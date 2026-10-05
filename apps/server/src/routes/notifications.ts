import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EVENT_TYPES, NOTIFICATION_CATEGORIES, type NotificationCategoryId } from "@mcc/shared";
import { prisma } from "../db.js";
import { isDiscordEnabledFor } from "../services/notificationService.js";
import { DISCORD_WEBHOOK_PATTERN, getWebhook, maskWebhook, saveWebhook, sendTestEmbed } from "../services/discordChannel.js";

const UpdateSettingSchema = z.object({ discordEnabled: z.boolean() });
const CATEGORY_IDS = NOTIFICATION_CATEGORIES.map((c) => c.id) as [NotificationCategoryId, ...NotificationCategoryId[]];
const CategorySchema = z.enum(CATEGORY_IDS).optional();
const WebhookSchema = z.object({
  url: z
    .string()
    .trim()
    .regex(DISCORD_WEBHOOK_PATTERN, "That isn't a Discord webhook URL — it should look like https://discord.com/api/webhooks/…"),
  category: CategorySchema,
});

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get("/api/notifications", async (request) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.min(Number(limit) || 50, 200);
    const notifications = await prisma.notification.findMany({
      take,
      orderBy: { createdAt: "desc" },
      include: { event: { include: { platformAccount: { include: { platform: true } } } } },
    });
    // Match /api/events' shape: parsed `payload`, not raw `payloadJson`.
    return notifications.map((n) => ({
      ...n,
      event: { ...n.event, payload: JSON.parse(n.event.payloadJson), payloadJson: undefined },
    }));
  });

  /** Webhook URLs are never returned in full — only a masked hint. */
  app.get("/api/notification-settings", async () => {
    const results = [];
    for (const eventType of EVENT_TYPES) {
      results.push({ eventType, discordEnabled: await isDiscordEnabledFor(eventType) });
    }
    const webhook = await getWebhook();
    const categories = [];
    for (const c of NOTIFICATION_CATEGORIES) {
      const resolved = await getWebhook(c.id);
      categories.push({
        id: c.id,
        label: c.label,
        eventTypes: c.eventTypes,
        hasOwnWebhook: resolved?.source === "category",
        webhookHint: resolved ? maskWebhook(resolved.url) : null,
      });
    }
    return {
      discordConfigured: Boolean(webhook),
      webhookSource: webhook?.source ?? null,
      webhookHint: webhook ? maskWebhook(webhook.url) : null,
      categories,
      settings: results,
    };
  });

  app.put("/api/settings/discord-webhook", async (request, reply) => {
    const body = WebhookSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid URL" });
    await saveWebhook(body.data.url, body.data.category);
    return { ok: true, webhookHint: maskWebhook(body.data.url) };
  });

  app.delete("/api/settings/discord-webhook", async (request, reply) => {
    const category = CategorySchema.safeParse((request.query as { category?: string }).category);
    if (!category.success) return reply.code(400).send({ error: "Unknown category" });
    await saveWebhook(null, category.data);
    return { ok: true };
  });

  app.patch("/api/notification-settings/:eventType", async (request, reply) => {
    const { eventType } = request.params as { eventType: string };
    if (!(EVENT_TYPES as readonly string[]).includes(eventType)) {
      return reply.code(404).send({ error: "Unknown event type" });
    }
    const body = UpdateSettingSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const setting = await prisma.notificationSetting.upsert({
      where: { eventType },
      create: { eventType, discordEnabled: body.data.discordEnabled },
      update: { discordEnabled: body.data.discordEnabled },
    });
    return setting;
  });

  app.post("/api/notifications/test-discord", async (request, reply) => {
    const category = CategorySchema.safeParse((request.query as { category?: string }).category);
    if (!category.success) return reply.code(400).send({ error: "Unknown category" });
    const result = await sendTestEmbed(category.data);
    if (!result.ok) return reply.code(502).send({ ok: false, error: result.error });
    return { ok: true };
  });
}
