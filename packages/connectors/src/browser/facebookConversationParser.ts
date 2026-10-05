import { createHash } from "node:crypto";
import type { ConnectorMessage } from "../types.js";

/**
 * Parses the accessibility labels Facebook's normal conversation view puts
 * on each message (verified live 2026-10-05). Each message is a
 * `role="article"` containing an element whose aria-label reads:
 *
 *   "Enter, Message sent September 28, 2026, 3:33 PM by You: Yes, are you interested?"
 *
 * Direction comes from that structured sender, never from bubble
 * position: "You" → OUTBOUND, a platform notice → SYSTEM, anyone else
 * (the buyer) → INBOUND. The wording is Facebook's English UI text; a
 * label that doesn't match is skipped rather than guessed at.
 */

// The sender can't be empty or contain ":" — Facebook briefly renders
// "…by : text" before participant names load, and that must not be read
// as a sender (seen live 2026-10-05).
const LABEL = /^(?:Enter,\s*)?Message sent ([A-Z][a-z]+ \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M) by ([^:\s][^:]*?)(?:: ([\s\S]*))?$/;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Facebook-generated notices that appear inside a thread. */
const SYSTEM_BODY = [
  /\bstarted this chat\.?$/i,
  /^beware of /i,
  /\bis waiting for your response\.?$/i,
  /\bsent you a message about your listing\b/i,
];
const SYSTEM_SENDERS = new Set(["facebook", "marketplace", "meta"]);

export interface ParsedLabel {
  sentAt: Date;
  sender: string;
  body: string;
}

export function parseMessageLabel(label: string): ParsedLabel | null {
  const m = label.replace(/\s+/g, " ").trim().match(LABEL);
  if (!m) return null;
  const sentAt = parseLocalTimestamp(m[1]);
  if (!sentAt) return null;
  return { sentAt, sender: m[2].trim(), body: (m[3] ?? "").trim() || "(attachment)" };
}

/** "September 28, 2026, 3:33 PM" in the machine's local time zone (the
 * browser renders labels in local time). Minute precision. */
function parseLocalTimestamp(s: string): Date | null {
  const m = s.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2})\s?([AP]M)$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  const [day, year, hour12, minute] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (month < 0 || hour12 < 1 || hour12 > 12 || minute > 59 || day < 1) return null;
  const hour = (hour12 % 12) + (m[6] === "PM" ? 12 : 0);
  const d = new Date(year, month, day, hour, minute);
  return d.getMonth() === month && d.getDate() === day ? d : null; // rejects e.g. February 31
}

/** Facebook-generated notice text (also used for inbox previews). */
export function isSystemNotice(body: string): boolean {
  return SYSTEM_BODY.some((re) => re.test(body.trim()));
}

export function directionFor(sender: string, body: string): ConnectorMessage["direction"] {
  if (SYSTEM_SENDERS.has(sender.toLowerCase()) || isSystemNotice(body)) return "SYSTEM";
  return sender === "You" ? "OUTBOUND" : "INBOUND";
}

export function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * SYNTHETIC message identity — NOT Facebook's message id. Facebook's
 * rendered conversation exposes no message ids, so a message is identified
 * by what is rendered: thread + minute + direction + body hash.
 *
 * Deterministic across runs (no random ids): the same rendered message
 * always yields the same fingerprint. `occurrence` (#2, #3…) separates
 * messages identical in all of those (e.g. two "?" in the same minute);
 * since such messages are interchangeable, numbering them by count is
 * order-independent — rendering order can't swap their identities.
 */
export function messageFingerprint(
  threadId: string,
  sentAt: Date,
  direction: string,
  body: string,
  occurrence: number,
): string {
  const bodyHash = createHash("sha1").update(normalizeBody(body)).digest("hex").slice(0, 16);
  return `facebook:${threadId}:${sentAt.toISOString()}:${direction}:${bodyHash}${occurrence > 1 ? `#${occurrence}` : ""}`;
}

/** Labels in chronological order → normalized messages.
 *
 * Facebook's labels only go to the minute, so messages within one minute
 * are stored a few milliseconds apart in on-screen order — that keeps
 * "sort by time" equal to the real order. The fingerprint uses the minute
 * itself, so it stays the same however many messages share that minute. */
export function labelsToMessages(threadId: string, labels: string[]): ConnectorMessage[] {
  const counts = new Map<string, number>();
  const perMinute = new Map<number, number>();
  const out: ConnectorMessage[] = [];
  for (const label of labels) {
    const p = parseMessageLabel(label);
    if (!p) continue;
    const direction = directionFor(p.sender, p.body);
    const base = `${p.sentAt.toISOString()}|${direction}|${normalizeBody(p.body)}`;
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    const minute = p.sentAt.getTime();
    const position = perMinute.get(minute) ?? 0;
    perMinute.set(minute, position + 1);
    out.push({
      externalMessageId: messageFingerprint(threadId, p.sentAt, direction, p.body, occurrence),
      senderName: direction === "SYSTEM" ? "Facebook" : p.sender,
      body: normalizeBody(p.body),
      sentAt: new Date(minute + Math.min(position, 59_999)).toISOString(),
      direction,
    });
  }
  return out;
}
