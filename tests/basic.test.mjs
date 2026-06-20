import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/config.js";
import { postNexi } from "../dist/nexi-client.js";
import { SQLiteStore } from "../dist/storage/sqlite-store.js";
import { redactValue } from "../dist/utils/redact.js";

const baseEnv = {
  NEXI_POS_API_KEY_ID: "key-id",
  NEXI_POS_API_KEY_SECRET: "key-secret",
};

test("loadConfig supports optional terminal ID and request timeout", () => {
  const config = loadConfig({
    ...baseEnv,
    NEXI_POS_TERMINAL_ID: "t-123",
    NEXI_POS_REQUEST_TIMEOUT_SECONDS: "12",
  });

  assert.equal(config.terminalId, "t-123");
  assert.equal(config.requestTimeoutSeconds, 12);
});

test("redactValue hides credentials and card values", () => {
  const redacted = redactValue({
    apiKeySecret: "secret",
    payment_method_details: {
      card_number_customer: "1234567890123456",
    },
  });

  assert.equal(redacted.apiKeySecret, "[REDACTED]");
  assert.equal(redacted.payment_method_details.card_number_customer, "[REDACTED]");
});

test("SQLiteStore upserts transaction responses and can fetch them", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexi-pos-test-"));
  try {
    const store = new SQLiteStore(join(dir, "store.sqlite"));
    store.updateTransaction({
      transaction: {
        external_id: "order-1",
        terminal_id: "t-1",
        type: "PURCHASE",
        currency: "SEK",
        requested_amount: 500,
        state: "AWAITING_CONFIRM",
        result_code: "SUCCESS",
      },
    });

    const stored = store.getTransaction("order-1", "t-1");
    assert.equal(stored.external_id, "order-1");
    assert.equal(stored.type, "purchase");
    assert.equal(stored.currency, "SEK");
    assert.equal(stored.requested_amount, 500);
    assert.equal(stored.state, "AWAITING_CONFIRM");
    assert.equal(stored.result_code, "SUCCESS");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("postNexi times out stalled requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  try {
    await assert.rejects(
      () => postNexi({
        apiKeyId: "key-id",
        apiKeySecret: "key-secret",
        baseUrl: "https://example.invalid/pos/v1",
        defaultCurrency: "SEK",
        maxAmountMinor: 500,
        userAgent: "test/1.0",
        storagePath: "./data/test.sqlite",
        requestTimeoutSeconds: 1,
      }, "/transaction/get", { external_id: "x", terminal_id: "t" }),
      /timed out after 1 seconds/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
