/**
 * 搜索提供方：Tavily（需 TAVILY_API_KEY）
 *
 * 面向 LLM 的搜索 API，返回结构化结果；申请地址：https://app.tavily.com
 */
import { postJson } from '../http'
import type { SearchOptions, SearchProvider, SearchResult } from './types'

const ENDPOINT = 'https://api.tavily.com/search'

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>
}

const isAvailable = (): boolean => Boolean(process.env.TAVILY_API_KEY)

async function search (query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { maxResults = 5 } = options
  const data = await postJson<TavilyResponse>(
    ENDPOINT,
    {
      query,
      search_depth: 'basic',
      topic: 'general',
      max_results: maxResults,
      include_answer: false,
    },
    { headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` } }
  )

  return (data.results || []).map((item) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: item.content || '',
  }))
}

const tavilyProvider: SearchProvider = { name: 'Tavily', isAvailable, search }

export default tavilyProvider
