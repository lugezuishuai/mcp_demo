import "dotenv/config";

import { z } from "zod";

// 将模型厂商别名归一化，避免后续模块重复判断 gpt/claude 等同义配置。
const providerSchema = z
  .enum(["openai", "gpt", "deepseek", "anthropic", "claude"])
  .default("openai")
  .transform((provider) => {
    if (provider === "gpt") return "openai" as const;
    if (provider === "claude") return "anthropic" as const;
    return provider;
  });

// .env 中的空字符串代表未配置，需在 URL 和非空字符串校验前转为 undefined。
const optionalString = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.url().optional(),
);

const environmentSchema = z.object({
  MODEL_PROVIDER: providerSchema,
  MODEL: z.string().min(1).default("gpt-4o-mini"),
  API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  BASE_URL: optionalUrl,
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  MAX_TOKENS: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  TAVILY_API_KEY: optionalString,
  FIRECRAWL_API_KEY: optionalString,
  MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  WEB_SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  WEB_FETCH_MAX_CHARACTERS: z.coerce.number().int().min(1_000).max(100_000).default(20_000),
  LANGSMITH_API_KEY: optionalString,
  LANGSMITH_PROJECT: z.string().min(1).optional(),
  SYSTEM_PROMPT: z
    .string()
    .min(1)
    .default(
      "You are a web research assistant. Use web_search for current or source-backed discovery, " +
        "then use web_fetch when the full content of a result is needed. Cite source URLs in the final answer " +
        "and never claim that a tool succeeded when it returned an error.",
    ),
});

const mcpHttpEnvironmentSchema = z.object({
  MCP_HTTP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_SSE_PORT: z.coerce.number().int().min(0).max(65_535).default(3_001),
  MCP_STREAMABLE_HTTP_PORT: z.coerce.number().int().min(0).max(65_535).default(3_002),
});

export type ModelProvider = "openai" | "deepseek" | "anthropic";

export interface AppConfig {
  modelProvider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  maxRetries: number;
  tavilyApiKey?: string;
  firecrawlApiKey?: string;
  mcpToolTimeoutMs: number;
  webSearchMaxResults: number;
  webFetchMaxCharacters: number;
  langSmithApiKey?: string;
  /** LangSmith 项目名，默认 mcp_demo，可用 LANGSMITH_PROJECT 覆盖。 */
  langSmithProject: string;
  systemPrompt: string;
}

export interface LoadConfigOptions {
  requireModelApiKey?: boolean;
  requireToolApiKeys?: boolean;
}

export interface McpHttpServerConfig {
  host: string;
  ssePort: number;
  streamableHttpPort: number;
}

/**
 * 读取并校验模型、MCP 工具与 LangSmith 的环境变量。
 *
 * @param environment - 待解析的环境变量，默认使用当前进程环境。
 * @param options - 控制不同入口需要强制校验哪些凭据。
 * @returns 所有运行入口共享的标准化配置。
 */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env, options: LoadConfigOptions = {}): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const apiKey = resolveModelApiKey(parsed);

  if (options.requireModelApiKey !== false && !apiKey) {
    throw new Error(
      "API_KEY is required (provider-specific OPENAI_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY is also accepted)",
    );
  }
  if (options.requireToolApiKeys) {
    requireToolApiKeys(parsed);
  }

  return {
    modelProvider: parsed.MODEL_PROVIDER,
    model: parsed.MODEL,
    ...(apiKey ? { apiKey } : {}),
    ...(parsed.BASE_URL ? { baseUrl: parsed.BASE_URL } : {}),
    temperature: parsed.MODEL_TEMPERATURE,
    ...(parsed.MAX_TOKENS ? { maxTokens: parsed.MAX_TOKENS } : {}),
    timeoutMs: parsed.MODEL_TIMEOUT_MS,
    maxRetries: parsed.MODEL_MAX_RETRIES,
    ...(parsed.TAVILY_API_KEY ? { tavilyApiKey: parsed.TAVILY_API_KEY } : {}),
    ...(parsed.FIRECRAWL_API_KEY ? { firecrawlApiKey: parsed.FIRECRAWL_API_KEY } : {}),
    mcpToolTimeoutMs: parsed.MCP_TOOL_TIMEOUT_MS,
    webSearchMaxResults: parsed.WEB_SEARCH_MAX_RESULTS,
    webFetchMaxCharacters: parsed.WEB_FETCH_MAX_CHARACTERS,
    ...(parsed.LANGSMITH_API_KEY ? { langSmithApiKey: parsed.LANGSMITH_API_KEY } : {}),
    langSmithProject: parsed.LANGSMITH_PROJECT ?? "mcp_demo",
    systemPrompt: parsed.SYSTEM_PROMPT,
  };
}

/**
 * 读取 SSE 与 Streamable HTTP Server 的监听地址，和模型配置保持解耦。
 */
export function loadMcpHttpServerConfig(environment: NodeJS.ProcessEnv = process.env): McpHttpServerConfig {
  const parsed = mcpHttpEnvironmentSchema.parse(environment);
  return {
    host: parsed.MCP_HTTP_HOST,
    ssePort: parsed.MCP_SSE_PORT,
    streamableHttpPort: parsed.MCP_STREAMABLE_HTTP_PORT,
  };
}

/**
 * 按通用 Key 优先、当前 Provider 专属 Key 兜底的规则选择模型凭据。
 */
function resolveModelApiKey(environment: z.infer<typeof environmentSchema>): string | undefined {
  if (environment.API_KEY) return environment.API_KEY;
  if (environment.MODEL_PROVIDER === "anthropic") return environment.ANTHROPIC_API_KEY;
  if (environment.MODEL_PROVIDER === "deepseek") return environment.DEEPSEEK_API_KEY;
  return environment.OPENAI_API_KEY;
}

/**
 * MCP Server 启动前同时校验两个工具凭据，避免连接成功后才在首次调用时失败。
 */
function requireToolApiKeys(environment: z.infer<typeof environmentSchema>): void {
  const missingNames = [
    !environment.TAVILY_API_KEY ? "TAVILY_API_KEY" : undefined,
    !environment.FIRECRAWL_API_KEY ? "FIRECRAWL_API_KEY" : undefined,
  ].filter((name): name is string => Boolean(name));

  if (missingNames.length > 0) {
    throw new Error(`Missing MCP tool credentials: ${missingNames.join(", ")}`);
  }
}
