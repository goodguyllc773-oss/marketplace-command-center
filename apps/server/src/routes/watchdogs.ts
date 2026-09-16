import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { markStaleWatchdogs, restartWatchdog, startWatchdog, stopWatchdog } from "../services/watchdogManager.js";

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
}
