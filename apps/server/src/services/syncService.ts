import { randomUUID } from "node:crypto";
import type { EventType, StandardEvent } from "@mcc/shared";
import { prisma } from "../db.js";
import { getConnector } from "./connectorManager.js";
import { MESSAGE_SOURCE, hydrateAndStore } from "./conversationHydration.js";
import { recordEvents } from "./eventEngine.js";
import { computeSaleFinancials } from "./financials.js";
import { dispatchNotifications } from "./notificationService.js";

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

    const caps = connector.supportedCapabilities;
    const [listings, conversations, offers, orders, sales] = await Promise.all([
      caps.includes("listings") ? connector.getListings() : Promise.resolve([]),
      caps.includes("messages") ? connector.getConversations() : Promise.resolve([]),
      caps.includes("offers") ? connector.getOffers() : Promise.resolve([]),
      caps.includes("orders") ? connector.getOrders() : Promise.resolve([]),
      caps.includes("sales") ? connector.getSales() : Promise.resolve([]),
    ]);

    // Connectors that only report state (coreDiffsState) get their events
    // derived here by comparing against what the DB already holds. Dedupe
    // keys are stable or tied to the transition, so a restart never re-fires
    // old alerts. The first sync of an account is a baseline: existing
    // listings aren't announced as "new", but listings that are already
    // taken down and unread messages are, since those need attention.
    const diff = connector.coreDiffsState === true;
    const coreEvents: StandardEvent[] = [];
    const emit = (type: EventType, entityId: string, key: string, payload: unknown) =>
      coreEvents.push({
        id: randomUUID(),
        type,
        platformId: connector.platformId,
        accountId: platformAccountId,
        timestamp: new Date().toISOString(),
        entityId,
        dedupeKey: `${connector.platformId}:${platformAccountId}:${key}`,
        payload,
      });
    const listingsBaseline = diff && (await prisma.listing.count({ where: { platformAccountId } })) === 0;

    const listingIdByExternal = new Map<string, string>();
    const touchedItems = new Set<string>();
    const newlySold: { id: string; inventoryItemId: string | null }[] = [];
    for (const l of listings) {
      const key = { platformAccountId_externalListingId: { platformAccountId, externalListingId: l.externalListingId } };
      const prev = diff ? await prisma.listing.findUnique({ where: key }) : null;
      const metadataJson = l.statusNote ? JSON.stringify({ statusNote: l.statusNote }) : null;
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
          metadataJson,
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
          ...(diff ? { metadataJson } : {}),
          updatedAt: new Date(l.updatedAt),
          ...needsDelistingUpdate,
        },
      });
      listingIdByExternal.set(l.externalListingId, row.id);

      // Real connectors: every newly seen listing gets its own inventory
      // item. Only at first sight, so a link the user later removes or
      // changes on the Listings page is never re-created.
      if (diff && !prev && !row.inventoryItemId) {
        const item = await prisma.inventoryItem.create({
          data: { title: l.title, status: inventoryStatusFor([l.status]), notes: `Auto-added from ${connector.platformId} listing` },
        });
        await prisma.listing.update({ where: { id: row.id }, data: { inventoryItemId: item.id } });
        row.inventoryItemId = item.id;
      }
      if (row.inventoryItemId) touchedItems.add(row.inventoryItemId);

      if (diff) {
        const ext = l.externalListingId;
        const at = Date.now();
        const payload = { listingId: row.id, listingTitle: l.title, price: l.price, currency: l.currency, url: l.url, reason: l.statusNote };
        if (!prev) {
          if (!listingsBaseline) emit("LISTING_CREATED", row.id, `created:${ext}`, payload);
          if (l.status === "REMOVED") emit("LISTING_REMOVED", row.id, `removed:${ext}:first-seen`, payload);
        } else if (prev.status !== l.status) {
          if (l.status === "SOLD") {
            await recordSaleFromListing(platformAccountId, row.id, ext, l.price, l.currency);
            emit("LISTING_SOLD", row.id, `sold:${ext}`, { ...payload, salePrice: l.price });
          } else if (l.status === "REMOVED") {
            emit("LISTING_REMOVED", row.id, `removed:${ext}:${at}`, payload);
          } else if (l.status === "ACTIVE") {
            const change = prev.status === "REMOVED" ? "Back up — no longer taken down" : "Marked available again";
            emit("LISTING_UPDATED", row.id, `active:${ext}:${at}`, { ...payload, change });
          }
        } else if (prev.price !== l.price) {
          emit("LISTING_UPDATED", row.id, `price:${ext}:${at}`, { ...payload, change: `Price ${prev.price} → ${l.price}` });
        }
      }
      if (l.status === "SOLD" && row.inventoryItemId) {
        newlySold.push({ id: row.id, inventoryItemId: row.inventoryItemId });
      }
    }

    for (const sold of newlySold) {
      await applyCrossListingAwareness(sold.id, sold.inventoryItemId!);
    }

    // A listing that vanished from the platform was deleted or taken down.
    // Skipped when the scrape came back empty, so a page-layout change can't
    // mass-flag everything as removed.
    if (diff && caps.includes("listings") && listings.length > 0) {
      const gone = await prisma.listing.findMany({
        where: {
          platformAccountId,
          status: { in: ["ACTIVE", "DRAFT"] },
          externalListingId: { notIn: listings.map((l) => l.externalListingId) },
        },
      });
      for (const g of gone) {
        if (g.inventoryItemId) touchedItems.add(g.inventoryItemId);
        const reason = "No longer on the selling page — deleted or taken down";
        await prisma.listing.update({
          where: { id: g.id },
          data: { status: "REMOVED", needsDelisting: false, metadataJson: JSON.stringify({ statusNote: reason }) },
        });
        emit("LISTING_REMOVED", g.id, `gone:${g.externalListingId}:${Date.now()}`, {
          listingId: g.id,
          listingTitle: g.title,
          price: g.price,
          currency: g.currency,
          url: g.url,
          reason,
        });
      }
    }

    for (const itemId of touchedItems) await syncInventoryStatus(itemId);

    const listingIdByTitle = new Map<string, string>();
    for (const l of listings) {
      const id = listingIdByExternal.get(l.externalListingId);
      if (id) listingIdByTitle.set(l.title, id);
    }

    let hydrationBudget = connector.hydrationsPerCycle ?? 0;
    let hydrationStopped = false;
    const hydrationErrors: string[] = [];

    for (const c of conversations) {
      const listingId =
        (c.externalListingId ? listingIdByExternal.get(c.externalListingId) : undefined) ??
        (c.listingTitle ? listingIdByTitle.get(c.listingTitle) : undefined);
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
          ...(listingId ? { listingId } : {}),
        },
      });

      const messages = await connector.getMessages(c.externalConversationId);
      const preview = messages[0];
      // A stored preview placeholder now recognised as a Facebook notice:
      // correct its classification (never alerts).
      if (preview?.direction === "SYSTEM") {
        await prisma.message.updateMany({
          where: { conversationId: conv.id, externalMessageId: preview.externalMessageId, direction: "UNKNOWN" },
          data: { direction: "SYSTEM", senderName: preview.senderName },
        });
      }

      // Conversation hydration (connectors that support it): open only
      // conversations whose latest message changed since their last read,
      // a few per cycle. Unread ones are never opened automatically —
      // viewing a conversation can mark it read on the platform — and
      // their preview is reliably INBOUND anyway (your own message can't
      // be unread to you); they're read in full once the user has read them.
      if (connector.hydrateConversation && preview) {
        const covered = conv.hydratedMessageId === preview.externalMessageId;
        if (!covered && !c.unread && hydrationBudget > 0 && !hydrationStopped) {
          hydrationBudget--;
          const outcome = await hydrateAndStore(connector, conv, {
            previewMessageId: preview.externalMessageId,
            platformUnread: c.unread,
          });
          coreEvents.push(...outcome.events);
          if (outcome.result.status === "SUCCESS") continue;
          if (outcome.result.status === "AUTH_REQUIRED" || outcome.result.status === "RATE_LIMITED") {
            hydrationStopped = true;
            hydrationErrors.push(`Conversation history: ${outcome.result.detail ?? outcome.result.status}`);
          }
        } else if (covered) {
          continue;
        }
      }

      for (const m of messages) {
        const where = { conversationId_externalMessageId: { conversationId: conv.id, externalMessageId: m.externalMessageId } };
        if (await prisma.message.findUnique({ where })) continue;
        const created = await prisma.message
          .create({
            data: {
              conversationId: conv.id,
              externalMessageId: m.externalMessageId,
              senderName: m.senderName,
              body: m.body,
              direction: m.direction,
              sentAt: new Date(m.sentAt),
            },
          })
          .catch(() => null);
        if (created && diff && m.direction === "INBOUND" && !m.historical) {
          // For hydrating connectors this is an inbox preview: the latest
          // message of an unread conversation — reliably from the buyer.
          emit("MESSAGE_RECEIVED", conv.id, `msg:${m.externalMessageId}`, {
            ...(connector.hydrateConversation ? { source: MESSAGE_SOURCE.PREVIEW } : {}),
            conversationId: conv.id,
            externalMessageId: m.externalMessageId,
            senderName: m.senderName,
            body: m.body,
            listingTitle: c.listingTitle,
            unreadCount: c.unreadCount,
            sentAt: m.sentAt,
          });
        }
      }
    }

    // Offers/sales can refer to a listing that isn't in this scan (e.g. it
    // sold and dropped off the shop page) — fall back to the DB.
    const resolveListing = async (externalListingId: string) => {
      const id = listingIdByExternal.get(externalListingId);
      if (id) return prisma.listing.findUnique({ where: { id } });
      return prisma.listing.findUnique({
        where: { platformAccountId_externalListingId: { platformAccountId, externalListingId } },
      });
    };

    for (const o of offers) {
      const listing = await resolveListing(o.externalListingId);
      if (diff && !o.historical) {
        const known = await prisma.offer.findUnique({
          where: { platformAccountId_externalOfferId: { platformAccountId, externalOfferId: o.externalOfferId } },
        });
        if (!known) {
          emit("OFFER_RECEIVED", listing?.id ?? o.externalListingId, `offer:${o.externalOfferId}`, {
            offerId: o.externalOfferId,
            listingId: listing?.id,
            listingTitle: listing?.title ?? o.listingTitle,
            buyerName: o.buyerName,
            amount: o.amount,
            currency: o.currency,
          });
        }
      }
      if (!listing) continue;
      const listingId = listing.id;
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
      const listingId = (await resolveListing(o.externalListingId))?.id;
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
      if (diff && !s.historical) {
        const listing = await resolveListing(s.externalListingId);
        // Same key as the listing-status transition, so a sale seen both on
        // the shop page and in an email alerts once.
        emit("LISTING_SOLD", listing?.id ?? s.externalListingId, `sold:${s.externalListingId}`, {
          listingId: listing?.id,
          listingTitle: listing?.title ?? s.listingTitle,
          salePrice: s.salePrice,
          currency: s.currency,
          buyerName: s.buyerName,
        });
      }
      const orderId = orderIdByExternal.get(s.externalOrderId);
      if (!orderId) continue;
      const platformFees = s.platformFees ?? 0;
      const paymentFees = s.paymentFees ?? 0;

      // Manual-entry fields (shippingCost, shippingRevenue, discount,
      // refundAmount, otherCosts, and purchaseCost once user-edited) are
      // never known to a connector — a routine sync must never stamp them
      // back to 0, or every 30s tick would erase what the user entered on
      // the Sales page. So: preserve an existing sale's manual fields, and
      // only derive purchaseCost from a linked InventoryItem on first
      // creation (best-effort — the user can always override it later).
      const existing = await prisma.sale.findUnique({ where: { orderId } });

      let purchaseCost = existing?.purchaseCost ?? 0;
      if (!existing) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: { listing: { select: { inventoryItem: { select: { purchaseCost: true } } } } },
        });
        purchaseCost = order?.listing.inventoryItem?.purchaseCost ?? 0;
      }

      const manual = {
        purchaseCost,
        shippingCost: existing?.shippingCost ?? 0,
        shippingRevenue: existing?.shippingRevenue ?? 0,
        discount: existing?.discount ?? 0,
        refundAmount: existing?.refundAmount ?? 0,
        otherCosts: existing?.otherCosts ?? 0,
      };
      const { netProfit, profitMargin } = computeSaleFinancials({
        salePrice: s.salePrice,
        platformFees,
        paymentFees,
        ...manual,
      });

      await prisma.sale.upsert({
        where: { orderId },
        create: {
          orderId,
          salePrice: s.salePrice,
          platformFees,
          paymentFees,
          netProfit,
          profitMargin,
          currency: s.currency,
          soldAt: new Date(s.soldAt),
          ...manual,
        },
        update: { salePrice: s.salePrice, platformFees, paymentFees, netProfit, profitMargin },
      });
    }

    // A sale whose order just came back REFUNDED gets a sensible default
    // (full refund) if the user hasn't already entered one manually —
    // still just a starting point, editable on the Sales page.
    for (const o of orders) {
      if (o.status !== "REFUNDED") continue;
      const orderId = orderIdByExternal.get(o.externalOrderId);
      if (!orderId) continue;
      const sale = await prisma.sale.findUnique({ where: { orderId } });
      if (!sale || sale.refundAmount > 0) continue;
      const { netProfit, profitMargin } = computeSaleFinancials({
        salePrice: sale.salePrice,
        purchaseCost: sale.purchaseCost,
        platformFees: sale.platformFees,
        paymentFees: sale.paymentFees,
        shippingCost: sale.shippingCost,
        shippingRevenue: sale.shippingRevenue,
        discount: sale.discount,
        otherCosts: sale.otherCosts,
        refundAmount: sale.salePrice,
      });
      await prisma.sale.update({
        where: { orderId },
        data: { refundAmount: sale.salePrice, netProfit, profitMargin },
      });
    }

    const { events, errors: connectorErrors } = await connector.sync();
    const errors = [...connectorErrors, ...hydrationErrors];
    const newEvents = await recordEvents(platformAccountId, [...events, ...coreEvents]);
    await dispatchNotifications(newEvents);

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
 * A listing seen turning SOLD becomes a sale on the Sales page, at the
 * listing price with cost from its inventory item. Fees, shipping, etc.
 * stay 0 for the user to fill in (platforms like Facebook don't report
 * them). Sold time is when the watchdog saw it change — accurate to one
 * check interval. Skipped if the connector already reported an order.
 */
