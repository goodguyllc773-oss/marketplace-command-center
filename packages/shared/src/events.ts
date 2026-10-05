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

  // A platform notification that doesn't map to a more specific type
  // (e.g. a Depop email we don't have a dedicated rule for yet).
  "PLATFORM_NOTIFICATION",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Groups of event types that can each be routed to their own Discord
 * channel (webhook). Every event type belongs to exactly one category. */
export const NOTIFICATION_CATEGORIES = [
  { id: "messages", label: "Messages", eventTypes: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
  { id: "offers", label: "Offers", eventTypes: ["OFFER_RECEIVED", "OFFER_ACCEPTED", "OFFER_DECLINED", "OFFER_EXPIRED"] },
  { id: "listings", label: "Listings", eventTypes: ["LISTING_CREATED", "LISTING_UPDATED", "LISTING_REMOVED"] },
  {
    id: "sales",
    label: "Sales & orders",
    eventTypes: [
      "LISTING_SOLD",
      "ORDER_CREATED",
      "ORDER_UPDATED",
      "ORDER_CANCELLED",
      "PAYMENT_RECEIVED",
      "REFUND_ISSUED",
      "SHIPMENT_CREATED",
      "SHIPMENT_UPDATED",
      "ORDER_DELIVERED",
    ],
  },
  {
    id: "health",
    label: "Account health",
    eventTypes: [
      "ACCOUNT_CONNECTED",
      "ACCOUNT_DISCONNECTED",
      "AUTHENTICATION_REQUIRED",
      "WATCHDOG_STARTED",
      "WATCHDOG_STOPPED",
      "WATCHDOG_ERROR",
    ],
  },
  { id: "other", label: "Other notifications", eventTypes: ["PLATFORM_NOTIFICATION"] },
] as const satisfies readonly { id: string; label: string; eventTypes: readonly EventType[] }[];

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]["id"];

export function categoryForEvent(eventType: string): NotificationCategoryId | undefined {
  return NOTIFICATION_CATEGORIES.find((c) => (c.eventTypes as readonly string[]).includes(eventType))?.id;
}

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
