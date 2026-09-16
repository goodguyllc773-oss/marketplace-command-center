import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getConnector } from "../services/connectorManager.js";

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

    const byPlatform = new Map<string, { platformId: string; platformKey: string; platformName: string; unread: number }>();
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
    try {
      const connector = await getConnector(conversation.platformAccountId);
      capabilities = connector.supportedCapabilities;
    } catch {
      // account not yet connectable (e.g. real connector not implemented) — reply UI just disables
    }

    return { ...conversation, capabilities };
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
