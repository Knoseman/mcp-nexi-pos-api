import { z } from "zod";

import { getConfig } from "../config.js";
import { NexiClient } from "../nexi-client.js";
import { SQLiteStore } from "../storage/sqlite-store.js";

let sessionTerminalId: string | undefined;

const currencySchema = z.string().regex(/^[A-Z]{3}$/).optional();
const waitSecondsSchema = z.number().int().min(0).max(120).optional();
const terminalIdSchema = z.string().min(1).max(128);
const externalIdSchema = z.string().min(1).max(128);
const amountSchema = z.number().int().nonnegative();

const baseTransactionSchema = {
  external_id: externalIdSchema,
  requested_amount: amountSchema,
  currency: currencySchema,
  terminal_id: terminalIdSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  wait_seconds: waitSecondsSchema,
};

const setTerminalIdSchema = z.object({ terminal_id: terminalIdSchema });
const emptySchema = z.object({});

const purchaseSchema = z.object({
  ...baseTransactionSchema,
  cashback_amount: amountSchema.optional(),
});

const takePaymentSchema = z.object({
  ...baseTransactionSchema,
  timeout_seconds: z.number().int().min(1).max(300).optional(),
  auto_confirm: z.boolean().optional(),
});

const refundSchema = z.object({
  ...baseTransactionSchema,
  customer_not_present: z.boolean().optional(),
  original_purchase_external_id: externalIdSchema.optional(),
  original_purchase_terminal_id: terminalIdSchema.optional(),
});

const confirmSchema = z.object({
  external_id: externalIdSchema,
  result_code: z.string().min(1),
  terminal_id: terminalIdSchema.optional(),
  result_description: z.string().optional(),
  captured_amount: amountSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  commit_window_seconds: z.number().int().positive().optional(),
  wait_seconds: waitSecondsSchema,
});

const getTransactionSchema = z.object({
  external_id: externalIdSchema,
  terminal_id: terminalIdSchema.optional(),
  wait_seconds: waitSecondsSchema,
});

const getUnconfirmedSchema = z.object({ terminal_id: terminalIdSchema.optional() });

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
  transaction?: unknown;
  raw?: unknown;
};

type ToolContext = {
  client: InstanceType<typeof NexiClient>;
  store: InstanceType<typeof SQLiteStore>;
  config: ReturnType<typeof getConfig>;
};

function textResult(payload: ToolResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function resolveTerminalId(inputTerminalId?: string): string {
  const terminalId = inputTerminalId ?? sessionTerminalId;
  if (!terminalId) throw new Error("terminal_id is required. Call set_terminal_id first or pass terminal_id.");
  return terminalId;
}

function currencyOrDefault(config: ReturnType<typeof getConfig>, currency?: string): string {
  return currency ?? config.defaultCurrency ?? "SEK";
}

function assertAmount(config: ReturnType<typeof getConfig>, amount: number) {
  const maxAmount = config.maxAmountMinor ?? 500;
  if (!Number.isInteger(amount)) throw new Error("requested_amount must be an integer in minor units");
  if (amount > maxAmount) throw new Error(`requested_amount exceeds configured max amount (${maxAmount})`);
}

function summarize(operation: string, terminalId: string | undefined, externalId: string | undefined, raw: any, message?: string): ToolResult {
  const tx = raw?.transaction ?? raw;
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
    transaction: tx,
    raw,
  };
}

