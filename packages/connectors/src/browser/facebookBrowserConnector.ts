import type { Page, Response } from "playwright";
import type { ConnectorCapability, HealthStatus } from "@mcc/shared";
import type {
  ConnectorConversation,
  ConnectorListing,
  ConnectorMessage,
  ConnectorOffer,
  ConnectorOrder,
  ConnectorSale,
  HydrationOptions,
  HydrationResult,
  HydrationStatus,
  MarketplaceAccount,
  MarketplaceConnector,
  SendMessageResult,
  SyncResult,
} from "../types.js";
import { UnsupportedCapabilityError } from "../types.js";
import { closeHeadlessSession, getHeadlessSession, hasSavedSession } from "./browserSession.js";
import { isSystemNotice, labelsToMessages, parseMessageLabel } from "./facebookConversationParser.js";

export const FACEBOOK_LOGIN_URL = "https://www.facebook.com/login/";
const SELLING_URL = "https://www.facebook.com/marketplace/you/selling/";
const INBOX_URL = "https://www.facebook.com/marketplace/inbox/";

/** A scan is reused for this long, so one watchdog tick (health check +
 * listings + conversations + messages) and the Accounts page's status
 * polling never trigger more than one pass over facebook.com. */
const SCAN_TTL_MS = 60_000;

interface FbThread {
  threadId: string;
  buyerName: string;
  listingId?: string;
  listingTitle?: string;
  unreadCount: number;
  updatedAt: string;
  latestMessageId?: string;
  latestSnippet?: string;
  /** `UserMessage` or `GenericAdminTextMessage` (a Facebook notice). */
  latestType?: string;
}

/** Conservative limits for reading conversations (see hydrateConversation). */
export interface FacebookHydrationConfig {
  perCycle: number;
  pauseBetweenMs: number;
  maxScrolls: number;
  manualMaxScrolls: number;
  scrollWaitMs: number;
  pageTimeoutMs: number;
}

const DEFAULT_HYDRATION: FacebookHydrationConfig = {
  perCycle: 3,
  pauseBetweenMs: 5_000,
  maxScrolls: 6,
  manualMaxScrolls: 25,
  scrollWaitMs: 1_500,
  pageTimeoutMs: 45_000,
};

const CONVERSATION_URL = (threadId: string) => `https://www.facebook.com/messages/t/${threadId}/`;

interface Scan {
  at: number;
  authenticated: boolean;
  listings: ConnectorListing[];
  threads: FbThread[];
}

/**
 * REAL connector for the logged-in user's own Facebook Marketplace, read
 * headlessly through the session the user created in the login window
 * (browserSession.ts). The app never sees a password.
 *
 * Built against the live pages (2026-10-05), not guessed. Facebook renders
 * these pages from structured data it embeds in the HTML and fetches via
 * its GraphQL endpoint; that data carries real ids and statuses, so it is
 * read instead of the visual layout (which has no ids and many identical
 * cards — e.g. several "DESIGNER CARDHOLDERS $30" listings):
 *
 * - /marketplace/you/selling/ embeds one object per listing: `id`,
 *   `marketplace_listing_title`, `listing_price.formatted_amount`,
 *   `renderable_listing_status` (AVAILABLE | SOLD | REVIEW_REJECTED…),
 *   `listing_status_indicator.content` (e.g. "This listing may go against
 *   our rules for selling."), `listing_insights` (clicks), `creation_time`.
 * - /marketplace/inbox/ (seller tab) loads threads via GraphQL: `thread_key
 *   .thread_fbid`, the buyer in `other_participants`, the listing in
 *   `marketplace_thread_data.messageable_item`, `unread_count`,
 *   `updated_time_precise`, and the latest message's `id`, `snippet` and
 *   `__typename`. The inbox data never says who sent that latest message:
 *   it's INBOUND when the thread is unread (your own message can't be
 *   unread to you), SYSTEM for `GenericAdminTextMessage`, otherwise
 *   UNKNOWN until the conversation is hydrated.
 * - /messages/t/{thread_fbid}/ (the normal conversation view) renders the
 *   full thread with per-message sender/time labels — see
 *   hydrateConversation() and facebookConversationParser.ts.
 *
 * Reports state only (`coreDiffsState`); the server turns changes into
 * events and Discord notifications.
 */
