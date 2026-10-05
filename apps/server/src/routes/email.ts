import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EMAIL_PLATFORM_IDS, verifyEmailLogin } from "@mcc/connectors";
import { prisma } from "../db.js";
import { dropConnector } from "../services/connectorManager.js";
import { getEmailConfig, listEmailConfigs, saveEmailConfig } from "../services/emailSettings.js";

const ConnectSchema = z.object({
  user: z.string().trim().email("Enter your full email address"),
  password: z.string().min(1, "Enter the App Password"),
  host: z.string().trim().min(1).default("imap.gmail.com"),
  port: z.coerce.number().int().positive().default(993),
  matchTo: z
    .string()
    .trim()
    .email("The Depop sign-up email must be a full email address")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

async function emailAccount(id: string) {
  const account = await prisma.platformAccount.findUnique({ where: { id }, include: { platform: true } });
  if (!account || !EMAIL_PLATFORM_IDS.includes(account.platform.key)) return null;
  return account;
}

/** Each email-reading account (e.g. each Depop shop) has its own mailbox
 * connection. Passwords are encrypted at rest and never returned. */
export function registerEmailRoutes(app: FastifyInstance): void {
  app.get("/api/accounts/:id/email", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await emailAccount(id))) return reply.code(404).send({ error: "Not an email-connected account" });
    const cfg = await getEmailConfig(id);
    return cfg
      ? { connected: true, user: cfg.user, host: cfg.host, matchTo: cfg.matchTo ?? null, connectedAt: cfg.connectedAt }
      : { connected: false };
  });

  /** Verifies the login against the mail server before saving anything. */
  app.put("/api/accounts/:id/email", async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await emailAccount(id);
    if (!account) return reply.code(404).send({ error: "Not an email-connected account" });
    const body = ConnectSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
    const { user, host, port, matchTo } = body.data;

    // A mailbox shared by several accounts only works if each one says
    // which address its own emails are sent to — otherwise they'd mix.
    const sharing = (await listEmailConfigs()).filter(
      (c) => c.platformAccountId !== id && c.cfg.user.toLowerCase() === user.toLowerCase() && c.cfg.host === host,
    );
    if (sharing.length > 0) {
      const others = await prisma.platformAccount.findMany({ where: { id: { in: sharing.map((s) => s.platformAccountId) } } });
      const names = others.map((o) => o.label).join(", ");
      if (!matchTo) {
        return reply.code(409).send({
          error: `This inbox is already connected to ${names}. If both shops get Depop email here (e.g. Gmail +aliases), fill in "Depop sign-up email" so each account only reads its own emails.`,
        });
      }
      const missing = sharing.filter((s) => !s.cfg.matchTo);
      if (missing.length > 0) {
        return reply.code(409).send({
          error: `${names} also reads this inbox but has no Depop sign-up email set — reconnect it with one first, so the two don't mix.`,
        });
      }
      if (sharing.some((s) => s.cfg.matchTo?.toLowerCase() === matchTo.toLowerCase())) {
        return reply.code(409).send({ error: `${names} already uses ${matchTo} — each shop needs its own sign-up email.` });
      }
    }

    // Google shows App Passwords in groups of four; the spaces aren't part of it.
    const cfg = { host, port, user, pass: body.data.password.replace(/\s+/g, ""), matchTo, connectedAt: new Date().toISOString() };
    try {
      await verifyEmailLogin(cfg);
    } catch (err) {
      const e = err as { message?: string; authenticationFailed?: boolean; responseText?: string };
      const detail = e.responseText || e.message || String(err);
      const authFailed = e.authenticationFailed === true || /auth|credentials|invalid|login/i.test(detail);
      return reply.code(400).send({
        error: authFailed
          ? "The mail server rejected that login. For Gmail, use an App Password (not your normal password) — 2-Step Verification must be on."
          : `Couldn't reach the mail server: ${detail}`,
      });
    }
    await saveEmailConfig(id, cfg);
    dropConnector(id);
    return { connected: true, user, host, matchTo: matchTo ?? null, connectedAt: cfg.connectedAt };
  });

  app.delete("/api/accounts/:id/email", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await emailAccount(id))) return reply.code(404).send({ error: "Not an email-connected account" });
    await saveEmailConfig(id, null);
    dropConnector(id);
    return { connected: false };
  });
}
