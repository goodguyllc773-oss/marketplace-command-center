import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const ListQuerySchema = z.object({
  platformId: z.string().optional(),
  accountId: z.string().optional(),
  status: z.string().optional(),
  needsDelisting: z.enum(["true", "false"]).optional(),
  unlinkedOnly: z.enum(["true", "false"]).optional(),
  q: z.string().optional(),
});

const LinkSchema = z.object({ inventoryItemId: z.string().nullable() });
const UpdateSchema = z.object({ status: z.string().optional(), needsDelisting: z.boolean().optional() });

export function registerListingRoutes(app: FastifyInstance): void {
  app.get("/api/listings", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { platformId, accountId, status, needsDelisting, unlinkedOnly, q } = parsed.data;

    const listings = await prisma.listing.findMany({
      where: {
        status: status || undefined,
        needsDelisting: needsDelisting ? needsDelisting === "true" : undefined,
        inventoryItemId: unlinkedOnly === "true" ? null : undefined,
        platformAccountId: accountId,
        platformAccount: platformId ? { platformId } : undefined,
        title: q ? { contains: q } : undefined,
      },
      include: {
        platformAccount: { include: { platform: true } },
        inventoryItem: { select: { id: true, title: true, sku: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return listings;
  });

  app.get("/api/listings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        platformAccount: { include: { platform: true } },
        inventoryItem: { include: { listings: { include: { platformAccount: { include: { platform: true } } } } } },
      },
    });
    if (!listing) return reply.code(404).send({ error: "Listing not found" });
    return listing;
  });

  /** Cross-listing: attach/detach this listing from a local InventoryItem
   * (`inventoryItemId: null` unlinks). This is the only way multiple
   * platform listings become known as "the same physical item". */
  app.patch("/api/listings/:id/link", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = LinkSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    if (body.data.inventoryItemId) {
      const exists = await prisma.inventoryItem.findUnique({ where: { id: body.data.inventoryItemId } });
      if (!exists) return reply.code(404).send({ error: "Inventory item not found" });
    }

    const listing = await prisma.listing
      .update({ where: { id }, data: { inventoryItemId: body.data.inventoryItemId } })
      .catch(() => null);
    if (!listing) return reply.code(404).send({ error: "Listing not found" });
    return listing;
  });

  /** Manual overrides — e.g. dismissing a "needs delisting" warning once
   * you've handled it by hand (spec section 10: this stays a manual
   * workflow until a connector can actually delist automatically). */
  app.patch("/api/listings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });

    const listing = await prisma.listing.update({ where: { id }, data: body.data }).catch(() => null);
    if (!listing) return reply.code(404).send({ error: "Listing not found" });
    return listing;
  });
}
