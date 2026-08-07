import type { AiClientFetch } from "./ai-client.js";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowExternalContext } from "./script-flow-ai-planner.js";

const DEFAULT_EMBEDDING_BASE_URL = "https://mobile.eeo-inc.com/code-embedding";
const DEFAULT_CODE_SEARCH_BASE_URL = "https://mobile.eeo-inc.com";
const DEFAULT_TIMEOUT_MS = 3_500;
const DEFAULT_TOP_K = 3;
const DEFAULT_MAX_SEMANTIC_QUERIES = 2;
const DEFAULT_MAX_EXACT_QUERIES = 3;
const MAX_CONTEXT_RESULTS = 8;
const MAX_CONTEXT_FILES = 8;
const MAX_CANDIDATE_STEPS = 8;
const MAX_SEARCH_TEXT_LENGTH = 120;

export type ClassInCodeSearchPlan = {
  semanticQueries: string[];
  exactQueries: string[];
  languages: string[];
};

export type ScriptFlowCodeContextProviderInput = {
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
};

export type ScriptFlowCodeContextProvider = (input: ScriptFlowCodeContextProviderInput) => Promise<ScriptFlowExternalContext | undefined>;

export type ClassInCodeContextOptions = {
  enabled?: boolean;
  embeddingBaseUrl?: string;
  codeSearchBaseUrl?: string;
  apiToken?: string;
  timeoutMs?: number;
  topK?: number;
  maxSemanticQueries?: number;
  maxExactQueries?: number;
  repos?: string[];
  user?: string;
  fetchImpl?: AiClientFetch;
};

type ClassInCodeResult = {
  title: string;
  repoName: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  score?: number;
};

