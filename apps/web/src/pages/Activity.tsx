import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { Card } from "../components/Card.js";

const TYPE_ICON: Record<string, string> = {
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

function describe(type: string, payload: Record<string, unknown>): string {
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

export default function Activity() {
  const eventsQuery = useQuery({ queryKey: ["events"], queryFn: () => api.events.list(100) });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <p className="text-sm text-slate-400">Chronological feed of everything the watchdogs have seen.</p>
      </div>

      <Card>
        {eventsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {eventsQuery.data && eventsQuery.data.length === 0 && (
          <div className="text-sm text-slate-500">No events yet — start a watchdog on the Accounts page.</div>
        )}
        <ul className="flex flex-col divide-y divide-base-800">
          {eventsQuery.data?.map((evt) => (
            <li key={evt.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5">{TYPE_ICON[evt.type] ?? "⚪"}</span>
              <div className="flex-1">
                <div className="text-sm text-slate-200">{describe(evt.type, evt.payload)}</div>
                <div className="text-xs text-slate-500">
                  {evt.platformAccount.platform.name} / {evt.platformAccount.label} ·{" "}
                  {new Date(evt.timestamp).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
