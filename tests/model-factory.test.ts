import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.ts";
import { createChatModel } from "../src/model-factory.ts";

const baseConfig: AppConfig = {
  modelProvider: "openai",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0,
  timeoutMs: 1_000,
  maxRetries: 0,
  mcpToolTimeoutMs: 1_000,
  webSearchMaxResults: 5,
  webFetchMaxCharacters: 20_000,
  langSmithProject: "mcp_demo",
  systemPrompt: "test",
};

describe("createChatModel", () => {
  it("uses ChatOpenAI for OpenAI and DeepSeek", () => {
    expect(createChatModel(baseConfig)).toBeInstanceOf(ChatOpenAI);
    expect(
      createChatModel({
        ...baseConfig,
        modelProvider: "deepseek",
        model: "deepseek-chat",
      }),
    ).toBeInstanceOf(ChatOpenAI);
  });

  it("enables the Responses API only for supported DeepSeek models", () => {
    const responsesModel = createChatModel({
      ...baseConfig,
      modelProvider: "deepseek",
      model: "deepseek-v4-flash",
    }) as ChatOpenAI;
    const chatModel = createChatModel({
      ...baseConfig,
      modelProvider: "deepseek",
      model: "deepseek-chat",
    }) as ChatOpenAI;

    expect(responsesModel.useResponsesApi).toBe(true);
    expect(chatModel.useResponsesApi).toBe(false);
  });

  it("uses the native Anthropic adapter for Claude", () => {
    const model = createChatModel({
      ...baseConfig,
      modelProvider: "anthropic",
      maxTokens: 8_192,
    }) as ChatAnthropic;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.maxTokens).toBe(8_192);
  });
});
