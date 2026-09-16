import { randomUUID } from "node:crypto";
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

export interface MockCatalogItem {
  title: string;
  price: number;
}

export interface MockConnectorSeed {
  platformId: string;
  accountId: string;
  accountDisplayName: string;
  catalog: MockCatalogItem[];
  buyerNames: string[];
  currency?: string;
  /** Defaults to all capabilities — override to model a platform that
   * genuinely doesn't support something (e.g. no formal shipping tracking
   * for local-pickup-heavy marketplaces). */
  capabilities?: readonly ConnectorCapability[];
}

interface ListingState extends ConnectorListing {
  conversationIds: string[];
}

/**
 * Shared engine behind every Mock*Connector. Holds realistic fake state in
 * memory (no persistence — the app's own DB is the persistence layer) and
 * exposes `simulate*` methods so tests/dev tooling can trigger new
 * messages, offers, sales, refunds, disconnects, duplicate events, and
 * watchdog failures on demand (spec section 25).
 */
export class MockConnectorBase implements MarketplaceConnector {
  readonly platformId: string;
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[];

  private connected = false;
  private authenticated = true;
  private readonly currency: string;
  private readonly account: MarketplaceAccount;
  private readonly listings = new Map<string, ListingState>();
  private readonly conversations = new Map<string, ConnectorConversation>();
  private readonly messages = new Map<string, ConnectorMessage[]>();
  private readonly offers = new Map<string, ConnectorOffer>();
  private readonly orders = new Map<string, ConnectorOrder>();
  private readonly sales = new Map<string, ConnectorSale>();
  private readonly pendingEvents: StandardEvent[] = [];
  private lastEvent: StandardEvent | undefined;
  private forcedError: string | undefined;

  constructor(private readonly seed: MockConnectorSeed) {
    this.platformId = seed.platformId;
    this.accountId = seed.accountId;
    this.supportedCapabilities = seed.capabilities ?? [
      "messages",
      "sendMessages",
      "listings",
      "offers",
      "orders",
      "sales",
      "shipping",
    ];
    this.currency = seed.currency ?? "USD";
    this.account = {
      externalAccountId: `${seed.platformId}-${seed.accountId}`,
      displayName: seed.accountDisplayName,
      profileUrl: `https://example-${seed.platformId}.test/u/${seed.accountId}`,
    };
    this.seedInitialData();
  }

