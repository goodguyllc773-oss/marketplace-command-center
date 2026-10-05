import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conversationUrl } from "@mcc/connectors";
import { prisma } from "../db.js";
import { getConnector } from "../services/connectorManager.js";
import { hydrateAndStore } from "../services/conversationHydration.js";
import { recordEvents } from "../services/eventEngine.js";
import { dispatchNotifications } from "../services/notificationService.js";

const ListQuerySchema = z.object({
  platformId: z.string().optional(),
  accountId: z.string().optional(),
  unread: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
});

const ReplySchema = z.object({ message: z.string().min(1) });
const PatchSchema = z.object({ unread: z.boolean().optional(), archived: z.boolean().optional() });

export function registerConversationRoutes(app: FastifyInstance): void {
  /** Per-platform unread counts for the inbox sidebar — independent of the
   * current list filter, so switching filters doesn't jitter the counts. */
  app.get("/api/inbox/summary", async () => {
    const unread = await prisma.conversation.findMany({
      where: { unread: true, archived: false },
      select: {
        platformAccount: { select: { id: true, label: true, platform: { select: { id: true, key: true, name: true } } } },
      },
    });

    // Every platform gets a tab, even with nothing unread.
    const byPlatform = new Map<string, { platformId: string; platformKey: string; platformName: string; unread: number }>();
    for (const p of await prisma.platform.findMany({ orderBy: { name: "asc" } })) {
      byPlatform.set(p.id, { platformId: p.id, platformKey: p.key, platformName: p.name, unread: 0 });
    }
    for (const c of unread) {
      const p = c.platformAccount.platform;
      const existing = byPlatform.get(p.id);
      if (existing) existing.unread += 1;
      else byPlatform.set(p.id, { platformId: p.id, platformKey: p.key, platformName: p.name, unread: 1 });
    }

    return { totalUnread: unread.length, byPlatform: [...byPlatform.values()] };
  });

  app.get("/api/conversations", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { platformId, accountId, unread, archived, q } = parsed.data;

    const conversations = await prisma.conversation.findMany({
      where: {
        archived: archived ? archived === "true" : false,
        unread: unread ? unread === "true" : undefined,
        platformAccountId: accountId,
        platformAccount: platformId ? { platformId } : undefined,
      },
      include: {
        platformAccount: { include: { platform: true } },
        listing: { select: { id: true, title: true } },
        // Full history when searching (so a match anywhere in the thread
        // surfaces it), otherwise just the most recent message for the
        // list preview.
        messages: q ? { orderBy: { sentAt: "desc" } } : { orderBy: { sentAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    const filtered = q
      ? conversations.filter((c) => matchesSearch(c, q))
      : conversations;

    return filtered.map((c) => ({
      id: c.id,
      buyerName: c.buyerName,
      lastMessageAt: c.lastMessageAt,
      unread: c.unread,
      archived: c.archived,
      listing: c.listing,
      platformAccount: c.platformAccount,
      lastMessage: c.messages[0] ?? null,
    }));
  });

  app.get("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        platformAccount: { include: { platform: true } },
        listing: { select: { id: true, title: true, price: true, currency: true, url: true } },
        messages: { orderBy: { sentAt: "asc" } },
      },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    let capabilities: readonly string[] = [];
    let canLoadHistory = false;
    try {
      const connector = await getConnector(conversation.platformAccountId);
      capabilities = connector.supportedCapabilities;
      canLoadHistory = typeof connector.hydrateConversation === "function";
    } catch {
      // account not yet connectable (e.g. real connector not implemented) — reply UI just disables
    }

    // Plain status for the Inbox: has the full conversation been read yet?
    // Facebook notices from the inbox preview don't appear as messages in
    // the conversation view, so they aren't "waiting" to be read.
    const hasPlaceholders = conversation.messages.some(
      (m) => !m.externalMessageId.startsWith("facebook:") && m.direction !== "SYSTEM",
    );
    const hydrationState = !canLoadHistory
      ? null
      : conversation.hydratedAt && !hasPlaceholders
        ? "HYDRATED"
        : conversation.unread
          ? "SKIPPED_UNREAD"
          : "PENDING";

    return {
      ...conversation,
      capabilities,
      canLoadHistory,
      hydrationState,
      platformUrl: conversationUrl(conversation.platformAccount.platform.key, conversation.externalConversationId),
    };
  });

  /** Manual "Load conversation history": reads the full thread from the
   * platform's conversation view (read-only), with a deeper scroll limit
   * than the automatic watchdog reads. An unread conversation comes back
   * SKIPPED_UNREAD unless the user explicitly confirmed (`confirmUnread`). */
  app.post("/api/conversations/:id/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const confirmUnread = (request.body as { confirmUnread?: unknown } | undefined)?.confirmUnread === true;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const connector = await getConnector(conversation.platformAccountId);
    if (!connector.hydrateConversation) {
      return reply.code(400).send({ error: "This platform doesn't support loading conversation history" });
    }
    const outcome = await hydrateAndStore(connector, conversation, { manual: true, allowUnread: confirmUnread });
    if (outcome.events.length > 0) {
      await dispatchNotifications(await recordEvents(conversation.platformAccountId, outcome.events));
    }
    const { status, detail, reachedStart, messages } = outcome.result;
    return {
      status,
      detail,
      reachedStart,
      messagesFound: messages.length,
      added: outcome.added,
      updated: outcome.updated,
    };
  });

  app.post("/api/conversations/:id/reply", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ReplySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { platformAccount: true },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    const connector = await getConnector(conversation.platformAccountId);
    if (!connector.supportedCapabilities.includes("sendMessages")) {
      return reply.code(400).send({ error: `${conversation.platformAccount.label} does not support sending messages` });
    }

    const result = await connector.sendMessage(conversation.externalConversationId, body.data.message);
    if (!result.ok) {
      return reply.code(502).send({ error: result.error ?? "Send failed" });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        externalMessageId: result.externalMessageId ?? `local-${Date.now()}`,
        senderName: conversation.platformAccount.label,
        body: body.data.message,
        direction: "OUTBOUND",
        sentAt: new Date(),
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: message.sentAt, unread: false },
    });

    return reply.code(201).send(message);
  });

  app.patch("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = PatchSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });

    const conversation = await prisma.conversation
      .update({ where: { id }, data: body.data })
      .catch(() => null);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    return conversation;
  });
}

interface SearchableConversation {
  buyerName: string;
  listing: { title: string } | null;
  messages: { body: string }[];
}

function matchesSearch(c: SearchableConversation, q: string): boolean {
  const needle = q.toLowerCase();
  if (c.buyerName.toLowerCase().includes(needle)) return true;
  if (c.listing?.title.toLowerCase().includes(needle)) return true;
  return c.messages.some((m) => m.body.toLowerCase().includes(needle));
}
