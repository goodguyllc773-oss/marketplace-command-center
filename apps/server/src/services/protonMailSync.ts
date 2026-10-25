import { randomUUID } from "node:crypto";
import { parseDepopEmails, parseProtonRows, protonRowToEmail } from "@mcc/connectors";
import type { StandardEvent } from "@mcc/shared";
import { recordEvents } from "./eventEngine.js";
import { dispatchNotifications } from "./notificationService.js";

const PLATFORM_ID = "depop-live";

/**
 * Depop emails from a free Proton Mail inbox, read off the list the user
 * keeps open (see packages/connectors/src/extension/protonInbox.ts). Each
 * row runs through the same rules as Depop emails read over IMAP
 * (parseDepopEmails) — subjects only, since emails are never opened.
 *
 * Rows dated before `connectedAt` (the first time this inbox was seen) are
 * history: never alerted. A thread getting a new email changes its id
 * (count/time), so each new email alerts once. Only notices are used —
 * Depop messages themselves come from the Depop Reader's messages tab.
 */
export async function ingestProtonInbox(accountId: string, snapshot: unknown, connectedAt: string) {
  const rows = parseProtonRows(snapshot);
  if (rows.length === 0) return { rows: 0, alerts: 0 };
  const data = parseDepopEmails(rows.map(protonRowToEmail), connectedAt);

  const events: StandardEvent[] = data.notices
    .filter((n) => !n.historical)
    .map((n) => ({
      id: randomUUID(),
      type: n.type,
      platformId: PLATFORM_ID,
      accountId,
      timestamp: n.date,
      entityId: n.messageId,
      dedupeKey: `${PLATFORM_ID}:${accountId}:proton:${n.messageId}`,
      payload: { ...n.payload, source: "PROTON_INBOX" },
    }));
  if (events.length > 0) await dispatchNotifications(await recordEvents(accountId, events));
  return { rows: rows.length, alerts: events.length };
}