export class FacebookBrowserConnector implements MarketplaceConnector {
  readonly platformId = "facebook-live";
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[] = ["listings", "messages"];
  readonly coreDiffsState = true;

  private readonly label: string;
  private readonly hydration: FacebookHydrationConfig;
  private scan: Scan | null = null;
  private inFlight: Promise<Scan> | null = null;
  /** Serializes everything that navigates the one shared page. */
  private pageQueue: Promise<unknown> = Promise.resolve();
  private lastConversationNavigationAt = 0;

  constructor(accountId: string, label: string, hydration: Partial<FacebookHydrationConfig> = {}) {
    this.accountId = accountId;
    this.label = label;
    this.hydration = { ...DEFAULT_HYDRATION, ...hydration };
  }

  get hydrationsPerCycle(): number {
    return this.hydration.perCycle;
  }

  async connect(): Promise<void> {
    if (!hasSavedSession(this.accountId)) return;
    await getHeadlessSession(this.accountId);
  }

  async disconnect(): Promise<void> {
    this.scan = null;
    await closeHeadlessSession(this.accountId);
  }

  async healthCheck(): Promise<HealthStatus> {
    const lastCheckedAt = new Date().toISOString();
    if (!hasSavedSession(this.accountId)) {
      return {
        online: false,
        authenticated: false,
        lastCheckedAt,
        message: "Not logged in yet — open the login window from the Accounts page",
      };
    }
    try {
      const scan = await this.getScan();
      return {
        online: true,
        authenticated: scan.authenticated,
        lastCheckedAt,
        message: scan.authenticated ? undefined : "Session expired — log in again from the Accounts page",
      };
    } catch (err) {
      return { online: false, authenticated: true, lastCheckedAt, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async getAccount(): Promise<MarketplaceAccount> {
    return { externalAccountId: this.accountId, displayName: this.label, profileUrl: SELLING_URL };
  }

  async getListings(): Promise<ConnectorListing[]> {
    return (await this.getAuthenticatedScan()).listings;
  }

  async getConversations(): Promise<ConnectorConversation[]> {
    const { threads } = await this.getAuthenticatedScan();
    return threads.map((t) => ({
      externalConversationId: t.threadId,
      buyerName: t.buyerName,
      listingTitle: t.listingTitle,
      externalListingId: t.listingId,
      lastMessageAt: t.updatedAt,
      unread: t.unreadCount > 0,
      unreadCount: t.unreadCount,
    }));
  }

  async getMessages(conversationId: string): Promise<ConnectorMessage[]> {
    const { threads } = await this.getAuthenticatedScan();
    const t = threads.find((x) => x.threadId === conversationId);
    if (!t?.latestMessageId || t.latestSnippet === undefined) return [];
    // Notices first: Facebook types some (e.g. "<name> sent you a message
    // about your listing") as UserMessage, so the text is checked too.
    const direction: ConnectorMessage["direction"] =
      t.latestType === "GenericAdminTextMessage" || isSystemNotice(t.latestSnippet)
        ? "SYSTEM"
        : t.unreadCount > 0
          ? "INBOUND"
          : "UNKNOWN";
    return [
      {
        externalMessageId: t.latestMessageId,
        senderName: direction === "SYSTEM" ? "Facebook" : direction === "INBOUND" ? t.buyerName : "Latest message",
        body: t.latestSnippet,
        sentAt: t.updatedAt,
        direction,
      },
    ];
  }

  /**
   * Reads one conversation's history from Facebook's normal conversation
   * view, read-only: it navigates to the conversation, waits, reads the
   * rendered per-message labels, and scrolls the message list upward (a
   * DOM scroll — no clicks, typing, or key presses) to load older messages.
   * It never touches the end-to-end-encryption PIN dialog Facebook shows
   * for the user's other chats; Marketplace threads render behind it.
   * Security walls (login, checkpoint, "temporarily blocked") stop it.
   */
  async hydrateConversation(conversationId: string, options: HydrationOptions = {}): Promise<HydrationResult> {
    const cfg = this.hydration;
    const maxScrolls = options.manual ? cfg.manualMaxScrolls : cfg.maxScrolls;

    // Hard guard, independent of callers: never open a conversation that
    // Facebook reports as unread — viewing it can mark it read and show
    // the buyer "Seen". Uses Facebook's own unread count from the inbox
    // scan (cached ≤60s; refreshing it only loads the inbox, never a
    // conversation). Must run before withPage: the scan takes the lock too.
    if (!options.allowUnread) {
      const scan = await this.getScan();
      if (!scan.authenticated) return failure("AUTH_REQUIRED", "Facebook session expired — log in again from the Accounts page");
      const thread = scan.threads.find((t) => t.threadId === conversationId);
      const unread = thread ? thread.unreadCount > 0 : options.knownUnread !== false;
      if (unread) return failure("SKIPPED_UNREAD", "Unread on Facebook — not opened, so it isn't marked read");
    }

    return this.withPage(async (page) => {
      const wait = this.lastConversationNavigationAt + cfg.pauseBetweenMs - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);

      let status = 0;
      try {
        const res = await page.goto(CONVERSATION_URL(conversationId), { waitUntil: "domcontentloaded", timeout: cfg.pageTimeoutMs });
        status = res?.status() ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return failure(/timeout/i.test(message) ? "TIMEOUT" : "PAGE_ERROR", message);
      } finally {
        this.lastConversationNavigationAt = Date.now();
      }
      if (status === 429) return failure("RATE_LIMITED", "Facebook answered 429 Too Many Requests");
      if (isLoginUrl(page.url())) return failure("AUTH_REQUIRED", "Facebook asked to log in or verify — log in again from the Accounts page");

      const rendered = await page
        .waitForSelector('[role="article"]', { timeout: Math.min(cfg.pageTimeoutMs, 20_000) })
        .then(() => true)
        .catch(() => false);
      if (!rendered) {
        const text = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => "");
        if (/temporarily blocked|going too fast|try again later/i.test(text)) return failure("RATE_LIMITED", "Facebook says to slow down");
        if (/log in to facebook|log into facebook|confirm your identity|security check/i.test(text)) {
          return failure("AUTH_REQUIRED", "Facebook showed a login or security check — log in again from the Accounts page");
        }
        if (/enter your pin to restore/i.test(text)) return failure("PIN_DIALOG_PRESENT", "Only the encrypted-chat PIN prompt rendered");
        return failure("NO_HISTORY_FOUND", "No messages rendered for this conversation");
      }
      await waitForLabelsToSettle(page);

      // Collect labels pass by pass; virtualized lists can drop rows while
      // scrolling, so keep the most copies of each label seen in one pass.
      const best = new Map<string, { count: number; pass: number; index: number }>();
      let reachedStart = false;
      let stalePasses = 0;
      for (let pass = 0; pass <= maxScrolls; pass++) {
        const labels = await readMessageLabels(page);
        const counts = new Map<string, number>();
        let added = 0;
        labels.forEach((label, index) => {
          const n = (counts.get(label) ?? 0) + 1;
          counts.set(label, n);
          const prev = best.get(label);
          if (!prev) added++;
          if (!prev || n > prev.count) best.set(label, { count: n, pass: prev?.pass ?? pass, index: prev?.index ?? index });
        });
        if (labels.some((l) => /started this chat\.?$/i.test(l))) {
          reachedStart = true;
          break;
        }
        stalePasses = added === 0 && pass > 0 ? stalePasses + 1 : 0;
        if (stalePasses >= 2 || pass === maxScrolls) break;
        const moved = await scrollMessagesUp(page);
        if (!moved && pass > 0) {
          reachedStart = true;
          break;
        }
        await page.waitForTimeout(cfg.scrollWaitMs);
        await waitForLabelsToSettle(page);
      }

      const ordered = [...best.entries()]
        .flatMap(([label, s]) => Array.from({ length: s.count }, () => ({ label, ...s, at: parseMessageLabel(label)?.sentAt.getTime() ?? 0 })))
        .sort((a, b) => a.at - b.at || b.pass - a.pass || a.index - b.index)
        .map((x) => x.label);
      const messages = labelsToMessages(conversationId, ordered);
      return { status: messages.length ? "SUCCESS" : "NO_HISTORY_FOUND", messages, reachedStart };
    });
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
    return { syncedAt: new Date().toISOString(), events: [], errors: [] };
  }

  // ---- internals --------------------------------------------------------

  private async getAuthenticatedScan(): Promise<Scan> {
    const scan = await this.getScan();
    if (!scan.authenticated) throw new Error("Facebook session expired — log in again from the Accounts page");
    return scan;
  }

  private async getScan(): Promise<Scan> {
    if (this.scan && Date.now() - this.scan.at < SCAN_TTL_MS) return this.scan;
    if (!this.inFlight) {
      this.inFlight = this.runScan()
        .then((s) => (this.scan = s))
        .finally(() => (this.inFlight = null));
    }
    return this.inFlight;
  }

  private withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const run = this.pageQueue.then(async () => fn((await getHeadlessSession(this.accountId)).page));
    this.pageQueue = run.catch(() => undefined);
    return run;
  }

