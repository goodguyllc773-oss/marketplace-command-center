import { prisma } from "../db.js";
import { getConnector } from "./connectorManager.js";
import { recordEvents } from "./eventEngine.js";

export interface SyncOutcome {
  ok: boolean;
  newEvents: number;
  error?: string;
}

/**
 * Reconciles one PlatformAccount against its live connector: pulls
 * listings/conversations/messages/offers/orders/sales, upserts them by
 * external id, drains + dedupes standardized events, and updates the
 * account's Watchdog row. This is what a running watchdog calls on every
 * tick, and what "sync now" calls on demand.
 */
export async function runFullSync(platformAccountId: string): Promise<SyncOutcome> {
  try {
    const connector = await getConnector(platformAccountId);

    let health = await connector.healthCheck();
    if (!health.online && health.authenticated) {
      await connector.connect();
      health = await connector.healthCheck();
    }
    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        status: health.online && health.authenticated ? "CONNECTED" : health.authenticated ? "DISCONNECTED" : "AUTH_REQUIRED",
      },
    });

    const [listings, conversations, offers, orders, sales] = await Promise.all([
      connector.getListings(),
      connector.getConversations(),
      connector.supportedCapabilities.includes("offers") ? connector.getOffers() : Promise.resolve([]),
      connector.getOrders(),
      connector.supportedCapabilities.includes("sales") ? connector.getSales() : Promise.resolve([]),
    ]);

    const listingIdByExternal = new Map<string, string>();
    const newlySold: { id: string; inventoryItemId: string | null }[] = [];
    for (const l of listings) {
      // A listing no longer ACTIVE can't itself "need delisting" — clear
      // the flag on itself regardless (it only ever applies to sibling
      // listings still active elsewhere; see applyCrossListingAwareness).
      const needsDelistingUpdate = l.status !== "ACTIVE" ? { needsDelisting: false } : {};
      const row = await prisma.listing.upsert({
        where: {
          platformAccountId_externalListingId: {
            platformAccountId,
            externalListingId: l.externalListingId,
          },
        },
        create: {
          platformAccountId,
          externalListingId: l.externalListingId,
          title: l.title,
          price: l.price,
          currency: l.currency,
          status: l.status,
          url: l.url,
          views: l.views ?? undefined,
          likes: l.likes ?? undefined,
          watchers: l.watchers ?? undefined,
          offerCount: l.offerCount ?? undefined,
          messageCount: l.messageCount ?? undefined,
          createdAt: new Date(l.createdAt),
          updatedAt: new Date(l.updatedAt),
        },
        update: {
          title: l.title,
          price: l.price,
          status: l.status,
          url: l.url,
          views: l.views ?? undefined,
          likes: l.likes ?? undefined,
          watchers: l.watchers ?? undefined,
          offerCount: l.offerCount ?? undefined,
          messageCount: l.messageCount ?? undefined,
          updatedAt: new Date(l.updatedAt),
          ...needsDelistingUpdate,
        },
      });
      listingIdByExternal.set(l.externalListingId, row.id);
      if (l.status === "SOLD" && row.inventoryItemId) {
        newlySold.push({ id: row.id, inventoryItemId: row.inventoryItemId });
      }
    }

    for (const sold of newlySold) {
      await applyCrossListingAwareness(sold.id, sold.inventoryItemId!);
    }

    const listingIdByTitle = new Map<string, string>();
    for (const l of listings) {
      const id = listingIdByExternal.get(l.externalListingId);
      if (id) listingIdByTitle.set(l.title, id);
    }

    for (const c of conversations) {
      const listingId = c.listingTitle ? listingIdByTitle.get(c.listingTitle) : undefined;
      const conv = await prisma.conversation.upsert({
        where: {
          platformAccountId_externalConversationId: {
            platformAccountId,
            externalConversationId: c.externalConversationId,
          },
        },
        create: {
          platformAccountId,
          externalConversationId: c.externalConversationId,
          buyerName: c.buyerName,
          lastMessageAt: new Date(c.lastMessageAt),
          unread: c.unread,
          listingId,
        },
        update: {
          buyerName: c.buyerName,
          lastMessageAt: new Date(c.lastMessageAt),
          unread: c.unread,
        },
      });

      const messages = await connector.getMessages(c.externalConversationId);
      for (const m of messages) {
        await prisma.message
          .upsert({
            where: {
              conversationId_externalMessageId: {
                conversationId: conv.id,
                externalMessageId: m.externalMessageId,
              },
            },
            create: {
              conversationId: conv.id,
              externalMessageId: m.externalMessageId,
              senderName: m.senderName,
              body: m.body,
              direction: m.direction,
              sentAt: new Date(m.sentAt),
            },
            update: {},
          })
          .catch(() => undefined);
      }
    }

    for (const o of offers) {
      const listingId = listingIdByExternal.get(o.externalListingId);
      if (!listingId) continue;
      await prisma.offer.upsert({
        where: {
          platformAccountId_externalOfferId: {
            platformAccountId,
            externalOfferId: o.externalOfferId,
          },
        },
        create: {
          platformAccountId,
          listingId,
          externalOfferId: o.externalOfferId,
          buyerName: o.buyerName,
          amount: o.amount,
          currency: o.currency,
          status: o.status,
          createdAt: new Date(o.createdAt),
        },
        update: { status: o.status },
      });
    }

    const orderIdByExternal = new Map<string, string>();
    for (const o of orders) {
      const listingId = listingIdByExternal.get(o.externalListingId);
      if (!listingId) continue;
      const row = await prisma.order.upsert({
        where: {
          platformAccountId_externalOrderId: {
            platformAccountId,
            externalOrderId: o.externalOrderId,
          },
        },
        create: {
          platformAccountId,
          listingId,
          externalOrderId: o.externalOrderId,
          buyerName: o.buyerName,
          status: o.status,
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
        },
        update: { status: o.status, updatedAt: new Date(o.updatedAt) },
      });
      orderIdByExternal.set(o.externalOrderId, row.id);
    }

    for (const s of sales) {
      const orderId = orderIdByExternal.get(s.externalOrderId);
      if (!orderId) continue;
      const platformFees = s.platformFees ?? 0;
      const paymentFees = s.paymentFees ?? 0;
      const netProfit = s.salePrice - platformFees - paymentFees;
      await prisma.sale.upsert({
        where: { orderId },
        create: {
          orderId,
          salePrice: s.salePrice,
          platformFees,
          paymentFees,
          netProfit,
          profitMargin: s.salePrice > 0 ? netProfit / s.salePrice : 0,
          currency: s.currency,
          soldAt: new Date(s.soldAt),
        },
        update: {
          salePrice: s.salePrice,
          platformFees,
          paymentFees,
          netProfit,
          profitMargin: s.salePrice > 0 ? netProfit / s.salePrice : 0,
        },
      });
    }

    const { events, errors } = await connector.sync();
    const newEvents = await recordEvents(platformAccountId, events);

    await prisma.watchdog.update({
      where: { platformAccountId },
      data: {
        lastSuccessAt: new Date(),
        state: errors.length > 0 ? "ERROR" : "RUNNING",
        lastError: errors[0] ?? null,
      },
    });

    return { ok: errors.length === 0, newEvents: newEvents.length, error: errors[0] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.watchdog
      .update({ where: { platformAccountId }, data: { state: "ERROR", lastError: message } })
      .catch(() => undefined);
    return { ok: false, newEvents: 0, error: message };
  }
}

/**
 * Spec section 10 — cross-listing awareness: when one listing for an
 * InventoryItem sells, the item itself is SOLD and every *other* still-ACTIVE
 * listing for that same item (on any platform/account) becomes a
 * "needs delisting" warning — a manual workflow, never an automatic
 * cross-platform delist (spec explicitly rules that out for now).
 */
async function applyCrossListingAwareness(soldListingId: string, inventoryItemId: string): Promise<void> {
  await prisma.inventoryItem.update({ where: { id: inventoryItemId }, data: { status: "SOLD" } });
  await prisma.listing.updateMany({
    where: { inventoryItemId, id: { not: soldListingId }, status: "ACTIVE" },
    data: { needsDelisting: true },
  });
}
