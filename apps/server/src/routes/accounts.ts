import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { runFullSync } from "../services/syncService.js";
import { stopWatchdog } from "../services/watchdogManager.js";

const CreateAccountSchema = z.object({
  platformKey: z.string().min(1),
  externalAccountId: z.string().min(1),
  label: z.string().min(1),
});

export function registerAccountRoutes(app: FastifyInstance): void {
  app.get("/api/accounts", async () => {
    return prisma.platformAccount.findMany({
      include: { platform: true, watchdog: true },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post("/api/accounts", async (request, reply) => {
    const body = CreateAccountSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    const { platformKey, externalAccountId, label } = body.data;

    const platform = await prisma.platform.findUnique({ where: { key: platformKey } });
    if (!platform) {
      return reply.code(404).send({ error: `Unknown platform "${platformKey}" — seed platforms first` });
    }

    const account = await prisma.platformAccount.create({
      data: {
        platformId: platform.id,
        externalAccountId,
        label,
        status: "DISCONNECTED",
        watchdog: { create: { state: "STOPPED" } },
      },
      include: { platform: true, watchdog: true },
    });
    return reply.code(201).send(account);
  });

  app.delete("/api/accounts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await stopWatchdog(id).catch(() => undefined);
    await prisma.platformAccount.delete({ where: { id } }).catch(() => undefined);
    return reply.code(204).send();
  });

  app.post("/api/accounts/:id/sync", async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await prisma.platformAccount.findUnique({ where: { id } });
    if (!account) return reply.code(404).send({ error: "Account not found" });
    const result = await runFullSync(id);
    return result;
  });
}
