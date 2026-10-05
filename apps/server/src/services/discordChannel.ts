import type { Event as EventRow } from "@prisma/client";
import { NOTIFICATION_CATEGORIES, categoryForEvent, type NotificationCategoryId } from "@mcc/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { parseEventPayload } from "./eventEngine.js";

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp: string;
}

const COLOR = {
  purple: 0x9b59b6,
  green: 0x2ecc71,
  gold: 0xf1c40f,
  red: 0xe74c3c,
  gray: 0x95a5a6,
};

/**
 * Builds the Discord embed for one standardized event. Returns null for
 * event types with nothing meaningful to show (kept deliberately narrow —
 * we don't fabricate content for a payload shape we don't recognize).
 */
async function buildEmbed(row: EventRow, platformName: string, accountLabel: string): Promise<DiscordEmbed | null> {
  const payload = parseEventPayload<Record<string, unknown>>(row);

  // Events built from platform emails carry a ready-made one-line summary.
  if (typeof payload.summary === "string") {
    return {
      title: `${SUMMARY_TITLES[row.type] ?? "📬 Notification"} — ${platformName}`,
      description: payload.summary,
      color: row.type === "PLATFORM_NOTIFICATION" ? COLOR.gray : COLOR.gold,
      fields: [{ name: "Account", value: accountLabel, inline: true }],
      timestamp: row.timestamp.toISOString(),
    };
  }

  switch (row.type) {
    case "MESSAGE_RECEIVED":
      return {
        title: `🟣 New ${platformName} Message`,
        description: typeof payload.body === "string" ? `"${payload.body}"` : undefined,
        color: COLOR.purple,
        fields: [
          { name: "Account", value: accountLabel, inline: true },
          { name: "Buyer", value: String(payload.senderName ?? "unknown"), inline: true },
          ...(payload.listingTitle ? [{ name: "Listing", value: String(payload.listingTitle), inline: true }] : []),
        ],
        timestamp: row.timestamp.toISOString(),
      };

    case "OFFER_RECEIVED":
      return {
        title: `🟡 New Offer — ${platformName}`,
        color: COLOR.gold,
        fields: [
          { name: "Account", value: accountLabel, inline: true },
          { name: "Buyer", value: String(payload.buyerName ?? "unknown"), inline: true },
          { name: "Listing", value: String(payload.listingTitle ?? "—"), inline: true },
          { name: "Offer", value: `${payload.amount ?? "?"} ${payload.currency ?? ""}`.trim(), inline: true },
        ],
        timestamp: row.timestamp.toISOString(),
      };

    case "LISTING_SOLD": {
      const listingId = row.entityId;
      const sale = await prisma.sale.findFirst({
        where: { order: { listingId } },
        orderBy: { soldAt: "desc" },
      });
      const fields = [
        { name: "Platform", value: platformName, inline: true },
        { name: "Account", value: accountLabel, inline: true },
        { name: "Item", value: String(payload.listingTitle ?? "—"), inline: false },
        { name: "Sale", value: money(Number(payload.salePrice ?? 0)), inline: true },
        ...(payload.buyerName ? [{ name: "Buyer", value: String(payload.buyerName), inline: true }] : []),
      ];
      if (sale) {
        fields.push(
          { name: "Cost", value: money(sale.purchaseCost), inline: true },
          { name: "Fees", value: money(sale.platformFees + sale.paymentFees), inline: true },
          { name: "Net Profit", value: money(sale.netProfit), inline: true },
          { name: "Margin", value: `${(sale.profitMargin * 100).toFixed(1)}%`, inline: true },
        );
      }
      return { title: "🟢 Item Sold", color: COLOR.green, fields, timestamp: row.timestamp.toISOString() };
    }

    case "LISTING_REMOVED":
      return {
        title: `⚠️ ${platformName} Listing Taken Down`,
        description: typeof payload.reason === "string" ? payload.reason : undefined,
        color: COLOR.red,
        fields: listingFields(payload, accountLabel),
        timestamp: row.timestamp.toISOString(),
      };

    case "LISTING_CREATED":
      return {
        title: `🆕 New ${platformName} Listing`,
        color: COLOR.green,
        fields: listingFields(payload, accountLabel),
        timestamp: row.timestamp.toISOString(),
      };

    case "LISTING_UPDATED":
      return {
        title: `✏️ ${platformName} Listing Updated`,
        description: typeof payload.change === "string" ? payload.change : undefined,
        color: COLOR.gray,
        fields: listingFields(payload, accountLabel),
        timestamp: row.timestamp.toISOString(),
      };

    case "ACCOUNT_DISCONNECTED":
      return {
        title: `🔴 ${platformName} Account Disconnected`,
        description: typeof payload.reason === "string" ? payload.reason : undefined,
        color: COLOR.red,
        fields: [{ name: "Account", value: accountLabel, inline: true }],
        timestamp: row.timestamp.toISOString(),
      };

    case "AUTHENTICATION_REQUIRED":
      return {
        title: `🔴 ${platformName} Needs Re-authentication`,
        color: COLOR.red,
        fields: [{ name: "Account", value: accountLabel, inline: true }],
        timestamp: row.timestamp.toISOString(),
      };

    case "WATCHDOG_ERROR":
      return {
        title: `🚨 Watchdog Error — ${platformName}`,
        description: typeof payload.message === "string" ? payload.message : undefined,
        color: COLOR.red,
        fields: [{ name: "Account", value: accountLabel, inline: true }],
        timestamp: row.timestamp.toISOString(),
      };

    default:
      return {
        title: `${platformName} — ${row.type.replaceAll("_", " ")}`,
        color: COLOR.gray,
        fields: [{ name: "Account", value: accountLabel, inline: true }],
        timestamp: row.timestamp.toISOString(),
      };
  }
}

