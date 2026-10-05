import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const ListQuerySchema = z.object({
  accountId: z.string().optional(),
  role: z.enum(["SELLING", "BUYING"]).optional(),
});

export function registerOfferRoutes(app: FastifyInstance): void {
  /** Every offer MCC knows — on your listings (selling) and, from the
   * Depop Reader extension's Offers tab, ones where you're the buyer. */
  app.get("/api/offers", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { accountId, role } = parsed.data;
    return prisma.offer.findMany({
      where: { platformAccountId: accountId, role },
      include: {
        listing: { select: { id: true, title: true, url: true } },
        platformAccount: { include: { platform: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  });
}
