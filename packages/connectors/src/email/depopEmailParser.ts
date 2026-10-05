import type { EventType } from "@mcc/shared";
import type { ConnectorConversation, ConnectorMessage, ConnectorOffer, ConnectorOrder, ConnectorSale } from "../types.js";
import type { FetchedEmail } from "./emailSource.js";

export interface DepopNotice {
  messageId: string;
  type: EventType;
  date: string;
  historical: boolean;
  payload: { summary: string; subject: string; [k: string]: unknown };
}

export interface DepopEmailData {
  conversations: ConnectorConversation[];
  messages: Map<string, ConnectorMessage[]>;
  offers: ConnectorOffer[];
  orders: ConnectorOrder[];
  sales: ConnectorSale[];
  notices: DepopNotice[];
}

/**
 * Turns Depop notification emails into app data and alerts.
 *
 * Rules marked VERIFIED match the user's real Depop emails (inspected
 * 2026-10-05). Depop puts the content in the HTML part only (the text
 * part is just preheader padding), and every link is a tracking redirect —
 * so there are no product ids to tie an email to a specific listing.
 *
 * Only `*@alerts.depop.com` (transactional) is read; `*@ohhey.depop.com`
 * is marketing and ignored. Anything transactional without a dedicated
 * rule still surfaces as PLATFORM_NOTIFICATION, so nothing is dropped.
 *
 * Privacy: order emails contain the user's shipping address — only the
 * item, price, and total are taken from them.
 */
export function parseDepopEmails(emails: FetchedEmail[], connectedAt: string): DepopEmailData {
  const out: DepopEmailData = { conversations: [], messages: new Map(), offers: [], orders: [], sales: [], notices: [] };
  const since = new Date(connectedAt).getTime();

  for (const e of emails) {
    if (!/@alerts\.depop\.com$/i.test(e.from)) continue;
    const text = htmlToText(e.html) || e.text;
    const historical = new Date(e.date).getTime() < since;
    const user = e.subject.match(/@([\w.]+)/)?.[1] ?? text.match(/@([\w.]+)/)?.[1];
    const amount = money(text);
    const notice = (type: EventType, summary: string, extra: Record<string, unknown> = {}) =>
      out.notices.push({ messageId: e.messageId, type, date: e.date, historical, payload: { summary, subject: e.subject, ...extra } });

    // VERIFIED: "@seller has sent you a counter offer" — body "…counter offer of $42.70."
    if (/has sent you a counter offer/i.test(e.subject)) {
      notice("OFFER_RECEIVED", `Counter offer from @${user}${amount ? `: $${amount.toFixed(2)}` : ""} — you have 24h to respond (you're buying)`, {
        role: "buying",
        buyerName: `@${user}`,
        amount,
        currency: "USD",
      });
      continue;
    }
    // VERIFIED: "Don’t miss the counter offer from @seller" — a reminder of the above.
    if (/counter offer from @/i.test(e.subject)) {
      notice("PLATFORM_NOTIFICATION", `Reminder: counter offer from @${user} expires soon (you're buying)`, { role: "buying" });
      continue;
    }
    // VERIFIED: "@seller has accepted your offer" / "Congratulations – @seller has accepted your offer"
    if (/has accepted your offer/i.test(e.subject)) {
      notice("OFFER_ACCEPTED", `@${user} accepted your offer${amount ? ` of $${amount.toFixed(2)}` : ""} — buy it before it expires (you're buying)`, {
        role: "buying",
        amount,
      });
      continue;
    }
    // VERIFIED: "Your Depop order is confirmed" — "Item: … Item price: $38.00 … Total: $45.94"
    if (/your depop order is confirmed/i.test(e.subject)) {
      const item = text.match(/Item:\s*\|?\s*([^|]+?)\s*\|/i)?.[1]?.trim();
      const total = text.match(/Total:\s*\|?\s*\$\s?([\d,]+\.\d{2})/i)?.[1];
      notice("ORDER_CREATED", `Purchase confirmed${item ? `: ${item}` : ""}${total ? ` — $${total} total` : ""} from @${user} (you're buying)`, {
        role: "buying",
        item,
        total: total ? Number(total.replace(/,/g, "")) : undefined,
      });
      continue;
    }
    // VERIFIED: "Your order from @seller has been shipped"
    if (/your order from @[\w.]+ has been shipped/i.test(e.subject)) {
      notice("SHIPMENT_UPDATED", `@${user} shipped your order (you're buying)`, { role: "buying" });
      continue;
    }

    // UNVERIFIED (no real example yet): a buyer messaging the user. Goes to
    // the Inbox as that buyer's conversation; refine once one arrives.
    if (/\bmessage/i.test(e.subject) && user) {
      const conversationId = `email:${user.toLowerCase()}`;
      const body = firstSentenceAfter(text, user) ?? e.subject;
      out.conversations.push({ externalConversationId: conversationId, buyerName: `@${user}`, lastMessageAt: e.date, unread: !historical });
      const list = out.messages.get(conversationId) ?? [];
      list.push({ externalMessageId: e.messageId, senderName: `@${user}`, body, sentAt: e.date, direction: "INBOUND", historical });
      out.messages.set(conversationId, list);
      continue;
    }

    notice("PLATFORM_NOTIFICATION", `Depop: ${e.subject}${firstLine(text) ? ` — ${firstLine(text)}` : ""}`);
  }

  // One conversation row per buyer, newest message time wins.
  const byId = new Map<string, ConnectorConversation>();
  for (const c of out.conversations) {
    const prev = byId.get(c.externalConversationId);
    if (!prev || c.lastMessageAt > prev.lastMessageAt) byId.set(c.externalConversationId, { ...c, unread: c.unread || !!prev?.unread });
  }
  out.conversations = [...byId.values()];
  return out;
}

/** Visible text of an email's HTML, with block boundaries as " | ". */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/[͏­​‌]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" | ");
}

function money(text: string): number | undefined {
  const m = text.match(/of \$\s?([\d,]+(?:\.\d{2})?)/i) ?? text.match(/\$\s?([\d,]+\.\d{2})/);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

/** Skips Depop's header boilerplate ("Depop - buy, sell…", greetings). */
function firstLine(text: string): string | undefined {
  return text
    .split(" | ")
    .find((s) => s.length > 12 && !/^depop - |^hey @|^\d+$|^thanks/i.test(s))
    ?.slice(0, 200);
}

function firstSentenceAfter(text: string, user: string): string | undefined {
  const parts = text.split(" | ");
  const i = parts.findIndex((s) => s.includes(`@${user}`) && !/^hey @/i.test(s));
  return i >= 0 ? parts.slice(i, i + 2).join(" ").slice(0, 300) : undefined;
}
