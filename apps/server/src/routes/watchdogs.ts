import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  checkHealthNow,
  markStaleWatchdogs,
  restartWatchdog,
  startWatchdog,
  stopWatchdog,
  updateWatchdogConfig,
} from "../services/watchdogManager.js";

const ConfigSchema = z.object({
  intervalMs: z.number().int().min(5000).optional(),
  staleAfterMs: z.number().int().min(10000).optional(),
});

export function registerWatchdogRoutes(app: FastifyInstance): void {
  app.get("/api/watchdogs", async () => {
    await markStaleWatchdogs();
    return prisma.watchdog.findMany({
      include: { platformAccount: { include: { platform: true } } },
      orderBy: { updatedAt: "desc" },
    });
  });

  app.post("/api/watchdogs/:accountId/start", async (request) => {
    const { accountId } = request.params as { accountId: string };
    await startWatchdog(accountId);
    return { ok: true };
  });

  app.post("/api/watchdogs/:accountId/stop", async (request) => {
    const { accountId } = request.params as { accountId: string };
    await stopWatchdog(accountId);
    return { ok: true };
  });

  app.post("/api/watchdogs/:accountId/restart", async (request) => {
    const { accountId } = request.params as { accountId: string };
    await restartWatchdog(accountId);
    return { ok: true };
  });

  app.post("/api/watchdogs/:accountId/health-check", async (request) => {
    const { accountId } = request.params as { accountId: string };
    return checkHealthNow(accountId);
  });

  app.patch("/api/watchdogs/:accountId", async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const body = ConfigSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });
    await updateWatchdogConfig(accountId, body.data);
    return prisma.watchdog.findUnique({ where: { platformAccountId: accountId } });
  });
}
