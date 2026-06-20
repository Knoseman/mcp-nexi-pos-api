import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { redactJsonString } from "../utils/redact.js";
import type { StoredTransaction, TransactionIntent, TransactionStore, TransactionUpdate, TransactionType } from "./types.js";

type Statement = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
};

type Database = {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  close: () => void;
};

type DatabaseFactory = new (path: string) => Database;

function loadDatabase(): DatabaseFactory {
  const require = createRequire(import.meta.url);
  const required = require("better-sqlite3") as { default?: DatabaseFactory } | DatabaseFactory;
  if (typeof required === "function") return required;
  if (required.default) return required.default;
  throw new Error("better-sqlite3 did not export a database constructor");
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRaw(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findValue(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] != null) return record[key];
    }
  }
  return undefined;
}

function findRecord(records: Record<string, unknown>[], keys: string[]): Record<string, unknown> | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (isRecord(value)) return value;
    }
  }
  return undefined;
}

function normalizeTransactionType(value: unknown): TransactionType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized.includes("refund")) return "refund";
  if (normalized.includes("purchase") || normalized.includes("payment")) return "purchase";
  return undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim().toUpperCase();
}

function normalizeAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return Math.trunc(amount);
  }
  return undefined;
}

function extractAmount(records: Record<string, unknown>[]): number | undefined {
  const directAmount = normalizeAmount(findValue(records, ["requested_amount", "requestedAmount", "minor_units", "minorUnits"]));
  if (directAmount != null) return directAmount;

  const amountValue = normalizeAmount(findValue(records, ["amount"]));
  if (amountValue != null) return amountValue;

  const amountRecord = findRecord(records, ["amount", "requested_amount", "requestedAmount"]);
  if (!amountRecord) return undefined;
  return normalizeAmount(findValue([amountRecord], ["value", "amount", "minor_units", "minorUnits"]));
}

function extractIntentFields(records: Record<string, unknown>[]): Pick<TransactionIntent, "type" | "currency" | "requested_amount"> | null {
  const amountRecord = findRecord(records, ["amount", "requested_amount", "requestedAmount"]);
  const searchRecords = amountRecord ? [...records, amountRecord] : records;
  const type = normalizeTransactionType(findValue(searchRecords, ["type", "transaction_type", "transactionType", "operation", "operation_type"]));
  const currency = normalizeCurrency(findValue(searchRecords, ["currency", "currency_code", "currencyCode", "requested_currency", "requestedCurrency"]));
  const requested_amount = extractAmount(records);

  if (type && currency && requested_amount != null) return { type, currency, requested_amount };
  return null;
}

function isConfirmedState(state: unknown): boolean {
  if (typeof state !== "string") return false;
  return ["CONFIRMED", "COMMITTED"].includes(state.toUpperCase());
}

function toStored(row: Record<string, unknown>): StoredTransaction {
  return {
    external_id: String(row.external_id),
    terminal_id: String(row.terminal_id),
    type: row.type as TransactionType,
    currency: String(row.currency),
    requested_amount: Number(row.requested_amount),
    state: row.state == null ? null : String(row.state),
    result_code: row.result_code == null ? null : String(row.result_code),
    result_description: row.result_description == null ? null : String(row.result_description),
    confirmed: Boolean(row.confirmed),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    raw_transaction: parseRaw(row.raw_transaction),
  };
}

