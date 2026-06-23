# mcp-nexi-pos-api

MVP MCP server for Nexi POS payment operations.

It provides tools to create purchases and refunds, poll payment state, confirm transactions, recover unconfirmed transactions, check terminal status, and list terminal events.

## Setup

### From npm package

```bash
npm install -g mcp-nexi-pos-api
mcp-nexi-pos-api
```

### From source

```bash
npm install
npm run build
npm start
```

### Minimum working config

You need Nexi POS API credentials before you can use the server:

- `NEXI_POS_API_KEY_ID`
- `NEXI_POS_API_KEY_SECRET`
- a Nexi POS terminal ID

The terminal ID is generated together with the API key ID and API key secret. Credential and terminal generation is outside this MCP server for now. Get these values from Nexi API documentation before starting the server.

The smallest useful `.env` file is:

```env
NEXI_POS_API_KEY_ID=your-api-key-id
NEXI_POS_API_KEY_SECRET=your-api-key-secret
NEXI_POS_TERMINAL_ID=your-terminal-id
```

`NEXI_POS_TERMINAL_ID` is optional. It is used as an environment fallback when a tool call does not include `terminal_id` and no session terminal has been set with `set_terminal_id`. It has no default value.

A fuller local `.env` file can include:

```env
NEXI_POS_API_KEY_ID=your-api-key-id
NEXI_POS_API_KEY_SECRET=your-api-key-secret
NEXI_POS_TERMINAL_ID=your-terminal-id
NEXI_POS_BASE_URL=https://api.sandbox.npay.eu/pos/v1
NEXI_POS_DEFAULT_CURRENCY=SEK
NEXI_POS_MAX_AMOUNT_MINOR=100021
NEXI_POS_USER_AGENT=mcp-nexi-pos-api/0.1.3
NEXI_POS_STORAGE_PATH=./data/nexi-pos.sqlite
NEXI_POS_REQUEST_TIMEOUT_SECONDS=30
```

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `NEXI_POS_API_KEY_ID` | Nexi Basic Auth username. Generated outside this MCP server. | Required |
| `NEXI_POS_API_KEY_SECRET` | Nexi Basic Auth password. Generated outside this MCP server. | Required |
| `NEXI_POS_TERMINAL_ID` | Optional terminal ID fallback when no tool `terminal_id` or session terminal ID is available. Generated with the API credentials. | No default |
| `NEXI_POS_BASE_URL` | Nexi POS API base URL. | `https://api.sandbox.npay.eu/pos/v1` |
| `NEXI_POS_DEFAULT_CURRENCY` | Currency used when a tool omits `currency`. | `SEK` |
| `NEXI_POS_MAX_AMOUNT_MINOR` | Safety limit in minor units. Defaults high enough for Nexi test-case amounts. | `100021` |
| `NEXI_POS_USER_AGENT` | User agent sent to Nexi. | `mcp-nexi-pos-api/0.1.3` |
| `NEXI_POS_STORAGE_PATH` | SQLite file for local recovery state. | `./data/nexi-pos.sqlite` |
| `NEXI_POS_REQUEST_TIMEOUT_SECONDS` | Hard timeout for each HTTP request to Nexi. | `30` |

## Claude Desktop config

Minimum example for a global npm install:

```json
{
  "mcpServers": {
    "nexi-pos": {
      "command": "mcp-nexi-pos-api",
      "env": {
        "NEXI_POS_API_KEY_ID": "your-api-key-id",
        "NEXI_POS_API_KEY_SECRET": "your-api-key-secret",
        "NEXI_POS_TERMINAL_ID": "your-terminal-id"
      }
    }
  }
}
```

Fuller example for a global npm install:

```json
{
  "mcpServers": {
    "nexi-pos": {
      "command": "mcp-nexi-pos-api",
      "env": {
        "NEXI_POS_API_KEY_ID": "your-api-key-id",
        "NEXI_POS_API_KEY_SECRET": "your-api-key-secret",
        "NEXI_POS_TERMINAL_ID": "your-terminal-id",
        "NEXI_POS_BASE_URL": "https://api.sandbox.npay.eu/pos/v1",
        "NEXI_POS_DEFAULT_CURRENCY": "SEK",
        "NEXI_POS_MAX_AMOUNT_MINOR": "100021",
        "NEXI_POS_STORAGE_PATH": "/absolute/path/to/data/nexi-pos.sqlite"
      }
    }
  }
}
```

Example from source:

