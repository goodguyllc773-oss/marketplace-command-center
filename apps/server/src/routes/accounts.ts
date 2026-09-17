import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LOGIN_START_URLS, hasSavedSession, openLoginWindow } from "@mcc/connectors";
import { prisma } from "../db.js";
import { getConnector } from "../services/connectorManager.js";
import { runFullSync } from "../services/syncService.js";
import { DEFAULT_INTERVAL_MS, stopWatchdog } from "../services/watchdogManager.js";

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

    const intervalMs = DEFAULT_INTERVAL_MS[platform.kind] ?? 30_000;
    const account = await prisma.platformAccount.create({
      data: {
        platformId: platform.id,
        externalAccountId,
        label,
        status: "DISCONNECTED",
        // Staleness must stay comfortably above the sync interval — a
        // fixed 120s default would flap RUNNING/STALE every cycle for a
        // 5-minute-interval connector. 4x the interval (min 2 minutes)
        // gives room for one or two missed cycles before alarming.
        watchdog: { create: { state: "STOPPED", intervalMs, staleAfterMs: Math.max(intervalMs * 4, 120_000) } },
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

  /** Opens a real, visible browser window on this machine at the
   * platform's own login page. The user types their own credentials into
   * it — this server never sees or stores a password, only the resulting
   * session cookies once they're done (see packages/connectors browserSession.ts).
   * Does not track "is it still open" itself — Chromium's own profile lock
   * is the source of truth, surfaced here as a normal error if a window on
   * this profile is already running. */
  app.post("/api/accounts/:id/login-window", async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await prisma.platformAccount.findUnique({ where: { id }, include: { platform: true } });
    if (!account) return reply.code(404).send({ error: "Account not found" });
    const loginUrl = LOGIN_START_URLS[account.platform.key];
    if (!loginUrl) return reply.code(400).send({ error: `${account.platform.name} doesn't use an interactive login` });
    try {
      await openLoginWindow(id, loginUrl);
      return { ok: true };
    } catch (err) {
      return reply.code(409).send({
        error:
          "Couldn't open a new login window — one may already be open for this account. Check your taskbar, or close it and try again.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /** Real status, not a filesystem guess: actually checks the saved
   * session against the live site via the connector's own health check.
   * Errors (e.g. a visible login window still has the profile locked) are
   * reported as-is rather than misread as "not logged in". */
  app.get("/api/accounts/:id/login-status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await prisma.platformAccount.findUnique({ where: { id }, include: { platform: true } });
    if (!account) return reply.code(404).send({ error: "Account not found" });
    const requiresLogin = account.platform.key in LOGIN_START_URLS;
    if (!requiresLogin) return { requiresLogin, everAttempted: false, authenticated: false };

    const everAttempted = hasSavedSession(id);
    if (!everAttempted) return { requiresLogin, everAttempted, authenticated: false };

    try {
      const connector = await getConnector(id);
      const health = await connector.healthCheck();
      return { requiresLogin, everAttempted, authenticated: health.online && health.authenticated, message: health.message };
    } catch (err) {
      return {
        requiresLogin,
        everAttempted,
        authenticated: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