export class SqliteTransactionStore implements TransactionStore {
  private db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const DatabaseCtor = loadDatabase();
    this.db = new DatabaseCtor(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        external_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        type TEXT NOT NULL,
        currency TEXT NOT NULL,
        requested_amount INTEGER NOT NULL,
        state TEXT,
        result_code TEXT,
        result_description TEXT,
        confirmed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        raw_transaction TEXT,
        PRIMARY KEY (external_id, terminal_id)
      )
    `);
  }

  saveIntent(intent: TransactionIntent): void {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO transactions (external_id, terminal_id, type, currency, requested_amount, state, confirmed, created_at, updated_at, raw_transaction)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(external_id, terminal_id) DO UPDATE SET
        type = excluded.type,
        currency = excluded.currency,
        requested_amount = excluded.requested_amount,
        updated_at = excluded.updated_at
    `).run(
      intent.external_id,
      intent.terminal_id,
      intent.type,
      intent.currency,
      intent.requested_amount,
      "INTENT",
      timestamp,
      timestamp,
      redactJsonString({ metadata: intent.metadata ?? {} }),
    );
  }

  getTransaction(external_id: string, terminal_id: string): StoredTransaction | null {
    const row = this.db.prepare("SELECT * FROM transactions WHERE external_id = ? AND terminal_id = ?").get(external_id, terminal_id);
    return row ? toStored(row) : null;
  }

  updateTransaction(input: TransactionUpdate | unknown): void {
    const raw = isRecord(input) ? input : {};
    const transaction = isRecord(raw.transaction) ? raw.transaction : raw;
    const externalId = String(transaction.external_id ?? raw.external_id ?? "");
    const terminalId = String(transaction.terminal_id ?? raw.terminal_id ?? "");
    if (!externalId || !terminalId) return;

    const existing = this.getTransaction(externalId, terminalId);
    const extractedIntent = extractIntentFields([transaction, raw]);
    const type = extractedIntent?.type ?? existing?.type;
    const currency = extractedIntent?.currency ?? existing?.currency;
    const requestedAmount = extractedIntent?.requested_amount ?? existing?.requested_amount;
    if (!type || !currency || requestedAmount == null) return;

    const state = transaction.state ?? raw.state ?? null;
    const confirmed = isConfirmedState(state) ? 1 : 0;
    const timestamp = nowIso();

    this.db.prepare(`
      INSERT INTO transactions (
        external_id, terminal_id, type, currency, requested_amount, state, result_code, result_description,
        confirmed, created_at, updated_at, raw_transaction
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id, terminal_id) DO UPDATE SET
        type = COALESCE(excluded.type, transactions.type),
        currency = COALESCE(excluded.currency, transactions.currency),
        requested_amount = COALESCE(excluded.requested_amount, transactions.requested_amount),
        state = COALESCE(excluded.state, transactions.state),
        result_code = COALESCE(excluded.result_code, transactions.result_code),
        result_description = COALESCE(excluded.result_description, transactions.result_description),
        confirmed = CASE WHEN excluded.confirmed = 1 THEN 1 ELSE transactions.confirmed END,
        raw_transaction = COALESCE(excluded.raw_transaction, transactions.raw_transaction),
        updated_at = excluded.updated_at
    `).run(
      externalId,
      terminalId,
      type,
      currency,
      requestedAmount,
      state,
      transaction.result_code ?? raw.result_code ?? null,
      transaction.result_description ?? raw.result_description ?? null,
      confirmed,
      timestamp,
      timestamp,
      redactJsonString(input),
    );
  }

  markConfirmed(external_id: string, terminal_id: string): void {
    this.db.prepare(`
      UPDATE transactions SET confirmed = 1, state = COALESCE(state, 'CONFIRMED'), updated_at = ?
      WHERE external_id = ? AND terminal_id = ?
    `).run(nowIso(), external_id, terminal_id);
  }

  listLocalUnconfirmed(terminal_id?: string): StoredTransaction[] {
    const rows = terminal_id
      ? this.db.prepare("SELECT * FROM transactions WHERE confirmed = 0 AND terminal_id = ? ORDER BY updated_at DESC").all(terminal_id)
      : this.db.prepare("SELECT * FROM transactions WHERE confirmed = 0 ORDER BY updated_at DESC").all();
    return rows.map(toStored);
  }

  close(): void {
    this.db.close();
  }
}

export class SQLiteStore extends SqliteTransactionStore {}

export function createSqliteTransactionStore(path: string): TransactionStore {
  return new SqliteTransactionStore(path);
}
