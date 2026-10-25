import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export function registerEventRoutes(app: FastifyInstance): void {
  app.get("/api/events", async (request) => {
    const { limit, accountId } = request.query as { limit?: string; accountId?: string };
    const take = Math.min(Number(limit) || 50, 200);
    const events = await prisma.event.findMany({
      take,
      where: accountId ? { platformAccountId: accountId } : undefined,
      orderBy: { timestamp: "desc" },
      include: { platformAccount: { include: { platform: true } } },
    });
    return events.map((e) => ({
      ...e,
      payload: JSON.parse(e.payloadJson),
      payloadJson: undefined,
    }));
  });
}
