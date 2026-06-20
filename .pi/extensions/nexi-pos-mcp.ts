import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | undefined;
let transport: StdioClientTransport | undefined;

async function getClient() {
  if (client) return client;

  client = new Client({ name: "pi-nexi-pos-client", version: "0.1.0" });
  transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
  });

  await client.connect(transport);
  return client;
}

async function callNexiTool(name: string, args: Record<string, unknown>) {
  const mcp = await getClient();
  return mcp.callTool({ name, arguments: args });
}

const Empty = Type.Object({});
const TerminalId = Type.String({ description: "Nexi POS terminal ID" });
const ExternalId = Type.String({ description: "Idempotency external ID" });
const Currency = Type.Optional(Type.String({ description: "ISO 4217 currency code, e.g. SEK" }));
const Amount = Type.Number({ description: "Integer amount in ISO 4217 minor units, e.g. SEK 1.00 = 100" });
const WaitSeconds = Type.Optional(Type.Number({ description: "Nexi wait_seconds" }));
const Metadata = Type.Optional(Type.Object({}, { additionalProperties: true }));

function registerMcpTool(pi: ExtensionAPI, name: string, description: string, parameters: any) {
  pi.registerTool({
    name,
    label: `Nexi POS: ${name}`,
    description,
    parameters,
    async execute(_toolCallId, params) {
      const result = await callNexiTool(name, params as Record<string, unknown>);
      return { content: result.content ?? [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerMcpTool(pi, "set_terminal_id", "Set the Nexi POS terminal ID for this Pi session.", Type.Object({ terminal_id: TerminalId }));
  registerMcpTool(pi, "get_session_terminal_id", "Get the current Nexi POS terminal ID.", Empty);
  registerMcpTool(pi, "clear_terminal_id", "Clear the current Nexi POS terminal ID.", Empty);

  registerMcpTool(pi, "create_purchase", "Low-level Nexi POS purchase call. For normal customer card payments, prefer take_payment. Amount is in minor units, e.g. 500 for 5.00 SEK.", Type.Object({
    external_id: ExternalId,
    requested_amount: Amount,
    currency: Currency,
    terminal_id: Type.Optional(TerminalId),
    cashback_amount: Type.Optional(Amount),
    metadata: Metadata,
    wait_seconds: WaitSeconds,
  }));

  registerMcpTool(pi, "take_payment", "Recommended normal customer card payment flow. Polls while PROCESSING and tells you when confirmation is needed. Amount is in minor units, e.g. 500 for 5.00 SEK.", Type.Object({
    external_id: ExternalId,
    requested_amount: Amount,
    currency: Currency,
    terminal_id: Type.Optional(TerminalId),
    metadata: Metadata,
    timeout_seconds: Type.Optional(Type.Number()),
    wait_seconds: WaitSeconds,
    auto_confirm: Type.Optional(Type.Boolean()),
  }));

  registerMcpTool(pi, "create_refund", "Create a Nexi POS refund. Amount is in minor units, e.g. 500 for 5.00 SEK.", Type.Object({
    external_id: ExternalId,
    requested_amount: Amount,
    currency: Currency,
    terminal_id: Type.Optional(TerminalId),
    customer_not_present: Type.Optional(Type.Boolean()),
    original_purchase_external_id: Type.Optional(ExternalId),
    original_purchase_terminal_id: Type.Optional(TerminalId),
    metadata: Metadata,
    wait_seconds: WaitSeconds,
  }));

  registerMcpTool(pi, "confirm_transaction", "Confirm a Nexi POS transaction after AWAITING_CONFIRM. This completes the approved card result.", Type.Object({
    external_id: ExternalId,
    result_code: Type.String(),
    terminal_id: Type.Optional(TerminalId),
    result_description: Type.Optional(Type.String()),
    captured_amount: Type.Optional(Amount),
    metadata: Metadata,
    commit_window_seconds: Type.Optional(Type.Number()),
    wait_seconds: WaitSeconds,
  }));

  registerMcpTool(pi, "get_transaction", "Get a Nexi POS transaction by external_id and terminal. Use after timeout/restart or to check PROCESSING state.", Type.Object({
    external_id: ExternalId,
    terminal_id: Type.Optional(TerminalId),
    wait_seconds: WaitSeconds,
  }));

  registerMcpTool(pi, "get_unconfirmed_transactions", "Get Nexi POS unconfirmed transactions for the terminal.", Type.Object({
    terminal_id: Type.Optional(TerminalId),
  }));

  pi.registerCommand("nexi-pos", {
    description: "Show Nexi POS MCP extension status",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Nexi POS MCP tools are registered. Restart pi or run /reload after changes.", "info");
    },
  });

  pi.on("session_shutdown", async () => {
    await transport?.close().catch(() => undefined);
    client = undefined;
    transport = undefined;
  });
}
