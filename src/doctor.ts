import { loadConfig } from "./config.ts";
import { enableLangSmithTracing } from "./langsmith.ts";
import { createMcpClient, loadWebTools } from "./mcp-client.ts";
import { createChatModel } from "./model-factory.ts";

/**
 * 诊断环境变量、模型工厂和 MCP 握手，不发起真实模型或 Web API 请求。
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env, {
    requireModelApiKey: true,
    requireToolApiKeys: true,
  });
  const tracingEnabled = enableLangSmithTracing({
    apiKey: config.langSmithApiKey,
    projectName: config.langSmithProject,
  });

  // 构造模型可提前发现 Provider 参数错误，但不会产生远程请求和费用。
  createChatModel(config);
  const mcpClient = createMcpClient(config);

  try {
    // tools/list 验证本地子进程、stdio、MCP 握手和工具注册是否完整。
    const tools = await loadWebTools(mcpClient);
    console.log(`node: ${process.version}`);
    console.log(`model: ${config.modelProvider}/${config.model}`);
    console.log(`model API key configured: ${Boolean(config.apiKey)}`);
    console.log(`Tavily API key configured: ${Boolean(config.tavilyApiKey)}`);
    console.log(`Firecrawl API key configured: ${Boolean(config.firecrawlApiKey)}`);
    console.log(`LangSmith tracing: ${tracingEnabled ? `enabled (${config.langSmithProject})` : "disabled"}`);
    console.log(
      `MCP tools: ${tools
        .map((tool) => tool.name)
        .sort()
        .join(", ")}`,
    );
    console.log("diagnosis: ok");
  } finally {
    await mcpClient.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnosis: failed - ${message}`);
  process.exitCode = 1;
});