```json
{
  "mcpServers": {
    "nexi-pos": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-nexi-pos-api/dist/index.js"],
      "env": {
        "NEXI_POS_API_KEY_ID": "your-api-key-id",
        "NEXI_POS_API_KEY_SECRET": "your-api-key-secret",
        "NEXI_POS_TERMINAL_ID": "your-terminal-id"
      }
    }
  }
}
```

## Amount format

All amounts are integers in ISO 4217 minor units. Do not send floating point values.

Examples:

- `SEK 1.00` = `100`
- `EUR 1.00` = `100`
- `JPY 1` = `1`

The default max amount is `100021`, meaning SEK/EUR `1000.21`. This allows the documented Nexi simulator/test-case amounts. Set `NEXI_POS_MAX_AMOUNT_MINOR` to a lower value if your environment should block larger test amounts.

## External IDs

`external_id` is your unique order or payment ID. Use a value that lets you find the payment later, for example `order-1001-payment-1`.

Rules:

- Use one unique `external_id` for one transaction.
- Reuse the same `external_id` only when retrying the same transaction after a timeout, restart, or network problem.
- Use a new `external_id` for a new order, a new payment attempt, or a different amount.

Reusing an old `external_id` for a different amount or order can return the old transaction or fail because Nexi treats it as the same transaction request.

## Tools

- `set_terminal_id` - store a terminal ID for this MCP server session.
- `get_session_terminal_id` - show the current session terminal ID.
- `clear_terminal_id` - clear the session terminal ID.
- `list_test_cases` - list documented Nexi simulator/test cases and their trigger amounts.
- `create_purchase` - low-level purchase call. Can use `requested_amount` or named `test_case`.
- `take_payment` - recommended normal purchase flow. It creates/polls a purchase until Nexi leaves `PROCESSING` or the timeout is reached. Can use `requested_amount` or named `test_case`.
- `create_refund` - low-level refund call.
- `confirm_transaction` - confirm a purchase or refund result.
- `get_transaction` - fetch a transaction by `external_id` and terminal.
- `get_unconfirmed_transactions` - list unconfirmed transactions for a terminal.
- `get_terminal_status` - fetch terminal connection, transaction state, screen, and battery status.
- `list_terminal_events` - list terminal event stream entries, optionally filtered by event type.

## Response guide

All tool responses use this JSON shape:

```json
{
  "ok": true,
  "operation": "take_payment",
  "terminal_id": "terminal-1",
  "external_id": "order-123",
  "state": "AWAITING_CONFIRM",
  "result_code": "SUCCESS",
  "result_description": "Approved",
  "success": true,
  "message": "Payment flow stopped at terminal/current state",
  "user_message": "The card step succeeded, but the transaction is not complete until it is confirmed.",
  "next_action": "Call confirm_transaction to complete the transaction.",
  "summary": {
    "amount": 500,
    "currency": "SEK",
    "state": "AWAITING_CONFIRM",
    "result_code": "SUCCESS",
    "reference": "reference-from-nexi",
    "masked_card": "************0010"
  },
  "transaction": {},
  "raw": {}
}
```

Field meanings:

- `ok`: the MCP tool call was handled. It does not always mean that the card payment succeeded.
- `success`: the payment/refund result was successful. This is true only when `result_code` is `SUCCESS`.
- `state`: the current Nexi transaction state, for example `PROCESSING`, `AWAITING_CONFIRM`, `CONFIRMED`, or `COMMITTED`.
- `result_code`: the payment/refund result from Nexi, when available.
- `summary`: short user-friendly payment details. Use this before inspecting `raw`.
- `user_message`: important human-readable warning or context.
- `next_action`: suggested next step, for example poll again, confirm, or no action needed.
- `test_case`: included when `requested_amount` matches a documented Nexi simulator/test case, or when `test_case` was used as input.
- `raw`: full Nexi response for debugging and integrations.

## Normal payment flow

For most clients, use `take_payment` for purchases. It calls Nexi purchase repeatedly while the state is `PROCESSING`, until the total `timeout_seconds` is reached or Nexi returns a later state such as `AWAITING_CONFIRM`, `CONFIRMED`, or `COMMITTED`.

You can provide the terminal in three ways:

1. pass `terminal_id` in the tool call;
2. call `set_terminal_id` once for the session;
3. set `NEXI_POS_TERMINAL_ID` as an environment fallback.

Recommended flow:

1. Start a payment with `take_payment`.
2. If the response state is `AWAITING_CONFIRM`, call `confirm_transaction` when your business flow is ready.
3. If the response is still `PROCESSING`, retry later with the same `external_id` and terminal ID.

