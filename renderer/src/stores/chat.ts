/**
 * 聊天工具状态（Pinia）
 *
 * 数据来源：主进程 IPC（见 src/api）—— 对话流式接口 + 会话管理，
 * 消息最终落在本地 SQLite。
 *
 * 流式文本不在这里逐字更新：增量交给页面的打字机渲染，结束后再把权威文本写入
 * 消息列表，这样既保留平滑的打字效果，又避免 Vue 与手动 DOM 写入互相覆盖。
 */
import { defineStore } from 'pinia'

import type { ChatResult, MessageRow } from '../../../types/ipc'
import { api } from '../api'

/** 界面上的消息（本地 id，避免与数据库 id 混用） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

let localSeq = 0
const localId = (prefix: string): string => `${prefix}-${Date.now()}-${++localSeq}`

export const useChatStore = defineStore('chat', {
  state: () => ({
    conversations: [] as Array<{ id: number; title: string }>,
    currentId: null as number | null,
    messages: [] as ChatMessage[],
    loadingMessages: false,
    sending: false,
    streaming: false, // 为 true 时页面渲染流式气泡（打字机把增量写进去）
    error: '',
  }),

  getters: {
    /** 当前会话标题（消息以首条内容自动命名，由主进程落库） */
    currentTitle (state): string {
      const conversation = state.conversations.find(
        (item) => Number(item.id) === Number(state.currentId)
      )
      if (conversation) return conversation.title
      return state.currentId ? '对话' : '新对话'
    },
    isEmpty (state): boolean {
      return !state.messages.length && !state.streaming
    },
  },

  actions: {
    /** 拉取会话列表 */
    async loadConversations (): Promise<void> {
      try {
        const rows = await api.listConversations()
        this.conversations = (rows || []).filter((row): row is NonNullable<typeof row> => Boolean(row))
      } catch (err) {
        this.error = `加载会话列表失败：${(err as Error).message}`
      }
    },

    /** 打开会话并载入历史消息 */
    async openConversation (id: number): Promise<void> {
      this.currentId = id
      this.messages = []
      this.error = ''
      this.loadingMessages = true
      try {
        const rows = (await api.getMessages(id)) || []
        this.messages = rows.map((row: MessageRow) => ({
          id: localId('db'),
          role: row.role === 'assistant' ? 'assistant' : 'user',
          content: row.content,
        }))
      } catch (err) {
        this.error = `加载消息失败：${(err as Error).message}`
      } finally {
        this.loadingMessages = false
      }
      await this.loadConversations()
    },

    /** 新建会话 */
    async newConversation (): Promise<{ id: number; title: string } | null> {
      try {
        const conversation = await api.createConversation()
        if (!conversation) return null
        this.currentId = conversation.id
        this.messages = []
        this.error = ''
        await this.loadConversations()
        return conversation
      } catch (err) {
        this.error = `新建会话失败：${(err as Error).message}`
        return null
      }
    },

    /** 删除会话（含其中的消息，由数据库级联删除） */
    async removeConversation (id: number): Promise<void> {
      try {
        await api.deleteConversation(id)
        if (Number(this.currentId) === Number(id)) {
          this.currentId = null
          this.messages = []
        }
        await this.loadConversations()
      } catch (err) {
        this.error = `删除会话失败：${(err as Error).message}`
      }
    },

    /** 乐观显示用户消息（不必等主进程返回） */
    pushUserMessage (text: string): void {
      this.messages.push({ id: localId('user'), role: 'user', content: text })
    },

    /** 进入流式状态：页面据此渲染流式气泡并挂上打字机 */
    beginStreaming (): void {
      this.streaming = true
    },

    /**
     * 发起一次对话
     * @param text 用户输入
     * @param onDelta 增量文本回调（交给打字机）
     */
    async sendMessage (text: string, onDelta?: (delta: string) => void): Promise<ChatResult> {
      this.sending = true
      this.error = ''
      try {
        const res = await api.chat(
          { message: text, conversationId: this.currentId },
          (delta) => { if (typeof onDelta === 'function') onDelta(delta) }
        )

        if (res && res.ok) {
          if (res.conversationId) this.currentId = res.conversationId
          this.messages.push({
            id: localId('assistant'),
            role: 'assistant',
            content: res.message || '',
          })
          await this.loadConversations()
          return { ok: true }
        }
        return { ok: false, error: (res && res.error) || '调用失败' }
      } catch (err) {
        return { ok: false, error: (err as Error)?.message || String(err) }
      } finally {
        this.sending = false
        this.streaming = false
      }
    },

    dismissError (): void {
      this.error = ''
    },

    /** 由页面在调用失败时写入错误信息 */
    setError (message: string): void {
      this.error = message || ''
    },
  },
})
