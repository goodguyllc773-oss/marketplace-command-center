import type { FetchedEmail } from "../email/emailSource.js";

/**
 * Proton Mail inbox rows, as read by the MCC Depop Reader extension from
 * the mail.proton.me tab the user keeps open (free Proton plans have no
 * IMAP Bridge). Layout VERIFIED on the user's real inbox (2026-10-24):
 *
 *   row      [data-shortcut-target="item-container"], data-element-id = id
 *   sender   [data-testid="message-column:sender-address"] title = address
 *   subject  [data-testid="message-row:subject"] title = subject
 *   unread   .item-unread-dot / "Unread email"
 *   thread   "37 messages in conversation" (Proton groups by conversation)
 *   time     "Saturday, October 24th, 2026 at 10:03 AM"
 *
 * Only the list is read — emails are never opened — so there are no bodies:
 * subjects carry the information (amounts live in bodies and are absent).
 */

export interface ProtonRow {
  id: string;
  senderAddress: string;
  subject: string;
  unread: boolean;
  /** Messages in the Proton conversation (thread); 1 when not shown. */
  count: number;
  /** When the thread's latest message arrived (local time). */
  receivedAt: Date | null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Saturday, October 24th, 2026 at 10:03 AM" → local Date. */
export function parseProtonDate(label: string): Date | null {
  const m = label.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const [day, year, hour, minute] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (month < 0 || hour < 1 || hour > 12 || minute > 59) return null;
  const d = new Date(year, month, day, (hour % 12) + (/pm/i.test(m[6]) ? 12 : 0), minute);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

/** Depop senders only — and never Depop's sign-in ("magic link") emails. */
export function isDepopSender(address: string): boolean {
  return /@([\w-]+\.)*depop\.com$/i.test(address) && !/@auth\.depop\.com$/i.test(address);
}

export function parseProtonRows(snapshot: unknown): ProtonRow[] {
  const rows = (snapshot as { rows?: unknown })?.rows;
  const out: ProtonRow[] = [];
  for (const r of Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []) {
    if (!r || typeof r !== "object") continue;
    const id = typeof r.id === "string" ? r.id : "";
    const senderAddress = typeof r.sender === "string" ? r.sender.trim().toLowerCase() : "";
    const subject = typeof r.subject === "string" ? r.subject.replace(/\s+/g, " ").trim() : "";
    if (!id || !subject || !isDepopSender(senderAddress)) continue;
    out.push({
      id,
      senderAddress,
      subject,
      unread: r.unread === true,
      count: typeof r.count === "number" && r.count > 0 ? r.count : 1,
      receivedAt: typeof r.when === "string" ? parseProtonDate(r.when) : null,
    });
  }
  return out;
}

/**
 * A row as the email parser's input. The id changes whenever the thread
 * gets a new message (count / time), so each new email is seen once.
 */
export function protonRowToEmail(row: ProtonRow): FetchedEmail {
  return {
    messageId: `proton:${row.id}:${row.count}:${row.receivedAt?.toISOString() ?? "undated"}`,
    from: row.senderAddress,
    to: [],
    subject: row.subject,
    date: (row.receivedAt ?? new Date()).toISOString(),
    html: "",
    text: "",
  };
}
