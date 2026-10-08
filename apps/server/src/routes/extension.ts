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
  /** The shop picked in the extension's settings — only a fallback when
   * the page doesn't show which Depop account is signed in. */
  accountId: z.string().min(1).optional(),
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
    signedInAs: z.string().max(60).optional(),
    signedInVia: z.string().max(60).optional(),
    headerDiag: z.array(z.string().max(300)).max(60).optional(),
  }),
  snapshot: z.unknown().optional(),
});

/** Depop accounts the extension saw signed in that MCC has no shop for —
 * offered on the Accounts page ("Add"). Not under the `depopExtension:`
 * prefix, which is per-shop status. */
const UNKNOWN_SHOPS_KEY = "depopReaderUnknownShops";
const UNKNOWN_SHOP_WINDOW_MS = 24 * 60 * 60_000;

async function noteUnknownShop(username: string): Promise<void> {
  const row = await prisma.appSetting.findUnique({ where: { key: UNKNOWN_SHOPS_KEY } });
  const seen = (row ? JSON.parse(row.value) : {}) as Record<string, string>;
  seen[username] = new Date().toISOString();
  const value = JSON.stringify(seen);
  await prisma.appSetting.upsert({ where: { key: UNKNOWN_SHOPS_KEY }, create: { key: UNKNOWN_SHOPS_KEY, value }, update: { value } });
}

/** The MCC Depop shop for a report: the signed-in account when the page
 * shows it (so tabs in any Chrome profile land on the right shop and a
 * wrong settings choice can't mix shops up), else the settings choice. */
async function resolveShop(signedInAs: string | undefined, accountId: string | undefined) {
  const shops = await prisma.platformAccount.findMany({ where: { platform: { key: "depop-live" } } });
  const username = signedInAs?.replace(/^@/, "").toLowerCase();
  if (username) {
    const shop = shops.find((s) => s.externalAccountId.replace(/^@/, "").toLowerCase() === username);
    return shop ? { shop } : { unknown: username };
  }
  const shop = shops.find((s) => s.id === accountId);
  return shop ? { shop } : {};
}

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
    const { kind, page, snapshot } = body.data;

    const resolved = await resolveShop(page.signedInAs, body.data.accountId);
    if (resolved.unknown) {
      await noteUnknownShop(resolved.unknown);
      return reply.code(404).send({ error: `@${resolved.unknown} isn't in MCC yet — add it on MCC's Accounts page` });
    }
    if (!resolved.shop) {
      return reply.code(404).send({
        error: body.data.accountId
          ? "That MCC Depop shop no longer exists"
          : "Couldn't tell which Depop account is signed in — pick the shop in the extension's settings",
      });
    }
    const accountId = resolved.shop.id;

    const result = await handleExtensionReport(accountId, { kind, page, snapshot });
    if (result) {
      request.log.info(
        `[depop-extension] ${accountId}: ${result.conversations} conversations, ${result.newMessages} new, ${result.alerts} alerts`,
      );
    }
    if (kind === "snapshot" && !/^\/messages\/?$/.test(page.path)) saveSnapshot(accountId, { page, snapshot });
    return { ok: true };
  });

  /** Signed-in Depop accounts seen in the last day that MCC has no shop for. */
  app.get("/api/extension/depop/unknown-shops", async () => {
    const row = await prisma.appSetting.findUnique({ where: { key: UNKNOWN_SHOPS_KEY } });
    const seen = (row ? JSON.parse(row.value) : {}) as Record<string, string>;
    const known = new Set(
      (await prisma.platformAccount.findMany({ where: { platform: { key: "depop-live" } }, select: { externalAccountId: true } })).map(
        (s) => s.externalAccountId.replace(/^@/, "").toLowerCase(),
      ),
    );
    return Object.entries(seen)
      .filter(([u, at]) => !known.has(u) && Date.now() - new Date(at).getTime() < UNKNOWN_SHOP_WINDOW_MS)
      .map(([username, lastSeenAt]) => ({ username, lastSeenAt }));
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