  private runScan(): Promise<Scan> {
    return this.withPage((page) => this.scanPages(page));
  }

  private async scanPages(page: Page): Promise<Scan> {
    const payloads: string[] = [];
    const onResponse = (res: Response) => {
      if (!res.url().includes("/api/graphql")) return;
      res
        .text()
        .then((body) => {
          if (body.includes("marketplace_listing_title") || body.includes("thread_fbid")) payloads.push(body);
        })
        .catch(() => undefined);
    };
    page.on("response", onResponse);
    try {
      await page.goto(SELLING_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (isLoginUrl(page.url())) return { at: Date.now(), authenticated: false, listings: [], threads: [] };
      await page.waitForTimeout(4_000);
      await scrollToLoadMore(page, 6);
      payloads.push(...(await embeddedJson(page)));

      await page.goto(INBOX_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (isLoginUrl(page.url())) return { at: Date.now(), authenticated: false, listings: [], threads: [] };
      await page.waitForTimeout(4_000);
      await scrollToLoadMore(page, 2);
      payloads.push(...(await embeddedJson(page)));
      await page.waitForTimeout(1_000);
    } finally {
      page.off("response", onResponse);
    }

    const listings = new Map<string, ConnectorListing>();
    const threads = new Map<string, FbThread>();
    for (const body of payloads) {
      for (const json of parseJsonChunks(body)) walk(json, listings, threads);
    }
    return { at: Date.now(), authenticated: true, listings: [...listings.values()], threads: [...threads.values()] };
  }
}

function isLoginUrl(url: string): boolean {
  return url.includes("/login") || url.includes("/checkpoint");
}

function failure(status: HydrationStatus, detail: string): HydrationResult {
  return { status, messages: [], reachedStart: false, detail };
}

/** The rendered per-message labels, in on-screen (chronological) order. */
async function readMessageLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="article"]'))
      .map((article) => article.querySelector('[aria-label*="Message sent "]')?.getAttribute("aria-label") ?? "")
      .filter((label) => /^(Enter,\s*)?Message sent /.test(label)),
  );
}

