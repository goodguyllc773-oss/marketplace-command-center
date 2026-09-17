import type { FastifyInstance } from "fastify";
import { MOCK_PLATFORM_IDS, REAL_PLATFORM_IDS } from "@mcc/connectors";
import { prisma } from "../db.js";

const PLATFORM_NAMES: Record<string, string> = {
  depop: "Depop",
  facebook: "Facebook",
  ebay: "eBay",
  "depop-live": "Depop (Live)",
  "facebook-live": "Facebook (Live)",
};

export function registerPlatformRoutes(app: FastifyInstance): void {
  app.get("/api/platforms", async () => {
    return prisma.platform.findMany({
      include: { _count: { select: { accounts: true } } },
      orderBy: { name: "asc" },
    });
  });

  /** Idempotently ensures the built-in mock platforms and real (non-mock)
   * connector platforms exist. Real platforms get added here as they're
   * implemented (Phase 12+) — kept distinctly named/keyed from their mock
   * counterparts so demo data and live data never mix. */
  app.post("/api/platforms/seed", async () => {
    const results = [];
    for (const key of MOCK_PLATFORM_IDS) {
      const platform = await prisma.platform.upsert({
        where: { key },
        create: { key, name: PLATFORM_NAMES[key] ?? key, kind: "mock" },
        update: {},
      });
      results.push(platform);
    }
    for (const key of REAL_PLATFORM_IDS) {
      const platform = await prisma.platform.upsert({
        where: { key },
        create: { key, name: PLATFORM_NAMES[key] ?? key, kind: "browser" },
        update: {},
      });
      results.push(platform);
    }
    return results;
  });
}
