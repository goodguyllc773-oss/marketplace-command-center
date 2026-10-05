import { createMockConnector, createBrowserConnector, EMAIL_PLATFORM_IDS, type MarketplaceConnector } from "@mcc/connectors";
import { prisma } from "../db.js";
import { getEmailConfig } from "./emailSettings.js";
import { env } from "../env.js";

/**
 * Holds live connector instances in memory, keyed by PlatformAccount id.
 * The core app never instantiates a connector class directly — it goes
 * through here so swapping a mock for a real connector later is a one-line
 * change in `resolveConnector`.
 */
const liveConnectors = new Map<string, MarketplaceConnector>();

export async function getConnector(platformAccountId: string): Promise<MarketplaceConnector> {
  const existing = liveConnectors.get(platformAccountId);
  if (existing) return existing;

  const account = await prisma.platformAccount.findUniqueOrThrow({
    where: { id: platformAccountId },
    include: { platform: true },
  });

  const connector = await resolveConnector(account.platform.key, account.platform.kind, account.id, account.label, account.externalAccountId);
  liveConnectors.set(platformAccountId, connector);
  return connector;
}

async function resolveConnector(
  platformKey: string,
  kind: string,
  accountId: string,
  label: string,
  externalAccountId: string,
): Promise<MarketplaceConnector> {
  if (kind === "mock") {
    return createMockConnector(platformKey, accountId, label);
  }
  if (kind === "browser") {
    const email = EMAIL_PLATFORM_IDS.includes(platformKey) ? ((await getEmailConfig(accountId)) ?? undefined) : undefined;
    return createBrowserConnector(platformKey, accountId, externalAccountId, {
      email,
      facebookHydration: {
        perCycle: env.FB_HYDRATIONS_PER_CYCLE,
        pauseBetweenMs: env.FB_HYDRATION_PAUSE_MS,
        maxScrolls: env.FB_HYDRATION_MAX_SCROLLS,
        manualMaxScrolls: env.FB_HYDRATION_MANUAL_MAX_SCROLLS,
        scrollWaitMs: env.FB_HYDRATION_SCROLL_WAIT_MS,
        pageTimeoutMs: env.FB_HYDRATION_PAGE_TIMEOUT_MS,
      },
    });
  }
  throw new Error(`Unknown connector kind "${kind}" for platform "${platformKey}"`);
}

export function dropConnector(platformAccountId: string): void {
  const connector = liveConnectors.get(platformAccountId);
  if (connector && "disconnect" in connector) {
    void connector.disconnect().catch(() => undefined);
  }
  liveConnectors.delete(platformAccountId);
}
