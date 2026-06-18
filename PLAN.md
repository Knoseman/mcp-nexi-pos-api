# MCP Nexi POS API - Implementation Plan

## Goal

Create an MVP MCP server named `mcp-nexi-pos-api` for sending and managing Nexi POS card payments from MCP clients.

The first version focuses on payment operations only. It will not include terminal status, event listing, printing, local storage, mock mode, Docker, or automated simulator tests.

## Important API rules from Nexi docs

- Base URL: `https://api.npay.eu/pos/v1`
- All API operations use `POST`.
- Authentication uses Basic Auth:
  - username = API key id
  - password = API key secret
- Required headers:
  - `Authorization`
  - `User-Agent`
  - `Content-Type: application/json`
  - `Accept: application/json`
- Amounts are integers in ISO 4217 minor units:
  - `SEK 1.00` = `100`
  - `EUR 1.00` = `100`
  - `JPY 1` = `1`
- Floating point numbers must not be sent to Nexi.
- Transaction idempotency is based on `terminal_id` + `external_id`.
- Payment result is not decided by HTTP `200` alone.
- `transaction.result_code === "SUCCESS"` means success.
- Any other `result_code` is a failed payment result.
- Normal purchase flow repeats `/transaction/purchase` while state is `PROCESSING` until `AWAITING_CONFIRM`.
- Confirmation is done with `/transaction/confirm`, but this MVP will only confirm when explicitly requested.

## Technology choice

Use TypeScript/Node.js because it is practical for MCP servers and easy to package.

Core dependencies:

- Official MCP SDK
- `zod` for tool input validation
- Native `fetch` from Node.js
- `dotenv` for local configuration
- `typescript` and `tsx` for development

## Configuration

Environment variables:

```env
NEXI_POS_API_KEY_ID=...
NEXI_POS_API_KEY_SECRET=...
NEXI_POS_BASE_URL=https://api.npay.eu/pos/v1
NEXI_POS_DEFAULT_CURRENCY=SEK
NEXI_POS_MAX_AMOUNT_MINOR=500
NEXI_POS_USER_AGENT=mcp-nexi-pos-api/0.1.0
NEXI_POS_STORAGE_PATH=./data/nexi-pos.sqlite
```

Notes:

- Max amount defaults to `500` minor units. For SEK/EUR this equals `5.00`.
- For currencies with different minor units, the user must configure a suitable `NEXI_POS_MAX_AMOUNT_MINOR` value. The MVP will not do exchange-rate conversion.
- Terminal ID is held in server memory per server session.
- Transaction state is stored locally in SQLite for recovery and reliability.

## MCP tools for v1

### 1. `set_terminal_id`

Set the terminal ID for the current MCP server session.

Input:

```ts
{
  terminal_id: string
}
```

Behavior:

- Stores terminal ID in memory.
- Future tools can omit `terminal_id`.
- Can be overwritten by calling this tool again.

### 2. `get_session_terminal_id`

Return the currently configured terminal ID for the MCP server session.

Input: none.

### 3. `clear_terminal_id`

Clear the current session terminal ID.

Input: none.

### 4. `create_purchase`

Low-level wrapper around `POST /transaction/purchase`.

Input:

```ts
{
  external_id: string,
  requested_amount: number,
  currency?: string,
  terminal_id?: string,
  cashback_amount?: number,
  metadata?: object,
  wait_seconds?: number
}
```

Behavior:

- Uses configured terminal ID if `terminal_id` is omitted.
- Uses default currency `SEK` if omitted.
- Validates amount as integer minor units.
- Blocks amounts above configured max amount.
- Defaults `wait_seconds` to `25` unless supplied.
- Returns simplified transaction summary and raw transaction.

### 5. `take_payment`

High-level payment helper.

Input:

```ts
{
  external_id: string,
  requested_amount: number,
  currency?: string,
  terminal_id?: string,
  metadata?: object,
  timeout_seconds?: number,
  wait_seconds?: number,
  auto_confirm?: boolean
}
```

Behavior:

- Defaults `timeout_seconds` to `15`.
- `timeout_seconds` is a client-side MCP timeout only. It is not a Nexi transaction timeout.
- Defaults `wait_seconds` to `25`, but effective wait must not exceed remaining timeout.
- Saves transaction intent locally before the first Nexi request.
- Calls `/transaction/purchase` repeatedly while state is `PROCESSING` and time remains.
- Stores each returned transaction state in SQLite.
- Returns early if timeout is reached with current state and identifiers.
- Stops when state is `AWAITING_CONFIRM`, `CONFIRMED`, or `COMMITTED`.
- Does not confirm by default.
- If `auto_confirm: true`, calls `/transaction/confirm` after `AWAITING_CONFIRM` using the transaction `result_code`.

Important answer to question 11:

- Based on Nexi docs, clients should repeat the purchase request while `PROCESSING` until `AWAITING_CONFIRM`.
- For this MCP server, `take_payment` should do that only until the configured total timeout.
- If it times out, it returns `external_id`, `terminal_id`, and current state so the user can later call `get_transaction` or `take_payment` again with the same identifiers.

