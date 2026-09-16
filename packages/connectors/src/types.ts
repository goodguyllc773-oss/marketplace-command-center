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
  lastMessageAt: string;
  unread: boolean;
}

export interface ConnectorMessage {
  externalMessageId: string;
  senderName: string;
  body: string;
  sentAt: string;
  direction: "INBOUND" | "OUTBOUND";
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
}

export interface ConnectorOffer {
  externalOfferId: string;
  externalListingId: string;
  buyerName: string;
  amount: number;
  currency: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "COUNTERED";
  createdAt: string;
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
}

export class UnsupportedCapabilityError extends Error {
  constructor(platformId: string, capability: ConnectorCapability) {
    super(`${platformId} connector does not support capability "${capability}"`);
    this.name = "UnsupportedCapabilityError";
  }
}
