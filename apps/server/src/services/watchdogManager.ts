import { prisma } from "../db.js";
import { dropConnector, getConnector } from "./connectorManager.js";
import { runFullSync } from "./syncService.js";

const timers = new Map<string, ReturnType<typeof setInterval>>();

export function isRunning(platformAccountId: string): boolean {
  return timers.has(platformAccountId);
}

/** Real, site-scraping connectors have no rate-limit contract with the
 * platform — default to a courteous 5 minutes rather than hammering a
 * real site every 30s. Applied when the account (and its Watchdog row) is
 * first created — see routes/accounts.ts — since by the time
 * `startWatchdog` runs, that row already exists. The user can still
 * override it per account afterwards. */
export const DEFAULT_INTERVAL_MS: Record<string, number> = {
  mock: 30_000,
  browser: 300_000,
};

export async function startWatchdog(platformAccountId: string, intervalMs?: number): Promise<void> {
  if (timers.has(platformAccountId)) return;

  const watchdog = await prisma.watchdog.upsert({
    where: { platformAccountId },
    create: { platformAccountId, state: "RUNNING", intervalMs: intervalMs ?? 30_000 },
    update: { state: "RUNNING", intervalMs: intervalMs ?? undefined },
  });

  await runFullSync(platformAccountId);
  const timer = setInterval(() => {
    void runFullSync(platformAccountId);
  }, watchdog.intervalMs);
  timers.set(platformAccountId, timer);
}

export async function stopWatchdog(platformAccountId: string): Promise<void> {
  const timer = timers.get(platformAccountId);
  if (timer) {
    clearInterval(timer);
    timers.delete(platformAccountId);
  }
  dropConnector(platformAccountId);
  await prisma.watchdog.upsert({
    where: { platformAccountId },
    create: { platformAccountId, state: "STOPPED" },
    update: { state: "STOPPED" },
  });
}

export async function restartWatchdog(platformAccountId: string): Promise<void> {
  await stopWatchdog(platformAccountId);
  await startWatchdog(platformAccountId);
}

/**
 * Lightweight probe distinct from a full sync (spec section 5 lists
 * "Health check" as its own watchdog capability): just asks the connector
 * "are you there and authenticated", updates the account's connection
 * status, and — if healthy — refreshes `lastSuccessAt` so it also resets
 * the staleness clock, without touching listings/messages/etc.
 */
export async function checkHealthNow(platformAccountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const connector = await getConnector(platformAccountId);
    const health = await connector.healthCheck();
    await prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: {
        status: health.online && health.authenticated ? "CONNECTED" : health.authenticated ? "DISCONNECTED" : "AUTH_REQUIRED",
      },
    });
    if (health.online && health.authenticated) {
      await prisma.watchdog.upsert({
        where: { platformAccountId },
        create: { platformAccountId, lastSuccessAt: new Date() },
        update: { lastSuccessAt: new Date(), lastError: null, state: isRunning(platformAccountId) ? "RUNNING" : undefined },
      });
      return { ok: true };
    }
    const message = health.message ?? "Not healthy";
    await prisma.watchdog.upsert({
      where: { platformAccountId },
      create: { platformAccountId, lastError: message },
      update: { lastError: message },
    });
    return { ok: false, error: message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.watchdog
      .upsert({ where: { platformAccountId }, create: { platformAccountId, lastError: message }, update: { lastError: message } })
      .catch(() => undefined);
    return { ok: false, error: message };
  }
}

export async function updateWatchdogConfig(
  platformAccountId: string,
  config: { intervalMs?: number; staleAfterMs?: number },
): Promise<void> {
  await prisma.watchdog.upsert({
    where: { platformAccountId },
    create: { platformAccountId, ...config },
    update: config,
  });
  // A running watchdog's interval only takes effect on next restart (its
  // setInterval is already armed) — restart it now so a new interval
  // applies immediately rather than silently waiting.
  if (config.intervalMs !== undefined && timers.has(platformAccountId)) {
    await restartWatchdog(platformAccountId);
  }
}

/** Flags watchdogs whose last successful check is older than their own
 * configured staleness threshold, without touching ones already
 * ERROR/STOPPED. */
export async function markStaleWatchdogs(): Promise<void> {
  const running = await prisma.watchdog.findMany({ where: { state: "RUNNING" } });
  const now = Date.now();
  const staleIds = running
    .filter((w) => w.lastSuccessAt && now - w.lastSuccessAt.getTime() > w.staleAfterMs)
    .map((w) => w.id);
  if (staleIds.length > 0) {
    await prisma.watchdog.updateMany({ where: { id: { in: staleIds } }, data: { state: "STALE" } });
  }
}

export function stopAllWatchdogs(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}
