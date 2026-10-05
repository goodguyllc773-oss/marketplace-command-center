import { randomUUID } from "node:crypto";
import {
  dateLabelToDay,
  parseConversationList,
  parseConversationView,
  parseOffersPage,
  previewMessageId,
  titleFromSlug,
  viewMessageId,
} from "@mcc/connectors";
import type { StandardEvent } from "@mcc/shared";
import { prisma } from "../db.js";
import { recordEvents } from "./eventEngine.js";
import { dispatchNotifications } from "./notificationService.js";

/**
 * Turns the Depop messages page — as read by the "MCC Depop Reader"
 * extension in the user's own Chrome — into Inbox conversations and alerts.
 *
 * Only the conversation list is parsed: per conversation the buyer, the
 * latest message's text and day, and Depop's unread marker. The list
 * doesn't say who sent the latest message, so (as with Facebook previews)
 * it's INBOUND only when the conversation is unread — your own message
 * can't be unread to you — SYSTEM for Depop's own notices, else UNKNOWN.
 *
 * Alerts: MESSAGE_RECEIVED for a new unread buyer message, a
 * PLATFORM_NOTIFICATION for a new Depop notice, OFFER_RECEIVED when the
 * Offers tab turns "unread". The very first page seen for a shop is the
 * starting point: stored, never alerted.
 */

export interface ExtensionStatus {
  lastSeenAt: string;
  lastSnapshotAt?: string;
  path: string;
  visible?: boolean;
  /** When the first conversation list was stored (no alerts before it). */
  baselineAt?: string;
  unreadOffers?: boolean;
  conversations?: number;
  /** Set once an "extension stopped reporting" alert went out. */
  offlineAlertedAt?: string;
  /** The extension's auto-refresh (clicks Depop's own Refresh button). */
  autoRefresh?: boolean;
  refreshMinutes?: number;
  lastRefreshAt?: string;
  refreshProblem?: string;
  /** The extension's Offers-tab check (opens the tab, reads it, goes back). */
  offersCheck?: boolean;
  offersMinutes?: number;
  /** First Offers tab stored (no offer alerts before it) / latest read. */
  offersBaselineAt?: string;
  lastOffersAt?: string;
}

const PLATFORM_ID = "depop-live";
export const statusKey = (accountId: string) => `depopExtension:${accountId}`;

export async function getExtensionStatus(accountId: string): Promise<ExtensionStatus | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: statusKey(accountId) } });
  return row ? (JSON.parse(row.value) as ExtensionStatus) : null;
}

export async function saveExtensionStatus(accountId: string, status: ExtensionStatus): Promise<void> {
  const value = JSON.stringify(status);
  await prisma.appSetting.upsert({ where: { key: statusKey(accountId) }, create: { key: statusKey(accountId), value }, update: { value } });
}

// Reports (two open tabs, check-ins, the offline check) all read-modify-
// write the shop's status — one at a time per shop.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(accountId) ?? Promise.resolve()).then(fn);
  queues.set(accountId, run.catch(() => undefined));
  return run;
}

export interface ExtensionReport {
  kind: "heartbeat" | "snapshot";
  page: {
    path: string;
    visible?: boolean;
    autoRefresh?: boolean;
    refreshMinutes?: number;
    lastRefreshAt?: string;
    refreshProblem?: string;
    offersCheck?: boolean;
    offersMinutes?: number;
  };
  snapshot?: unknown;
}

