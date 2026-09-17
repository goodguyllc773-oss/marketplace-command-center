import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EVENT_TYPES } from "@mcc/shared";
import { prisma } from "../db.js";
import { isDiscordEnabledFor } from "../services/notificationService.js";
import { sendTestEmbed } from "../services/discordChannel.js";
import { env } from "../env.js";

const UpdateSettingSchema = z.object({ discordEnabled: z.boolean() });

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

  app.get("/api/notification-settings", async () => {
    const results = [];
    for (const eventType of EVENT_TYPES) {
      results.push({ eventType, discordEnabled: await isDiscordEnabledFor(eventType) });
    }
    return { discordConfigured: Boolean(env.DISCORD_WEBHOOK_URL), settings: results };
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

  app.post("/api/notifications/test-discord", async (_request, reply) => {
    const result = await sendTestEmbed();
    if (!result.ok) return reply.code(502).send({ ok: false, error: result.error });
    return { ok: true };
  });
}
