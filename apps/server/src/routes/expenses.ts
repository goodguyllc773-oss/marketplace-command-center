import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const CATEGORIES = [
  "Inventory",
  "Shipping",
  "Packaging",
  "Platform Fees",
  "Equipment",
  "Gas",
  "Advertising",
  "Supplies",
  "Other",
] as const;

const CreateSchema = z.object({
  amount: z.number().positive(),
  date: z.string().datetime(),
  category: z.enum(CATEGORIES),
  description: z.string().optional(),
  platformId: z.string().optional(),
  platformAccountId: z.string().optional(),
  inventoryItemId: z.string().optional(),
});

const UpdateSchema = CreateSchema.partial();

const ListQuerySchema = z.object({
  category: z.string().optional(),
  platformId: z.string().optional(),
  accountId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function registerExpenseRoutes(app: FastifyInstance): void {
  app.get("/api/expenses", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { category, platformId, accountId, inventoryItemId, from, to } = parsed.data;

    const expenses = await prisma.expense.findMany({
      where: {
        category: category || undefined,
        platformId: platformId || undefined,
        platformAccountId: accountId || undefined,
        inventoryItemId: inventoryItemId || undefined,
        date: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
      },
      include: {
        platform: true,
        platformAccount: { include: { platform: true } },
        inventoryItem: { select: { id: true, title: true } },
      },
      orderBy: { date: "desc" },
    });
    return expenses;
  });

  app.post("/api/expenses", async (request, reply) => {
    const body = CreateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const expense = await prisma.expense.create({
      data: { ...body.data, date: new Date(body.data.date) },
    });
    return reply.code(201).send(expense);
  });

  app.patch("/api/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (Object.keys(body.data).length === 0) return reply.code(400).send({ error: "Nothing to update" });

    const expense = await prisma.expense
      .update({ where: { id }, data: { ...body.data, date: body.data.date ? new Date(body.data.date) : undefined } })
      .catch(() => null);
    if (!expense) return reply.code(404).send({ error: "Expense not found" });
    return expense;
  });

  app.delete("/api/expenses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.expense.delete({ where: { id } }).catch(() => undefined);
    return reply.code(204).send();
  });
}
