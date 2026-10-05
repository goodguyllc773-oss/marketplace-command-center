import type { Event as EventRow } from "@prisma/client";
import type { EventType } from "@mcc/shared";
import { prisma } from "../db.js";
import { sendEventToDiscord } from "./discordChannel.js";

/** Spec section 16's example rule set — everything else defaults off so a
 * first run doesn't spam Discord with every routine listing update, but
 * stays one click away to enable per event type. */
const DEFAULT_DISCORD_ENABLED: ReadonlySet<EventType> = new Set([
  "MESSAGE_RECEIVED",
  "OFFER_RECEIVED",
  "LISTING_SOLD",
  "WATCHDOG_ERROR",
  "ACCOUNT_DISCONNECTED",
  "AUTHENTICATION_REQUIRED",
  "PLATFORM_NOTIFICATION",
]);

export async function isDiscordEnabledFor(eventType: string): Promise<boolean> {
  const existing = await prisma.notificationSetting.findUnique({ where: { eventType } });
  if (existing) return existing.discordEnabled;
  const discordEnabled = DEFAULT_DISCORD_ENABLED.has(eventType as EventType);
  await prisma.notificationSetting
    .create({ data: { eventType, discordEnabled } })
    .catch(() => undefined); // benign race if two events of the same type dispatch concurrently
  return discordEnabled;
}

/** Fires after the event engine records new (deduped) events — one Discord
 * message per event, each routing decision logged to `Notification` for
 * the diagnostics view regardless of outcome. */
export async function dispatchNotifications(events: EventRow[]): Promise<void> {
  for (const event of events) {
    if (!(await isDiscordEnabledFor(event.type))) continue;

    const account = await prisma.platformAccount.findUnique({
      where: { id: event.platformAccountId },
      include: { platform: true },
    });
    if (!account) continue;

    const result = await sendEventToDiscord(event, account.platform.name, account.label);
    // "No embed for this event type" / "no webhook configured" aren't
    // failures worth logging — they're just not applicable.
    if (!result.ok && result.error?.startsWith("No ")) continue;

    await prisma.notification.create({
      data: {
        eventId: event.id,
        channel: "discord",
        status: result.ok ? "SENT" : "FAILED",
        error: result.ok ? null : (result.error ?? "Unknown error"),
        sentAt: result.ok ? new Date() : null,
      },
    });
  }
}
