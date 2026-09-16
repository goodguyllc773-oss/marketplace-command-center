import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOCAL_API_KEY: z.string().min(8, "LOCAL_API_KEY must be set to a random string of 8+ chars"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("127.0.0.1"),
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
});

export const env = EnvSchema.parse(process.env);
