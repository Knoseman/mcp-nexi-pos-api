import { z } from "zod";

import { getConfig } from "../config.js";
import { NexiClient } from "../nexi-client.js";
import {
  confirmTransactionInputSchema,
  createPurchaseInputSchema,
  createRefundInputSchema,
  emptyInputSchema,
  getTerminalStatusInputSchema,
  getTransactionInputSchema,
  getUnconfirmedTransactionsInputSchema,
  listTerminalEventsInputSchema,
  setTerminalIdInputSchema,
  takePaymentInputSchema,
  type ConfirmTransactionInput,
  type CreatePurchaseInput,
  type CreateRefundInput,
  type GetTerminalStatusInput,
  type ListTerminalEventsInput,
  type TakePaymentInput,
} from "../schemas.js";
import { SQLiteStore } from "../storage/sqlite-store.js";
import type { TransactionType } from "../storage/types.js";
import { NexiApiError } from "../utils/errors.js";

let sessionTerminalId: string | undefined;

type ToolResult = {
  ok: boolean;
  operation: string;
  terminal_id?: string;
  external_id?: string;
  state?: string;
  result_code?: string;
  result_description?: string;
  success?: boolean;
  message: string;
  user_message?: string;
  next_action?: string;
  summary?: {
    amount?: number;
    currency?: string;
    state?: string;
    result_code?: string;
    reference?: string;
    masked_card?: string;
    authorized_amount?: number;
    captured_amount?: number;
    connected?: boolean;
    transaction_state?: string;
    screen_message?: string;
    battery_percentage?: number;
    plugged_in?: boolean;
    updated_at?: string;
    event_count?: number;
    next_token?: string;
    latest_event_type?: string;
    latest_event_time?: string;
    latest_event_subject?: string;
  };
  error?: {
    name?: string;
    status?: number;
    statusText?: string;
    retryAfter?: string | null;
    body?: unknown;
  };
  transaction?: unknown;
  terminal_status?: unknown;
  events?: unknown;
  raw?: unknown;
};

type ToolContext = {
  client: InstanceType<typeof NexiClient>;
  store: InstanceType<typeof SQLiteStore>;
  config: ReturnType<typeof getConfig>;
};

type NexiRequest = Record<string, unknown>;

