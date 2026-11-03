import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AppApi, ChatRequest, ChatResult, GameState, ReminderPayload } from './types/ipc'

// 流式增量频道（与主进程约定一致）
const STREAM_CHANNEL = 'chat:stream'

// 游戏工具频道：状态推送 / 提醒
const GAME_STATE_CHANNEL = 'game:state'
const GAME_REMINDER_CHANNEL = 'game:reminder'

let requestSeq = 0

/**
 * 订阅主进程推送，返回取消订阅函数（组件卸载时调用，避免重复监听）
 */
function subscribe<T> (channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

/**
 * 发起一次对话；回复的增量文本会通过 onChunk 实时回调，用于界面打字效果。
 *
 * 实现说明：每次请求生成唯一 requestId，只监听属于自己的增量事件，
 *          请求结束（无论成功/失败）后立即移除监听，避免泄漏与串台。
 */
function chat (payload: ChatRequest, onChunk?: (delta: string) => void): Promise<ChatResult> {
  const requestId = `chat-${Date.now()}-${++requestSeq}`
  const handler = (_event: IpcRendererEvent, data: { requestId?: string; delta?: string }): void => {
    if (data && data.requestId === requestId && typeof data.delta === 'string' && onChunk) {
      onChunk(data.delta)
    }
  }

  if (typeof onChunk === 'function') ipcRenderer.on(STREAM_CHANNEL, handler)
  return (ipcRenderer.invoke('chat', { ...payload, requestId }) as Promise<ChatResult>).finally(() =>
    ipcRenderer.off(STREAM_CHANNEL, handler)
  )
}

/** 渲染进程中安全暴露的主进程能力（契约见 types/ipc.ts 的 AppApi） */
const api: AppApi = {
  // 对话（带流式回调）
  chat,
  // 会话管理
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  createConversation: () => ipcRenderer.invoke('conversations:create'),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  getMessages: (id) => ipcRenderer.invoke('conversations:messages', id),

  // 游戏时长控制工具
  game: {
    /** 当前状态：正在计时的游戏（可多款，只含游戏主进程）、今日累计、识别名单 */
    getState: () => ipcRenderer.invoke('game:state'),
    /** 图表数据：最近 N 天的每日时长与各游戏占比 */
    getStats: (days) => ipcRenderer.invoke('game:stats', days),
    /** 手动暂停 / 继续计时 */
    setPaused: (paused) => ipcRenderer.invoke('game:pause', paused),
    /** 修改配置（每日限额、提醒间隔、预警阈值） */
    updateSettings: (patch) => ipcRenderer.invoke('game:settings', patch),
    /** 游戏识别名单：游戏名 / 关联进程 / 来源（user | learned | builtin） */
    getRegistry: () => ipcRenderer.invoke('game:registry'),
    /** 新增 / 覆盖「进程 → 游戏」识别规则（识别错了可手动纠正） */
    saveRule: (rule) => ipcRenderer.invoke('game:registry:save', rule),
    /** 删除自定义识别规则（内置与自动识别的记录只能改，不能删） */
    removeRule: (processName) => ipcRenderer.invoke('game:registry:remove', processName),
    /** 屏蔽进程（识别错了用它纠正：之后不再当作游戏计时） */
    ignoreProcess: (processName) => ipcRenderer.invoke('game:ignore', processName),
    /** 取消屏蔽 */
    restoreProcess: (processName) => ipcRenderer.invoke('game:restore', processName),
    /** 订阅状态推送，返回取消订阅函数（组件卸载时调用） */
    onState: (handler) => subscribe<GameState>(GAME_STATE_CHANNEL, handler),
    /** 订阅提醒（剩余不足预警 / 已达限额，仍在游戏则每 30 秒重复） */
    onReminder: (handler) => subscribe<ReminderPayload>(GAME_REMINDER_CHANNEL, handler),
  },
}

// 在渲染进程中安全暴露 api（contextIsolation 开启时使用）
contextBridge.exposeInMainWorld('api', api)
