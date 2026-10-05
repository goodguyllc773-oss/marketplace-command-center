import type { Conversation, Message } from "@prisma/client";
import type { ConnectorMessage, HydrationResult, MarketplaceConnector } from "@mcc/connectors";
import type { StandardEvent } from "@mcc/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";

/** A never-hydrated conversation only alerts for messages sent shortly
 * before we first saw it — older ones are history being backfilled. */
const NEW_CONVERSATION_ALERT_WINDOW_MS = 10 * 60_000;

/** Where a message/event came from. Inbox previews only know the latest
 * message; the conversation view is the source of truth once readable. */
export const MESSAGE_SOURCE = {
  PREVIEW: "FACEBOOK_MARKETPLACE_INBOX",
  CONVERSATION: "FACEBOOK_CONVERSATION",
} as const;

/** Rows written from a conversation read carry a synthetic fingerprint
 * id with this prefix; anything else is an inbox-preview placeholder. */
const FINGERPRINT_PREFIX = "facebook:";

export interface HydrationOutcome {
  result: HydrationResult;
  added: number;
  updated: number;
  events: StandardEvent[];
}

export interface HydrateOptions {
  /** Inbox latest-message id this read covers (automatic reads). */
  previewMessageId?: string;
  manual?: boolean;
  /** Facebook's current unread state, from this cycle's inbox scan. */
  platformUnread?: boolean;
  /** The user explicitly confirmed opening an unread conversation. */
  allowUnread?: boolean;
}

/**
 * Reads a conversation's full history through the connector and stores it
 * in the existing Message table. Shared by the watchdog cycle and the
 * Inbox's manual "Load conversation history".
 *
 * - Never opens an unread conversation without explicit confirmation
 *   (checked here AND in the connector against Facebook's own state).
 * - Messages are keyed by the connector's synthetic fingerprint
 *   (externalMessageId), so repeated reads never duplicate rows.
 * - Inbox-preview placeholders are converted in place to the message they
 *   stand for (matched by text, else by time), or removed if that message
 *   is already stored — never left as duplicates.
 * - All writes + the checkpoint commit in one transaction: a failed read
 *   or failed write never advances `hydratedMessageId`/`hydratedAt`.
 * - MESSAGE_RECEIVED only for genuinely new INBOUND messages (never
 *   OUTBOUND/SYSTEM/UNKNOWN), dedupe key `msg:<fingerprint>`.
 */
