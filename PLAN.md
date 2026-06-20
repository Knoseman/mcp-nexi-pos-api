# MCP Nexi POS API - Improvement Plan

## Goal

Improve the existing `mcp-nexi-pos-api` MCP server while keeping the current API methods only:

- `set_terminal_id`
- `get_session_terminal_id`
- `clear_terminal_id`
- `create_purchase`
- `take_payment`
- `create_refund`
- `confirm_transaction`
- `get_transaction`
- `get_unconfirmed_transactions`

The focus is reliability, safety, recovery, better configuration, and easier debugging. No new payment API methods will be added in this work.

## Current review summary

The project builds successfully with `npm run build`.

Main issues found:

1. Terminal ID is not supported in `.env`, even though it belongs with the API key and secret provisioning flow.
2. `take_payment` forwards MCP-only fields such as `timeout_seconds` and `auto_confirm` to Nexi because it spreads the whole input object.
3. Validation schemas are duplicated between `src/schemas.ts` and `src/tools/index.ts`.
4. Nexi API errors lose useful safe details before they reach the user.
5. HTTP requests do not have a hard request timeout.
6. SQLite recovery only updates known transactions; it does not insert transactions found later by `get_transaction`.
7. Idempotency reuse is not guarded locally.
8. `wait_seconds: 0` can cause fast polling loops.
9. Version values are inconsistent between `package.json`, server metadata, and user agent defaults.
10. There are no automated tests.

## User experience review summary

From a user perspective, the server should feel less like a low-level developer wrapper and more like a guided payment assistant.

User-friendly improvements to include:

1. Make setup clearer with a minimum working `.env` example.
2. Improve common error messages with likely causes and next steps.
3. Add `next_action` guidance to tool responses.
4. Reduce response noise by returning a clear payment summary before raw data.
5. Make `take_payment` the recommended normal purchase tool.
6. Make confirmation status clearer, especially when a transaction is `AWAITING_CONFIRM`.
7. Explain `external_id` and idempotency in user terms.
8. Add troubleshooting for common payment and setup problems.
9. Improve MCP tool descriptions so AI clients choose the right tool.
10. Add simple examples for common tasks like taking and confirming a 5 SEK payment.

## Terminal ID configuration

Add this environment variable:

```env
NEXI_POS_TERMINAL_ID=your-terminal-id
```

Rules:

- This variable is optional.
- It must not have a default value.
- If set, it is used as the fallback terminal ID when a tool omits `terminal_id` and no session terminal ID has been set.
- Explicit tool input `terminal_id` has highest priority.
- Session terminal ID set by `set_terminal_id` has second priority.
- `NEXI_POS_TERMINAL_ID` has third priority.
- If none are available, return the current clear error: `terminal_id is required...`.

Resolution order:

```text
input.terminal_id -> session terminal ID -> NEXI_POS_TERMINAL_ID -> error
```

Files to update:

- `.env.example`
- `README.md`
- `src/config.ts`
- `src/tools/index.ts`
- tests

## Terminal/API key generation feature evaluation

The Nexi API documentation offers a provisioning feature that can generate a terminal ID, API key ID, and API key secret together.

Decision for this improvement round: **keep this outside the MCP server**.

Reasons:

- The current server scope is payment operations only.
- Credential and terminal provisioning is an administrative/setup concern, not a normal payment action.
- Provisioning likely needs different permissions and a different security model than payment tools.
- Exposing credential generation through an MCP tool could increase the risk of accidental credential creation or leakage.
- The generated API secret must be handled with extra care and should not be returned casually into chat history.

Recommended future option:

- Add a separate setup CLI command or separate admin MCP server later, if needed.
- Keep it disabled by default.
- Require explicit operator confirmation.
- Write generated values directly to a secure target, such as a local `.env` file or secret manager, instead of returning secrets in normal tool output.

No credential/terminal generation tool will be added now.

## Implementation phases

### Phase 1: Configuration and docs

Tasks:

1. Add optional `terminalId?: string` to `AppConfig`.
2. Add `NEXI_POS_TERMINAL_ID` to the config schema without a default.
3. Trim and validate it when present.
4. Update terminal resolution to use config fallback.
5. Update `.env.example` with `NEXI_POS_TERMINAL_ID=your-terminal-id`.
6. Update README:
   - env variable table
   - setup examples
   - terminal ID resolution order
   - note that terminal ID is generated together with API key ID and API key secret
   - note that provisioning stays outside this MCP server for now

Acceptance criteria:

