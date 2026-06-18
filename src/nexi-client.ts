import type { AppConfig } from "./config.js";
import { getConfig } from "./config.js";
import { isRecord, NexiApiError } from "./utils/errors.js";

export type NexiPostOptions = {
  signal?: AbortSignal;
};

export class NexiClient {
  constructor(private readonly config: AppConfig = getConfig()) {}

  post<TResponse = unknown, TBody extends Record<string, unknown> = Record<string, unknown>>(
    path: string,
    body: TBody,
    options: NexiPostOptions = {}
  ): Promise<TResponse> {
    return postNexi<TResponse, TBody>(this.config, path, body, options);
  }

  purchase<TResponse = unknown>(body: Record<string, unknown>, options?: NexiPostOptions): Promise<TResponse> {
    return this.post<TResponse>("/transaction/purchase", body, options);
  }

  refund<TResponse = unknown>(body: Record<string, unknown>, options?: NexiPostOptions): Promise<TResponse> {
    return this.post<TResponse>("/transaction/refund", body, options);
  }

  confirm<TResponse = unknown>(body: Record<string, unknown>, options?: NexiPostOptions): Promise<TResponse> {
    return this.post<TResponse>("/transaction/confirm", body, options);
  }

  getTransaction<TResponse = unknown>(body: Record<string, unknown>, options?: NexiPostOptions): Promise<TResponse> {
    return this.post<TResponse>("/transaction/get", body, options);
  }

  getUnconfirmedTransactions<TResponse = unknown>(body: Record<string, unknown>, options?: NexiPostOptions): Promise<TResponse> {
    return this.post<TResponse>("/transaction/unconfirmed", body, options);
  }
}

const MAX_ERROR_BODY_CHARS = 2_000;

export function createNexiClient(config: AppConfig = getConfig()): NexiClient {
  return new NexiClient(config);
}

export async function postNexi<
  TResponse = unknown,
  TBody extends Record<string, unknown> = Record<string, unknown>
>(
  config: AppConfig,
  path: string,
  body: TBody,
  options: NexiPostOptions = {}
): Promise<TResponse> {
  const url = buildUrl(config.baseUrl, path);
  const authorization = buildBasicAuth(config.apiKeyId, config.apiKeySecret);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "User-Agent": config.userAgent,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: options.signal
    });
  } catch (error) {
    throw new NexiApiError("Nexi request failed before a response was received", {
      body: sanitizeErrorBody(error)
    });
  }

  const parsedBody = await parseJsonBody(response);

  if (!response.ok) {
    throw new NexiApiError(`Nexi request failed with HTTP ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
      retryAfter: response.headers.get("retry-after"),
      body: sanitizeErrorBody(parsedBody)
    });
  }

  return parsedBody as TResponse;
}

function buildUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function buildBasicAuth(apiKeyId: string, apiKeySecret: string): string {
  const token = Buffer.from(`${apiKeyId}:${apiKeySecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new NexiApiError("Nexi response was not valid JSON", {
      status: response.status,
      statusText: response.statusText,
      retryAfter: response.headers.get("retry-after"),
      body: truncate(text)
    });
  }
}

function sanitizeErrorBody(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeErrorBody);
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      if (isSensitiveKey(key)) {
        output[key] = "[REDACTED]";
      } else if (typeof entry === "string") {
        output[key] = truncate(entry);
      } else {
        output[key] = sanitizeErrorBody(entry);
      }
    }
    return output;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return [
    "authorization",
    "api_key_secret",
    "apiKeySecret",
    "card_number_customer",
    "card_number_merchant",
    "card_token",
    "par_value"
  ].includes(key);
}

function truncate(value: string): string {
  if (value.length <= MAX_ERROR_BODY_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_ERROR_BODY_CHARS)}...[truncated]`;
}
