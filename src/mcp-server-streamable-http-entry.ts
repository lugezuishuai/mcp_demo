import { loadConfig, loadMcpHttpServerConfig } from "./config.ts";
import { createStreamableHttpMcpApplication, startMcpHttpServer } from "./mcp-http-server.ts";

/**
 * 启动现行 MCP Streamable HTTP 单端点 Server。
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env, {
    requireModelApiKey: false,
    requireToolApiKeys: true,
  });
  const httpConfig = loadMcpHttpServerConfig();
  const application = createStreamableHttpMcpApplication(config, {
    host: httpConfig.host,
  });

  await startMcpHttpServer(application, {
    host: httpConfig.host,
    port: httpConfig.streamableHttpPort,
    label: "mcp-streamable-http",
    endpoint: "/mcp",
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-streamable-http] startup failed: ${message}`);
  process.exitCode = 1;
});
