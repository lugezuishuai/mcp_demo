import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import {
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

import type { AppConfig } from "./config.ts";
import { createMcpClient, loadWebTools, type McpServerConnection, type WebMcpClient } from "./mcp-client.ts";
import { createChatModel } from "./model-factory.ts";

export interface HostAgentGraphOptions {
  /**
   * CLI 需要 MemorySaver 支持多轮对话；Studio 由 Agent Server 注入持久化，因此应关闭。
   */
  useLocalMemorySaver?: boolean;
}

/**
 * 封装 Host、MCP Client 与 LangGraph 的生命周期。
 */
export class HostAgent {
  private constructor(
    private readonly graph: ReturnType<typeof createHostAgentGraph>,
    private readonly mcpClient: WebMcpClient,
  ) {}

  /**
   * 启动 MCP Client、动态发现工具并构建 Host Agent 图。
   *
   * @param config - 模型、MCP 与提示词配置。
   * @param connection - Host 要连接的 MCP Server transport 与地址。
   * @returns 可处理多轮请求且能被显式关闭的 Host Agent。
   */
  static async create(config: AppConfig, connection: McpServerConnection = { transport: "stdio" }): Promise<HostAgent> {
    const mcpClient = createMcpClient(config, connection);

    try {
      // getTools 会执行 MCP initialize 和 tools/list，Host 不硬编码第三方工具 schema。
      const tools = await loadWebTools(mcpClient);
      const graph = createHostAgentGraph(createChatModel(config), tools, config.systemPrompt);
      return new HostAgent(graph, mcpClient);
    } catch (error) {
      await mcpClient.close();
      throw error;
    }
  }

  /**
   * 在指定线程执行一轮 Agent 对话。
   *
   * @param prompt - 用户输入。
   * @param threadId - LangGraph MemorySaver 使用的会话标识。
   * @returns 模型在零次或多次 MCP 工具调用后的最终文本。
   */
  async respond(prompt: string, threadId: string): Promise<string> {
    const result = await this.graph.invoke(
      { messages: [new HumanMessage(prompt)] },
      { configurable: { thread_id: threadId } },
    );
    const text = result.messages.at(-1)?.text.trim();

    if (!text) {
      throw new Error("The Host Agent returned an empty response");
    }
    return text;
  }

  /**
   * 关闭 MCP 会话；Stdio 模式还会终止由 Host 启动的 Server 子进程。
   */
  async close(): Promise<void> {
    await this.mcpClient.close();
  }
}

/**
 * 构建“模型决策 → MCP 工具执行 → 模型总结”的 LangGraph ReAct 循环。
 *
 * @param model - 支持 tool calling 的聊天模型。
 * @param tools - MCP Client 通过 tools/list 动态加载的 LangChain 工具。
 * @param systemPrompt - Host Agent 的系统提示词。
 * @param options - CLI 或 Studio 的持久化策略。
 * @returns 已编译的 LangGraph。
 */
export function createHostAgentGraph(
  model: BaseChatModel,
  tools: DynamicStructuredTool[],
  systemPrompt: string,
  options: HostAgentGraphOptions = {},
) {
  if (!model.bindTools) {
    throw new Error("The configured model does not support tool calling");
  }
  const modelWithTools = model.bindTools(tools);

  /**
   * 把系统指令与当前线程消息交给模型；模型可直接回答或生成 MCP tool_calls。
   */
  const callModel = async (state: typeof MessagesAnnotation.State, runnableConfig?: LangGraphRunnableConfig) => {
    const response = await modelWithTools.invoke([new SystemMessage(systemPrompt), ...state.messages], runnableConfig);
    return { messages: [response] };
  };

  // toolsCondition 仅在模型生成 tool_calls 时进入工具节点，工具结果随后回到模型节点总结。
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("host_agent", callModel)
    .addNode("mcp_tools", new ToolNode(tools))
    .addEdge(START, "host_agent")
    .addConditionalEdges("host_agent", toolsCondition, {
      tools: "mcp_tools",
      [END]: END,
    })
    .addEdge("mcp_tools", "host_agent");

  if (options.useLocalMemorySaver === false) {
    return workflow.compile();
  }
  return workflow.compile({ checkpointer: new MemorySaver() });
}
