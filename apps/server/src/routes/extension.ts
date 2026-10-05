import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { checkExtensionsOffline, getExtensionStatus, handleExtensionReport } from "../services/depopExtensionSync.js";

/**
 * Receives reports from the "MCC Depop Reader" Chrome extension
 * (extension/depop-reader). The extension runs in the user's own Chrome,
 * in a depop.com/messages tab the user opened themselves, and only reads
 * what that page already shows — it never navigates, clicks or reloads.
 * The conversation list becomes Inbox conversations + alerts (see
 * services/depopExtensionSync.ts). Message text is never logged.
 */

const ReportSchema = z.object({
  accountId: z.string().min(1),
  kind: z.enum(["heartbeat", "snapshot"]),
  page: z.object({
    path: z.string(),
    title: z.string().optional(),
    visible: z.boolean().optional(),
    autoRefresh: z.boolean().optional(),
    refreshMinutes: z.number().optional(),
    lastRefreshAt: z.string().optional(),
    refreshProblem: z.string().optional(),
    offersCheck: z.boolean().optional(),
    offersMinutes: z.number().optional(),
  }),
  snapshot: z.unknown().optional(),
});

const OFFLINE_CHECK_MS = 2 * 60_000;

/** Snapshots of pages other than the list (open conversations, the
 * Offers tab) are kept locally (gitignored, last 40) for diagnosing
 * layout changes. */
const INSPECT_DIR = path.join(process.cwd(), ".inspect", "depop-ext");
const KEEP_SNAPSHOTS = 40;

export function registerExtensionRoutes(app: FastifyInstance): void {
  app.post("/api/extension/depop/report", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const body = ReportSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Malformed report" });
    const { accountId, kind, page, snapshot } = body.data;

    const account = await prisma.platformAccount.findUnique({ where: { id: accountId }, include: { platform: true } });
    if (account?.platform.key !== "depop-live") return reply.code(404).send({ error: "That MCC Depop shop no longer exists" });

    const result = await handleExtensionReport(accountId, { kind, page, snapshot });
    if (result) {
      request.log.info(
        `[depop-extension] ${accountId}: ${result.conversations} conversations, ${result.newMessages} new, ${result.alerts} alerts`,
      );
    }
    if (kind === "snapshot" && !/^\/messages\/?$/.test(page.path)) saveSnapshot(accountId, { page, snapshot });
    return { ok: true };
  });

  app.get("/api/accounts/:id/extension-status", async (request) => {
    const { id } = request.params as { id: string };
    return (await getExtensionStatus(id)) ?? null;
  });

  const timer = setInterval(() => void checkExtensionsOffline().catch(() => undefined), OFFLINE_CHECK_MS);
  app.addHook("onClose", async () => clearInterval(timer));
}

function saveSnapshot(accountId: string, data: unknown): void {
  try {
    fs.mkdirSync(INSPECT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(INSPECT_DIR, `${accountId}-${stamp}.json`), JSON.stringify(data, null, 2));
    const files = fs.readdirSync(INSPECT_DIR).filter((f) => f.startsWith(accountId)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) fs.rmSync(path.join(INSPECT_DIR, f));
  } catch {
    // local diagnostics only
  }
}
