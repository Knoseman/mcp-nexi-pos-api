import dotenv from "dotenv";
import { z } from "zod";

export const DEFAULT_NEXI_BASE_URL = "https://api.sandbox.npay.eu/pos/v1";
export const DEFAULT_CURRENCY = "SEK";
export const DEFAULT_MAX_AMOUNT_MINOR = 500;
export const DEFAULT_USER_AGENT = "mcp-nexi-pos-api/0.1.1";
export const DEFAULT_STORAGE_PATH = "./data/nexi-pos.sqlite";
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;

dotenv.config();

const envSchema = z.object({
  NEXI_POS_API_KEY_ID: z.string().trim().min(1, "NEXI_POS_API_KEY_ID is required"),
  NEXI_POS_API_KEY_SECRET: z.string().trim().min(1, "NEXI_POS_API_KEY_SECRET is required"),
  NEXI_POS_BASE_URL: z.string().trim().url().default(DEFAULT_NEXI_BASE_URL),
  NEXI_POS_DEFAULT_CURRENCY: z.string().trim().regex(/^[A-Z]{3}$/).default(DEFAULT_CURRENCY),
  NEXI_POS_MAX_AMOUNT_MINOR: z.coerce.number().int().positive().default(DEFAULT_MAX_AMOUNT_MINOR),
  NEXI_POS_USER_AGENT: z.string().trim().min(1).default(DEFAULT_USER_AGENT),
  NEXI_POS_STORAGE_PATH: z.string().trim().min(1).default(DEFAULT_STORAGE_PATH),
  NEXI_POS_TERMINAL_ID: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, "NEXI_POS_TERMINAL_ID contains invalid characters").optional(),
  NEXI_POS_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(DEFAULT_REQUEST_TIMEOUT_SECONDS)
});

export type AppConfig = {
  apiKeyId: string;
  apiKeySecret: string;
  baseUrl: string;
  defaultCurrency: string;
  maxAmountMinor: number;
  userAgent: string;
  storagePath: string;
  terminalId?: string;
  requestTimeoutSeconds: number;
};

let cachedConfig: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  const baseUrl = parsed.NEXI_POS_BASE_URL.replace(/\/+$/, "");

  return {
    apiKeyId: parsed.NEXI_POS_API_KEY_ID,
    apiKeySecret: parsed.NEXI_POS_API_KEY_SECRET,
    baseUrl,
    defaultCurrency: parsed.NEXI_POS_DEFAULT_CURRENCY,
    maxAmountMinor: parsed.NEXI_POS_MAX_AMOUNT_MINOR,
    userAgent: parsed.NEXI_POS_USER_AGENT,
    storagePath: parsed.NEXI_POS_STORAGE_PATH,
    terminalId: parsed.NEXI_POS_TERMINAL_ID,
    requestTimeoutSeconds: parsed.NEXI_POS_REQUEST_TIMEOUT_SECONDS
  };
}

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}