- Server starts without `NEXI_POS_TERMINAL_ID`.
- Tools can use `NEXI_POS_TERMINAL_ID` when no session/input terminal is set.
- Input terminal still overrides session/config terminal.
- README documents no default terminal ID.

### Phase 2: Explicit Nexi request bodies

Problem:

Some tools forward internal MCP fields to Nexi via object spread.

Tasks:

1. Add request body builder helpers, for example:
   - `buildPurchaseRequest(input, terminalId, currency, waitSeconds)`
   - `buildRefundRequest(...)`
   - `buildConfirmRequest(...)`
   - `buildGetTransactionRequest(...)`
   - `buildGetUnconfirmedRequest(...)`
2. Include only fields that belong to the Nexi API call.
3. Do not send MCP-only fields:
   - `timeout_seconds`
   - `auto_confirm`
4. Preserve supported current API fields:
   - `external_id`
   - `requested_amount`
   - `currency`
   - `terminal_id`
   - `cashback_amount`
   - `metadata`
   - `wait_seconds`
   - `customer_not_present`
   - `original_purchase_external_id`
   - `original_purchase_terminal_id`
   - `result_code`
   - `result_description`
   - `captured_amount`
   - `commit_window_seconds`

Acceptance criteria:

- No MCP-only field is sent to Nexi.
- Existing tool interfaces remain unchanged.
- Tests verify exact request bodies.

### Phase 3: Shared schemas

Problem:

`src/schemas.ts` and `src/tools/index.ts` define similar but not identical schemas.

Tasks:

1. Move all tool input schema definitions to `src/schemas.ts`.
2. Import schemas into `src/tools/index.ts`.
3. Remove duplicated local schemas from the tool file.
4. Ensure all schemas use the stricter existing rules:
   - terminal ID format
   - external ID format
   - uppercase ISO currency code
   - safe integer amounts
   - bounded wait seconds
   - bounded metadata if added in Phase 9
5. Keep exported TypeScript types from schemas.

Acceptance criteria:

- One source of truth for input validation.
- Build passes.
- Tests confirm invalid IDs/currencies/amounts are rejected.

### Phase 4: Better error responses

Problem:

`NexiApiError` contains safe details, but tool responses only return `message`.

Tasks:

1. Extend `ToolResult` with optional error fields:

```ts
error?: {
  name?: string,
  status?: number,
  statusText?: string,
  retryAfter?: string | null,
  body?: unknown
}
```

2. Update `errorResult()` to include safe details from `NexiApiError`.
3. Use existing redaction for error bodies.
4. Do not include credentials, auth headers, or full card values.
5. Keep `message` short and human-readable.

Acceptance criteria:

- HTTP errors return status and sanitized body when available.
- Sensitive values are redacted.
- Existing response shape still has `ok`, `operation`, and `message`.

### Phase 5: Request timeout support

Tasks:

1. Add config variable:

```env
NEXI_POS_REQUEST_TIMEOUT_SECONDS=30
```

2. Add default in config, for example `30` seconds.
3. Use `AbortController` in `postNexi()`.
4. Respect caller-provided abort signals if added later.
5. Return a clear timeout error.
6. Ensure `take_payment` total timeout still controls the whole polling flow.

Acceptance criteria:

- A stalled HTTP request is aborted.
- Timeout error is clear in MCP response.
- `take_payment.timeout_seconds` and HTTP request timeout work together safely.

### Phase 6: SQLite recovery upsert

Problem:

`updateTransaction()` only updates existing rows. A transaction found by `get_transaction` may not be stored if no local intent exists.

Tasks:

1. Change `updateTransaction()` to insert or update by `(external_id, terminal_id)`.
2. Derive fields from the Nexi transaction when possible:
   - `type`
   - `currency`
   - `requested_amount`
   - `state`
   - `result_code`
   - `result_description`
3. Preserve existing intent values when the response lacks fields.
4. Store redacted raw transaction JSON.
5. Update `confirmed` when state is `CONFIRMED` or `COMMITTED`, if that is correct for Nexi semantics.
6. Keep `markConfirmed()` after explicit confirm calls.

Acceptance criteria:

- `get_transaction` can populate local storage for a transaction not already stored.
- Existing intent records are not overwritten with weaker/missing values.
- Local unconfirmed list remains useful after restart.

### Phase 7: Local idempotency protection

Problem:

Nexi idempotency is based on `terminal_id + external_id`. Reusing the same pair with different amount, currency, or type is dangerous/confusing.

Tasks:

