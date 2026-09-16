import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

const PUBLIC_PATHS = new Set(["/api/health"]);

/** All requests to the local API must present the shared local API key.
 * This is a single-user, loopback-only server, but requiring the key still
 * stops any other local process/page from silently talking to it. */
export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (PUBLIC_PATHS.has(request.url)) return;
    const key = request.headers["x-api-key"];
    if (key !== env.LOCAL_API_KEY) {
      reply.code(401).send({ error: "Missing or invalid x-api-key" });
    }
  });
}
