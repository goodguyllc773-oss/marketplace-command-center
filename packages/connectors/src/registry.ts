import type { MarketplaceConnector } from "./types.js";
import { MockDepopConnector } from "./mock/depop.js";
import { MockFacebookConnector } from "./mock/facebook.js";
import { MockEbayConnector } from "./mock/ebay.js";
import { DepopBrowserConnector } from "./browser/depopBrowserConnector.js";

export type ConnectorKind = "mock" | "browser";

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

/**
 * Real, non-mock connectors. `externalAccountId` here is whatever public
 * identifier that platform's connector needs to find the account (e.g. a
 * Depop username) — never a password or session token.
 */
const BROWSER_FACTORIES: Record<string, (accountId: string, externalAccountId: string) => MarketplaceConnector> = {
  "depop-live": (accountId, externalAccountId) => new DepopBrowserConnector(accountId, externalAccountId),
};

export const REAL_PLATFORM_IDS = Object.keys(BROWSER_FACTORIES);

export function createBrowserConnector(
  platformId: string,
  accountId: string,
  externalAccountId: string,
): MarketplaceConnector {
  const factory = BROWSER_FACTORIES[platformId];
  if (!factory) {
    throw new Error(`No browser connector registered for platform "${platformId}"`);
  }
  return factory(accountId, externalAccountId);
}
