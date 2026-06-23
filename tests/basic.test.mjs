import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/config.js";
import { NexiClient, postNexi } from "../dist/nexi-client.js";
import { SQLiteStore } from "../dist/storage/sqlite-store.js";
import { toolDefinitions } from "../dist/tools/index.js";
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

test("NexiClient supports terminal status and event list endpoints", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const client = new NexiClient({
      apiKeyId: "key-id",
      apiKeySecret: "key-secret",
      baseUrl: "https://example.invalid/pos/v1",
      defaultCurrency: "SEK",
      maxAmountMinor: 500,
      userAgent: "test/1.0",
      storagePath: "./data/test.sqlite",
      requestTimeoutSeconds: 30,
    });

    await client.getTerminalStatus({ terminal_id: "t-1" });
    await client.listTerminalEvents({ filter: { subject: { eq: "t-1" } }, type: { eq: "eu.npay.api.pos.v0.TerminalStatus" }, limit: 20, wait_seconds: 30 });
    await client.listTerminalEvents({ next_token: "next-1", limit: 10, wait_seconds: 5 });

    assert.equal(calls[0].url, "https://example.invalid/pos/v1/terminal/status");
    assert.deepEqual(calls[0].body, { terminal_id: "t-1" });
    assert.equal(calls[1].url, "https://example.invalid/pos/v1/event/list");
    assert.deepEqual(calls[1].body, { filter: { subject: { eq: "t-1" } }, type: { eq: "eu.npay.api.pos.v0.TerminalStatus" }, limit: 20, wait_seconds: 30 });
    assert.deepEqual(calls[2].body, { next_token: "next-1", limit: 10, wait_seconds: 5 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("terminal tools build requests and summarize responses", async () => {
  const calls = [];
  const client = {
    getTerminalStatus: async (body) => {
      calls.push({ name: "getTerminalStatus", body });
      return { status: { terminal_id: body.terminal_id, connected: true, transaction_state: "READY", screen_message: "Ready", battery_percentage: 94, plugged_in: true, updated_at: "2026-06-23T12:00:00Z" } };
    },
    listTerminalEvents: async (body) => {
      calls.push({ name: "listTerminalEvents", body });
      return { events: [{ type: "eu.npay.api.pos.v0.TerminalStatus", time: "2026-06-23T12:00:01Z", subject: "t-1" }], next_token: "next-2" };
    },
  };
  const tools = toolDefinitions({
    client,
    store: {},
    config: {
      apiKeyId: "key-id",
      apiKeySecret: "key-secret",
      baseUrl: "https://example.invalid/pos/v1",
      defaultCurrency: "SEK",
      maxAmountMinor: 500,
      userAgent: "test/1.0",
      storagePath: "./data/test.sqlite",
      requestTimeoutSeconds: 30,
      terminalId: "t-1",
    },
  });

  const statusResult = await tools.get_terminal_status.handler({});
  const statusPayload = JSON.parse(statusResult.content[0].text);
  assert.deepEqual(calls[0].body, { terminal_id: "t-1" });
  assert.equal(statusPayload.summary.connected, true);
  assert.equal(statusPayload.summary.transaction_state, "READY");

  await tools.list_terminal_events.handler({ event_type: "eu.npay.api.pos.v0.TerminalStatus" });
  assert.deepEqual(calls[1].body, {
    filter: {
      subject: { eq: "t-1" },
      type: { eq: "eu.npay.api.pos.v0.TerminalStatus" },
    },
    limit: 20,
    wait_seconds: 0,
  });

  const eventsResult = await tools.list_terminal_events.handler({ next_token: "next-1", limit: 5, wait_seconds: 10 });
  const eventsPayload = JSON.parse(eventsResult.content[0].text);
  assert.deepEqual(calls[2].body, { next_token: "next-1", limit: 5, wait_seconds: 10 });
  assert.equal(eventsPayload.summary.event_count, 1);
  assert.equal(eventsPayload.summary.next_token, "next-2");
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
