/**
 * LangChain Agent —— 运行于 Electron 主进程
 *
 * 使用 DeepSeek（OpenAI 兼容接口）通过 @langchain/openai 接入，
 * 并借助 @langchain/langgraph 的 createReactAgent 构建带工具调用能力的 Agent。
 *
 * 工具定义拆分在 tools/ 目录（计算器、当前时间、联网搜索），
 * 新增工具只需在 tools/index.ts 登记，本文件无需改动。
 *
 * 对外提供两条入口，二者共用同一条执行路径：
 * - streamAgent(text, history, onToken)：token 级流式，供界面实现「打字效果」；
 * - runAgent(text, history)：一次性返回完整回复（内部复用 streamAgent）。
 *
 * 说明：为避免缺少 DEEPSEEK_API_KEY 时应用启动即崩溃，模型与 agent 采用「懒加载」，
 *      实际调用 streamAgent / runAgent 时才初始化；若未配置密钥，主进程 IPC 会返回友好错误。
 */
import {
  AIMessage,
  HumanMessage,
  isAIMessageChunk,
  type BaseMessageChunk,
} from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'

import { tools } from './tools'
import { describeProviders } from './tools/search'

/** 会话历史消息（与数据库 messages 表结构对应） */
export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

// Agent 人设与工具使用策略
const SYSTEM_PROMPT = [
  '你是一个运行在 Electron 主进程中的中文 AI 助手。',
  '请始终使用简体中文回答问题。',
  '当问题涉及数学计算或当前时间时，请先调用对应工具，再基于工具结果给出最终答案。',
  '当问题涉及实时信息（新闻、天气、股价、价格、赛事、人物近况、软件最新版本等），或你不确定的事实时，请先调用 webSearch 工具联网搜索，再基于搜索结果回答。',
  '引用搜索结果时请标注来源链接；若搜索结果不足以回答，请如实说明，不要编造。',
].join('\n')

// ---------------------------------------------------------------------------
// 模型与 Agent（懒加载）
// ---------------------------------------------------------------------------
let agent: ReturnType<typeof createReactAgent> | null = null

function getAgent (): ReturnType<typeof createReactAgent> {
  if (agent) return agent

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY，请在项目根目录创建 .env 文件（参考 .env.example）')
  }

  const llm = new ChatOpenAI({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.3,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    },
  })

  agent = createReactAgent({
    llm,
    tools,
    prompt: SYSTEM_PROMPT,
  })

  console.log(
    `[agent] 已就绪 | 工具：${tools.map((item) => item.name).join('、')} | 搜索源：${describeProviders()}`
  )

  return agent
}

// ---------------------------------------------------------------------------
// 工具函数与对外 API
// ---------------------------------------------------------------------------

/** 提取消息文本内容（兼容 string 与 content 块数组两种格式） */
export function extractText (content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (part as { text?: string })?.text || '').join('')
  }
  return String(content ?? '')
}

/** 把「历史消息 + 最新消息」整理为 LangChain 消息数组 */
export function buildMessages (
  text: string,
  history: ChatHistoryItem[] = []
): Array<HumanMessage | AIMessage> {
  const messages: Array<HumanMessage | AIMessage> = []
  for (const item of history || []) {
    if (!item || typeof item.content !== 'string') continue
    messages.push(
      item.role === 'assistant' ? new AIMessage(item.content) : new HumanMessage(item.content)
    )
  }
  messages.push(new HumanMessage(text))
  return messages
}

/**
 * 以 token 流式方式运行 Agent：模型每产出增量文本就回调一次 onToken。
 *
 * 说明：Agent 可能多次调用模型（先决策工具、再生成答复），其中「决策阶段」的增量
 *      只含 tool_calls、文本为空，会被过滤掉，因此推送给界面的都是面向用户的正文。
 *
 * @param text 用户最新消息
 * @param history 历史消息（可选）
 * @param onToken 增量文本回调（可选）
 * @returns 本次回复的完整文本（与流式推送内容一致）
 */
export async function streamAgent (
  text: string,
  history: ChatHistoryItem[] = [],
  onToken?: (delta: string) => void
): Promise<string> {
  const reactAgent = getAgent()
  const stream = await reactAgent.stream(
    { messages: buildMessages(text, history) },
    { streamMode: 'messages' }
  )

  let full = ''
  for await (const chunk of stream as AsyncIterable<[unknown]>) {
    const message = (Array.isArray(chunk) ? chunk[0] : chunk) as BaseMessageChunk | undefined
    if (!message || !isAIMessageChunk(message)) continue // 跳过工具结果等非模型消息
    const delta = extractText(message.content)
    if (!delta) continue // 跳过仅含工具调用、无正文的增量
    full += delta
    if (typeof onToken === 'function') onToken(delta)
  }
  return full
}

/**
 * 运行 Agent（非流式、一次性拿到完整回复；内部复用 streamAgent 保证两条路径行为一致）
 */
export function runAgent (text: string, history: ChatHistoryItem[] = []): Promise<string> {
  return streamAgent(text, history)
}