/** A check-in or page update from the extension. */
export function handleExtensionReport(accountId: string, report: ExtensionReport) {
  return serial(accountId, async () => {
    const now = new Date().toISOString();
    const previous = await getExtensionStatus(accountId);
    const status: ExtensionStatus = {
      ...previous,
      lastSeenAt: now,
      lastSnapshotAt: report.kind === "snapshot" ? now : previous?.lastSnapshotAt,
      path: report.page.path,
      visible: report.page.visible,
      autoRefresh: report.page.autoRefresh,
      refreshMinutes: report.page.refreshMinutes,
      lastRefreshAt: report.page.lastRefreshAt ?? previous?.lastRefreshAt,
      refreshProblem: report.page.refreshProblem,
      offersCheck: report.page.offersCheck,
      offersMinutes: report.page.offersMinutes,
    };
    await saveExtensionStatus(accountId, status);
    if (report.kind !== "snapshot" || !report.snapshot) return null;
    if (/^\/messages\/offers\/?$/.test(report.page.path)) {
      const offers = await ingestOffers(accountId, status, report.snapshot);
      return { conversations: 0, newMessages: 0, alerts: offers.alerts, offers: offers.cards };
    }
    // An open conversation first, so its list preview isn't then stored
    // as a separate message.
    const view = await ingestView(accountId, report.page.path, report.snapshot);
    const list = await ingest(accountId, status, report.snapshot);
    return { ...list, viewMessages: view };
  });
}

