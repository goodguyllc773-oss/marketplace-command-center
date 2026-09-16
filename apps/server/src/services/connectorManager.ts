import { createMockConnector, type MarketplaceConnector } from "@mcc/connectors";
import { prisma } from "../db.js";

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

  const connector = resolveConnector(account.platform.key, account.platform.kind, account.id, account.label);
  liveConnectors.set(platformAccountId, connector);
  return connector;
}

function resolveConnector(
  platformKey: string,
  kind: string,
  accountId: string,
  label: string,
): MarketplaceConnector {
  if (kind === "mock") {
    return createMockConnector(platformKey, accountId, label);
  }
  throw new Error(
    `No real connector implemented yet for platform "${platformKey}" — only mock connectors exist so far (see PROJECT_PLAN.md Phase 12+).`,
  );
}

export function dropConnector(platformAccountId: string): void {
  liveConnectors.delete(platformAccountId);
}