### 6. `create_refund`

Low-level wrapper around `POST /transaction/refund`.

Input:

```ts
{
  external_id: string,
  requested_amount: number,
  currency?: string,
  terminal_id?: string,
  customer_not_present?: boolean,
  original_purchase_external_id?: string,
  original_purchase_terminal_id?: string,
  metadata?: object,
  wait_seconds?: number
}
```

Behavior:

- Same amount, terminal, and currency validation as purchase.
- Does not require stricter confirmation than purchases.

### 7. `confirm_transaction`

Wrapper around `POST /transaction/confirm`.

Input:

```ts
{
  external_id: string,
  result_code: string,
  terminal_id?: string,
  result_description?: string,
  captured_amount?: number,
  metadata?: object,
  commit_window_seconds?: number,
  wait_seconds?: number
}
```

Behavior:

- Used only when explicitly called, unless `take_payment.auto_confirm` is true.
- Supports success and failure confirmation.

### 8. `get_transaction`

Wrapper around `POST /transaction/get`.

Input:

```ts
{
  external_id: string,
  terminal_id?: string,
  wait_seconds?: number
}
```

### 9. `get_unconfirmed_transactions`

Wrapper around `POST /transaction/unconfirmed`.

Input:

```ts
{
  terminal_id?: string
}
```

## Response shape

Each tool should return a clear JSON result:

```ts
{
  ok: boolean,
  operation: string,
  terminal_id?: string,
  external_id?: string,
  state?: string,
  result_code?: string,
  result_description?: string,
  success?: boolean,
  message: string,
  transaction?: object,
  raw?: object
}
```

Rules:

- `success` means `result_code === "SUCCESS"`.
- `ok` means the MCP/API call was handled, not necessarily that the payment succeeded.
- Preserve unknown result/error codes as strings.

## Local storage

Use SQLite for MVP storage.

Default path:

```text
./data/nexi-pos.sqlite
```

Store only payment-relevant and recovery-relevant data:

- `external_id`
- `terminal_id`
- `type` — purchase/refund
- `currency`
- `requested_amount`
- `state`
- `result_code`
- `result_description`
- `confirmed` boolean
- `created_at`
- `updated_at`
- redacted raw transaction JSON

Storage rules:

- Save transaction intent before sending a purchase/refund request to Nexi.
- Update stored state after every Nexi response.
- Mark transaction as confirmed after successful `/transaction/confirm` response.
- Never store API credentials.
- Store redacted transaction JSON only.

This makes the MVP safer and supports recovery after MCP server restart.

## Safety and privacy

- No explicit real-payment confirmation flag.
- No production-blocking environment variable.
- Enforce max amount limit from config, default `500` minor units.
- Redact sensitive/card-related fields in logs:
  - `card_number_customer`
  - `card_number_merchant`
  - `card_token`
  - `par_value`
  - authorization header
  - API secrets
- Do not log full raw responses by default.

## Project structure

```text
mcp-nexi-pos-api/
  package.json
  tsconfig.json
  README.md
  .env.example
  src/
    index.ts
    config.ts
    nexi-client.ts
    schemas.ts
    storage/
      sqlite-store.ts
      types.ts
    tools/
      terminal-session.ts
      purchase.ts
      refund.ts
      confirm.ts
      transaction.ts
    utils/
      amount.ts
      redact.ts
      errors.ts
```

## Implementation phases

### Phase 1: Project setup

- Initialize TypeScript Node project.
- Add MCP SDK, zod, dotenv.
- Add build/dev scripts.
- Add `.env.example`.

### Phase 2: Nexi API client

- Implement typed `post` helper.
- Add Basic Auth.
- Add user agent.
- Add JSON validation.
- Add safe error handling for Nexi error responses.
- Respect `Retry-After` only in client helper where useful.

### Phase 3: SQLite storage

- Create SQLite database file automatically.
- Create transactions table.
- Add functions to save intent, update transaction, mark confirmed, and list local unconfirmed records.
- Store redacted raw transaction JSON.

### Phase 4: Validation helpers

- Validate terminal ID format.
- Validate external ID format.
- Validate currency code.
- Validate amount as integer minor units.
- Enforce max amount limit.

### Phase 5: MCP tools

- Implement `set_terminal_id`, `get_session_terminal_id`, and `clear_terminal_id`.
- Implement low-level transaction tools.
- Implement `take_payment` loop with 15-second default timeout.

### Phase 6: Documentation

- README with setup, env vars, Claude Desktop config, and examples.
- Explain amount format clearly.
- Explain payment flow and confirmation.
- Explain local SQLite storage and recovery limits.
- Add manual recovery workflow:
  1. call `get_session_terminal_id`
  2. call `get_transaction`
  3. call `get_unconfirmed_transactions`
  4. call `confirm_transaction` when needed
- Explain simulator amount examples.

## Open decisions

1. Packaging: npm package, Docker, and GitHub Actions are not decided. Recommendation for MVP: local npm-based MCP server only.
2. SQLite improves recovery, but full production-grade transactional reliability still needs careful operational testing.
3. `continue_transaction`, terminal status, events, and printing are deferred.