  // ---- lifecycle ----------------------------------------------------

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (this.forcedError) {
      return {
        online: false,
        authenticated: this.authenticated,
        lastCheckedAt: new Date().toISOString(),
        message: this.forcedError,
      };
    }
    return {
      online: this.connected,
      authenticated: this.authenticated,
      lastCheckedAt: new Date().toISOString(),
      message: this.connected ? undefined : "Not connected",
    };
  }

  async getAccount(): Promise<MarketplaceAccount> {
    return this.account;
  }

  // ---- reads ----------------------------------------------------------

  async getConversations(): Promise<ConnectorConversation[]> {
    return [...this.conversations.values()].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    );
  }

  async getMessages(conversationId: string): Promise<ConnectorMessage[]> {
    return this.messages.get(conversationId) ?? [];
  }

  async sendMessage(conversationId: string, message: string): Promise<SendMessageResult> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return { ok: false, error: "Unknown conversation" };
    const externalMessageId = randomUUID();
    const list = this.messages.get(conversationId) ?? [];
    list.push({
      externalMessageId,
      senderName: this.account.displayName,
      body: message,
      sentAt: new Date().toISOString(),
      direction: "OUTBOUND",
    });
    this.messages.set(conversationId, list);
    conv.lastMessageAt = new Date().toISOString();
    conv.unread = false;
    this.emit("MESSAGE_SENT", conversationId, {
      conversationId,
      externalMessageId,
      senderName: this.account.displayName,
      body: message,
    });
    return { ok: true, externalMessageId };
  }

  async getListings(): Promise<ConnectorListing[]> {
    return [...this.listings.values()].map(({ conversationIds: _omit, ...l }) => l);
  }

  async getOrders(): Promise<ConnectorOrder[]> {
    return [...this.orders.values()];
  }

  async getSales(): Promise<ConnectorSale[]> {
    return [...this.sales.values()];
  }

  async getOffers(): Promise<ConnectorOffer[]> {
    return [...this.offers.values()];
  }

  async sync(): Promise<SyncResult> {
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    const errors = this.forcedError ? [this.forcedError] : [];
    return { syncedAt: new Date().toISOString(), events, errors };
  }

  // ---- simulation hooks (dev/test only) --------------------------------

  simulateNewMessage(opts?: { conversationId?: string; body?: string }): void {
    const conv =
      (opts?.conversationId && this.conversations.get(opts.conversationId)) ??
      [...this.conversations.values()][0];
    if (!conv) return;
    const body = opts?.body ?? "Is this still available?";
    const externalMessageId = randomUUID();
    const list = this.messages.get(conv.externalConversationId) ?? [];
    list.push({
      externalMessageId,
      senderName: conv.buyerName,
      body,
      sentAt: new Date().toISOString(),
      direction: "INBOUND",
    });
    this.messages.set(conv.externalConversationId, list);
    conv.lastMessageAt = new Date().toISOString();
    conv.unread = true;
    this.emit(
      "MESSAGE_RECEIVED",
      conv.externalConversationId,
      {
        conversationId: conv.externalConversationId,
        externalMessageId,
        senderName: conv.buyerName,
        body,
        listingTitle: conv.listingTitle,
      },
      `${this.platformId}:${this.accountId}:message:${externalMessageId}`,
    );
  }

  simulateNewOffer(opts?: { listingId?: string; amount?: number }): void {
    const listing =
      (opts?.listingId && this.listings.get(opts.listingId)) ??
      [...this.listings.values()].find((l) => l.status === "ACTIVE");
    if (!listing) return;
    const buyerName = this.randomBuyer();
    const amount = opts?.amount ?? Math.round(listing.price * 0.8);
    const externalOfferId = randomUUID();
    this.offers.set(externalOfferId, {
      externalOfferId,
      externalListingId: listing.externalListingId,
      buyerName,
      amount,
      currency: this.currency,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });
    listing.offerCount = (listing.offerCount ?? 0) + 1;
    this.emit(
      "OFFER_RECEIVED",
      externalOfferId,
      {
        offerId: externalOfferId,
        listingId: listing.externalListingId,
        listingTitle: listing.title,
        buyerName,
        amount,
        currency: this.currency,
      },
      `${this.platformId}:${this.accountId}:offer:${externalOfferId}`,
    );
  }

  simulateSale(opts?: { listingId?: string }): void {
    const listing =
      (opts?.listingId && this.listings.get(opts.listingId)) ??
      [...this.listings.values()].find((l) => l.status === "ACTIVE");
    if (!listing) return;
    listing.status = "SOLD";
    listing.updatedAt = new Date().toISOString();
    const externalOrderId = randomUUID();
    const buyerName = this.randomBuyer();
    this.orders.set(externalOrderId, {
      externalOrderId,
      externalListingId: listing.externalListingId,
      buyerName,
      status: "PAID",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.sales.set(externalOrderId, {
      externalOrderId,
      externalListingId: listing.externalListingId,
      salePrice: listing.price,
      currency: this.currency,
      platformFees: Math.round(listing.price * 0.09 * 100) / 100,
      paymentFees: Math.round(listing.price * 0.029 * 100) / 100,
      soldAt: new Date().toISOString(),
    });
    this.emit(
      "LISTING_SOLD",
      listing.externalListingId,
      {
        listingId: listing.externalListingId,
        listingTitle: listing.title,
        salePrice: listing.price,
        currency: this.currency,
      },
      `${this.platformId}:${this.accountId}:sold:${listing.externalListingId}`,
    );
    this.emit(
      "ORDER_CREATED",
      externalOrderId,
      { orderId: externalOrderId, listingId: listing.externalListingId, buyerName },
      `${this.platformId}:${this.accountId}:order:${externalOrderId}`,
    );
  }

  simulateRefund(opts: { orderId: string }): void {
    const order = this.orders.get(opts.orderId);
    if (!order) return;
    order.status = "REFUNDED";
    order.updatedAt = new Date().toISOString();
    this.emit(
      "REFUND_ISSUED",
      opts.orderId,
      { orderId: opts.orderId },
      `${this.platformId}:${this.accountId}:refund:${opts.orderId}:${Date.now()}`,
    );
  }

  simulateDisconnect(): void {
    this.connected = false;
    this.authenticated = false;
    this.emit(
      "ACCOUNT_DISCONNECTED",
      this.accountId,
      { reason: "Session expired" },
      `${this.platformId}:${this.accountId}:disconnected:${Date.now()}`,
    );
  }

  /** Re-emits the last event with the same dedupeKey, to exercise the event
   * engine's deduplication (a watchdog re-polling should not double-fire
   * notifications for the same underlying platform event). */
  simulateDuplicateEvent(): void {
    if (!this.lastEvent) return;
    this.pendingEvents.push({ ...this.lastEvent, id: randomUUID(), timestamp: new Date().toISOString() });
  }

  simulateWatchdogFailure(message = "Simulated connector failure"): void {
    this.forcedError = message;
    this.emit(
      "WATCHDOG_ERROR",
      this.accountId,
      { message },
      `${this.platformId}:${this.accountId}:error:${Date.now()}`,
    );
  }

  clearForcedError(): void {
    this.forcedError = undefined;
  }

  // ---- internals ------------------------------------------------------

  private emit(type: EventType, entityId: string, payload: unknown, dedupeKey?: string): void {
    const event: StandardEvent = {
      id: randomUUID(),
      type,
      platformId: this.platformId,
      accountId: this.accountId,
      timestamp: new Date().toISOString(),
      entityId,
      dedupeKey: dedupeKey ?? `${this.platformId}:${this.accountId}:${type}:${entityId}`,
      payload,
    };
    this.pendingEvents.push(event);
    this.lastEvent = event;
  }

  private randomBuyer(): string {
    const pool = this.seed.buyerNames;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Baseline catalog/conversation ids must be STABLE across app restarts —
   * a real marketplace's ids don't change when your watchdog restarts, and
   * `sync()` upserts by external id, so random ids here would duplicate
   * the whole baseline catalog on every restart. `simulate*` events (new
   * activity during a session) still use `randomUUID()`, which is correct
   * for genuinely new occurrences.
   */
  private stableId(kind: string, index: number): string {
    return `seed-${this.platformId}-${this.accountId}-${kind}-${index}`;
  }

  private seedInitialData(): void {
    const rng = mulberry32(hashString(`${this.platformId}:${this.accountId}`));
    const now = Date.now();
    this.seed.catalog.forEach((item, i) => {
      const externalListingId = this.stableId("listing", i);
      const createdAt = new Date(now - (i + 1) * 86_400_000).toISOString();
      this.listings.set(externalListingId, {
        externalListingId,
        title: item.title,
        price: item.price,
        currency: this.currency,
        status: "ACTIVE",
        url: `https://example-${this.platformId}.test/listing/${externalListingId}`,
        views: Math.floor(rng() * 200),
        likes: Math.floor(rng() * 30),
        watchers: Math.floor(rng() * 10),
        offerCount: 0,
        messageCount: 0,
        createdAt,
        updatedAt: createdAt,
        conversationIds: [],
      });
    });

    const listingsArr = [...this.listings.values()];
    for (let i = 0; i < Math.min(2, listingsArr.length); i++) {
      const listing = listingsArr[i];
      const externalConversationId = this.stableId("conversation", i);
      const buyerName = this.seed.buyerNames[i % this.seed.buyerNames.length];
      this.conversations.set(externalConversationId, {
        externalConversationId,
        buyerName,
        listingTitle: listing.title,
        lastMessageAt: new Date(now - i * 3_600_000).toISOString(),
        unread: i === 0,
      });
      this.messages.set(externalConversationId, [
        {
          externalMessageId: this.stableId("message", i),
          senderName: buyerName,
          body: "Is this still available?",
          sentAt: new Date(now - i * 3_600_000).toISOString(),
          direction: "INBOUND",
        },
      ]);
      listing.conversationIds.push(externalConversationId);
      listing.messageCount = (listing.messageCount ?? 0) + 1;
    }
  }
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
