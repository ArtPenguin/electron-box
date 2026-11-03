/**
 * 主进程能力封装（window.api）
 *
 * 集中一处访问 preload 暴露的 IPC：
 * - 页面与 store 只依赖本模块，不直接读 window.api，便于替换与测试
 * - 直接用浏览器打开 Vite dev server 调试界面时（npm run dev 时的调试场景），
 *   window.api 不存在，这里提供可用且安全的兜底实现，界面不会因缺 API 而崩溃
 */
import type { AppApi } from '../../../types/ipc'

const noUnsubscribe = (): void => {}
const emptyList = async (): Promise<never[]> => []

/** 纯浏览器环境下的兜底实现（Electron 中始终使用真实的 window.api） */
const fallback: AppApi = {
  chat: async () => ({ ok: false, error: '当前不在 Electron 环境中运行，无法调用模型' }),
  listConversations: emptyList,
  createConversation: async () => ({ id: 0, title: '新对话', createdAt: '', updatedAt: '' }),
  deleteConversation: async () => ({ ok: true }),
  getMessages: emptyList,
  game: {
    getState: async () => null,
    getStats: async () => null,
    setPaused: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    updateSettings: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    getRegistry: emptyList,
    saveRule: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    removeRule: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    ignoreProcess: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    restoreProcess: async () => ({ ok: false, error: '当前不在 Electron 环境中运行' }),
    onState: () => noUnsubscribe,
    onReminder: () => noUnsubscribe,
  },
}

export const api: AppApi = window.api ?? fallback

/** 是否运行在 Electron 中（界面可据此提示受限能力） */
export const isDesktop = Boolean(window.api)