## Examples

### Take a 5 SEK payment

Tool: `take_payment`

```json
{
  "external_id": "order-1001-payment-1",
  "requested_amount": 500,
  "currency": "SEK",
  "timeout_seconds": 60
}
```

### Run a named Nexi test case

Tool: `take_payment`

```json
{
  "external_id": "test-issuer-error-1",
  "test_case": "issuer_error",
  "currency": "SEK",
  "timeout_seconds": 60
}
```

The tool maps `issuer_error` to `requested_amount: 100006`. You can also use descriptions or aliases, for example `"bank declined"`.

To list supported names and descriptions, call `list_test_cases`:

```json
{}
```

### Confirm payment

Tool: `confirm_transaction`

```json
{
  "external_id": "order-1001-payment-1",
  "result_code": "SUCCESS"
}
```

### Refund 5 SEK

Tool: `create_refund`

```json
{
  "external_id": "order-1001-refund-1",
  "requested_amount": 500,
  "currency": "SEK",
  "original_purchase_external_id": "order-1001-payment-1"
}
```

### Purchase with environment terminal

Set `NEXI_POS_TERMINAL_ID` in the environment, then omit `terminal_id` in the tool call.

Tool: `create_purchase`

```json
{
  "external_id": "order-1002-payment-1",
  "requested_amount": 500,
  "currency": "SEK"
}
```

### Purchase with explicit terminal

Tool: `create_purchase`

```json
{
  "terminal_id": "your-terminal-id",
  "external_id": "order-1003-payment-1",
  "requested_amount": 500,
  "currency": "SEK"
}
```

### Recovery after restart

If the server restarts during a payment, use the same `external_id` and terminal ID.

Tool: `get_transaction`

```json
{
  "terminal_id": "your-terminal-id",
  "external_id": "order-1001-payment-1"
}
```

Then check unconfirmed transactions.

Tool: `get_unconfirmed_transactions`

```json
{
  "terminal_id": "your-terminal-id"
}
```

You can also check the terminal status.

Tool: `get_terminal_status`

```json
{
  "terminal_id": "your-terminal-id"
}
```

If a transaction is waiting for confirmation, confirm it.

Tool: `confirm_transaction`

```json
{
  "terminal_id": "your-terminal-id",
  "external_id": "order-1001-payment-1",
  "result_code": "SUCCESS"
}
```

### List terminal events

Tool: `list_terminal_events`

```json
{
  "terminal_id": "your-terminal-id",
  "event_type": "eu.npay.api.pos.v0.TerminalStatus",
  "limit": 20,
  "wait_seconds": 30
}
```

If `wait_seconds` is omitted, the tool uses short polling with `0`. Set a positive `wait_seconds` value for long polling.

Use `next_token` from a previous response to continue the same event list. When `next_token` is sent, the server does not send a new filter because Nexi keeps the previous filtering criteria.

```json
{
  "terminal_id": "your-terminal-id",
  "next_token": "token-from-previous-response",
  "limit": 20,
  "wait_seconds": 30
}
```

## Confirmation

This MVP does not confirm by default.

When a transaction reaches `AWAITING_CONFIRM`, call `confirm_transaction`:

```json
{
  "external_id": "order-1001-payment-1",
  "result_code": "SUCCESS"
}
```

You can also let `take_payment` confirm automatically:

```json
{
  "external_id": "order-1002-payment-1",
  "requested_amount": 500,
  "auto_confirm": true
}
```

Use `auto_confirm` only when your business flow is ready to accept the transaction result immediately.

## SQLite storage and recovery

The server stores payment-relevant state in SQLite at `NEXI_POS_STORAGE_PATH`.

Stored data includes:

- external ID
- terminal ID
- transaction type
- currency
- requested amount
- state
- result code and description
- confirmation flag
- timestamps
- redacted raw transaction JSON

API credentials are never stored. Card-related fields should be redacted by the storage/client layer.

Recovery workflow after a restart:

1. Call `set_terminal_id` if the session terminal ID was lost and you do not use `NEXI_POS_TERMINAL_ID`.
2. Call `get_transaction` with the known `external_id`.
3. Call `get_unconfirmed_transactions` for the terminal.
4. If needed, call `confirm_transaction` with the correct `result_code`.

SQLite improves recovery, but it is not a full production operations system. Keep your own order records and reconcile with Nexi when needed.

## Troubleshooting

### HTTP 401 or 403