/** Messages render before participant names load ("…by : text"); wait
 * until no label is missing its sender and the count holds steady. */
async function waitForLabelsToSettle(page: Page): Promise<void> {
  let previous = -1;
  for (let i = 0; i < 12; i++) {
    const labels = await readMessageLabels(page);
    const incomplete = labels.some((l) => / by :/.test(l));
    if (!incomplete && labels.length > 0 && labels.length === previous) return;
    previous = labels.length;
    await page.waitForTimeout(800);
  }
}

/** Scrolls the message list's own scroll container up by one screen.
 * Returns false when it was already at the top. */
async function scrollMessagesUp(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    let el = document.querySelector('[role="article"]')?.parentElement ?? null;
    while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) {
      el = el.parentElement;
    }
    if (!el || el.scrollTop <= 0) return false;
    el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
    return true;
  });
}

async function scrollToLoadMore(page: import("playwright").Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1_200);
  }
}

async function embeddedJson(page: import("playwright").Page): Promise<string[]> {
  return page.$$eval('script[type="application/json"]', (els) =>
    els
      .map((e) => e.textContent ?? "")
      .filter((t) => t.includes("marketplace_listing_title") || t.includes("thread_fbid")),
  );
}

/** GraphQL responses can be several JSON documents separated by newlines. */
function parseJsonChunks(body: string): unknown[] {
  const out: unknown[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // partial/streamed chunk — skip
    }
  }
  return out;
}

