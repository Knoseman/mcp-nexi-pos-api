import { z } from "zod";
import { simulatorTestCaseNames } from "./simulator-test-cases.js";
import { validateRequestedAmount } from "./utils/amount.js";

export const terminalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, "terminal_id contains invalid characters");
export const externalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, "external_id contains invalid characters");
export const currencyCodeSchema = z.string().trim().length(3).regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 uppercase code");
export const minorUnitAmountSchema = z.number().int().safe().nonnegative();
export const waitSecondsSchema = z.number().int().min(0).max(120).optional();
export const metadataSchema = z.record(z.string(), z.unknown()).optional();
export const simulatorTestCaseInputSchema = z.string().trim().min(1).max(128);

export function validateAmountWithMax(amount: unknown, maxAmountMinor: number): number {
  return validateRequestedAmount(amount, maxAmountMinor);
}

const transactionBaseFields = {
  external_id: externalIdSchema,
  currency: currencyCodeSchema.optional(),
  terminal_id: terminalIdSchema.optional(),
  metadata: metadataSchema,
  wait_seconds: waitSecondsSchema,
};

const purchaseBaseObjectSchema = z.object({
  ...transactionBaseFields,
  requested_amount: minorUnitAmountSchema.optional(),
  test_case: simulatorTestCaseInputSchema.optional().describe(`Nexi simulator/test case name or description. Known names: ${simulatorTestCaseNames().join(", ")}`),
});

const transactionBaseSchema = z.object({
  ...transactionBaseFields,
  requested_amount: minorUnitAmountSchema,
});

export const setTerminalIdInputSchema = z.object({ terminal_id: terminalIdSchema });
export const emptyInputSchema = z.object({}).strict();

export const createPurchaseInputSchema = purchaseBaseObjectSchema.extend({
  cashback_amount: minorUnitAmountSchema.optional(),
});

export const takePaymentInputSchema = purchaseBaseObjectSchema.extend({
  timeout_seconds: z.number().int().min(1).max(300).optional(),
  auto_confirm: z.boolean().optional(),
});

export const createRefundInputSchema = transactionBaseSchema.extend({
  customer_not_present: z.boolean().optional(),
  original_purchase_external_id: externalIdSchema.optional(),
  original_purchase_terminal_id: terminalIdSchema.optional(),
});

export const confirmTransactionInputSchema = z.object({
  external_id: externalIdSchema,
  result_code: z.string().trim().min(1).max(64),
  terminal_id: terminalIdSchema.optional(),
  result_description: z.string().max(512).optional(),
  captured_amount: minorUnitAmountSchema.optional(),
  metadata: metadataSchema,
  commit_window_seconds: z.number().int().min(0).max(86_400).optional(),
  wait_seconds: waitSecondsSchema,
});

export const getTransactionInputSchema = z.object({
  external_id: externalIdSchema,
  terminal_id: terminalIdSchema.optional(),
  wait_seconds: waitSecondsSchema,
});

export const getUnconfirmedTransactionsInputSchema = z.object({
  terminal_id: terminalIdSchema.optional(),
});

export const getTerminalStatusInputSchema = z.object({
  terminal_id: terminalIdSchema.optional(),
});

export const terminalEventTypeSchema = z.enum([
  "eu.npay.api.pos.v0.Transaction",
  "eu.npay.api.pos.v0.TerminalStatus",
]);

export const listTerminalEventsInputSchema = z.object({
  terminal_id: terminalIdSchema.optional(),
  event_type: terminalEventTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  wait_seconds: waitSecondsSchema,
  next_token: z.string().trim().min(1).max(4096).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseInputSchema>;
export type TakePaymentInput = z.infer<typeof takePaymentInputSchema>;
export type CreateRefundInput = z.infer<typeof createRefundInputSchema>;
export type ConfirmTransactionInput = z.infer<typeof confirmTransactionInputSchema>;
export type GetTerminalStatusInput = z.infer<typeof getTerminalStatusInputSchema>;
export type ListTerminalEventsInput = z.infer<typeof listTerminalEventsInputSchema>;