/** Depop's card wording → MCC offer status. */
function offerStatus(label: string): string {
  if (/it[’']s a deal|accepted/i.test(label)) return "ACCEPTED";
  if (/^offer sent$/i.test(label)) return "SENT";
  if (/expired/i.test(label)) return "EXPIRED";
  if (/item sold/i.test(label)) return "ITEM_SOLD";
  if (/declined/i.test(label)) return "DECLINED";
  if (/special offer|counter|new offer|offer received|buyer[’']s offer/i.test(label)) return "PENDING";
  return "OTHER";
}

const ACTIVE_STATUSES = new Set(["PENDING", "SENT", "ACCEPTED", "OTHER"]);
const usd = (n: number | null | undefined) => (n == null ? "?" : `US$${n.toFixed(2)}`);

/**
 * The Offers tab → MCC offers + alerts. Cards don't name the other person.
 * An offer is keyed by item + who offered + amount, so its status moving
 * (sent → deal → expired) updates one record. Alerts once per offer per
 * status; the first Offers tab seen for a shop is the starting point
 * (stored, not alerted). Expiry only alerts for offers seen active.
 */
async function ingestOffers(accountId: string, status: ExtensionStatus, snapshot: unknown) {
  const cards = parseOffersPage(snapshot);
  if (cards.length === 0) return { cards: 0, alerts: 0 };
  const baseline = !status.offersBaselineAt;
  const now = new Date();
  const events: StandardEvent[] = [];

  for (const card of cards) {
    if (!card.itemSlug) continue;
    const slug = card.itemSlug;
    const itemUrl = `https://www.depop.com/products/${slug}/`;
    const listing = await prisma.listing.findUnique({
      where: { platformAccountId_externalListingId: { platformAccountId: accountId, externalListingId: slug } },
      select: { id: true, title: true },
    });
    const itemTitle = listing?.title ?? titleFromSlug(slug);
    const newStatus = offerStatus(card.statusLabel);

    // "Item sold" cards carry no amount: they close the offers we know on it.
    if (card.amount === null) {
      const open = await prisma.offer.findMany({
        where: { platformAccountId: accountId, externalOfferId: { startsWith: `depop-offer:${slug}:` }, status: { in: [...ACTIVE_STATUSES] } },
      });
      for (const o of open) {
        await prisma.offer.update({ where: { id: o.id }, data: { status: newStatus, statusLabel: card.statusLabel } });
        if (!baseline) events.push(offerEvent(accountId, now, "OFFER_EXPIRED", o.externalOfferId, newStatus, `${card.statusLabel}: ${itemTitle} — your offer of ${usd(o.amount)} didn't go through\n${itemUrl}`));
      }
      continue;
    }

    const role = listing || card.offeredBy === "BUYER" ? "SELLING" : "BUYING";
    const externalOfferId = `depop-offer:${slug}:${card.offeredBy ?? "unknown"}:${card.amount.toFixed(2)}`;
    const prior = await prisma.offer.findUnique({
      where: { platformAccountId_externalOfferId: { platformAccountId: accountId, externalOfferId } },
    });
    const data = {
      listingId: listing?.id ?? null,
      buyerName: role === "SELLING" ? "Buyer" : "Seller",
      amount: card.amount,
      currency: card.currency,
      status: newStatus,
      role,
      offeredBy: card.offeredBy === "YOU" ? "BUYER" : card.offeredBy,
      itemTitle,
      itemUrl,
      originalPrice: card.originalPrice,
      statusLabel: card.statusLabel,
      deadlineLabel: card.deadlineLabel,
    };
    if (prior) await prisma.offer.update({ where: { id: prior.id }, data });
    else await prisma.offer.create({ data: { platformAccountId: accountId, externalOfferId, ...data } });

    if (baseline || prior?.status === newStatus) continue;
    const was = card.originalPrice ? ` (was ${usd(card.originalPrice)})` : "";
    const by = card.deadlineLabel ? ` — ${card.deadlineLabel.charAt(0).toLowerCase()}${card.deadlineLabel.slice(1)}` : "";
    const buying = role === "BUYING" ? " (you're buying)" : "";
    let event: { type: StandardEvent["type"]; summary: string } | null = null;
    if (newStatus === "PENDING") {
      event =
        card.offeredBy === "SELLER"
          ? { type: "OFFER_RECEIVED", summary: `Seller's special offer: ${usd(card.amount)}${was} on ${itemTitle}${by}${buying}` }
          : { type: "OFFER_RECEIVED", summary: `Offer from a buyer: ${usd(card.amount)}${was} on ${itemTitle}${by}` };
    } else if (newStatus === "ACCEPTED") {
      event =
        role === "BUYING"
          ? { type: "OFFER_ACCEPTED", summary: `It's a deal — ${usd(card.amount)}${was} on ${itemTitle}${by}${buying}` }
          : { type: "OFFER_ACCEPTED", summary: `Deal agreed: ${usd(card.amount)}${was} on ${itemTitle}${by}` };
    } else if ((newStatus === "EXPIRED" || newStatus === "ITEM_SOLD") && prior && ACTIVE_STATUSES.has(prior.status)) {
      event = { type: "OFFER_EXPIRED", summary: `${card.statusLabel}: ${usd(card.amount)} on ${itemTitle}${buying}` };
    } else if (newStatus === "DECLINED") {
      event = { type: "OFFER_DECLINED", summary: `Offer declined: ${usd(card.amount)} on ${itemTitle}${buying}` };
    } else if (newStatus === "OTHER") {
      event = { type: "PLATFORM_NOTIFICATION", summary: `Depop offer update — ${card.statusLabel}: ${usd(card.amount)} on ${itemTitle}${by}` };
    }
    if (event) events.push(offerEvent(accountId, now, event.type, externalOfferId, newStatus, `${event.summary}\n${itemUrl}`));
  }

  await saveExtensionStatus(accountId, { ...status, offersBaselineAt: status.offersBaselineAt ?? now.toISOString(), lastOffersAt: now.toISOString() });
  if (events.length > 0) await dispatchNotifications(await recordEvents(accountId, events));
  return { cards: cards.length, alerts: events.length };
}

function offerEvent(accountId: string, now: Date, type: StandardEvent["type"], offerId: string, status: string, summary: string): StandardEvent {
  return {
    id: randomUUID(),
    type,
    platformId: PLATFORM_ID,
    accountId,
    timestamp: now.toISOString(),
    entityId: offerId,
    dedupeKey: `${PLATFORM_ID}:${accountId}:offer:${offerId}:${status}`,
    payload: { summary, source: "DEPOP_OFFERS_TAB", offerId },
  };
}

const sameText = (a: string, b: string) => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const [x, y] = [norm(a), norm(b)];
  return x === y || (y.length >= 20 && (x.startsWith(y) || y.startsWith(x)));
};

/**
 * Stores the messages of a conversation the user has open on Depop. Never
 * alerts: the user is reading it right now, and new-message alerts come
 * from the list. List previews already stored are converted in place to
 * the message they stand for, so nothing is duplicated.
 */
async function ingestView(accountId: string, pagePath: string, snapshot: unknown): Promise<number> {
  const now = new Date();
  const view = parseConversationView(snapshot, pagePath, now);
  if (!view || view.messages.length === 0) return 0;

  const existing = await prisma.conversation.findUnique({
    where: { platformAccountId_externalConversationId: { platformAccountId: accountId, externalConversationId: view.conversationId } },
  });
  const listing = view.itemSlug
    ? await prisma.listing.findUnique({
        where: { platformAccountId_externalListingId: { platformAccountId: accountId, externalListingId: view.itemSlug } },
        select: { id: true },
      })
    : null;
  const last = view.messages.at(-1)!;
  const conv =
    existing ??
    (await prisma.conversation.create({
      data: {
        platformAccountId: accountId,
        externalConversationId: view.conversationId,
        buyerName: view.otherUser ? `@${view.otherUser}` : "Depop user",
        lastMessageAt: last.sentAt ?? now,
        unread: false,
      },
    }));
  if (listing && conv.listingId !== listing.id) {
    await prisma.conversation.update({ where: { id: conv.id }, data: { listingId: listing.id } });
  }

  // Same-minute messages keep their on-screen order (ms offsets), and
  // identical repeats in one minute get #2, #3… — as with Facebook.
  const occurrences = new Map<string, number>();
  const perMinute = new Map<string, number>();
  const rows = view.messages.map((m) => {
    const minute = m.sentAt ? m.sentAt.toISOString() : "undated";
    const key = `${minute}|${m.direction}|${m.body}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const position = perMinute.get(minute) ?? 0;
    perMinute.set(minute, position + 1);
    return {
      externalMessageId: viewMessageId(view.conversationId, m.sentAt, m.direction, m.body, occurrence),
      direction: m.direction,
      body: m.body,
      senderName: m.direction === "OUTBOUND" ? "You" : view.otherUser ? `@${view.otherUser}` : conv.buyerName,
      sentAt: new Date((m.sentAt ?? now).getTime() + position),
    };
  });

  let added = 0;
  await prisma.$transaction(async (tx) => {
    const previews = await tx.message.findMany({
      where: { conversationId: conv.id, externalMessageId: { startsWith: "depop-preview:" } },
    });
    for (const r of rows) {
      const where = { conversationId_externalMessageId: { conversationId: conv.id, externalMessageId: r.externalMessageId } };
      if (await tx.message.findUnique({ where })) continue;
      const preview = previews.find((p) => sameText(p.body, r.body));
      const data = { externalMessageId: r.externalMessageId, senderName: r.senderName, direction: r.direction, body: r.body, sentAt: r.sentAt };
      if (preview) {
        previews.splice(previews.indexOf(preview), 1);
        await tx.message.update({ where: { id: preview.id }, data });
      } else {
        await tx.message.create({ data: { conversationId: conv.id, ...data } });
        added++;
      }
    }
    if (last.sentAt && last.sentAt > conv.lastMessageAt) {
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: last.sentAt } });
    }
  });
  return added;
}

async function ingest(accountId: string, status: ExtensionStatus, snapshot: unknown) {
  const page = parseConversationList(snapshot);
  // Nothing recognisable (still loading, or a layout we don't know) —
  // never treat that as "all conversations gone".
  if (page.rows.length === 0) return { conversations: 0, newMessages: 0, alerts: 0 };

  const baseline = !status.baselineAt;
  const now = new Date();
  const events: StandardEvent[] = [];
  const event = (type: StandardEvent["type"], entityId: string, dedupe: string, payload: Record<string, unknown>) =>
    events.push({
      id: randomUUID(),
      type,
      platformId: PLATFORM_ID,
      accountId,
      timestamp: now.toISOString(),
      entityId,
      dedupeKey: `${PLATFORM_ID}:${accountId}:${dedupe}`,
      payload,
    });

  let newMessages = 0;
  for (const row of page.rows) {
    const day = dateLabelToDay(row.dateLabel, now);
    // Only "Today" carries no fixed day to date by; it's dated when first seen.
    const sentAt = day && !/^today$/i.test(row.dateLabel) ? new Date(`${day}T12:00:00`) : now;
    const direction = row.fromDepop ? "SYSTEM" : row.unread ? "INBOUND" : "UNKNOWN";
    const senderName = row.fromDepop ? "Depop" : row.unread ? `@${row.username}` : "Latest message";
    const buyerName = row.fromDepop ? "Depop" : `@${row.username}`;

    const conv = await prisma.conversation.upsert({
      where: { platformAccountId_externalConversationId: { platformAccountId: accountId, externalConversationId: row.conversationId } },
      create: { platformAccountId: accountId, externalConversationId: row.conversationId, buyerName, lastMessageAt: sentAt, unread: row.unread },
      update: { buyerName, unread: row.unread },
    });

    const externalMessageId = previewMessageId(row.conversationId, row.preview, day ?? "undated");
    const known = await prisma.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conv.id, externalMessageId } },
    });
    if (known) continue;
    // Already stored from the open conversation (same text, recently) —
    // the preview is that message, not a new one.
    const recent = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { sentAt: "desc" },
      take: 5,
      select: { body: true },
    });
    if (recent.some((m) => sameText(m.body, row.preview))) continue;

    await prisma.message.create({
      data: { conversationId: conv.id, externalMessageId, senderName, body: row.preview, direction, sentAt },
    });
    newMessages++;
    if (sentAt > conv.lastMessageAt) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: sentAt } });
    }
    if (baseline) continue;

    if (direction === "INBOUND") {
      event("MESSAGE_RECEIVED", conv.id, `msg:${externalMessageId}`, {
        source: "DEPOP_MESSAGES_PAGE",
        conversationId: conv.id,
        externalMessageId,
        senderName,
        body: row.preview,
      });
    } else if (direction === "SYSTEM") {
      event("PLATFORM_NOTIFICATION", conv.id, `msg:${externalMessageId}`, {
        summary: `Message from Depop: ${row.preview}`,
        conversationId: conv.id,
      });
    }
  }

  // With the extension's Offers-tab check on, the detailed offer alerts
  // replace this vague one.
  if (page.unreadOffers === true && status.unreadOffers !== true && !baseline && !status.offersCheck) {
    event("OFFER_RECEIVED", accountId, `offers-unread:${now.toISOString()}`, {
      summary: "New offer activity on Depop — open Messages → Offers on Depop to see it",
    });
  }

  await saveExtensionStatus(accountId, {
    ...status,
    baselineAt: status.baselineAt ?? now.toISOString(),
    unreadOffers: page.unreadOffers ?? status.unreadOffers,
    conversations: page.rows.length,
  });

  if (events.length > 0) await dispatchNotifications(await recordEvents(accountId, events));
  return { conversations: page.rows.length, newMessages, alerts: events.length };
}

/** Seen within this long = the Depop messages tab is still open. The
 * extension checks in every minute; Chrome may slow background tabs. */
export const EXTENSION_OFFLINE_AFTER_MS = 10 * 60_000;

/**
 * One Discord alert (health) when a shop's Depop tab that was reporting
 * goes quiet — closed tab, Chrome closed, PC asleep, or MCC unreachable —
 * so a silent gap in Depop alerts doesn't go unnoticed.
 */
export async function checkExtensionsOffline(): Promise<void> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "depopExtension:" } } });
  for (const row of rows) {
    const accountId = row.key.slice("depopExtension:".length);
    await serial(accountId, () => alertIfOffline(accountId));
  }
}

async function alertIfOffline(accountId: string): Promise<void> {
  const status = await getExtensionStatus(accountId);
  if (!status) return;
  const quietFor = Date.now() - new Date(status.lastSeenAt).getTime();
  if (quietFor < EXTENSION_OFFLINE_AFTER_MS || status.offlineAlertedAt === status.lastSeenAt) return;

  const created = await recordEvents(accountId, [
    {
      id: randomUUID(),
      type: "WATCHDOG_ERROR",
      platformId: PLATFORM_ID,
      accountId,
      timestamp: new Date().toISOString(),
      entityId: accountId,
      dedupeKey: `${PLATFORM_ID}:${accountId}:extension-offline:${status.lastSeenAt}`,
      payload: {
        summary: `Depop messages aren't being watched — the Depop tab stopped reporting at ${new Date(status.lastSeenAt).toLocaleTimeString()}. Open depop.com/messages in Chrome again.`,
      },
    },
  ]);
  await saveExtensionStatus(accountId, { ...status, offlineAlertedAt: status.lastSeenAt });
  await dispatchNotifications(created);
}
