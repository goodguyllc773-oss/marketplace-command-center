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

/**
 * Full financial summary for a date range (spec sections 13/14): revenue,
 * profit, cost of goods, platform/payment fees, net shipping,
 * discounts/refunds, manual expenses (subtracted from profit — they're
 * real money out that isn't tied to any one sale), and per-item averages.
 */
async function summarizeRange(start: Date | undefined, end: Date | undefined) {
  const dateFilter = start || end ? { gte: start, lte: end } : undefined;
  const [sales, expenseAgg] = await Promise.all([
    prisma.sale.findMany({ where: dateFilter ? { soldAt: dateFilter } : undefined }),
    prisma.expense.aggregate({ _sum: { amount: true }, where: dateFilter ? { date: dateFilter } : undefined }),
  ]);

  const itemsSold = sales.length;
  const revenue = sales.reduce((sum, s) => sum + s.salePrice + s.shippingRevenue, 0);
  const costOfGoods = sales.reduce((sum, s) => sum + s.purchaseCost, 0);
  const platformFees = sales.reduce((sum, s) => sum + s.platformFees, 0);
  const paymentFees = sales.reduce((sum, s) => sum + s.paymentFees, 0);
  const shippingNet = sales.reduce((sum, s) => sum + (s.shippingCost - s.shippingRevenue), 0);
  const discounts = sales.reduce((sum, s) => sum + s.discount, 0);
  const refunds = sales.reduce((sum, s) => sum + s.refundAmount, 0);
  const expenses = expenseAgg._sum.amount ?? 0;
  const profit = sales.reduce((sum, s) => sum + s.netProfit, 0) - expenses;

  return {
    revenue,
    profit,
    itemsSold,
    profitMargin: revenue > 0 ? profit / revenue : 0,
    avgSalePrice: itemsSold > 0 ? sales.reduce((sum, s) => sum + s.salePrice, 0) / itemsSold : 0,
    avgProfitPerItem: itemsSold > 0 ? profit / itemsSold : 0,
    costOfGoods,
    platformFees,
    paymentFees,
    shippingNet,
    discounts,
    refunds,
    expenses,
  };
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/api/dashboard/summary", async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };

    const [today, week, month, allTime, custom] = await Promise.all([
      summarizeRange(rangeStart("today"), undefined),
      summarizeRange(rangeStart("week"), undefined),
      summarizeRange(rangeStart("month"), undefined),
      summarizeRange(rangeStart("allTime"), undefined),
      from || to ? summarizeRange(from ? new Date(from) : undefined, to ? new Date(to) : undefined) : Promise.resolve(null),
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
      custom,
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
