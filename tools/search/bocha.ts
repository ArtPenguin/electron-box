/**
 * 搜索提供方：博查（Bocha）Web Search，需 BOCHA_API_KEY
 *
 * 国内可直连、中文搜索友好；申请与文档：https://open.bochaai.com
 */
import { postJson } from '../http'
import type { SearchOptions, SearchProvider, SearchResult } from './types'

const ENDPOINT = 'https://api.bochaai.com/v1/web-search'

interface BochaItem {
  name?: string
  title?: string
  url?: string
  summary?: string
  snippet?: string
  datePublished?: string
}

interface BochaResponse {
  code?: number
  msg?: string
  data?: { webPages?: { value?: BochaItem[] } }
  webPages?: { value?: BochaItem[] }
}

const isAvailable = (): boolean => Boolean(process.env.BOCHA_API_KEY)

async function search (query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { maxResults = 5 } = options
  const data = await postJson<BochaResponse>(
    ENDPOINT,
    { query, summary: true, count: maxResults, freshness: 'noLimit' },
    { headers: { Authorization: `Bearer ${process.env.BOCHA_API_KEY}` } }
  )

  if (data.code && data.code !== 200) {
    throw new Error(data.msg || `博查返回错误码 ${data.code}`)
  }

  // 兼容 data.webPages 与顶层 webPages 两种包裹方式
  const pages = (data.data || data).webPages?.value
  if (!Array.isArray(pages)) return []

  return pages.map((item) => ({
    title: item.name || item.title || '',
    url: item.url || '',
    snippet: item.summary || item.snippet || '',
    publishedAt: item.datePublished || '',
  }))
}

const bochaProvider: SearchProvider = { name: 'Bocha', isAvailable, search }

export default bochaProvider