export async function hydrateAndStore(
  connector: MarketplaceConnector,
  conversation: Conversation,
  options: HydrateOptions = {},
): Promise<HydrationOutcome> {
  const tag = `[fb-hydration] conversation ${conversation.id}`;
  const empty = (result: HydrationResult): HydrationOutcome => ({ result, added: 0, updated: 0, events: [] });

  if ((options.platformUnread ?? false) && !options.allowUnread) {
    console.info(`${tag} skipped: unread`);
    return empty({ status: "SKIPPED_UNREAD", messages: [], reachedStart: false, detail: "Unread on Facebook — not opened" });
  }

  console.info(`${tag} started${options.manual ? " (manual)" : ""}`);
  let result: HydrationResult;
  try {
    result = await connector.hydrateConversation!(conversation.externalConversationId, {
      manual: options.manual,
      allowUnread: options.allowUnread,
      knownUnread: options.platformUnread ?? conversation.unread,
    });
  } catch (err) {
    result = { status: "UNKNOWN_ERROR", messages: [], reachedStart: false, detail: err instanceof Error ? err.message : String(err) };
  }
  if (result.status === "SKIPPED_UNREAD") {
    console.info(`${tag} skipped: unread`);
    return empty(result);
  }
  if (result.status !== "SUCCESS") {
    console.warn(`${tag} failed: ${result.status}`);
    return empty(result);
  }
  console.info(`${tag} found ${result.messages.length} messages${result.reachedStart ? " (full history)" : ""}`);

  let outcome: { added: number; updated: number; alertable: Set<string> };
  try {
    outcome = await prisma.$transaction((tx) => store(tx, conversation, result.messages, options.previewMessageId));
  } catch (err) {
    // Code/name only — database errors can echo the values (message text).
    const code = (err as { code?: string; name?: string }).code ?? (err as { name?: string }).name ?? "error";
    console.warn(`${tag} failed: storing messages (${code})`);
    return empty({ status: "UNKNOWN_ERROR", messages: [], reachedStart: false, detail: "Couldn't save the conversation" });
  }
  console.info(`${tag} completed: added ${outcome.added} / updated ${outcome.updated}`);

  const cutoff = conversation.hydratedAt
    ? floorToMinute(conversation.hydratedAt)
    : new Date(conversation.createdAt.getTime() - NEW_CONVERSATION_ALERT_WINDOW_MS);
  const listing = conversation.listingId
    ? await prisma.listing.findUnique({ where: { id: conversation.listingId }, select: { title: true } })
    : null;
  const events: StandardEvent[] = result.messages
    .filter((m) => m.direction === "INBOUND" && outcome.alertable.has(m.externalMessageId))
    .filter((m) => new Date(m.sentAt) >= cutoff)
    .map((m) => ({
      id: randomUUID(),
      type: "MESSAGE_RECEIVED",
      platformId: connector.platformId,
      accountId: conversation.platformAccountId,
      timestamp: m.sentAt,
      entityId: conversation.id,
      // Same key format as the sync service's own message events.
      dedupeKey: `${connector.platformId}:${conversation.platformAccountId}:msg:${m.externalMessageId}`,
      payload: {
        source: MESSAGE_SOURCE.CONVERSATION,
        conversationId: conversation.id,
        externalMessageId: m.externalMessageId,
        senderName: m.senderName,
        body: m.body,
        listingTitle: listing?.title,
      },
    }));

  return { result, added: outcome.added, updated: outcome.updated, events };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function store(
  tx: Tx,
  conversation: Conversation,
  messages: ConnectorMessage[],
  previewMessageId: string | undefined,
): Promise<{ added: number; updated: number; alertable: Set<string> }> {
  const alertable = new Set<string>();
  const claimed = new Set<string>();
  let added = 0;
  let updated = 0;

  // 1. Reconcile preview placeholders first, so the message they stand for
  //    isn't then inserted (and alerted) a second time.
  const placeholders = await tx.message.findMany({
    where: { conversationId: conversation.id, NOT: { externalMessageId: { startsWith: FINGERPRINT_PREFIX } } },
    orderBy: { sentAt: "desc" },
  });
  for (const ph of placeholders) {
    const match = matchPlaceholder(ph, messages, claimed);
    if (!match) continue;
    claimed.add(match.externalMessageId);
    const already = await tx.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId: match.externalMessageId } },
    });
    if (already) {
      await tx.message.delete({ where: { id: ph.id } });
      continue;
    }
    await tx.message.update({
      where: { id: ph.id },
      data: {
        externalMessageId: match.externalMessageId,
        senderName: match.senderName,
        direction: match.direction,
        sentAt: new Date(match.sentAt),
        body: match.body,
      },
    });
    updated++;
    // An INBOUND preview was already alerted from the inbox scan.
    if (ph.direction !== "INBOUND") alertable.add(match.externalMessageId);
  }

  // 2. Insert or reconcile every message read from the conversation.
  for (const m of messages) {
    const where = { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId: m.externalMessageId } };
    const existing = await tx.message.findUnique({ where });
    const data = { senderName: m.senderName, direction: m.direction, sentAt: new Date(m.sentAt), body: m.body };
    if (!existing) {
      await tx.message.create({ data: { conversationId: conversation.id, externalMessageId: m.externalMessageId, ...data } });
      added++;
      alertable.add(m.externalMessageId);
    } else if (
      existing.senderName !== data.senderName ||
      existing.direction !== data.direction ||
      existing.body !== data.body ||
      existing.sentAt.getTime() !== data.sentAt.getTime()
    ) {
      await tx.message.update({ where: { id: existing.id }, data });
      updated++;
    }
  }

  // 3. Checkpoint — only reached when everything above succeeded.
  await tx.conversation.update({
    where: { id: conversation.id },
    data: { hydratedAt: new Date(), ...(previewMessageId ? { hydratedMessageId: previewMessageId } : {}) },
  });
  return { added, updated, alertable };
}

/**
 * Which conversation message an inbox-preview placeholder stands for.
 * The preview is the conversation's latest message as of its timestamp
 * (the thread's update time), so: same text first; otherwise (e.g. the
 * preview said "sent a photo" but the message is an attachment) the latest
 * not-yet-claimed message at or just before that time.
 */
function matchPlaceholder(ph: Message, messages: ConnectorMessage[], claimed: Set<string>): ConnectorMessage | undefined {
  const free = messages.filter((m) => !claimed.has(m.externalMessageId));
  const snippet = ph.body.replace(/\s+/g, " ").trim().replace(/…$/, "");
  const byText = [...free].reverse().find((m) => m.body === snippet || (snippet.length >= 20 && m.body.startsWith(snippet)));
  if (byText || ph.direction === "SYSTEM") return byText;
  const limit = ph.sentAt.getTime() + 60_000;
  return [...free].reverse().find((m) => new Date(m.sentAt).getTime() <= limit && m.direction !== "SYSTEM");
}

function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}