async function recordSaleFromListing(
  platformAccountId: string,
  listingId: string,
  externalListingId: string,
  price: number,
  currency: string,
): Promise<void> {
  if (await prisma.order.findFirst({ where: { listingId } })) return;
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { inventoryItem: true } });
  const purchaseCost = listing?.inventoryItem?.purchaseCost ?? 0;
  const order = await prisma.order.create({
    data: { platformAccountId, listingId, externalOrderId: `listing-sold:${externalListingId}`, buyerName: "Unknown", status: "PAID" },
  });
  const zero = { platformFees: 0, paymentFees: 0, shippingCost: 0, shippingRevenue: 0, discount: 0, refundAmount: 0, otherCosts: 0 };
  const { netProfit, profitMargin } = computeSaleFinancials({ salePrice: price, purchaseCost, ...zero });
  await prisma.sale.create({
    data: { orderId: order.id, salePrice: price, purchaseCost, ...zero, netProfit, profitMargin, currency, soldAt: new Date() },
  });
}

/** Listing statuses → the inventory status they imply for their item. */
export function inventoryStatusFor(listingStatuses: string[]): string {
  if (listingStatuses.includes("SOLD")) return "SOLD";
  if (listingStatuses.includes("ACTIVE")) return "LISTED";
  return "INVENTORY";
}

// Statuses the listings themselves can explain. Anything else (RESERVED,
// PAID, SHIPPED, DELIVERED, RETURNED, REFUNDED) is the user's own
// fulfilment tracking and is never overwritten by a sync.
const LISTING_DRIVEN_STATUSES = ["INVENTORY", "LISTED", "SOLD"];

async function syncInventoryStatus(inventoryItemId: string): Promise<void> {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    include: { listings: { select: { status: true } } },
  });
  if (!item || !LISTING_DRIVEN_STATUSES.includes(item.status)) return;
  const next = inventoryStatusFor(item.listings.map((l) => l.status));
  if (next !== item.status) await prisma.inventoryItem.update({ where: { id: item.id }, data: { status: next } });
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
