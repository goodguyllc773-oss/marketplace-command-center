import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { registerAuth } from "./plugins/auth.js";
import { registerPlatformRoutes } from "./routes/platforms.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerWatchdogRoutes } from "./routes/watchdogs.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerListingRoutes } from "./routes/listings.js";
import { registerDevRoutes } from "./routes/dev.js";
import { prisma } from "./db.js";
import { startWatchdog, stopAllWatchdogs } from "./services/watchdogManager.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [/^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/],
});

registerAuth(app);

app.get("/api/health", async () => ({ ok: true, service: "mcc-server" }));

registerPlatformRoutes(app);
registerAccountRoutes(app);
registerWatchdogRoutes(app);
registerDashboardRoutes(app);
registerEventRoutes(app);
registerConversationRoutes(app);
registerInventoryRoutes(app);
registerListingRoutes(app);
registerDevRoutes(app);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAllWatchdogs();
    void app.close().then(() => process.exit(0));
  });
}

app
  .listen({ port: env.PORT, host: env.HOST })
  .then(async () => {
    app.log.info(`Marketplace Command Center API listening on http://${env.HOST}:${env.PORT}`);
    // In-memory watchdog timers don't survive a restart — resume any that
    // the DB still marks RUNNING/STALE so monitoring doesn't silently stop.
    const toResume = await prisma.watchdog.findMany({
      where: { state: { in: ["RUNNING", "STALE"] } },
    });
    for (const w of toResume) {
      await startWatchdog(w.platformAccountId, w.intervalMs).catch((err) =>
        app.log.error({ err, accountId: w.platformAccountId }, "failed to resume watchdog"),
      );
    }
    if (toResume.length > 0) app.log.info(`Resumed ${toResume.length} watchdog(s) from previous run`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