export function classInCodeContextOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ClassInCodeContextOptions {
  return {
    enabled: booleanEnv(env.CLASSIN_CODE_CONTEXT_ENABLED, false),
    embeddingBaseUrl: stringEnv(env.CLASSIN_CODE_EMBEDDING_BASE_URL) ?? DEFAULT_EMBEDDING_BASE_URL,
    codeSearchBaseUrl: stringEnv(env.CLASSIN_CODE_SEARCH_BASE_URL) ?? DEFAULT_CODE_SEARCH_BASE_URL,
    apiToken: stringEnv(env.CLASSIN_CODE_API_TOKEN),
    timeoutMs: positiveIntegerEnv(env.CLASSIN_CODE_CONTEXT_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    topK: positiveIntegerEnv(env.CLASSIN_CODE_CONTEXT_TOP_K) ?? DEFAULT_TOP_K,
    maxSemanticQueries: positiveIntegerEnv(env.CLASSIN_CODE_CONTEXT_MAX_SEMANTIC_QUERIES) ?? DEFAULT_MAX_SEMANTIC_QUERIES,
    maxExactQueries: positiveIntegerEnv(env.CLASSIN_CODE_CONTEXT_MAX_EXACT_QUERIES) ?? DEFAULT_MAX_EXACT_QUERIES,
    repos: commaSeparatedEnv(env.CLASSIN_CODE_CONTEXT_REPOS),
    user: stringEnv(env.CLASSIN_CODE_CONTEXT_USER)
  };
}

export function createClassInCodeContextProvider(options: ClassInCodeContextOptions = classInCodeContextOptionsFromEnv()): ScriptFlowCodeContextProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const enabled = options.enabled === true;
  const embeddingBaseUrl = trimTrailingSlash(options.embeddingBaseUrl ?? DEFAULT_EMBEDDING_BASE_URL);
  const codeSearchBaseUrl = trimTrailingSlash(options.codeSearchBaseUrl ?? DEFAULT_CODE_SEARCH_BASE_URL);
  const timeoutMs = positiveInteger(options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
  const topK = positiveInteger(options.topK) ?? DEFAULT_TOP_K;
  const maxSemanticQueries = positiveInteger(options.maxSemanticQueries) ?? DEFAULT_MAX_SEMANTIC_QUERIES;
  const maxExactQueries = positiveInteger(options.maxExactQueries) ?? DEFAULT_MAX_EXACT_QUERIES;
  const repos = options.repos?.map((repo) => repo.trim()).filter(Boolean);

  return async (input) => {
    if (!enabled || !isClassInApp(input.appId)) {
      return undefined;
    }
    const plan = buildClassInCodeSearchPlan(input);
    if (plan.semanticQueries.length === 0 && plan.exactQueries.length === 0) {
      return undefined;
    }

    try {
      const results: ClassInCodeResult[] = [];
      for (const query of plan.semanticQueries.slice(0, maxSemanticQueries)) {
        const languages = plan.languages.length > 0 ? plan.languages : [undefined];
        for (const language of languages) {
          results.push(...await searchEmbedding({
            fetchImpl,
            baseUrl: embeddingBaseUrl,
            timeoutMs,
            apiToken: options.apiToken,
            query,
            language,
            topK,
            repos,
            user: options.user
          }));
        }
      }
      for (const query of plan.exactQueries.slice(0, maxExactQueries)) {
        results.push(...await searchExactCode({
          fetchImpl,
          baseUrl: codeSearchBaseUrl,
          timeoutMs,
          apiToken: options.apiToken,
          query,
          topK,
          repos
        }));
      }

      const uniqueResults = dedupeResults(results).slice(0, MAX_CONTEXT_RESULTS);
      if (uniqueResults.length === 0) {
        return undefined;
      }
      return buildExternalContext(input, plan, uniqueResults);
    } catch {
      return undefined;
    }
  };
}

export function buildClassInCodeSearchPlan(input: ScriptFlowCodeContextProviderInput): ClassInCodeSearchPlan {
  const prompt = compactWhitespace(input.prompt).slice(0, MAX_SEARCH_TEXT_LENGTH);
  const exactQueries = extractExactQueries(input.prompt);
  const functionalTerms = exactQueries.filter((term) => !isLikelyDynamicBusinessValue(term));
  const semanticQueries = uniqueStrings([
    prompt,
    functionalTerms.length >= 2 ? functionalTerms.join(" ") : undefined
  ]);
  return {
    semanticQueries,
    exactQueries,
    languages: languagesForPlatform(input.platform)
  };
}

export function mergeScriptFlowExternalContexts(
  callerContext: ScriptFlowExternalContext | undefined,
  automaticContext: ScriptFlowExternalContext | undefined
): ScriptFlowExternalContext | undefined {
  if (!callerContext) return automaticContext;
  if (!automaticContext) return callerContext;
  return removeEmptyContextFields({
    source: callerContext.source,
    summary: `${callerContext.summary.trim()}\n\nclassin-code 自动检索补充：\n${automaticContext.summary.trim()}`,
    implementationStack: callerContext.implementationStack ?? automaticContext.implementationStack,
    relevantFiles: uniqueStrings([
      ...(callerContext.relevantFiles ?? []),
      ...(automaticContext.relevantFiles ?? [])
    ]),
    candidateSteps: uniqueStrings([
      ...(callerContext.candidateSteps ?? []),
      ...(automaticContext.candidateSteps ?? [])
    ]),
    constraints: uniqueStrings([
      ...(callerContext.constraints ?? []),
      ...(automaticContext.constraints ?? [])
    ])
  });
}

async function searchEmbedding(input: {
  fetchImpl: AiClientFetch;
  baseUrl: string;
  timeoutMs: number;
  apiToken?: string;
  query: string;
  language?: string;
  topK: number;
  repos?: string[];
  user?: string;
}): Promise<ClassInCodeResult[]> {
  const body = {
    query: input.query,
    top_k: input.topK,
    ...(input.language ? { language: input.language } : {}),
    ...(input.repos && input.repos.length > 0 ? { repos: input.repos } : {}),
    ...(input.user ? { user: input.user } : {})
  };
  return postClassInCodeSearch(input.fetchImpl, `${input.baseUrl}/api/v1/search`, body, input.timeoutMs, input.apiToken);
}

async function searchExactCode(input: {
  fetchImpl: AiClientFetch;
  baseUrl: string;
  timeoutMs: number;
  apiToken?: string;
  query: string;
  topK: number;
  repos?: string[];
}): Promise<ClassInCodeResult[]> {
  const repoFields = input.repos && input.repos.length > 0
    ? input.repos.length === 1
      ? { repo: input.repos[0] }
      : { repos: input.repos }
    : {};
  const body = {
    tool: "search_code",
    query: input.query,
    mode: "exact",
    branch: "alpha",
    limit: input.topK,
    context_lines: 0,
    ...repoFields
  };
  return postClassInCodeSearch(input.fetchImpl, `${input.baseUrl}/code/api/search`, body, input.timeoutMs, input.apiToken);
}

async function postClassInCodeSearch(
  fetchImpl: AiClientFetch,
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  apiToken?: string
): Promise<ClassInCodeResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`classin-code request failed: HTTP ${response.status}`);
    }
    return extractCodeResults(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function buildExternalContext(
  input: ScriptFlowCodeContextProviderInput,
  plan: ClassInCodeSearchPlan,
  results: ClassInCodeResult[]
): ScriptFlowExternalContext {
  const candidateFiles = uniqueStrings(results.map((result) => `${result.repoName}:${result.filePath}`)).slice(0, MAX_CONTEXT_FILES);
  const candidates = results
    .slice(0, 5)
    .map((result) => `${result.title} (${result.repoName}:${lineRef(result)})`);
  return {
    source: "classin-code",
    implementationStack: implementationStackForPlatform(input.platform),
    summary: [
      `classin-code 根据自然语言目标检索到 ${results.length} 个候选实现线索。`,
      plan.exactQueries.length > 0 ? `候选文案/业务词：${plan.exactQueries.join("、")}` : undefined,
      candidates.length > 0 ? `候选文件：${candidates.join("；")}` : undefined
    ].filter(Boolean).join("\n"),
    relevantFiles: candidateFiles,
    candidateSteps: splitIntentClauses(input.prompt).slice(0, MAX_CANDIDATE_STEPS),
    constraints: [
      "代码上下文只作为生成线索，页面资产、用户明示步骤和真机试运行结果优先。",
      "不要把底层控件 ID、选择器、坐标、bounds 或代码内部 key 写入 ScriptFlow target。",
      "代码命中的页面、文案和业务顺序只能转成 text、icon、visual 或 control 目标。"
    ]
  };
}

function extractCodeResults(payload: unknown): ClassInCodeResult[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : [];
  return candidates
    .map(normalizeCodeResult)
    .filter((result): result is ClassInCodeResult => Boolean(result));
}

function normalizeCodeResult(value: unknown): ClassInCodeResult | undefined {
  if (!isRecord(value)) return undefined;
  const filePath = stringField(value, "file_path") ?? stringField(value, "path") ?? stringField(value, "filePath");
  const repoName = stringField(value, "repo_name") ?? stringField(value, "repo") ?? stringField(value, "repository") ?? "unknown";
  if (!filePath) return undefined;
  return {
    title: sanitizeContextText(stringField(value, "title") ?? filePath),
    repoName: sanitizeContextText(repoName),
    filePath: sanitizePath(filePath),
    startLine: numberField(value, "start_line") ?? numberField(value, "startLine") ?? numberField(value, "line"),
    endLine: numberField(value, "end_line") ?? numberField(value, "endLine"),
    score: numberField(value, "score")
  };
}

function extractExactQueries(prompt: string): string[] {
  return uniqueStrings(splitIntentClauses(prompt)
    .map((clause) => stripActionWords(clause))
    .flatMap(splitTermCandidates)
    .map((term) => normalizeSearchTerm(term))
    .filter((term) => term.length >= 2 && !isStopSearchTerm(term) && !isLikelyDynamicBusinessValue(term)))
    .slice(0, 8);
}

function splitIntentClauses(prompt: string): string[] {
  const normalized = prompt
    .replace(/但是不要/g, "，不要")
    .replace(/但不要/g, "，不要")
    .replace(/并且/g, "，")
    .replace(/然后/g, "，")
    .replace(/再/g, "，")
    .replace(/[。；;\n]+/g, "，");
  return normalized
    .split(/[，,]+/)
    .map((clause) => clause.trim().replace(/^(先|再|然后|并|且|同时)/, "").trim())
    .filter(Boolean);
}

function stripActionWords(clause: string): string {
  return clause
    .replace(/^(请|帮我|帮忙|需要|测试|验证)/, "")
    .replace(/^(不要|别|无需|不需要)/, "")
    .replace(/^(启动|打开|进入|前往|到达|点击|点开|填写|输入|选择|勾选|取消勾选|清空|确认|搜索|滑动到|滑动|返回|新建|创建)/, "")
    .replace(/(按钮|入口|页面|页|字段|输入框)$/g, "")
    .trim();
}

function splitTermCandidates(term: string): string[] {
  return term
    .split(/[“”"':：\s/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeSearchTerm(term: string): string {
  return compactWhitespace(term)
    .replace(/^(的|一个|一下|第一个|当前|当前页)/, "")
    .replace(/(但|并|然后).*$/g, "")
    .trim();
}

function isStopSearchTerm(term: string): boolean {
  return /^(app|App|APP|应用|当前页|页面|按钮|入口|字段|输入框)$/.test(term);
}

function isLikelyDynamicBusinessValue(term: string): boolean {
  return /[0-9]/.test(term) || /[一二三四五六七八九十百千万]+号/.test(term);
}

function languagesForPlatform(platform: PageAssetPlatform): string[] {
  if (platform === "android") return ["kotlin", "java"];
  if (platform === "ios") return ["swift", "objective-c"];
  if (platform === "harmony") return ["typescript", "javascript"];
  if (platform === "flutter") return ["dart"];
  return [];
}

function implementationStackForPlatform(platform: PageAssetPlatform): ScriptFlowExternalContext["implementationStack"] {
  if (platform === "android") return "android-native";
  if (platform === "ios") return "ios-native";
  if (platform === "harmony") return "harmony-native";
  if (platform === "flutter") return "flutter";
  return "unknown";
}

function dedupeResults(results: ClassInCodeResult[]): ClassInCodeResult[] {
  const sorted = [...results].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const seen = new Set<string>();
  const unique: ClassInCodeResult[] = [];
  for (const result of sorted) {
    const key = `${result.repoName}:${result.filePath}:${result.startLine ?? 0}:${result.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

function lineRef(result: ClassInCodeResult): string {
  if (result.startLine && result.endLine && result.endLine !== result.startLine) {
    return `${result.filePath}:${result.startLine}-${result.endLine}`;
  }
  if (result.startLine) {
    return `${result.filePath}:${result.startLine}`;
  }
  return result.filePath;
}

function removeEmptyContextFields(context: ScriptFlowExternalContext): ScriptFlowExternalContext {
  return {
    source: context.source,
    summary: context.summary,
    ...(context.implementationStack ? { implementationStack: context.implementationStack } : {}),
    ...(context.relevantFiles && context.relevantFiles.length > 0 ? { relevantFiles: context.relevantFiles } : {}),
    ...(context.candidateSteps && context.candidateSteps.length > 0 ? { candidateSteps: context.candidateSteps } : {}),
    ...(context.constraints && context.constraints.length > 0 ? { constraints: context.constraints } : {})
  };
}

function sanitizeContextText(text: string): string {
  return compactWhitespace(text)
    .replace(/resource[-_ ]?id\s*[:=]\s*[\w.$:/-]+/gi, "控件ID")
    .replace(/accessibility[-_ ]?id\s*[:=]\s*[\w.$:/-]+/gi, "可访问性ID")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b\d{8,}\b/g, "<number>");
}

function sanitizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function isClassInApp(appId: string): boolean {
  const normalized = appId.trim().toLowerCase();
  return normalized === "classin" || normalized === "cn.eeo.classin" || normalized.includes("classin");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function stringEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function commaSeparatedEnv(value: string | undefined): string[] | undefined {
  const values = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

function positiveIntegerEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return positiveInteger(Number(value));
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