1. Add a store method to get an existing transaction by `(external_id, terminal_id)`.
2. Before saving a purchase/refund intent, compare existing values:
   - `type`
   - `currency`
   - `requested_amount`
3. If values differ, block the request with a clear error.
4. If values match, allow retry/polling.
5. Include guidance in the error message to use a new `external_id` for a new transaction.

Acceptance criteria:

- Same ID and same amount/currency/type can be retried.
- Same ID with different amount/currency/type is blocked locally.
- Tests cover allowed retry and blocked mismatch.

### Phase 8: Polling safety and wait handling

Problem:

`wait_seconds: 0` can cause fast repeated calls while `PROCESSING`.

Tasks:

1. Decide safe schema rule:
   - Preferred: set `wait_seconds` minimum to `1` for payment/refund calls.
   - Or allow `0`, but add a local sleep/backoff between loops.
2. Recommended implementation:
   - Keep Nexi `wait_seconds` min as `0` only if the API requires it.
   - In `take_payment`, always sleep at least 250-500 ms between repeated `PROCESSING` calls if the previous call returned immediately.
3. Ensure effective `wait_seconds` never exceeds remaining `timeout_seconds`.
4. Avoid calling Nexi with `wait_seconds: 0` repeatedly in a tight loop.

Acceptance criteria:

- `take_payment` cannot busy-loop.
- Total timeout is still respected.
- Tests cover quick `PROCESSING` responses.

### Phase 9: Version consistency

Problem:

`package.json` says `0.1.1`, while server metadata and default user agent say `0.1.0`.

Tasks:

1. Choose one source of truth.
2. Recommended simple approach:
   - Update constants to current package version when releasing.
   - Set server version and default user agent to `0.1.1` now.
3. Better future approach:
   - Import package metadata during build/runtime, if clean with NodeNext.
4. Update README and `.env.example` user agent examples.

Acceptance criteria:

- Package version, server version, and default user agent match.
- README examples match code.

### Phase 10: Automated tests

Tasks:

1. Add a test framework, recommended `vitest`.
2. Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

3. Add unit tests for:
   - config loading
   - terminal resolution order
   - amount validation and max amount
   - schema validation
   - redaction
   - Nexi request body builders
   - HTTP error shaping
   - request timeout behavior with mocked fetch
   - `take_payment` polling and auto-confirm
   - SQLite save/update/upsert/idempotency behavior
4. Use temporary SQLite files for storage tests.
5. Mock `fetch` for all Nexi client/tool tests.
6. Do not use real API credentials in tests.

Acceptance criteria:

- `npm test` passes locally.
- `npm run build` still passes.
- Tests do not call real Nexi endpoints.

### Phase 11: User-friendly tool responses and tool descriptions

Tasks:

1. Extend `ToolResult` with optional user-facing fields:

```ts
summary?: {
  amount?: number,
  currency?: string,
  state?: string,
  result_code?: string,
  reference?: string,
  masked_card?: string,
  authorized_amount?: number,
  captured_amount?: number
},
next_action?: string,
user_message?: string
```

2. Keep `raw` available for debugging and integrations, but make the top-level response easy to read.
3. Add `next_action` values based on state:
   - `AWAITING_CONFIRM`: `Call confirm_transaction to complete the transaction.`
   - `PROCESSING`: `Call take_payment again or get_transaction later with the same external_id.`
   - `CONFIRMED` or `COMMITTED`: `No action needed.`
   - failed result code: `Review result_code/result_description and do not confirm as success.`
4. Add a clear warning when state is `AWAITING_CONFIRM`:
   - The customer/card step succeeded, but the transaction is not complete until confirmed.
5. Improve missing terminal ID error:
   - Explain the three choices: pass `terminal_id`, call `set_terminal_id`, or set `NEXI_POS_TERMINAL_ID`.
6. Improve amount errors:
   - Explain minor units, for example `5.00 SEK = 500`.
7. Improve HTTP 401/403 errors:
   - Explain that credentials may be wrong, expired, or not allowed for the terminal.
8. Improve idempotency mismatch errors:
   - Explain that `external_id` must not be reused for a different amount/currency/type.
9. Improve MCP tool descriptions:
   - Mark `take_payment` as the normal purchase tool.
   - Mark `create_purchase` as a low-level/manual tool.
   - Mention minor-unit amounts in payment/refund tool descriptions.
   - Mention that confirmation is required after `AWAITING_CONFIRM`.

Acceptance criteria:

- Normal responses show a short useful summary without requiring users to inspect `raw`.
- Responses guide the next action.
- Common errors include practical next steps.
- AI clients are more likely to choose `take_payment` for normal payments.