type Obj = Record<string, any>;

function walk(node: unknown, listings: Map<string, ConnectorListing>, threads: Map<string, FbThread>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, listings, threads);
    return;
  }
  const o = node as Obj;
  if (typeof o.marketplace_listing_title === "string" && typeof o.id === "string" && "listing_price" in o && o.is_viewer_seller !== false) {
    const l = toListing(o);
    if (l) listings.set(l.externalListingId, l);
  }
  if (o.thread_key?.thread_fbid && o.other_participants) {
    const t = toThread(o);
    if (t) threads.set(t.threadId, t);
  }
  for (const v of Object.values(o)) walk(v, listings, threads);
}

function toListing(o: Obj): ConnectorListing | null {
  const status = String(o.renderable_listing_status ?? "");
  const note: string | undefined = o.listing_status_indicator?.content ?? undefined;
  let mapped: ConnectorListing["status"];
  if (o.is_sold || status === "SOLD") mapped = "SOLD";
  else if (o.is_draft) mapped = "DRAFT";
  else if (o.listing_is_rejected || status.includes("REJECTED") || status === "EXPIRED" || status === "DELETED") mapped = "REMOVED";
  else mapped = "ACTIVE";

  const priceText: string = o.listing_price?.formatted_amount ?? o.formatted_price?.text ?? "";
  const price = Number(priceText.replace(/[^\d.]/g, "")) || 0;
  const clicks = o.listing_insights?.insights?.[0]?.count;
  const created = typeof o.creation_time === "number" ? new Date(o.creation_time * 1000).toISOString() : new Date().toISOString();

  return {
    externalListingId: o.id,
    title: o.marketplace_listing_title,
    price,
    currency: "USD",
    status: mapped,
    statusNote: mapped === "REMOVED" ? (note ?? `Facebook status: ${status}`) : undefined,
    url: `https://www.facebook.com/marketplace/item/${o.id}/`,
    views: typeof clicks === "number" ? clicks : null,
    likes: null,
    watchers: null,
    offerCount: null,
    messageCount: null,
    createdAt: created,
    updatedAt: new Date().toISOString(),
  };
}

function toThread(o: Obj): FbThread | null {
  const buyer = o.other_participants?.edges?.[0]?.node?.messaging_actor;
  const latest = o.messages?.edges?.[0]?.node;
  const updated = Number(o.updated_time_precise);
  if (!buyer?.name || !updated) return null;
  return {
    threadId: String(o.thread_key.thread_fbid),
    buyerName: buyer.name,
    listingId: o.marketplace_thread_data?.messageable_item?.id,
    listingTitle: o.marketplace_thread_data?.messageable_item?.marketplace_listing_title,
    unreadCount: Number(o.unread_count ?? 0),
    updatedAt: new Date(updated).toISOString(),
    latestMessageId: latest?.id,
    latestSnippet: typeof latest?.snippet === "string" ? latest.snippet : undefined,
    latestType: typeof latest?.__typename === "string" ? latest.__typename : undefined,
  };
}
