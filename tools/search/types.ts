/**
 * 搜索相关的公共类型
 *
 * 各搜索源（Tavily / 博查 / 360 / Bing）都实现 SearchProvider，
 * 统一返回 SearchResult[]，由 tools/search/index.ts 负责择优与降级。
 */

/** 单条搜索结果 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

/** 搜索参数 */
export interface SearchOptions {
  /** 期望返回条数（各源自行收敛到自己的上限） */
  maxResults?: number
}

/** 搜索源接口 */
export interface SearchProvider {
  /** 展示名（用于日志与降级提示） */
  name: string
  /** 是否可用（通常取决于是否配置了 API Key） */
  isAvailable: () => boolean
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>
}
