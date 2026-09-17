import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { computeSaleFinancials } from "../services/financials.js";

const ListQuerySchema = z.object({
  platformId: z.string().optional(),
  accountId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().optional(),
});

const UpdateSchema = z.object({
  purchaseCost: z.number().nonnegative().optional(),
  shippingCost: z.number().nonnegative().optional(),
  shippingRevenue: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  refundAmount: z.number().nonnegative().optional(),
  otherCosts: z.number().nonnegative().optional(),
});

const saleInclude = {
  order: {
    include: {
      listing: { select: { id: true, title: true, inventoryItemId: true } },
      platformAccount: { include: { platform: true } },
    },
  },
} as const;

export function registerSalesRoutes(app: FastifyInstance): void {
  app.get("/api/sales", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { platformId, accountId, from, to, q } = parsed.data;

    const sales = await prisma.sale.findMany({
      where: {
        soldAt: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
        order: {
          platformAccountId: accountId,
          platformAccount: platformId ? { platformId } : undefined,
          listing: q ? { title: { contains: q } } : undefined,
        },
      },
      include: saleInclude,
      orderBy: { soldAt: "desc" },
    });
    return sales;
  });

  app.patch("/api/sales/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });

    const existing = await prisma.sale.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "Sale not found" });

    const merged = {
      purchaseCost: body.data.purchaseCost ?? existing.purchaseCost,
      shippingCost: body.data.shippingCost ?? existing.shippingCost,
      shippingRevenue: body.data.shippingRevenue ?? existing.shippingRevenue,
      discount: body.data.discount ?? existing.discount,
      refundAmount: body.data.refundAmount ?? existing.refundAmount,
      otherCosts: body.data.otherCosts ?? existing.otherCosts,
    };
    const { netProfit, profitMargin } = computeSaleFinancials({
      salePrice: existing.salePrice,
      platformFees: existing.platformFees,
      paymentFees: existing.paymentFees,
      ...merged,
    });

    const sale = await prisma.sale.update({
      where: { id },
      data: { ...merged, netProfit, profitMargin },
      include: saleInclude,
    });
    return sale;
  });
}
