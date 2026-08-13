import { loadConfig, loadMcpHttpServerConfig } from "./config.ts";
import { createSseMcpApplication, startMcpHttpServer } from "./mcp-http-server.ts";

/**
 * 启动兼容旧版 MCP Client 的 HTTP+SSE 双端点 Server。
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env, {
    requireModelApiKey: false,
    requireToolApiKeys: true,
  });
  const httpConfig = loadMcpHttpServerConfig();
  const application = createSseMcpApplication(config, {
    host: httpConfig.host,
  });

  await startMcpHttpServer(application, {
    host: httpConfig.host,
    port: httpConfig.ssePort,
    label: "mcp-sse",
    endpoint: "/sse",
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-sse] startup failed: ${message}`);
  process.exitCode = 1;
});
