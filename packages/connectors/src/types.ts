import type { ConnectorCapability, HealthStatus, StandardEvent } from "@mcc/shared";

export interface MarketplaceAccount {
  externalAccountId: string;
  displayName: string;
  profileUrl?: string;
}

export interface ConnectorConversation {
  externalConversationId: string;
  buyerName: string;
  listingTitle?: string;
  /** Preferred over listingTitle for linking, since titles can repeat. */
  externalListingId?: string;
  lastMessageAt: string;
  unread: boolean;
  /** The platform's own unread count, when it reports one. */
  unreadCount?: number;
}

export interface ConnectorMessage {
  externalMessageId: string;
  senderName: string;
  body: string;
  sentAt: string;
  /** UNKNOWN when the platform only exposes a preview without its sender;
   * SYSTEM for platform notices (never treated as a buyer message). */
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM" | "UNKNOWN";
  /** Happened before watching started: record it, but don't alert. */
  historical?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface ConnectorListing {
  externalListingId: string;
  title: string;
  price: number;
  currency: string;
  status: "ACTIVE" | "SOLD" | "REMOVED" | "DRAFT";
  /** Platform-supplied reason/notice, e.g. why a listing was taken down. */
  statusNote?: string;
  url?: string;
  views: number | null;
  likes: number | null;
  watchers: number | null;
  offerCount: number | null;
  messageCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorOrder {
  externalOrderId: string;
  externalListingId: string;
  buyerName: string;
  status: "CREATED" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorSale {
  externalOrderId: string;
  externalListingId: string;
  salePrice: number;
  currency: string;
  platformFees: number | null;
  paymentFees: number | null;
  soldAt: string;
  buyerName?: string;
  /** For the alert when the listing isn't (yet) known locally. */
  listingTitle?: string;
  historical?: boolean;
}

export interface ConnectorOffer {
  externalOfferId: string;
  externalListingId: string;
  buyerName: string;
  amount: number;
  currency: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "COUNTERED";
  createdAt: string;
  listingTitle?: string;
  historical?: boolean;
}

export type HydrationStatus =
  | "SUCCESS"
  /** Refused: the conversation is unread on the platform, and opening it
   * could mark it read. Only an explicit user confirmation overrides. */
  | "SKIPPED_UNREAD"
  | "NO_HISTORY_FOUND"
  | "AUTH_REQUIRED"
  | "PIN_DIALOG_PRESENT"
  | "PAGE_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR";

export interface HydrationOptions {
  /** User-initiated (deeper scroll limit). */
  manual?: boolean;
  /** The user explicitly confirmed opening an unread conversation. */
  allowUnread?: boolean;
  /** Caller's last known unread state, used only if the platform's own
   * current state for this conversation isn't available. */
  knownUnread?: boolean;
}

/** Result of reading one conversation's full thread. Messages are
 * chronological; `externalMessageId` is a deterministic fingerprint when
 * the platform shows no message ids. */
export interface HydrationResult {
  status: HydrationStatus;
  messages: ConnectorMessage[];
  reachedStart: boolean;
  detail?: string;
}

export interface SyncResult {
  syncedAt: string;
  events: StandardEvent[];
  errors: string[];
}

/**
 * Common interface every marketplace connector implements. The core
 * application never branches on platform name — only on
 * `supportedCapabilities`. A connector that doesn't support a capability
 * should throw `UnsupportedCapabilityError` if a method for it is called.
 */
export interface MarketplaceConnector {
  readonly platformId: string;
  readonly accountId: string;
  readonly supportedCapabilities: readonly ConnectorCapability[];
  /** When true the connector only reports current state, and the server
   * derives events (new/sold/removed listing, new message) by diffing it
   * against the database — so they survive restarts without re-firing.
   * When false/absent the connector emits its own events via sync(). */
  readonly coreDiffsState?: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  getAccount(): Promise<MarketplaceAccount>;

  getConversations(): Promise<ConnectorConversation[]>;
  getMessages(conversationId: string): Promise<ConnectorMessage[]>;
  sendMessage(conversationId: string, message: string): Promise<SendMessageResult>;

  getListings(): Promise<ConnectorListing[]>;
  getOrders(): Promise<ConnectorOrder[]>;
  getSales(): Promise<ConnectorSale[]>;
  getOffers(): Promise<ConnectorOffer[]>;

  sync(): Promise<SyncResult>;

  /** Optional: read a conversation's full history from the platform's
   * normal conversation view (read-only). Must refuse (SKIPPED_UNREAD) an
   * unread conversation unless `allowUnread` — the user explicitly
   * confirmed — is set. */
  hydrateConversation?(conversationId: string, options?: HydrationOptions): Promise<HydrationResult>;
  /** Max automatic hydrations per watchdog cycle. */
  readonly hydrationsPerCycle?: number;
}

export class UnsupportedCapabilityError extends Error {
  constructor(platformId: string, capability: ConnectorCapability) {
    super(`${platformId} connector does not support capability "${capability}"`);
    this.name = "UnsupportedCapabilityError";
  }
}
