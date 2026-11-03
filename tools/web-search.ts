/**
 * 工具：联网搜索
 *
 * 供 Agent 查询实时信息；底层搜索源由 tools/search 自动选择并逐级降级
 * （Tavily → 博查 → 360搜索 → Bing），此处只负责参数校验与错误兜底。
 */
import { tool } from '@langchain/core/tools'

import { searchWeb } from './search'

const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS_LIMIT = 10

const webSearchTool = tool(
  async ({ query, maxResults }: { query: string; maxResults?: number }) => {
    const keyword = typeof query === 'string' ? query.trim() : ''
    if (!keyword) return { error: '搜索关键词不能为空' }

    try {
      return await searchWeb(keyword, { maxResults: clampLimit(maxResults) })
    } catch (err) {
      return { error: `联网搜索失败：${(err as Error).message}` }
    }
  },
  {
    name: 'webSearch',
    description:
      '联网搜索：用于查询实时或你不确定的信息（新闻、天气、股价、价格、赛事、人物近况、软件最新版本等）。' +
      '输入关键词，返回若干条网页结果（标题、链接、摘要）；请基于结果作答并给出处。',
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，尽量简短精准，例如 "DeepSeek V3 发布时间"',
        },
        maxResults: {
          type: 'number',
          description: `返回结果条数，默认 ${DEFAULT_MAX_RESULTS}，最多 ${MAX_RESULTS_LIMIT}`,
        },
      },
      required: ['query'],
    },
  }
)

/** 收敛条数到 [1, MAX_RESULTS_LIMIT]，非法值回落到默认值 */
export function clampLimit (value: unknown): number {
  const num = Math.floor(Number(value))
  if (!Number.isFinite(num) || num < 1) return DEFAULT_MAX_RESULTS
  return Math.min(num, MAX_RESULTS_LIMIT)
}

export default webSearchTool
