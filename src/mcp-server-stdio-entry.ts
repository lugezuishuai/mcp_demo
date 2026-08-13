import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.ts";
import { createWebMcpServer } from "./mcp-server.ts";

/**
 * 通过 stdio 启动本地 MCP Server。
 *
 * stdout 专用于 JSON-RPC 帧，因此运行日志只能写入 stderr。
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env, {
    requireModelApiKey: false,
    requireToolApiKeys: true,
  });
  const server = createWebMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[mcp-stdio] connected");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-stdio] startup failed: ${message}`);
  process.exitCode = 1;
});