function errorResult(operation: string, error: unknown, terminalId?: string, externalId?: string): ToolResult {
  return {
    ok: false,
    operation,
    terminal_id: terminalId,
    external_id: externalId,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function saveIntent(store: ToolContext["store"], input: any, terminalId: string, type: "purchase" | "refund", config: ToolContext["config"]) {
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
      schema: setTerminalIdSchema,
      handler: async (input: z.infer<typeof setTerminalIdSchema>) => {
        sessionTerminalId = input.terminal_id;
        return textResult({ ok: true, operation: "set_terminal_id", terminal_id: sessionTerminalId, message: "Session terminal ID set" });
      },
    },
    get_session_terminal_id: {
      schema: emptySchema,
      handler: async () => textResult({ ok: true, operation: "get_session_terminal_id", terminal_id: sessionTerminalId, message: sessionTerminalId ? "Session terminal ID is set" : "No session terminal ID set" }),
    },
    clear_terminal_id: {
      schema: emptySchema,
      handler: async () => {
        const previous = sessionTerminalId;
        sessionTerminalId = undefined;
        return textResult({ ok: true, operation: "clear_terminal_id", terminal_id: previous, message: "Session terminal ID cleared" });
      },
    },
    create_purchase: {
      schema: purchaseSchema,
      handler: async (input: z.infer<typeof purchaseSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        try {
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "purchase", ctx.config);
          const raw = await ctx.client.purchase({ ...input, terminal_id: terminalId, currency: currencyOrDefault(ctx.config, input.currency), wait_seconds: input.wait_seconds ?? 25 });
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("create_purchase", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("create_purchase", error, terminalId, input.external_id)); }
      },
    },
    take_payment: {
      schema: takePaymentSchema,
      handler: async (input: z.infer<typeof takePaymentSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        const deadline = Date.now() + (input.timeout_seconds ?? 15) * 1000;
        let lastRaw: unknown;
        try {
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "purchase", ctx.config);
          while (Date.now() < deadline) {
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            const wait_seconds = Math.min(input.wait_seconds ?? 25, remaining);
            lastRaw = await ctx.client.purchase({ ...input, terminal_id: terminalId, currency: currencyOrDefault(ctx.config, input.currency), wait_seconds });
            await updateTransaction(ctx.store, lastRaw);
            const state = (lastRaw as any)?.transaction?.state ?? (lastRaw as any)?.state;
            if (state !== "PROCESSING") break;
          }
          const state = (lastRaw as any)?.transaction?.state ?? (lastRaw as any)?.state;
          if (state === "AWAITING_CONFIRM" && input.auto_confirm) {
            const tx = (lastRaw as any)?.transaction ?? lastRaw as any;
            const resultCode = tx?.result_code;
            if (typeof resultCode !== "string" || resultCode.length === 0) {
              throw new Error("Cannot auto-confirm because Nexi response did not include transaction.result_code");
            }
            lastRaw = await ctx.client.confirm({ external_id: input.external_id, terminal_id: terminalId, result_code: resultCode });
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
      schema: refundSchema,
      handler: async (input: z.infer<typeof refundSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        try {
          assertAmount(ctx.config, input.requested_amount);
          await saveIntent(ctx.store, input, terminalId, "refund", ctx.config);
          const raw = await ctx.client.refund({ ...input, terminal_id: terminalId, currency: currencyOrDefault(ctx.config, input.currency), wait_seconds: input.wait_seconds ?? 25 });
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("create_refund", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("create_refund", error, terminalId, input.external_id)); }
      },
    },
    confirm_transaction: {
      schema: confirmSchema,
      handler: async (input: z.infer<typeof confirmSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        try {
          const raw = await ctx.client.confirm({ ...input, terminal_id: terminalId, wait_seconds: input.wait_seconds ?? 25 });
          await updateTransaction(ctx.store, raw);
          await ctx.store.markConfirmed?.(input.external_id, terminalId);
          return textResult(summarize("confirm_transaction", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("confirm_transaction", error, terminalId, input.external_id)); }
      },
    },
    get_transaction: {
      schema: getTransactionSchema,
      handler: async (input: z.infer<typeof getTransactionSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        try {
          const raw = await ctx.client.getTransaction({ ...input, terminal_id: terminalId, wait_seconds: input.wait_seconds ?? 25 });
          await updateTransaction(ctx.store, raw);
          return textResult(summarize("get_transaction", terminalId, input.external_id, raw));
        } catch (error) { return textResult(errorResult("get_transaction", error, terminalId, input.external_id)); }
      },
    },
    get_unconfirmed_transactions: {
      schema: getUnconfirmedSchema,
      handler: async (input: z.infer<typeof getUnconfirmedSchema>) => {
        const terminalId = resolveTerminalId(input.terminal_id);
        try {
          const raw = await ctx.client.getUnconfirmedTransactions({ terminal_id: terminalId });
          return textResult(summarize("get_unconfirmed_transactions", terminalId, undefined, raw));
        } catch (error) { return textResult(errorResult("get_unconfirmed_transactions", error, terminalId)); }
      },
    },
  };
}
