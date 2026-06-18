const SENSITIVE_KEYS = new Set([
  "card_number_customer",
  "card_number_merchant",
  "card_token",
  "par_value",
  "authorization",
  "api_key_id",
  "api_key_secret",
  "apiKeyId",
  "apiKeySecret",
  "NEXI_POS_API_KEY_ID",
  "NEXI_POS_API_KEY_SECRET",
]);

const SECRET_KEY_PATTERNS = [/secret/i, /password/i, /authorization/i, /api[_-]?key/i, /token/i];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(nestedValue);
    }
    return output;
  }

  return value;
}

export function redactJsonString(value: unknown): string {
  return JSON.stringify(redactValue(value));
}
