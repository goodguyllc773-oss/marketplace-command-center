import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export function registerEventRoutes(app: FastifyInstance): void {
  app.get("/api/events", async (request) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.min(Number(limit) || 50, 200);
    const events = await prisma.event.findMany({
      take,
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
