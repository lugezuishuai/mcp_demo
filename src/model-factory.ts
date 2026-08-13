import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

import type { AppConfig } from "./config.ts";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_RESPONSES_MODELS = new Set(["deepseek-v4-flash"]);

/**
 * 根据统一配置创建 OpenAI、DeepSeek 或 Anthropic 的 LangChain Chat Model。
 *
 * @param config - 已校验的模型与推理配置。
 * @returns 可绑定 MCP 工具并交给 LangGraph 调用的聊天模型。
 */
export function createChatModel(config: AppConfig): BaseChatModel {
  if (!config.apiKey) {
    throw new Error("Cannot create a chat model without an API key");
  }

  // 汇总各厂商共享的参数，确保切换模型时超时、重试和生成限制保持一致。
  const common = {
    model: config.model,
    temperature: config.temperature,
    maxRetries: config.maxRetries,
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
  };

  if (config.modelProvider === "anthropic") {
    return new ChatAnthropic({
      ...common,
      apiKey: config.apiKey,
      ...(config.baseUrl ? { anthropicApiUrl: config.baseUrl } : {}),
      clientOptions: { timeout: config.timeoutMs },
    });
  }

  // DeepSeek 复用 OpenAI 兼容接口；未指定 BASE_URL 时使用官方地址。
  const baseURL = config.modelProvider === "deepseek" ? (config.baseUrl ?? DEEPSEEK_BASE_URL) : config.baseUrl;

  return new ChatOpenAI({
    ...common,
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    ...(baseURL ? { configuration: { baseURL } } : {}),
    ...(config.modelProvider === "deepseek" ? { useResponsesApi: DEEPSEEK_RESPONSES_MODELS.has(config.model) } : {}),
  });
}
