/**
 * HTTP 小工具：统一超时、User-Agent 与错误信息，避免各搜索 provider 重复处理。
 * 使用 Node 18+ / Electron 主进程内置的全局 fetch，无需额外依赖。
 */

// 部分站点会拒绝空 UA，统一伪装为常见浏览器
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ElectAgent/1.0'

const DEFAULT_TIMEOUT_MS = 15000

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface GetOptions {
  headers?: Record<string, string>
  timeoutMs?: number
}

/**
 * 发起请求并校验 HTTP 状态码。
 * @returns 仅返回 2xx 响应，其余情况抛出可读错误
 */
export async function request (url: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(`网络请求失败（${(err as Error).message}）`)
  }
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
  return res
}

/** GET 文本内容（HTML / XML / JSON 原文） */
export async function getText (url: string, options?: GetOptions): Promise<string> {
  const res = await request(url, options)
  return res.text()
}

/** POST JSON 并解析 JSON 响应 */
export async function postJson<T = unknown> (
  url: string,
  payload: unknown,
  options?: GetOptions
): Promise<T> {
  const res = await request(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as T
}
