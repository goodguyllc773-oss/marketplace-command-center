import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOCAL_API_KEY: z.string().min(8, "LOCAL_API_KEY must be set to a random string of 8+ chars"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("127.0.0.1"),
  DISCORD_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  // Facebook conversation hydration — conservative by default.
  FB_HYDRATIONS_PER_CYCLE: z.coerce.number().int().min(0).max(10).default(3),
  FB_HYDRATION_PAUSE_MS: z.coerce.number().int().min(1000).default(5000),
  FB_HYDRATION_MAX_SCROLLS: z.coerce.number().int().min(0).max(20).default(6),
  FB_HYDRATION_MANUAL_MAX_SCROLLS: z.coerce.number().int().min(0).max(60).default(25),
  FB_HYDRATION_SCROLL_WAIT_MS: z.coerce.number().int().min(500).default(1500),
  FB_HYDRATION_PAGE_TIMEOUT_MS: z.coerce.number().int().min(5000).default(45000),
  MCC_ENABLE_MOCKS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export const env = EnvSchema.parse(process.env);
