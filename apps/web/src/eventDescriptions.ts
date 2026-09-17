export const EVENT_TYPE_ICON: Record<string, string> = {
  MESSAGE_RECEIVED: "\u{1F534}",
  MESSAGE_SENT: "\u{1F4E4}",
  OFFER_RECEIVED: "\u{1F7E1}",
  OFFER_ACCEPTED: "\u{1F7E2}",
  OFFER_DECLINED: "⚪",
  OFFER_EXPIRED: "⚪",
  LISTING_CREATED: "\u{1F7E2}",
  LISTING_UPDATED: "\u{1F7E2}",
  LISTING_REMOVED: "⚫",
  LISTING_SOLD: "\u{1F7E2}",
  ORDER_CREATED: "\u{1F4E6}",
  ORDER_UPDATED: "\u{1F4E6}",
  ORDER_CANCELLED: "⚫",
  PAYMENT_RECEIVED: "\u{1F4B0}",
  REFUND_ISSUED: "↩️",
  SHIPMENT_CREATED: "\u{1F4E6}",
  SHIPMENT_UPDATED: "\u{1F4E6}",
  ORDER_DELIVERED: "\u{1F4E5}",
  ACCOUNT_CONNECTED: "\u{1F7E2}",
  ACCOUNT_DISCONNECTED: "\u{1F534}",
  AUTHENTICATION_REQUIRED: "\u{1F534}",
  WATCHDOG_STARTED: "\u{1F7E2}",
  WATCHDOG_STOPPED: "⚫",
  WATCHDOG_ERROR: "\u{1F6A8}",
};

export function describeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "MESSAGE_RECEIVED":
      return `New message from ${payload.senderName ?? "buyer"}${payload.listingTitle ? ` about "${payload.listingTitle}"` : ""}`;
    case "MESSAGE_SENT":
      return "Message sent";
    case "OFFER_RECEIVED":
      return `Offer of ${payload.amount} ${payload.currency ?? ""} on "${payload.listingTitle}"`;
    case "LISTING_SOLD":
      return `Sold "${payload.listingTitle}" for ${payload.salePrice} ${payload.currency ?? ""}`;
    case "REFUND_ISSUED":
      return "Refund issued";
    case "ACCOUNT_DISCONNECTED":
      return `Account disconnected${payload.reason ? `: ${payload.reason}` : ""}`;
    case "WATCHDOG_ERROR":
      return `Watchdog error: ${payload.message ?? "unknown"}`;
    default:
      return type.replaceAll("_", " ").toLowerCase();
  }
}
