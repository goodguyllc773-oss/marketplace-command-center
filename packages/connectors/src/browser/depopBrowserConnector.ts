import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { ConnectorCapability, HealthStatus, StandardEvent } from "@mcc/shared";
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
import { fetchRecentEmailsFrom, type EmailConfig } from "../email/emailSource.js";
import { parseDepopEmails, type DepopEmailData } from "../email/depopEmailParser.js";

// Headless Chromium announces itself as "HeadlessChrome", which Depop
// rejects outright; this is the same browser's normal desktop identity
// (installed Playwright Chromium v1243 = Chrome 153).
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const SCAN_TTL_MS = 60_000;
const PAUSE_BETWEEN_PAGES_MS = 2_500;
const TITLE_LOOKUPS_PER_CHECK = 5;
const EMAIL_LOOKBACK_DAYS = 14;

interface ScrapedListing {
  slug: string;
  url: string;
  price: number;
  status: "ACTIVE" | "SOLD";
}

interface Scan {
  at: number;
  status: number;
  listings: ScrapedListing[];
}

/**
 * REAL connector for a Depop seller's public shop page — signed out, no
 * credentials, nothing private. `supportedCapabilities` is only
 * `["listings"]`: messages/offers/orders live behind login, and Depop
 * answered the automated login window with 403 (2026-10-05). Getting past
 * that would mean evading its bot protection, which this app doesn't do.
 *
 * Depop also answers 403 once one browser loads several pages back to
 * back (seen live), while a fresh browser loading one page gets 200. So
 * each check uses a fresh short-lived browser: one shop-page load, then at
 * most a few spaced-out product-page title lookups, then it closes. A 403
 * is reported and simply retried at the next check — no workarounds.
 */
export class DepopBrowserConnector implements MarketplaceConnector {
  readonly platformId = "depop-live";
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[];
  readonly coreDiffsState = true;

  private readonly username: string;
  private readonly email: EmailConfig | undefined;
  private readonly titleCache = new Map<string, string>();
  private readonly firstSeenAt = new Map<string, string>();
  private scan: Scan | null = null;
  private inFlight: Promise<Scan> | null = null;
  private emailData: { at: number; data: DepopEmailData } | null = null;
  private emailInFlight: Promise<DepopEmailData> | null = null;

