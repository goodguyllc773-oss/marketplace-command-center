import type { MarketplaceConnector } from "./types.js";
import type { EmailConfig } from "./email/emailSource.js";
import { MockDepopConnector } from "./mock/depop.js";
import { MockFacebookConnector } from "./mock/facebook.js";
import { MockEbayConnector } from "./mock/ebay.js";
import { DepopBrowserConnector } from "./browser/depopBrowserConnector.js";
import {
  FacebookBrowserConnector,
  FACEBOOK_LOGIN_URL,
  type FacebookHydrationConfig,
} from "./browser/facebookBrowserConnector.js";

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
export interface BrowserConnectorOptions {
  email?: EmailConfig;
  facebookHydration?: Partial<FacebookHydrationConfig>;
}

const BROWSER_FACTORIES: Record<
  string,
  (accountId: string, externalAccountId: string, options: BrowserConnectorOptions) => MarketplaceConnector
> = {
  "depop-live": (accountId, externalAccountId, options) => new DepopBrowserConnector(accountId, externalAccountId, options.email),
  "facebook-live": (accountId, externalAccountId, options) =>
    new FacebookBrowserConnector(accountId, externalAccountId, options.facebookHydration),
};

/** Link that opens a conversation in the platform's own UI, when it has one. */
export function conversationUrl(platformId: string, externalConversationId: string): string | null {
  if (platformId === "facebook-live") return `https://www.facebook.com/messages/t/${encodeURIComponent(externalConversationId)}/`;
  // Conversations read by the Depop Reader extension use Depop's own id;
  // email-sourced ones (`email:<user>`) have no Depop link.
  if (platformId === "depop-live" && /^[0-9a-f]{32,}$/.test(externalConversationId)) {
    return `https://www.depop.com/messages/${externalConversationId}/`;
  }
  return null;
}

/** Platforms whose connector reads the user's connected email. */
export const EMAIL_PLATFORM_IDS = ["depop-live"];

export const REAL_PLATFORM_IDS = Object.keys(BROWSER_FACTORIES);

/** Platforms whose browser connector uses an interactive login (the user
 * types their own credentials into a real, visible browser window — the
 * app never sees them). Depop is deliberately absent: it answered the
 * automated login window with 403 (2026-10-05), and getting past that
 * would mean evading its bot protection. Depop runs signed out. */
export const LOGIN_START_URLS: Record<string, string> = {
  "facebook-live": FACEBOOK_LOGIN_URL,
};

export function createBrowserConnector(
  platformId: string,
  accountId: string,
  externalAccountId: string,
  options: BrowserConnectorOptions = {},
): MarketplaceConnector {
  const factory = BROWSER_FACTORIES[platformId];
  if (!factory) {
    throw new Error(`No browser connector registered for platform "${platformId}"`);
  }
  return factory(accountId, externalAccountId, options);
}