Check `NEXI_POS_API_KEY_ID` and `NEXI_POS_API_KEY_SECRET`. Also check that the credentials are valid for the selected `NEXI_POS_BASE_URL` environment, for example sandbox versus production. The credentials and terminal ID are generated outside this MCP server.

### Missing terminal ID

Pass `terminal_id` in the tool call, call `set_terminal_id`, or set `NEXI_POS_TERMINAL_ID`. There is no default terminal ID.

### Amount exceeds max

The server blocks amounts above `NEXI_POS_MAX_AMOUNT_MINOR`. Lower `requested_amount` or raise `NEXI_POS_MAX_AMOUNT_MINOR` for your environment. Amounts are minor units, so SEK `5.00` is `500`. The default `100021` allows Nexi's documented test-case trigger amounts.

### Transaction stuck in `PROCESSING`

Do not create a new transaction immediately. Retry `take_payment` with the same `external_id` and terminal ID, or call `get_transaction`. If it remains in `PROCESSING`, check the terminal and Nexi status before deciding whether to start a new payment with a new `external_id`.

### Transaction awaiting confirm

If `state` is `AWAITING_CONFIRM`, the card step has succeeded but the transaction is not complete. Call `confirm_transaction` with the same `external_id` and terminal ID when you are ready to accept the result. You can also use `auto_confirm` with `take_payment` for flows where immediate confirmation is correct.

### Reused `external_id`

Use the same `external_id` only to retry the same transaction. If the order, amount, or payment attempt is different, use a new `external_id`.

## Nexi simulator/test cases

Nexi documents special test-case amounts that can be used in sandbox and production simulator testing. The server detects these amounts and adds `test_case` information to responses. You can also trigger them by name or description with `test_case` instead of remembering the amount.

Examples:

- `test_case: "instant_success"` -> `requested_amount: 100002`
- `test_case: "bank declined"` -> `requested_amount: 100006`
- `requested_amount: 100017` -> response includes the 10% tip test-case information

Available cases:

| Name | Amount | Category | Description |
| --- | ---: | --- | --- |
| `successful_2s_delay` | `100001` | success | Successful transaction with 2-second delay |
| `instant_success` | `100002` | success | Instant successful transaction (0 seconds) |
| `rejected_by_processor` | `100003` | error | Transaction rejected by payment processor |
| `customer_cancelled` | `100004` | error | Transaction aborted (customer cancelled) |
| `card_removed` | `100005` | error | Card removed during processing |
| `issuer_error` | `100006` | error | Issuer error (bank declined) |
| `internal_system_error` | `100007` | error | Internal system error |
| `network_connectivity_error` | `100008` | error | Network connectivity error |
| `payment_method_not_accepted` | `100009` | error | Card/payment method not accepted |
| `contactless_pin_verified` | `100010` | payment_method | Successful PIN-verified contactless transaction |
| `contactless_cardholder_verification` | `100011` | payment_method | Successful contactless with cardholder verification |
| `chip_without_pin` | `100012` | payment_method | Successful chip card without PIN |
| `chip_with_pin` | `100013` | payment_method | Successful chip card with PIN |
| `magstripe_signature` | `100014` | payment_method | Successful magnetic stripe with signature |
| `magstripe_pin` | `100015` | payment_method | Successful magnetic stripe with PIN |
| `chip_with_pin_alternative` | `100016` | payment_method | Successful chip card with PIN (alternative mode) |
| `tip_10_percent` | `100017` | special_feature | Successful transaction with 10% tip added |
| `surcharge_1_5_percent` | `100018` | special_feature | Successful transaction with 1.5% surcharge |
| `dcc_enabled` | `100019` | special_feature | Successful transaction with Dynamic Currency Conversion enabled |
| `success_30s_delay` | `100020` | success | Successful transaction with 30-second delay |
| `loyalty_link_identity` | `100021` | special_feature | Successful transaction with Nexi Loyalty Link customer identity in response |

## Implementation notes for integration

The MCP tool layer expects these core modules to exist:

- `src/config.ts` exporting `getConfig()` with API, currency, terminal fallback, max amount, request timeout, and storage path settings.
- `src/nexi-client.ts` exporting `NexiClient` with `purchase`, `refund`, `confirm`, `getTransaction`, `getUnconfirmedTransactions`, `getTerminalStatus`, and `listTerminalEvents` methods.
- `src/storage/sqlite-store.ts` exporting `SQLiteStore` with `saveIntent`, `updateTransaction`, and `markConfirmed` methods.

These modules are intentionally separate from the MCP tool code so the API client and storage can be tested independently.
