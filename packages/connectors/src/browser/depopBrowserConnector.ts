import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
import type { ConnectorCapability, EventType, HealthStatus, StandardEvent } from "@mcc/shared";
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

interface ScrapedListing {
  slug: string;
  url: string;
  price: number;
  status: "ACTIVE" | "SOLD";
}

/**
 * REAL connector for a Depop seller's public shop page. Depop has no
 * public developer API for individual sellers, so this reads the same
 * public HTML/meta-tag data any visitor's browser sees — no login, no
 * credentials, nothing private. It is deliberately narrow:
 * `supportedCapabilities` is only `["listings"]`, honestly, because
 * messages/offers/orders live behind login and this session had no way to
 * inspect that authenticated DOM to build (or verify) a scraper for it —
 * that's real follow-up work, not something to fake here.
 *
 * Uses a real Chromium via Playwright rather than a bare HTTP client
 * because the site sits behind Cloudflare's bot-management JS challenge;
 * a plain fetch from a script (no browser, no JS execution) is very
 * likely to be blocked outright.
 */
export class DepopBrowserConnector implements MarketplaceConnector {
  readonly platformId = "depop-live";
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[] = ["listings"];

  private readonly username: string;
  private browser: Browser | null = null;
  private page: Page | null = null;

  private readonly knownListings = new Map<string, ScrapedListing>();
  private readonly titleCache = new Map<string, { title: string; description?: string }>();
  private readonly firstSeenAt = new Map<string, string>();
  private readonly pendingEvents: StandardEvent[] = [];
  private lastError: string | undefined;

  constructor(accountId: string, depopUsername: string) {
    this.accountId = accountId;
    this.username = depopUsername.replace(/^@/, "").trim();
  }

  async connect(): Promise<void> {
    if (this.browser) return;
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  async disconnect(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.browser = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      await this.connect();
      const page = this.page!;
      const res = await page.goto(this.shopUrl(), { waitUntil: "domcontentloaded", timeout: 20_000 });
      const online = !!res && res.status() < 400;
      if (!online) this.lastError = `Shop page returned ${res?.status()}`;
      return {
        online,
        authenticated: true, // no login required for this capability
        lastCheckedAt: new Date().toISOString(),
        message: online ? undefined : this.lastError,
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return { online: false, authenticated: true, lastCheckedAt: new Date().toISOString(), message: this.lastError };
    }
  }

  async getAccount(): Promise<MarketplaceAccount> {
    return { externalAccountId: this.username, displayName: `@${this.username}`, profileUrl: this.shopUrl() };
  }

  async getListings(): Promise<ConnectorListing[]> {
    await this.connect();
    const scraped = await this.scrapeShopPage();
    await this.diffAndEmit(scraped);

    const results: ConnectorListing[] = [];
    for (const item of scraped) {
      const details = this.titleCache.get(item.slug);
      const createdAt = this.firstSeenAt.get(item.slug) ?? new Date().toISOString();
      results.push({
        externalListingId: item.slug,
        title: details?.title ?? item.slug.replaceAll("-", " "),
        price: item.price,
        currency: "USD",
        status: item.status,
        url: item.url,
        views: null,
        likes: null,
        watchers: null,
        offerCount: null,
        messageCount: null,
        createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    return results;
  }

  async getConversations(): Promise<ConnectorConversation[]> {
    throw new UnsupportedCapabilityError(this.platformId, "messages");
  }
  async getMessages(): Promise<ConnectorMessage[]> {
    throw new UnsupportedCapabilityError(this.platformId, "messages");
  }
  async sendMessage(): Promise<SendMessageResult> {
    throw new UnsupportedCapabilityError(this.platformId, "sendMessages");
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
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    const errors = this.lastError ? [this.lastError] : [];
    this.lastError = undefined;
    return { syncedAt: new Date().toISOString(), events, errors };
  }

  // ---- internals --------------------------------------------------------

  private shopUrl(): string {
    return `https://www.depop.com/${this.username}/`;
  }

  /** Product URLs are stable, content-derived slugs (not styling classes),
   * so this survives Depop's frequent CSS-module class renames — verified
   * live against the site's actual markup before writing this. */
  private async scrapeShopPage(): Promise<ScrapedListing[]> {
    const page = this.page!;
    await page.goto(this.shopUrl(), { waitUntil: "networkidle", timeout: 30_000 });

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

  /** Open Graph meta tags are stable (SEO/social-share contract) unlike
   * layout classes — used only once per listing and cached, to keep this
   * gentle on the site rather than re-fetching every sync tick. */
  private async resolveTitle(slug: string, url: string): Promise<void> {
    if (this.titleCache.has(slug)) return;
    try {
      const page = this.page!;
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (!res || res.status() >= 400) return;
      const title = await page
        .locator('meta[property="og:title"]')
        .getAttribute("content")
        .catch(() => null);
      const description = await page
        .locator('meta[property="og:description"]')
        .getAttribute("content")
        .catch(() => null);
      this.titleCache.set(slug, {
        title: (title ?? slug.replaceAll("-", " ")).replace(/\s*\|\s*Depop$/i, ""),
        description: description ?? undefined,
      });
    } catch {
      // best-effort — falls back to a slug-derived title in getListings()
    }
  }

  private async diffAndEmit(scraped: ScrapedListing[]): Promise<void> {
    const now = new Date().toISOString();
    const seenSlugs = new Set(scraped.map((s) => s.slug));

    for (const item of scraped) {
      const prior = this.knownListings.get(item.slug);
      if (!prior) {
        this.firstSeenAt.set(item.slug, now);
        await this.resolveTitle(item.slug, item.url);
        this.emit("LISTING_CREATED", item.slug, { listingId: item.slug, url: item.url, price: item.price });
      } else if (prior.status === "ACTIVE" && item.status === "SOLD") {
        const title = this.titleCache.get(item.slug)?.title ?? item.slug;
        this.emit(
          "LISTING_SOLD",
          item.slug,
          { listingId: item.slug, listingTitle: title, salePrice: item.price, currency: "USD" },
          `${this.platformId}:${this.accountId}:sold:${item.slug}`,
        );
      } else if (prior.price !== item.price) {
        this.emit("LISTING_UPDATED", item.slug, { listingId: item.slug, price: item.price });
      }
      this.knownListings.set(item.slug, { slug: item.slug, url: item.url, price: item.price, status: item.status });
    }

    for (const [slug] of this.knownListings) {
      if (!seenSlugs.has(slug)) {
        this.emit("LISTING_REMOVED", slug, { listingId: slug });
        this.knownListings.delete(slug);
      }
    }
  }

  private emit(type: EventType, entityId: string, payload: unknown, dedupeKey?: string): void {
    this.pendingEvents.push({
      id: randomUUID(),
      type,
      platformId: this.platformId,
      accountId: this.accountId,
      timestamp: new Date().toISOString(),
      entityId,
      dedupeKey: dedupeKey ?? `${this.platformId}:${this.accountId}:${type}:${entityId}:${Date.now()}`,
      payload,
    });
  }
}
