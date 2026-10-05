import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Emails older than this are recorded but never alerted on. */
  connectedAt: string;
  /** When several accounts share one inbox (e.g. Gmail +aliases), only
   * emails addressed to this address belong to this account. */
  matchTo?: string;
}

export interface FetchedEmail {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  text: string;
  html: string;
}

function client(cfg: EmailConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

/** Throws with the server's reason if the login is rejected. */
export async function verifyEmailLogin(cfg: EmailConfig): Promise<void> {
  const c = client(cfg);
  await c.connect();
  await c.logout().catch(() => undefined);
}

/**
 * Read-only: the mailbox is opened with EXAMINE (readOnly) and messages
 * are fetched as raw source, so nothing is marked read, moved, or deleted.
 * Looks in Gmail's "All Mail" when present, so notifications filtered out
 * of the inbox still count.
 */
export async function fetchRecentEmailsFrom(
  cfg: EmailConfig,
  fromDomain: string,
  options: { sinceDays: number; max: number },
): Promise<FetchedEmail[]> {
  const c = client(cfg);
  await c.connect();
  try {
    const boxes = await c.list();
    const mailbox = boxes.find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
    const lock = await c.getMailboxLock(mailbox, { readOnly: true });
    try {
      const since = new Date(Date.now() - options.sinceDays * 86_400_000);
      const uids = (await c.search({ from: fromDomain, since }, { uid: true })) || [];
      const recent = uids.slice(-options.max);
      const out: FetchedEmail[] = [];
      if (recent.length === 0) return out;
      for await (const msg of c.fetch(recent, { source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0]?.address ?? "";
        if (!from.toLowerCase().endsWith(fromDomain)) continue;
        const toField = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
        const to = toField.flatMap((t) => t.value.map((v) => (v.address ?? "").toLowerCase())).filter(Boolean);
        if (cfg.matchTo && !to.includes(cfg.matchTo.toLowerCase())) continue;
        out.push({
          messageId: parsed.messageId ?? `uid-${msg.uid}`,
          from,
          to,
          subject: parsed.subject ?? "",
          date: (parsed.date ?? new Date()).toISOString(),
          text: parsed.text ?? "",
          html: typeof parsed.html === "string" ? parsed.html : "",
        });
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => undefined);
  }
}
