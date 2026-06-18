# mcp-nexi-pos-api

MVP MCP server for Nexi POS payment operations.

It provides tools to create purchases and refunds, poll payment state, confirm transactions, and recover unconfirmed transactions.

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

Create a local `.env` file:

```env
NEXI_POS_API_KEY_ID=your-api-key-id
NEXI_POS_API_KEY_SECRET=your-api-key-secret
NEXI_POS_BASE_URL=https://api.sandbox.npay.eu/pos/v1
NEXI_POS_DEFAULT_CURRENCY=SEK
NEXI_POS_MAX_AMOUNT_MINOR=500
NEXI_POS_USER_AGENT=mcp-nexi-pos-api/0.1.0
NEXI_POS_STORAGE_PATH=./data/nexi-pos.sqlite
```

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `NEXI_POS_API_KEY_ID` | Nexi Basic Auth username. | Required |
| `NEXI_POS_API_KEY_SECRET` | Nexi Basic Auth password. | Required |
| `NEXI_POS_BASE_URL` | Nexi POS API base URL. | `https://api.sandbox.npay.eu/pos/v1` |
| `NEXI_POS_DEFAULT_CURRENCY` | Currency used when a tool omits `currency`. | `SEK` |
| `NEXI_POS_MAX_AMOUNT_MINOR` | Safety limit in minor units. | `500` |
| `NEXI_POS_USER_AGENT` | User agent sent to Nexi. | `mcp-nexi-pos-api/0.1.0` |
| `NEXI_POS_STORAGE_PATH` | SQLite file for local recovery state. | `./data/nexi-pos.sqlite` |

## Claude Desktop config

Example for a global npm install:

```json
{
  "mcpServers": {
    "nexi-pos": {
      "command": "mcp-nexi-pos-api",
      "env": {
        "NEXI_POS_API_KEY_ID": "your-api-key-id",
        "NEXI_POS_API_KEY_SECRET": "your-api-key-secret",
        "NEXI_POS_BASE_URL": "https://api.sandbox.npay.eu/pos/v1",
        "NEXI_POS_DEFAULT_CURRENCY": "SEK",
        "NEXI_POS_MAX_AMOUNT_MINOR": "500",
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
        "NEXI_POS_API_KEY_SECRET": "your-api-key-secret"
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

The default max amount is `500`, meaning SEK/EUR `5.00`. Set `NEXI_POS_MAX_AMOUNT_MINOR` to a value that matches your test or production needs.

## Tools

- `set_terminal_id` - store a terminal ID for this MCP server session.
- `get_session_terminal_id` - show the current session terminal ID.
- `clear_terminal_id` - clear the session terminal ID.
- `create_purchase` - low-level purchase call.
- `take_payment` - high-level purchase helper that repeats while Nexi returns `PROCESSING`.
- `create_refund` - low-level refund call.
- `confirm_transaction` - confirm a purchase or refund result.
- `get_transaction` - fetch a transaction by `external_id` and terminal.
- `get_unconfirmed_transactions` - list unconfirmed transactions for a terminal.

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
  "transaction": {},
  "raw": {}
}
```

`ok` means the MCP/API call was handled. It does not always mean the card payment succeeded. `success` is true only when `result_code` is `SUCCESS`.

## Payment flow

1. Set the terminal ID once:

```json
{ "terminal_id": "YOUR_TERMINAL_ID" }
```

2. Start a payment:

```json
{
  "external_id": "order-1001",
  "requested_amount": 100,
  "currency": "SEK"
}
```

For most clients, use `take_payment`. It calls Nexi purchase repeatedly while the state is `PROCESSING`, until the total `timeout_seconds` is reached or Nexi returns a later state such as `AWAITING_CONFIRM`, `CONFIRMED`, or `COMMITTED`.

If the timeout is reached while the transaction is still `PROCESSING`, the response includes `external_id`, `terminal_id`, and the latest state. You can later call `get_transaction` or call `take_payment` again with the same identifiers.

## Confirmation

This MVP does not confirm by default.

When a transaction reaches `AWAITING_CONFIRM`, call `confirm_transaction`:

```json
{
  "external_id": "order-1001",
  "result_code": "SUCCESS"
}
```

You can also let `take_payment` confirm automatically:

```json
{
  "external_id": "order-1002",
  "requested_amount": 100,
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

1. Call `set_terminal_id` if the session terminal ID was lost.
2. Call `get_transaction` with the known `external_id`.
3. Call `get_unconfirmed_transactions` for the terminal.
4. If needed, call `confirm_transaction` with the correct `result_code`.

SQLite improves recovery, but it is not a full production operations system. Keep your own order records and reconcile with Nexi when needed.

## Simulator amount examples

Use small minor-unit amounts during simulator testing, for example:

- `100` for SEK `1.00`
- `200` for SEK `2.00`
- `500` for SEK `5.00`

Keep `NEXI_POS_MAX_AMOUNT_MINOR` low in test environments to avoid accidental large payments.

## Implementation notes for integration

The MCP tool layer expects these core modules to exist:

- `src/config.ts` exporting `getConfig()` with API, currency, max amount, and storage path settings.
- `src/nexi-client.ts` exporting `NexiClient` with `purchase`, `refund`, `confirm`, `getTransaction`, and `getUnconfirmedTransactions` methods.
- `src/storage/sqlite-store.ts` exporting `SQLiteStore` with `saveIntent`, `updateTransaction`, and `markConfirmed` methods.

These modules are intentionally separate from the MCP tool code so the API client and storage can be tested independently.
