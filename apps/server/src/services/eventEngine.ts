import type { StandardEvent } from "@mcc/shared";
import { prisma } from "../db.js";
import type { Event as EventRow } from "@prisma/client";

/**
 * Records standardized events, deduplicating on `dedupeKey`. A watchdog
 * that re-polls and sees the same underlying platform event again must not
 * produce a second stored Event (and therefore not a second Discord/desktop
 * notification) — see spec section 6.
 */
export async function recordEvents(
  platformAccountId: string,
  events: StandardEvent[],
): Promise<EventRow[]> {
  const created: EventRow[] = [];

  for (const evt of events) {
    const existing = await prisma.event.findUnique({ where: { dedupeKey: evt.dedupeKey } });
    if (existing) continue;

    const row = await prisma.event.create({
      data: {
        type: evt.type,
        platformAccountId,
        entityId: evt.entityId,
        dedupeKey: evt.dedupeKey,
        timestamp: new Date(evt.timestamp),
        payloadJson: JSON.stringify(evt.payload),
      },
    });
    created.push(row);
  }

  if (created.length > 0) {
    await prisma.watchdog
      .update({ where: { platformAccountId }, data: { lastEventAt: new Date() } })
      .catch(() => undefined);
  }

  return created;
}

export function parseEventPayload<T = unknown>(row: EventRow): T {
  return JSON.parse(row.payloadJson) as T;
}
