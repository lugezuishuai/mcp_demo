import { loadConfig } from "./config.ts";
import { createHostAgentGraph } from "./host-agent.ts";
import { enableLangSmithTracing } from "./langsmith.ts";
import { createMcpClient, loadWebTools } from "./mcp-client.ts";
import { createChatModel } from "./model-factory.ts";

// Studio 加载模块时建立一条长期 MCP 会话，供多个 Agent Server thread 复用工具定义。
const config = loadConfig(process.env, {
  requireModelApiKey: true,
  requireToolApiKeys: true,
});
enableLangSmithTracing({
  apiKey: config.langSmithApiKey,
  projectName: config.langSmithProject,
});

const mcpClient = createMcpClient(config);
const tools = await loadWebTools(mcpClient);

/**
 * Studio 停止或热重载 worker 时先关闭 stdio transport，避免 MCP 子进程成为孤儿进程。
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  await mcpClient.close();
  process.kill(process.pid, signal);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

/**
 * LangSmith Studio 使用的 Host Agent 图。
 *
 * Agent Server 负责线程持久化，所以此入口不再绑定进程内 MemorySaver。
 */
export const graph = createHostAgentGraph(createChatModel(config), tools, config.systemPrompt, {
  useLocalMemorySaver: false,
});