const SUMMARY_TITLES: Record<string, string> = {
  OFFER_RECEIVED: "🟡 Offer",
  OFFER_ACCEPTED: "🟢 Offer Accepted",
  ORDER_CREATED: "📦 Purchase Confirmed",
  SHIPMENT_UPDATED: "📦 Order Shipped",
  PLATFORM_NOTIFICATION: "📬 Notification",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function listingFields(payload: Record<string, unknown>, accountLabel: string) {
  const fields = [
    { name: "Account", value: accountLabel, inline: true },
    { name: "Item", value: String(payload.listingTitle ?? "—"), inline: true },
  ];
  if (typeof payload.price === "number") fields.push({ name: "Price", value: money(payload.price), inline: true });
  if (typeof payload.url === "string") fields.push({ name: "Link", value: payload.url, inline: false });
  return fields;
}

export interface DiscordSendResult {
  ok: boolean;
  error?: string;
}

export const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const NO_WEBHOOK = "No Discord webhook set — add one on the Settings page";

export type WebhookSource = "category" | "app" | "env";

/** `category` undefined = the default webhook. Stored as
 * `discordWebhookUrl` / `discordWebhookUrl:<category>` in AppSetting. */
function webhookKey(category?: NotificationCategoryId): string {
  return category ? `discordWebhookUrl:${category}` : "discordWebhookUrl";
}

/** Resolution order: the category's own webhook → the default webhook
 * saved on the Settings page → DISCORD_WEBHOOK_URL in .env. */
export async function getWebhook(category?: NotificationCategoryId): Promise<{ url: string; source: WebhookSource } | null> {
  if (category) {
    const own = await prisma.appSetting.findUnique({ where: { key: webhookKey(category) } });
    if (own?.value) return { url: own.value, source: "category" };
  }
  const saved = await prisma.appSetting.findUnique({ where: { key: webhookKey() } });
  if (saved?.value) return { url: saved.value, source: "app" };
  if (env.DISCORD_WEBHOOK_URL) return { url: env.DISCORD_WEBHOOK_URL, source: "env" };
  return null;
}

export async function saveWebhook(url: string | null, category?: NotificationCategoryId): Promise<void> {
  const key = webhookKey(category);
  if (url) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: url }, update: { value: url } });
  } else {
    await prisma.appSetting.deleteMany({ where: { key } });
  }
}

/** Anyone holding the full URL can post to the channel, so the UI only
 * ever gets the webhook id and the token's last 4 characters. */
export function maskWebhook(url: string): string {
  const m = url.match(/\/webhooks\/(\d+)\/([\w-]+)$/);
  return m ? `…/webhooks/${m[1]}/••••${m[2].slice(-4)}` : "••••";
}

export async function sendEventToDiscord(
  row: EventRow,
  platformName: string,
  accountLabel: string,
): Promise<DiscordSendResult> {
  const webhook = await getWebhook(categoryForEvent(row.type));
  if (!webhook) return { ok: false, error: NO_WEBHOOK };

  const embed = await buildEmbed(row, platformName, accountLabel);
  if (!embed) return { ok: false, error: "No embed for this event type" };

  return postEmbed(webhook.url, embed);
}

export async function sendTestEmbed(category?: NotificationCategoryId): Promise<DiscordSendResult> {
  const webhook = await getWebhook(category);
  if (!webhook) return { ok: false, error: NO_WEBHOOK };
  const label = NOTIFICATION_CATEGORIES.find((c) => c.id === category)?.label;
  return postEmbed(webhook.url, {
    title: "✅ Marketplace Command Center",
    description: label
      ? `Test notification — **${label}** alerts will arrive in this channel.`
      : "Test notification — Discord delivery is working.",
    color: COLOR.green,
    timestamp: new Date().toISOString(),
  });
}

async function postEmbed(url: string, embed: DiscordEmbed): Promise<DiscordSendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Discord returned ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
