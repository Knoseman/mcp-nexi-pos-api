export class ConfigError extends Error {
  public readonly name = "ConfigError";
}

export type NexiErrorDetails = {
  status?: number;
  statusText?: string;
  retryAfter?: string | null;
  body?: unknown;
};

export class NexiApiError extends Error {
  public readonly name = "NexiApiError";
  public readonly status?: number;
  public readonly statusText?: string;
  public readonly retryAfter?: string | null;
  public readonly body?: unknown;

  constructor(message: string, details: NexiErrorDetails = {}) {
    super(message);
    this.status = details.status;
    this.statusText = details.statusText;
    this.retryAfter = details.retryAfter;
    this.body = details.body;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