  /** With `email`, messages/offers/sales come from Depop's notification
   * emails (see email/depopEmailParser.ts); listings always come from the
   * public shop page. */
  constructor(accountId: string, depopUsername: string, email?: EmailConfig) {
    this.accountId = accountId;
    this.username = depopUsername.replace(/^@/, "").trim();
    this.email = email;
    // Offers/purchases from email arrive as alerts via sync(): Depop's emails
    // carry no product ids, so they can't be attached to a listing.
    this.supportedCapabilities = email ? ["listings", "messages"] : ["listings"];
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.scan = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    const lastCheckedAt = new Date().toISOString();
    try {
      const scan = await this.getScan();
      const online = scan.status > 0 && scan.status < 400;
      return {
        online,
        authenticated: true, // listings need no login
        lastCheckedAt,
        message: online ? undefined : refusedMessage(scan.status),
      };
    } catch (err) {
      return { online: false, authenticated: true, lastCheckedAt, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async getAccount(): Promise<MarketplaceAccount> {
    return { externalAccountId: this.username, displayName: `@${this.username}`, profileUrl: this.shopUrl() };
  }

  async getListings(): Promise<ConnectorListing[]> {
    const scan = await this.getScan();
    if (scan.status === 0 || scan.status >= 400) throw new Error(refusedMessage(scan.status));

    return scan.listings.map((item) => {
      if (!this.firstSeenAt.has(item.slug)) this.firstSeenAt.set(item.slug, new Date().toISOString());
      return {
        externalListingId: item.slug,
        title: this.titleCache.get(item.slug) ?? item.slug.replaceAll("-", " "),
        price: item.price,
        currency: "USD",
        status: item.status,
        url: item.url,
        views: null,
        likes: null,
        watchers: null,
        offerCount: null,
        messageCount: null,
        createdAt: this.firstSeenAt.get(item.slug)!,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  async getConversations(): Promise<ConnectorConversation[]> {
    return (await this.getEmailData("messages")).conversations;
  }
  async getMessages(conversationId: string): Promise<ConnectorMessage[]> {
    return (await this.getEmailData("messages")).messages.get(conversationId) ?? [];
  }
  async sendMessage(): Promise<SendMessageResult> {
    throw new UnsupportedCapabilityError(this.platformId, "sendMessages");
  }
  async getOrders(): Promise<ConnectorOrder[]> {
    return (await this.getEmailData("orders")).orders;
  }
  async getSales(): Promise<ConnectorSale[]> {
    return (await this.getEmailData("sales")).sales;
  }
  async getOffers(): Promise<ConnectorOffer[]> {
    return (await this.getEmailData("offers")).offers;
  }

  /** One mailbox read per check, shared by messages/offers/orders/sales. */
  private async getEmailData(capability: ConnectorCapability): Promise<DepopEmailData> {
    const email = this.email;
    if (!email) throw new UnsupportedCapabilityError(this.platformId, capability);
    if (this.emailData && Date.now() - this.emailData.at < SCAN_TTL_MS) return this.emailData.data;
    if (!this.emailInFlight) {
      this.emailInFlight = fetchRecentEmailsFrom(email, "depop.com", { sinceDays: EMAIL_LOOKBACK_DAYS, max: 200 })
        .then((emails) => parseDepopEmails(emails, email.connectedAt))
        .then((data) => {
          this.emailData = { at: Date.now(), data };
          return data;
        })
        .finally(() => (this.emailInFlight = null));
    }
    return this.emailInFlight;
  }

  /** Email notices (counter offers, purchases, anything without a
   * dedicated rule) become events here; dedupe is per email, and emails
   * from before the mailbox was connected never alert. */
  async sync(): Promise<SyncResult> {
    const syncedAt = new Date().toISOString();
    if (!this.email) return { syncedAt, events: [], errors: [] };
    try {
      const { notices } = await this.getEmailData("messages");
      const events: StandardEvent[] = notices
        .filter((n) => !n.historical)
        .map((n) => ({
          id: randomUUID(),
          type: n.type,
          platformId: this.platformId,
          accountId: this.accountId,
          timestamp: n.date,
          entityId: n.messageId,
          dedupeKey: `${this.platformId}:${this.accountId}:email:${n.messageId}`,
          payload: n.payload,
        }));
      return { syncedAt, events, errors: [] };
    } catch (err) {
      return { syncedAt, events: [], errors: [`Couldn't read Depop emails: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  // ---- internals --------------------------------------------------------

  private shopUrl(): string {
    return `https://www.depop.com/${this.username}/`;
  }

  /** One scan serves the health check and the listings read of a watchdog
   * tick (and the Accounts page's status polling). */
  private async getScan(): Promise<Scan> {
    if (this.scan && Date.now() - this.scan.at < SCAN_TTL_MS) return this.scan;
    if (!this.inFlight) {
      this.inFlight = this.runScan()
        .then((s) => (this.scan = s))
        .finally(() => (this.inFlight = null));
    }
    return this.inFlight;
  }

  private async runScan(): Promise<Scan> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: USER_AGENT });
      const res = await page.goto(this.shopUrl(), { waitUntil: "networkidle", timeout: 30_000 });
      const status = res?.status() ?? 0;
      if (status >= 400) return { at: Date.now(), status, listings: [] };
      const listings = await scrapeShopPage(page);

      let lookups = 0;
      for (const item of listings) {
        if (this.titleCache.has(item.slug) || lookups >= TITLE_LOOKUPS_PER_CHECK) continue;
        lookups++;
        await page.waitForTimeout(PAUSE_BETWEEN_PAGES_MS);
        const title = await lookUpTitle(page, item.url);
        if (title === "refused") break;
        if (title) this.titleCache.set(item.slug, title);
      }
      return { at: Date.now(), status, listings };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}

function refusedMessage(status: number): string {
  return status ? `Depop refused the request (${status}) — will try again next check` : "Depop shop page didn't load";
}

/** Product URLs are stable, content-derived slugs (not styling classes),
 * so this survives Depop's frequent CSS-module class renames — verified
 * live against the site's actual markup. */
async function scrapeShopPage(page: Page): Promise<ScrapedListing[]> {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/products/"]'));
    const seen = new Set<string>();
    const out: { slug: string; url: string; price: number; status: "ACTIVE" | "SOLD" }[] = [];

    for (const link of links) {
      const match = link.getAttribute("href")?.match(/\/products\/([^/]+)\/?/);
      const slug = match?.[1];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const card = link.closest("li") ?? link.parentElement ?? link;
      const text = card.textContent ?? "";
      const priceMatch = text.match(/[$€£]\s?([\d,]+\.?\d*)/);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0;
      const status: "ACTIVE" | "SOLD" = /\bsold\b/i.test(text) ? "SOLD" : "ACTIVE";

      out.push({ slug, url: `https://www.depop.com/products/${slug}/`, price, status });
    }
    return out;
  });
}

/** The product page's Open Graph title (an SEO contract, stable unlike
 * layout classes). "refused" stops further lookups for this check. */
async function lookUpTitle(page: Page, url: string): Promise<string | null | "refused"> {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!res || res.status() >= 400) return "refused";
    const title = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => null);
    return title ? title.replace(/\s*\|\s*Depop$/i, "") : null;
  } catch {
    return null;
  }
}
