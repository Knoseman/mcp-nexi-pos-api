export type TransactionType = "purchase" | "refund";

export interface TransactionIntent {
  external_id: string;
  terminal_id: string;
  type: TransactionType;
  currency: string;
  requested_amount: number;
  metadata?: Record<string, unknown>;
}

export interface TransactionUpdate {
  external_id: string;
  terminal_id: string;
  state?: string;
  result_code?: string;
  result_description?: string;
  raw_transaction?: unknown;
}

export interface StoredTransaction {
  external_id: string;
  terminal_id: string;
  type: TransactionType;
  currency: string;
  requested_amount: number;
  state: string | null;
  result_code: string | null;
  result_description: string | null;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
  raw_transaction: unknown;
}

export interface TransactionStore {
  saveIntent(intent: TransactionIntent): void;
  updateTransaction(update: TransactionUpdate | unknown): void;
  markConfirmed(external_id: string, terminal_id: string): void;
  listLocalUnconfirmed(terminal_id?: string): StoredTransaction[];
  close(): void;
}
