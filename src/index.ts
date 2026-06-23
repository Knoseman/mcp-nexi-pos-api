#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createToolContext, toolDefinitions } from "./tools/index.js";

async function main() {
  const server = new McpServer({
    name: "mcp-nexi-pos-api",
    version: "0.1.3",
  });

  const context = await createToolContext();
  const tools = toolDefinitions(context);

  for (const [name, definition] of Object.entries(tools)) {
    server.tool(name, definition.schema.shape, definition.handler as never);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("mcp-nexi-pos-api failed to start", error);
  process.exit(1);
});
