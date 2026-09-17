import type { ConnectorCapability, HealthStatus } from "@mcc/shared";
import type {
  ConnectorConversation,
  ConnectorListing,
  ConnectorMessage,
  ConnectorOffer,
  ConnectorOrder,
  ConnectorSale,
  MarketplaceAccount,
  MarketplaceConnector,
  SendMessageResult,
  SyncResult,
} from "../types.js";
import { UnsupportedCapabilityError } from "../types.js";
import { closeHeadlessSession, getHeadlessSession, hasSavedSession } from "./browserSession.js";

export const FACEBOOK_LOGIN_URL = "https://www.facebook.com/login/";
const SELLING_URL = "https://www.facebook.com/marketplace/you/selling/";

/**
 * REAL connector for Facebook Marketplace — currently a verified-honest
 * shell, not yet a working scraper. Facebook exposes no public seller
 * pages at all (confirmed live: a logged-out item page shows no seller
 * identity, no profile link, nothing in the DOM — unlike Depop's public
 * `/username/` shop), so unlike DepopBrowserConnector there was no way to
 * inspect or verify real listing/message page structure without actually
 * being logged in. Rather than guess at selectors I can't test — which the
 * project rules explicitly forbid ("do not create fake integrations and
 * pretend they are functional") — `supportedCapabilities` stays empty
 * until that inspection happens against a real logged-in session (via
 * saved cookies only, never a password — see browserSession.ts).
 *
 * What IS real here: `connect()`/`healthCheck()` genuinely check a saved
 * session against the live site and report AUTH_REQUIRED honestly when
 * there isn't one yet.
 */
export class FacebookBrowserConnector implements MarketplaceConnector {
  readonly platformId = "facebook-live";
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[] = [];

  private readonly label: string;

  constructor(accountId: string, label: string) {
    this.accountId = accountId;
    this.label = label;
  }

  async connect(): Promise<void> {
    if (!hasSavedSession(this.accountId)) return;
    await getHeadlessSession(this.accountId);
  }

  async disconnect(): Promise<void> {
    await closeHeadlessSession(this.accountId);
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!hasSavedSession(this.accountId)) {
      return {
        online: false,
        authenticated: false,
        lastCheckedAt: new Date().toISOString(),
        message: "Not logged in yet — open the login window from the Accounts page",
      };
    }
    try {
      const { page } = await getHeadlessSession(this.accountId);
      await page.goto(SELLING_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const authenticated = !page.url().includes("/login");
      return {
        online: true,
        authenticated,
        lastCheckedAt: new Date().toISOString(),
        message: authenticated ? undefined : "Session expired — log in again from the Accounts page",
      };
    } catch (err) {
      return {
        online: false,
        authenticated: false,
        lastCheckedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getAccount(): Promise<MarketplaceAccount> {
    return { externalAccountId: this.accountId, displayName: this.label, profileUrl: SELLING_URL };
  }

  // Every data capability is honestly unimplemented until verified live
  // against a real logged-in session — see class doc comment.
  async getConversations(): Promise<ConnectorConversation[]> {
    throw new UnsupportedCapabilityError(this.platformId, "messages");
  }
  async getMessages(): Promise<ConnectorMessage[]> {
    throw new UnsupportedCapabilityError(this.platformId, "messages");
  }
  async sendMessage(): Promise<SendMessageResult> {
    throw new UnsupportedCapabilityError(this.platformId, "sendMessages");
  }
  async getListings(): Promise<ConnectorListing[]> {
    throw new UnsupportedCapabilityError(this.platformId, "listings");
  }
  async getOrders(): Promise<ConnectorOrder[]> {
    throw new UnsupportedCapabilityError(this.platformId, "orders");
  }
  async getSales(): Promise<ConnectorSale[]> {
    throw new UnsupportedCapabilityError(this.platformId, "sales");
  }
  async getOffers(): Promise<ConnectorOffer[]> {
    throw new UnsupportedCapabilityError(this.platformId, "offers");
  }

  async sync(): Promise<SyncResult> {
    return { syncedAt: new Date().toISOString(), events: [], errors: [] };
  }
}