### Phase 12: README improvements

Tasks:

1. Update setup section with `NEXI_POS_TERMINAL_ID`.
2. Add a minimum working `.env` example:
   - `NEXI_POS_API_KEY_ID`
   - `NEXI_POS_API_KEY_SECRET`
   - `NEXI_POS_TERMINAL_ID`
   - optional base URL and safety settings
3. Explain terminal ID lifecycle:
   - generated with API key ID and API key secret
   - optional env fallback
   - can still be set per session or per tool call
4. Add warning that credential/terminal generation is outside this MCP server for now.
5. Make `take_payment` the recommended normal purchase flow.
6. Explain `external_id` in plain language:
   - It is your unique order/payment ID.
   - Reuse it only for retrying the same transaction.
   - Use a new value for a new amount or new order.
7. Add troubleshooting section:
   - HTTP 401/403
   - terminal ID missing
   - amount exceeds max
   - transaction stuck in `PROCESSING`
   - transaction awaiting confirm
   - reused `external_id`
8. Add examples for:
   - take 5 SEK payment
   - confirm last payment
   - refund 5 SEK
   - purchase with env terminal
   - purchase with explicit terminal
   - recovery after restart
9. Add a short response guide that explains:
   - `ok`
   - `success`
   - `state`
   - `result_code`
   - `next_action`

Acceptance criteria:

- A new user can configure and run the server without guessing where terminal ID belongs.
- Troubleshooting explains the common errors seen during testing.
- Users understand when a payment is approved but not yet confirmed.
- Users understand amount format and `external_id` reuse rules.

## Future user-friendly setup helper

Consider adding a setup helper later, outside the current payment API method scope.

Possible command:

```bash
mcp-nexi-pos-api doctor
```

It could check:

- API key ID is present, without printing it.
- API key secret is present, without printing it.
- terminal ID is present.
- base URL is set.
- max amount safety limit is set.
- SQLite storage path is writable.
- package/server version.

This should be a CLI helper, not a Nexi payment tool, and should not generate credentials.

## Suggested implementation order

1. Phase 1: Config and README terminal ID support.
2. Phase 2: Explicit Nexi request bodies.
3. Phase 3: Shared schemas.
4. Phase 4: Better error responses.
5. Phase 5: Request timeouts.
6. Phase 6: SQLite upsert recovery.
7. Phase 7: Idempotency protection.
8. Phase 8: Polling safety.
9. Phase 9: Version cleanup.
10. Phase 10: Tests.
11. Phase 11: User-friendly responses and tool descriptions.
12. Phase 12: Final README polish.

## Non-goals for this round

- Do not add new Nexi payment API methods.
- Do not add credential or terminal generation as an MCP tool.
- Do not add printing, terminal status, events, Docker, or credential generation.
- Do not add a setup/doctor CLI in this round.
- Do not change the public tool names.
- Do not require `NEXI_POS_TERMINAL_ID`; it is an optional fallback.

## Final acceptance checklist

- `npm run build` passes.
- `npm test` passes.
- Existing tool names and inputs remain compatible.
- No MCP-only fields are sent to Nexi.
- Terminal ID can come from input, session, or optional env fallback.
- No default terminal ID exists in code or docs.
- Error responses include useful safe diagnostics.
- Requests have timeouts.
- SQLite can recover transactions not created in the current process.
- Idempotency mismatch is blocked locally.
- Polling cannot busy-loop.
- Tool responses include clear summaries and next-action guidance.
- Tool descriptions guide AI clients toward the safest normal flow.
- README and `.env.example` match implementation.

## Implementation status - 2026-06-20

Implemented in this round:

- Optional `NEXI_POS_TERMINAL_ID` config with no default.
- Terminal resolution fallback: tool input -> session terminal -> env terminal -> clear error.
- `NEXI_POS_REQUEST_TIMEOUT_SECONDS` config and request abort timeout.
- Version consistency to `0.1.1` in code and docs.
- Shared tool schemas from `src/schemas.ts`.
- Explicit Nexi request body builders so MCP-only fields are not sent to Nexi.
- Better tool errors with safe Nexi error details.
- User-friendly response fields: `summary`, `user_message`, and `next_action`.
- SQLite transaction upsert for recovery.
- Local idempotency mismatch protection.
- Polling safety delay in `take_payment`.
- README user experience improvements and troubleshooting.
- Basic automated tests using Node's built-in test runner.

Validation:

- `npm run build` passed.
- `npm test` passed.
