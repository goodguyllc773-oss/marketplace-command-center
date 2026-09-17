import type { Event as EventRow } from "@prisma/client";
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

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export interface DiscordSendResult {
  ok: boolean;
  error?: string;
}

export async function sendEventToDiscord(
  row: EventRow,
  platformName: string,
  accountLabel: string,
): Promise<DiscordSendResult> {
  if (!env.DISCORD_WEBHOOK_URL) return { ok: false, error: "No DISCORD_WEBHOOK_URL configured" };

  const embed = await buildEmbed(row, platformName, accountLabel);
  if (!embed) return { ok: false, error: "No embed for this event type" };

  return postEmbed(embed);
}

export async function sendTestEmbed(): Promise<DiscordSendResult> {
  if (!env.DISCORD_WEBHOOK_URL) return { ok: false, error: "No DISCORD_WEBHOOK_URL configured" };
  return postEmbed({
    title: "✅ Marketplace Command Center",
    description: "Test notification — Discord delivery is working.",
    color: COLOR.green,
    timestamp: new Date().toISOString(),
  });
}

async function postEmbed(embed: DiscordEmbed): Promise<DiscordSendResult> {
  try {
    const res = await fetch(env.DISCORD_WEBHOOK_URL!, {
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
