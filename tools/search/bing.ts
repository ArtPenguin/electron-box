/**
 * 搜索提供方：Bing（RSS 输出，免 Key，末位兜底）
 *
 * 说明：Bing 支持以 format=rss 返回标准 RSS，比抓取 HTML 更稳定；但实测其 RSS 通道
 *      对「中文 + 空格」查询会退化成单字匹配，故仅作为最后的兜底源（主兜底为 360）。
 */
import { getText } from '../http'
import { toPlainText } from './html'
import type { SearchOptions, SearchProvider, SearchResult } from './types'

const ENDPOINT = 'https://www.bing.com/search'

/** 无需密钥，恒可用 */
const isAvailable = (): boolean => true

async function search (query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { maxResults = 5 } = options
  const keyword = normalizeQuery(query)
  const url = `${ENDPOINT}?format=rss&count=${maxResults}&q=${encodeURIComponent(keyword)}`
  const xml = await getText(url)
  return parseItems(xml).slice(0, maxResults)
}

/**
 * 纯中文（含数字）查询去掉空格，避免 Bing 退化为单字匹配；
 * 含拉丁字母的查询保持原样，否则会破坏英文短语的可读性。
 */
function normalizeQuery (query: string): string {
  return /^[\u4e00-\u9fff0-9\s]+$/.test(query) ? query.replace(/\s+/g, '') : query
}

/** 解析 RSS 中的 <item> 列表 */
function parseItems (xml: string): SearchResult[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const block = match[1]
    return {
      title: toPlainText(pick(block, 'title')),
      url: toPlainText(pick(block, 'link')),
      snippet: toPlainText(pick(block, 'description')),
    }
  })
}

/** 取出某个标签内的原始内容 */
function pick (block: string, tag: string): string {
  const matched = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return matched ? matched[1].trim() : ''
}

const bingProvider: SearchProvider = { name: 'Bing', isAvailable, search }

export default bingProvider
