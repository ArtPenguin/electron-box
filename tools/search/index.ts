/**
 * 搜索提供方注册与调度
 *
 * 优先级：Tavily → 博查（需密钥，结果质量最佳）→ 360搜索 → Bing（免 Key 兜底）。
 * 调度策略：跳过未配置密钥的提供方，依次尝试；某个源报错或没有结果时自动降级到
 *          下一个，全部失败才抛错，因此「没配密钥」也能正常联网搜索。
 *
 * 统一结果格式：[{ title, url, snippet, publishedAt? }]
 */
import bing from './bing'
import bocha from './bocha'
import so360 from './so360'
import tavily from './tavily'
import type { SearchOptions, SearchProvider, SearchResult } from './types'

// 优先级从高到低
const providers: SearchProvider[] = [tavily, bocha, so360, bing]

// 单条摘要最大长度，避免长文本挤占模型上下文
const SNIPPET_MAX_LENGTH = 500

export interface SearchResponse {
  provider: string
  query: string
  results: SearchResult[]
}

/** 联网搜索（自动选择可用的搜索源，失败时逐级降级） */
export async function searchWeb (query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const { maxResults = 5 } = options
  const failures: string[] = []

  for (const provider of providers) {
    if (!provider.isAvailable()) continue
    try {
      const results = normalize(await provider.search(query, { maxResults }))
      if (results.length > 0) return { provider: provider.name, query, results }
      failures.push(`${provider.name} 未返回结果`)
    } catch (err) {
      failures.push(`${provider.name}：${(err as Error).message}`)
    }
  }

  throw new Error(failures.join('；') || '没有可用的搜索源')
}

/** 各搜索源的启用情况（用于启动日志，便于排查为什么走了某个源） */
export function describeProviders (): string {
  return providers
    .map((provider) => `${provider.name}${provider.isAvailable() ? '' : '(未配置)'}`)
    .join(' → ')
}

/** 归一化结果：丢弃无链接的条目、压缩空白、截断过长摘要 */
function normalize (results: SearchResult[] | undefined): SearchResult[] {
  return (results || [])
    .filter((item) => item && item.url)
    .map((item) => ({
      title: flatten(item.title) || item.url,
      url: item.url,
      snippet: truncate(flatten(item.snippet)),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    }))
}

const flatten = (text: unknown): string => String(text || '').replace(/\s+/g, ' ').trim()

const truncate = (text: string): string =>
  text.length > SNIPPET_MAX_LENGTH ? `${text.slice(0, SNIPPET_MAX_LENGTH)}…` : text

export type { SearchResult, SearchProvider, SearchOptions } from './types'
