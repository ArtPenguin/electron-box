/**
 * 搜索提供方：360 搜索（免 Key 兜底，中文相关性好）
 *
 * 选型依据（实测）：Bing 的 RSS 通道对「中文 + 空格」查询会退化成单字匹配
 * （如「黑神话 悟空 发行日期」返回「黑」字释义），因此免 Key 场景以 360 为主；
 * 该源的结果条目带 data-mdurl 属性，可直接取到目标真实地址，无需跟随跳转链接。
 *
 * 注意：本提供方依赖搜索结果页的 DOM 结构，若 360 改版导致解析为空，
 *      上层会自动降级到下一个搜索源，不会中断对话。
 */
import { getText } from '../http'
import { decodeEntities, toPlainText } from './html'
import type { SearchOptions, SearchProvider, SearchResult } from './types'

const ENDPOINT = 'https://www.so.com/s'

const TITLE_BLOCK = /<h3[^>]*class="res-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/
const REAL_URL = /data-mdurl="([^"]+)"/
const FALLBACK_URL = /href="([^"]+)"/

// 摘要按优先级尝试：res-desc 最精确，其余为不同结果样式的容器
const SUMMARY_PATTERNS: RegExp[] = [
  /<(p|div|span)[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/\1>/,
  /<(p|div|span)[^>]*class="[^"]*res-(?:list-summary|comm-con)[^"]*"[^>]*>([\s\S]*?)<\/\1>/,
]

/** 无需密钥，恒可用 */
const isAvailable = (): boolean => true

async function search (query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { maxResults = 5 } = options
  const html = await getText(`${ENDPOINT}?q=${encodeURIComponent(query)}`)
  return splitItems(html)
    .map(parseItem)
    .filter((item): item is SearchResult => Boolean(item))
    .slice(0, maxResults)
}

/** 结果条目以 <li> 分隔，只保留含结果标题的片段 */
function splitItems (html: string): string[] {
  return html.split(/<li[\s>]/).filter((block) => block.includes('class="res-title'))
}

/** 从单个结果条目中解析标题 / 真实地址 / 摘要 */
function parseItem (block: string): SearchResult | null {
  const titleBlock = block.match(TITLE_BLOCK)?.[1]
  if (!titleBlock) return null

  const url = block.match(REAL_URL)?.[1] || titleBlock.match(FALLBACK_URL)?.[1]
  if (!url) return null

  return {
    title: toPlainText(titleBlock),
    url: decodeEntities(url),
    snippet: toPlainText(pickSnippet(block)),
  }
}

function pickSnippet (block: string): string {
  for (const pattern of SUMMARY_PATTERNS) {
    const matched = block.match(pattern)
    if (matched) return matched[2]
  }
  return ''
}

const so360Provider: SearchProvider = { name: '360搜索', isAvailable, search }

export default so360Provider
