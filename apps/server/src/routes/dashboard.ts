import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

function rangeStart(range: string): Date | undefined {
  const now = new Date();
  switch (range) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "week": {
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "month": {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    case "allTime":
    default:
      return undefined;
  }
}

async function summarizeRange(start: Date | undefined) {
  const sales = await prisma.sale.findMany({
    where: start ? { soldAt: { gte: start } } : undefined,
  });
  const revenue = sales.reduce((sum, s) => sum + s.salePrice, 0);
  const profit = sales.reduce((sum, s) => sum + s.netProfit, 0);
  return { revenue, profit, itemsSold: sales.length };
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/api/dashboard/summary", async () => {
    const [today, week, month, allTime] = await Promise.all([
      summarizeRange(rangeStart("today")),
      summarizeRange(rangeStart("week")),
      summarizeRange(rangeStart("month")),
      summarizeRange(rangeStart("allTime")),
    ]);

    const [unreadMessages, pendingOffers, activeListings, watchdogs] = await Promise.all([
      prisma.conversation.count({ where: { unread: true, archived: false } }),
      prisma.offer.count({ where: { status: "PENDING" } }),
      prisma.listing.count({ where: { status: "ACTIVE" } }),
      prisma.watchdog.findMany(),
    ]);

    const inventoryValueAgg = await prisma.inventoryItem.aggregate({
      _sum: { purchaseCost: true },
      where: { status: { notIn: ["SOLD", "REFUNDED"] } },
    });

    return {
      today,
      week,
      month,
      allTime,
      unreadMessages,
      pendingOffers,
      activeListings,
      inventoryValue: inventoryValueAgg._sum.purchaseCost ?? 0,
      watchdogHealth: {
        running: watchdogs.filter((w) => w.state === "RUNNING").length,
        stopped: watchdogs.filter((w) => w.state === "STOPPED").length,
        error: watchdogs.filter((w) => w.state === "ERROR").length,
        authRequired: watchdogs.filter((w) => w.state === "AUTH_REQUIRED").length,
        stale: watchdogs.filter((w) => w.state === "STALE").length,
      },
    };
  });

  app.get("/api/dashboard/by-platform", async () => {
    const accounts = await prisma.platformAccount.findMany({
      include: { platform: true },
    });
    const results = [];
    for (const account of accounts) {
      const sales = await prisma.sale.findMany({
        where: { order: { platformAccountId: account.id } },
      });
      results.push({
        platformAccountId: account.id,
        platform: account.platform.name,
        account: account.label,
        revenue: sales.reduce((sum, s) => sum + s.salePrice, 0),
        profit: sales.reduce((sum, s) => sum + s.netProfit, 0),
        itemsSold: sales.length,
      });
    }
    return results;
  });
}
