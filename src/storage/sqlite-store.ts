import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { redactJsonString } from "../utils/redact.js";
import type { StoredTransaction, TransactionIntent, TransactionStore, TransactionUpdate, TransactionType } from "./types.js";

type Statement = {
  run: (...params: unknown[]) => unknown;
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

  updateTransaction(input: TransactionUpdate | unknown): void {
    const raw = input as Record<string, unknown>;
    const transaction = (raw.transaction && typeof raw.transaction === "object" ? raw.transaction : raw) as Record<string, unknown>;
    const externalId = String(transaction.external_id ?? raw.external_id ?? "");
    const terminalId = String(transaction.terminal_id ?? raw.terminal_id ?? "");
    if (!externalId || !terminalId) return;

    this.db.prepare(`
      UPDATE transactions SET
        state = COALESCE(?, state),
        result_code = COALESCE(?, result_code),
        result_description = COALESCE(?, result_description),
        raw_transaction = COALESCE(?, raw_transaction),
        updated_at = ?
      WHERE external_id = ? AND terminal_id = ?
    `).run(
      transaction.state ?? null,
      transaction.result_code ?? null,
      transaction.result_description ?? null,
      redactJsonString(input),
      nowIso(),
      externalId,
      terminalId,
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
