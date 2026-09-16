export const EVENT_TYPES = [
  "MESSAGE_RECEIVED",
  "MESSAGE_SENT",

  "OFFER_RECEIVED",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "OFFER_EXPIRED",

  "LISTING_CREATED",
  "LISTING_UPDATED",
  "LISTING_REMOVED",
  "LISTING_SOLD",

  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",

  "PAYMENT_RECEIVED",
  "REFUND_ISSUED",

  "SHIPMENT_CREATED",
  "SHIPMENT_UPDATED",
  "ORDER_DELIVERED",

  "ACCOUNT_CONNECTED",
  "ACCOUNT_DISCONNECTED",
  "AUTHENTICATION_REQUIRED",

  "WATCHDOG_STARTED",
  "WATCHDOG_STOPPED",
  "WATCHDOG_ERROR",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Every standardized event a connector/watchdog emits into the event engine.
 * `dedupeKey` is what the engine uses to collapse repeat sightings of the
 * same underlying platform event into a single stored Event (see
 * apps/server event-engine dedup logic) — connectors should make it stable
 * across re-polls (e.g. `${platformId}:${accountId}:message:${externalId}`).
 */
export interface StandardEvent<TPayload = unknown> {
  id: string;
  type: EventType;
  platformId: string;
  accountId: string;
  timestamp: string;
  entityId: string;
  dedupeKey: string;
  payload: TPayload;
}

export interface MessageReceivedPayload {
  conversationId: string;
  externalMessageId: string;
  senderName: string;
  body: string;
  listingTitle?: string;
}

export interface OfferReceivedPayload {
  offerId: string;
  listingId: string;
  listingTitle: string;
  buyerName: string;
  amount: number;
  currency: string;
}

export interface ListingSoldPayload {
  listingId: string;
  listingTitle: string;
  salePrice: number;
  currency: string;
}

export interface WatchdogErrorPayload {
  message: string;
  code?: string;
}
