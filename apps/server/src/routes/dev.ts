import type { FastifyInstance } from "fastify";
import { MockConnectorBase } from "@mcc/connectors";
import { z } from "zod";
import { getConnector } from "../services/connectorManager.js";
import { runFullSync } from "../services/syncService.js";

const SimulateSchema = z.object({
  action: z.enum(["message", "offer", "sale", "refund", "disconnect", "duplicate", "failure"]),
  orderId: z.string().optional(),
});

/**
 * Dev-only tooling for exercising the mock connectors without waiting for
 * real activity — spec section 25: "make it easy to test: new message, new
 * offer, sale, refund, refund, account disconnect, duplicate event,
 * watchdog failure." Not wired to any real connector; throws for those.
 */
export function registerDevRoutes(app: FastifyInstance): void {
  app.post("/api/dev/accounts/:accountId/simulate", async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const body = SimulateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const connector = await getConnector(accountId);
    if (!(connector instanceof MockConnectorBase)) {
      return reply.code(400).send({ error: "Simulation is only available for mock connectors" });
    }

    switch (body.data.action) {
      case "message":
        connector.simulateNewMessage();
        break;
      case "offer":
        connector.simulateNewOffer();
        break;
      case "sale":
        connector.simulateSale();
        break;
      case "refund":
        if (!body.data.orderId) return reply.code(400).send({ error: "orderId required for refund" });
        connector.simulateRefund({ orderId: body.data.orderId });
        break;
      case "disconnect":
        connector.simulateDisconnect();
        break;
      case "duplicate":
        connector.simulateDuplicateEvent();
        break;
      case "failure":
        connector.simulateWatchdogFailure();
        break;
    }

    const result = await runFullSync(accountId);
    return { ok: true, action: body.data.action, syncResult: result };
  });
}
