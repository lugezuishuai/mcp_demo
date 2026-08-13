export interface LangSmithTracingOptions {
  apiKey: string | undefined;
  projectName: string;
}

/**
 * 在模型和 LangGraph 初始化前配置 LangSmith，确保 CLI 与 Studio 的 trace 落入同一项目。
 *
 * @param options - LangSmith API Key 与固定项目名。
 * @returns 是否已启用 tracing；未配置 Key 时返回 false。
 */
export function enableLangSmithTracing(options: LangSmithTracingOptions): boolean {
  if (!options.apiKey) {
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGCHAIN_TRACING_V2 = "false";
    return false;
  }

  // 同时设置新旧 tracing 开关，兼容 LangChain.js 依赖链中的不同版本。
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGCHAIN_TRACING_V2 = "true";
  process.env.LANGSMITH_API_KEY = options.apiKey;
  process.env.LANGSMITH_PROJECT = options.projectName;
  return true;
}
