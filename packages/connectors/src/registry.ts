import type { MarketplaceConnector } from "./types.js";
import { MockDepopConnector } from "./mock/depop.js";
import { MockFacebookConnector } from "./mock/facebook.js";
import { MockEbayConnector } from "./mock/ebay.js";

export type ConnectorKind = "mock";

/**
 * Factory keyed by platformId. Real connectors register here alongside the
 * mocks as they're built (Phase 12+) — the rest of the app only ever talks
 * to the `MarketplaceConnector` interface, never a concrete class.
 */
const MOCK_FACTORIES: Record<string, (accountId: string, displayName: string) => MarketplaceConnector> = {
  depop: (accountId, displayName) => new MockDepopConnector(accountId, displayName),
  facebook: (accountId, displayName) => new MockFacebookConnector(accountId, displayName),
  ebay: (accountId, displayName) => new MockEbayConnector(accountId, displayName),
};

export const MOCK_PLATFORM_IDS = Object.keys(MOCK_FACTORIES);

export function createMockConnector(
  platformId: string,
  accountId: string,
  displayName: string,
): MarketplaceConnector {
  const factory = MOCK_FACTORIES[platformId];
  if (!factory) {
    throw new Error(`No mock connector registered for platform "${platformId}"`);
  }
  return factory(accountId, displayName);
}
