export async function apiFetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new Error(`服务未连接：${errorToString(error)}`);
  }

  const text = await response.text();
  const json = parseJsonPayload(text);
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(json) || response.statusText || `请求失败：${response.status}`);
  }
  if (json === undefined) {
    throw new Error("服务返回了空响应，请确认后端服务已正常启动");
  }
  return json as T;
}

function parseJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("服务返回了非 JSON 响应，请确认后端服务和代理配置正常");
  }
}

function errorMessageFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
