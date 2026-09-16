import { prisma } from "../db.js";
import { dropConnector } from "./connectorManager.js";
import { runFullSync } from "./syncService.js";

const timers = new Map<string, ReturnType<typeof setInterval>>();

export function isRunning(platformAccountId: string): boolean {
  return timers.has(platformAccountId);
}

export async function startWatchdog(platformAccountId: string, intervalMs?: number): Promise<void> {
  if (timers.has(platformAccountId)) return;

  const watchdog = await prisma.watchdog.upsert({
    where: { platformAccountId },
    create: { platformAccountId, state: "RUNNING", intervalMs: intervalMs ?? 30000 },
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

/** Flags watchdogs whose last successful check is older than the staleness
 * threshold as STALE, without touching ones already ERROR/STOPPED. */
export async function markStaleWatchdogs(staleAfterMs = 120_000): Promise<void> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  await prisma.watchdog.updateMany({
    where: { state: "RUNNING", lastSuccessAt: { lt: cutoff } },
    data: { state: "STALE" },
  });
}

export function stopAllWatchdogs(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}
