import type { EmailConfig } from "@mcc/connectors";
import { prisma } from "../db.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

/** One email connection per platform account (e.g. each Depop shop). */
export function emailKey(platformAccountId: string): string {
  return `emailAccount:${platformAccountId}`;
}

export async function getEmailConfig(platformAccountId: string): Promise<EmailConfig | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: emailKey(platformAccountId) } });
  if (!row) return null;
  const plain = decryptSecret(row.value);
  return plain ? (JSON.parse(plain) as EmailConfig) : null;
}

export async function saveEmailConfig(platformAccountId: string, cfg: EmailConfig | null): Promise<void> {
  const key = emailKey(platformAccountId);
  if (!cfg) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  const value = encryptSecret(JSON.stringify(cfg));
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Every saved email connection, for spotting a mailbox shared by accounts. */
export async function listEmailConfigs(): Promise<{ platformAccountId: string; cfg: EmailConfig }[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "emailAccount:" } } });
  const out = [];
  for (const r of rows) {
    const plain = decryptSecret(r.value);
    if (plain) out.push({ platformAccountId: r.key.slice("emailAccount:".length), cfg: JSON.parse(plain) as EmailConfig });
  }
  return out;
}
