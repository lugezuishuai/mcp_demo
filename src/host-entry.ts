import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { loadConfig, loadMcpHttpServerConfig } from "./config.ts";
import { HostAgent } from "./host-agent.ts";
import { parseHostArguments } from "./host-arguments.ts";
import { enableLangSmithTracing } from "./langsmith.ts";
import { createMcpServerConnection } from "./mcp-client.ts";

/**
 * 启动 Host Agent；带参数时执行单轮请求，不带参数时进入共享 thread_id 的交互模式。
 */
async function main(): Promise<void> {
  const hostArguments = parseHostArguments(process.argv.slice(2));
  const config = loadConfig(process.env, {
    requireModelApiKey: true,
    // 网络模式下工具凭据属于独立 MCP Server，Host 进程无需持有。
    requireToolApiKeys: hostArguments.transport === "stdio",
  });
  const connection = createMcpServerConnection(hostArguments.transport, loadMcpHttpServerConfig());
  const tracingEnabled = enableLangSmithTracing({
    apiKey: config.langSmithApiKey,
    projectName: config.langSmithProject,
  });
  const agent = await HostAgent.create(config, connection);

  console.error(
    `[host] model=${config.modelProvider}/${config.model}, transport=${hostArguments.transport}, ` +
      `tracing=${tracingEnabled ? "on" : "off"}, tools=web_search,web_fetch`,
  );

  try {
    if (hostArguments.prompt) {
      await runTurn(agent, hostArguments.prompt);
      return;
    }
    await runInteractive(agent, hostArguments.transport);
  } finally {
    // 显式关闭 MCP Client；Stdio 模式还会停止由 Host 拉起的 Server 子进程。
    await agent.close();
  }
}

/**
 * 执行一轮 Host Agent 对话并打印回答。
 *
 * @param agent - 已连接 MCP Server 的 Host Agent。
 * @param prompt - 当前用户输入。
 * @param contextId - LangGraph 会话标识；首次调用时自动生成。
 * @returns 当前会话标识，供交互模式下一轮复用。
 */
async function runTurn(agent: HostAgent, prompt: string, contextId: string = randomUUID()): Promise<string> {
  const response = await agent.respond(prompt, contextId);
  console.log(`assistant > ${response}`);
  return contextId;
}

/**
 * 在终端持续读取用户输入，并复用 contextId 维持多轮 LangGraph 会话。
 */
async function runInteractive(agent: HostAgent, transport: string): Promise<void> {
  const readline: Interface = createInterface({ input: stdin, output: stdout });
  let contextId: string | undefined;

  console.log(`Interactive MCP Host started with ${transport}. Type exit or quit to stop.`);
  try {
    while (true) {
      // 空输入和退出命令不进入 Agent，避免产生无意义的模型调用。
      const prompt = (await readline.question("user > ")).trim();
      if (["exit", "quit"].includes(prompt.toLowerCase())) return;
      if (!prompt) continue;
      contextId = await runTurn(agent, prompt, contextId);
    }
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[host] failed: ${message}`);
  process.exitCode = 1;
});