function textResult(payload: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function resolveTerminalId(config: ToolContext["config"], inputTerminalId?: string): string {
  const terminalId = inputTerminalId ?? sessionTerminalId ?? config.terminalId;
  if (!terminalId) {
    throw new Error("terminal_id is required. Pass terminal_id in the tool call, call set_terminal_id first, or set NEXI_POS_TERMINAL_ID in the environment.");
  }
  return terminalId;
}

function currencyOrDefault(config: ToolContext["config"], currency?: string): string {
  return currency ?? config.defaultCurrency ?? "SEK";
}

function assertAmount(config: ToolContext["config"], amount: number) {
  const maxAmount = config.maxAmountMinor ?? 500;
  if (!Number.isInteger(amount)) throw new Error("requested_amount must be an integer in minor units. Example: 5.00 SEK = 500.");
  if (amount > maxAmount) throw new Error(`requested_amount exceeds configured max amount (${maxAmount}). Amounts are minor units, so 5.00 SEK = 500.`);
}

function addIfDefined(target: NexiRequest, key: string, value: unknown) {
  if (value !== undefined) target[key] = value;
}

function buildPurchaseRequest(input: CreatePurchaseInput | TakePaymentInput, terminalId: string, currency: string, waitSeconds: number): NexiRequest {
  const body: NexiRequest = {
    external_id: input.external_id,
    terminal_id: terminalId,
    requested_amount: input.requested_amount,
    currency,
    wait_seconds: waitSeconds,
  };
  addIfDefined(body, "metadata", input.metadata);
  if ("cashback_amount" in input) addIfDefined(body, "cashback_amount", input.cashback_amount);
  return body;
}

function buildRefundRequest(input: CreateRefundInput, terminalId: string, currency: string, waitSeconds: number): NexiRequest {
  const body: NexiRequest = {
    external_id: input.external_id,
    terminal_id: terminalId,
    requested_amount: input.requested_amount,
    currency,
    wait_seconds: waitSeconds,
  };
  addIfDefined(body, "metadata", input.metadata);
  addIfDefined(body, "customer_not_present", input.customer_not_present);
  addIfDefined(body, "original_purchase_external_id", input.original_purchase_external_id);
  addIfDefined(body, "original_purchase_terminal_id", input.original_purchase_terminal_id);
  return body;
}

function buildConfirmRequest(input: ConfirmTransactionInput, terminalId: string, waitSeconds: number): NexiRequest {
  const body: NexiRequest = {
    external_id: input.external_id,
    terminal_id: terminalId,
    result_code: input.result_code,
    wait_seconds: waitSeconds,
  };
  addIfDefined(body, "result_description", input.result_description);
  addIfDefined(body, "captured_amount", input.captured_amount);
  addIfDefined(body, "metadata", input.metadata);
  addIfDefined(body, "commit_window_seconds", input.commit_window_seconds);
  return body;
}

function buildGetTransactionRequest(input: z.infer<typeof getTransactionInputSchema>, terminalId: string, waitSeconds: number): NexiRequest {
  return {
    external_id: input.external_id,
    terminal_id: terminalId,
    wait_seconds: waitSeconds,
  };
}

function buildGetUnconfirmedRequest(terminalId: string): NexiRequest {
  return { terminal_id: terminalId };
}

function buildGetTerminalStatusRequest(terminalId: string): NexiRequest {
  return { terminal_id: terminalId };
}

function buildListTerminalEventsRequest(input: ListTerminalEventsInput, terminalId: string): NexiRequest {
  const body: NexiRequest = {
    limit: input.limit ?? 20,
    wait_seconds: input.wait_seconds ?? 0,
  };

  if (input.next_token) {
    body.next_token = input.next_token;
    return body;
  }

  const filter: NexiRequest = {
    subject: { eq: terminalId },
  };
  if (input.event_type) {
    filter.type = { eq: input.event_type };
  }
  body.filter = filter;
  return body;
}

function transactionFrom(raw: any): any {
  return raw?.transaction ?? raw;
}

function stateFrom(raw: unknown): string | undefined {
  const tx = transactionFrom(raw as any);
  return typeof tx?.state === "string" ? tx.state : undefined;
}

function resultCodeFrom(raw: unknown): string | undefined {
  const tx = transactionFrom(raw as any);
  const resultCode = tx?.result_code ?? (raw as any)?.result_code;
  return typeof resultCode === "string" ? resultCode : undefined;
}

function nextAction(state?: string, resultCode?: string): string | undefined {
  if (resultCode && resultCode !== "SUCCESS") return "Review result_code/result_description and do not confirm as success.";
  switch (state) {
    case "AWAITING_CONFIRM":
      return "Call confirm_transaction to complete the transaction.";
    case "PROCESSING":
      return "Call take_payment again or get_transaction later with the same external_id.";
    case "CONFIRMED":
    case "COMMITTED":
      return "No action needed.";
    default:
      return undefined;
  }
}

function userMessage(state?: string, resultCode?: string): string | undefined {
  if (state === "AWAITING_CONFIRM") {
    return "The card step succeeded, but the transaction is not complete until it is confirmed.";
  }
  if (resultCode && resultCode !== "SUCCESS") {
    return "Nexi returned a non-success result code. Treat this payment/refund as failed unless your business rules say otherwise.";
  }
  return undefined;
}

function buildSummary(tx: any): ToolResult["summary"] | undefined {
  if (!tx || typeof tx !== "object") return undefined;
  return {
    amount: typeof tx.total_amount === "number" ? tx.total_amount : tx.requested_amount,
    currency: tx.currency,
    state: tx.state,
    result_code: tx.result_code,
    reference: tx.reference,
    masked_card: tx.payment_method_details?.card_number_customer,
    authorized_amount: tx.authorized_amount,
    captured_amount: tx.captured_amount,
  };
}

function summarize(operation: string, terminalId: string | undefined, externalId: string | undefined, raw: any, message?: string): ToolResult {
  const tx = transactionFrom(raw);
  const resultCode = tx?.result_code ?? raw?.result_code;
  const state = tx?.state ?? raw?.state;
  const resultDescription = tx?.result_description ?? raw?.result_description;
  return {
    ok: true,
    operation,
    terminal_id: terminalId,
    external_id: externalId,
    state,
    result_code: resultCode,
    result_description: resultDescription,
    success: resultCode === "SUCCESS",
    message: message ?? `${operation} handled`,
    user_message: userMessage(state, resultCode),
    next_action: nextAction(state, resultCode),
    summary: buildSummary(tx),
    transaction: tx,
    raw,
  };
}

function terminalStatusFrom(raw: any): any {
  return raw?.status ?? raw;
}

function summarizeTerminalStatus(terminalId: string, raw: any): ToolResult {
  const status = terminalStatusFrom(raw);
  return {
    ok: true,
    operation: "get_terminal_status",
    terminal_id: terminalId,
    message: "Terminal status fetched",
    summary: status && typeof status === "object" ? {
      connected: status.connected,
      transaction_state: status.transaction_state,
      screen_message: status.screen_message,
      battery_percentage: status.battery_percentage,
      plugged_in: status.plugged_in,
      updated_at: status.updated_at,
    } : undefined,
    terminal_status: status,
    raw,
  };
}

function eventTimestamp(event: any): string | undefined {
  const value = event?.time ?? event?.created_at ?? event?.occurred_at ?? event?.updated_at;
  return typeof value === "string" ? value : undefined;
}

function summarizeTerminalEvents(terminalId: string, raw: any): ToolResult {
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const latest = events[0];
  const nextToken = typeof raw?.next_token === "string" ? raw.next_token : undefined;
  return {
    ok: true,
    operation: "list_terminal_events",
    terminal_id: terminalId,
    message: "Terminal events listed",
    summary: {
      event_count: events.length,
      next_token: nextToken,
      latest_event_type: typeof latest?.type === "string" ? latest.type : undefined,
      latest_event_time: eventTimestamp(latest),
      latest_event_subject: typeof latest?.subject === "string" ? latest.subject : undefined,
    },
    events,
    raw,
  };
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof NexiApiError && (error.status === 401 || error.status === 403)) {
    return `${error.message}. Check that the API credentials are correct and allowed for this terminal.`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorResult(operation: string, error: unknown, terminalId?: string, externalId?: string): ToolResult {
  const result: ToolResult = {
    ok: false,
    operation,
    terminal_id: terminalId,
    external_id: externalId,
    message: friendlyErrorMessage(error),
  };

  if (error instanceof NexiApiError) {
    result.error = {
      name: error.name,
      status: error.status,
      statusText: error.statusText,
      retryAfter: error.retryAfter,
      body: error.body,
    };
  } else if (error instanceof Error) {
    result.error = { name: error.name };
  }

  return result;
}

function assertIdempotentRetry(store: ToolContext["store"], input: { external_id: string; requested_amount: number; currency?: string }, terminalId: string, type: TransactionType, config: ToolContext["config"]) {
  const existing = store.getTransaction?.(input.external_id, terminalId);
  if (!existing) return;

  const currency = currencyOrDefault(config, input.currency);
  const mismatches: string[] = [];
  if (existing.type !== type) mismatches.push(`type ${existing.type} != ${type}`);
  if (existing.currency !== currency) mismatches.push(`currency ${existing.currency} != ${currency}`);
  if (existing.requested_amount !== input.requested_amount) mismatches.push(`requested_amount ${existing.requested_amount} != ${input.requested_amount}`);

  if (mismatches.length > 0) {
    throw new Error(`external_id is already used for this terminal with different transaction details (${mismatches.join(", ")}). Reuse external_id only to retry the same transaction; use a new external_id for a new amount, currency, or type.`);
  }
}

async function saveIntent(store: ToolContext["store"], input: { external_id: string; requested_amount: number; currency?: string; metadata?: Record<string, unknown> }, terminalId: string, type: TransactionType, config: ToolContext["config"]) {
  assertIdempotentRetry(store, input, terminalId, type, config);
  await store.saveIntent?.({
    external_id: input.external_id,
    terminal_id: terminalId,
    type,
    currency: currencyOrDefault(config, input.currency),
    requested_amount: input.requested_amount,
    metadata: input.metadata,
  });
}

async function updateTransaction(store: ToolContext["store"], raw: unknown) {
  await store.updateTransaction?.(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createToolContext(): Promise<ToolContext> {
  const config = getConfig();
  return {
    config,
    client: new NexiClient(config),
    store: new SQLiteStore(config.storagePath),
  };
}

export function toolDefinitions(ctx: ToolContext) {
  return {
    set_terminal_id: {
      schema: setTerminalIdInputSchema,
      handler: async (input: z.infer<typeof setTerminalIdInputSchema>) => {
        sessionTerminalId = input.terminal_id;
        return textResult({ ok: true, operation: "set_terminal_id", terminal_id: sessionTerminalId, message: "Session terminal ID set" });
      },
    },
    get_session_terminal_id: {
      schema: emptyInputSchema,
      handler: async () => textResult({
        ok: true,
        operation: "get_session_terminal_id",
        terminal_id: sessionTerminalId,
        message: sessionTerminalId ? "Session terminal ID is set" : ctx.config.terminalId ? "No session terminal ID set; NEXI_POS_TERMINAL_ID fallback is configured" : "No session terminal ID set",
        next_action: sessionTerminalId || ctx.config.terminalId ? undefined : "Pass terminal_id, call set_terminal_id, or set NEXI_POS_TERMINAL_ID.",
      }),
    },
    clear_terminal_id: {
      schema: emptyInputSchema,
      handler: async () => {
        const previous = sessionTerminalId;
        sessionTerminalId = undefined;
        return textResult({ ok: true, operation: "clear_terminal_id", terminal_id: previous, message: "Session terminal ID cleared" });
      },
    },
    create_purchase: {
      schema: createPurchaseInputSchema,
      handler: async (input: CreatePurchaseInput) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "purchase", ctx.config);
          const raw = await ctx.client.purchase(buildPurchaseRequest(input, terminalId, currencyOrDefault(ctx.config, input.currency), input.wait_seconds ?? 25));
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("create_purchase", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("create_purchase", error, terminalId, input.external_id)); }
      },
    },
    take_payment: {
      schema: takePaymentInputSchema,
      handler: async (input: TakePaymentInput) => {
        let terminalId: string | undefined;
        let lastRaw: unknown;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const deadline = Date.now() + (input.timeout_seconds ?? 15) * 1000;
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "purchase", ctx.config);
          while (Date.now() < deadline) {
            const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
            const waitSeconds = Math.min(input.wait_seconds ?? 25, remaining);
            lastRaw = await ctx.client.purchase(buildPurchaseRequest(input, terminalId, currencyOrDefault(ctx.config, input.currency), waitSeconds));
            await updateTransaction(ctx.store, lastRaw);
            const state = stateFrom(lastRaw);
            if (state !== "PROCESSING") break;
            if (Date.now() < deadline) await sleep(300);
          }
          const state = stateFrom(lastRaw);
          if (state === "AWAITING_CONFIRM" && input.auto_confirm) {
            const resultCode = resultCodeFrom(lastRaw);
            if (typeof resultCode !== "string" || resultCode.length === 0) {
              throw new Error("Cannot auto-confirm because Nexi response did not include transaction.result_code");
            }
            lastRaw = await ctx.client.confirm(buildConfirmRequest({ external_id: input.external_id, terminal_id: terminalId, result_code: resultCode }, terminalId, 25));
            await updateTransaction(ctx.store, lastRaw);
            await ctx.store.markConfirmed?.(input.external_id, terminalId);
            return textResult(summarize("take_payment", terminalId, input.external_id, lastRaw, "Payment reached AWAITING_CONFIRM and was auto-confirmed"));
          }
          const timedOut = Date.now() >= deadline && state === "PROCESSING";
          return textResult(summarize("take_payment", terminalId, input.external_id, lastRaw, timedOut ? "Payment is still PROCESSING after timeout" : "Payment flow stopped at terminal/current state"));
        } catch (error) { return textResult(errorResult("take_payment", error, terminalId, input.external_id)); }
      },
    },
    create_refund: {
      schema: createRefundInputSchema,
      handler: async (input: CreateRefundInput) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "refund", ctx.config);
          const raw = await ctx.client.refund(buildRefundRequest(input, terminalId, currencyOrDefault(ctx.config, input.currency), input.wait_seconds ?? 25));
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("create_refund", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("create_refund", error, terminalId, input.external_id)); }
      },
    },
    confirm_transaction: {
      schema: confirmTransactionInputSchema,
      handler: async (input: ConfirmTransactionInput) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const raw = await ctx.client.confirm(buildConfirmRequest(input, terminalId, input.wait_seconds ?? 25));
          await updateTransaction(ctx.store, raw);
          await ctx.store.markConfirmed?.(input.external_id, terminalId);
          return textResult(summarize("confirm_transaction", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("confirm_transaction", error, terminalId, input.external_id)); }
      },
    },
    get_transaction: {
      schema: getTransactionInputSchema,
      handler: async (input: z.infer<typeof getTransactionInputSchema>) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const raw = await ctx.client.getTransaction(buildGetTransactionRequest(input, terminalId, input.wait_seconds ?? 25));
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("get_transaction", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("get_transaction", error, terminalId, input.external_id)); }
      },
    },
    get_unconfirmed_transactions: {
      schema: getUnconfirmedTransactionsInputSchema,
      handler: async (input: z.infer<typeof getUnconfirmedTransactionsInputSchema>) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const raw = await ctx.client.getUnconfirmedTransactions(buildGetUnconfirmedRequest(terminalId));
          return textResult(summarize("get_unconfirmed_transactions", terminalId, undefined, raw));
        } catch (error) { return textResult(errorResult("get_unconfirmed_transactions", error, terminalId)); }
      },
    },
    get_terminal_status: {
      schema: getTerminalStatusInputSchema,
      handler: async (input: GetTerminalStatusInput) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const raw = await ctx.client.getTerminalStatus(buildGetTerminalStatusRequest(terminalId));
          return textResult(summarizeTerminalStatus(terminalId, raw));
        } catch (error) { return textResult(errorResult("get_terminal_status", error, terminalId)); }
      },
    },
    list_terminal_events: {
      schema: listTerminalEventsInputSchema,
      handler: async (input: ListTerminalEventsInput) => {
        let terminalId: string | undefined;
        try {
          terminalId = resolveTerminalId(ctx.config, input.terminal_id);
          const raw = await ctx.client.listTerminalEvents(buildListTerminalEventsRequest(input, terminalId));
          return textResult(summarizeTerminalEvents(terminalId, raw));
        } catch (error) { return textResult(errorResult("list_terminal_events", error, terminalId)); }
      },
    },
  };
}
