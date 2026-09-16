import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const CreateSchema = z.object({
  sku: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  purchaseCost: z.number().nonnegative().optional(),
  purchaseDate: z.string().datetime().optional(),
  condition: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
});

const UpdateSchema = CreateSchema.partial();

export function registerInventoryRoutes(app: FastifyInstance): void {
  app.get("/api/inventory", async (request) => {
    const { status, q } = request.query as { status?: string; q?: string };
    const items = await prisma.inventoryItem.findMany({
      where: {
        status: status || undefined,
        OR: q
          ? [
              { title: { contains: q } },
              { sku: { contains: q } },
              { brand: { contains: q } },
              { category: { contains: q } },
            ]
          : undefined,
      },
      include: {
        listings: {
          select: { id: true, title: true, status: true, price: true, needsDelisting: true, platformAccount: { include: { platform: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return items;
  });

  app.get("/api/inventory/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        listings: { include: { platformAccount: { include: { platform: true } } } },
        expenses: true,
      },
    });
    if (!item) return reply.code(404).send({ error: "Inventory item not found" });
    return item;
  });

  app.post("/api/inventory", async (request, reply) => {
    const body = CreateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      const item = await prisma.inventoryItem.create({
        data: { ...body.data, purchaseDate: body.data.purchaseDate ? new Date(body.data.purchaseDate) : undefined },
      });
      return reply.code(201).send(item);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        return reply.code(409).send({ error: "SKU already in use" });
      }
      throw err;
    }
  });

  app.patch("/api/inventory/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });

    const item = await prisma.inventoryItem
      .update({
        where: { id },
        data: { ...body.data, purchaseDate: body.data.purchaseDate ? new Date(body.data.purchaseDate) : undefined },
      })
      .catch(() => null);
    if (!item) return reply.code(404).send({ error: "Inventory item not found" });
    return item;
  });

  app.delete("/api/inventory/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // Unlink rather than cascade-delete listings — the listings themselves
    // are platform truth, synced independently; only the local grouping
    // goes away.
    await prisma.listing.updateMany({ where: { inventoryItemId: id }, data: { inventoryItemId: null } });
    await prisma.inventoryItem.delete({ where: { id } }).catch(() => undefined);
    return reply.code(204).send();
  });
}
