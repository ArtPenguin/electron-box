/**
 * 主进程 ↔ 渲染进程 的共享契约类型（IPC 单点定义）
 *
 * 为什么单独放这里：
 * - 主进程（main.ts / preload.ts / game/）与渲染层（Vue 组件 / Pinia store）
 *   都依赖同一份数据形状，放在本文件保证前后端不会各写一套而悄悄漂移；
 * - 本文件是**纯类型**（无运行时代码、不依赖 electron / node / DOM），
 *   因此两边都可以安全地 `import type`（编译期擦除，不产生运行时依赖）。
 */

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system'

/** 识别来源：内置库命中 / 自动识别（含目录推断）/ 用户自定义（优先级最高） */
export type GameRuleSource = 'builtin' | 'learned' | 'user'

// ---------------------------------------------------------------------------
// 对话
// ---------------------------------------------------------------------------

export interface Conversation {
  id: number
  title: string
  createdAt: string
  updatedAt: string
}

export interface MessageRow {
  id: number
  role: MessageRole
  content: string
  createdAt: string
}

/** 发起一次对话 */
export interface ChatRequest {
  message: string
  conversationId?: number | null
}

/** 对话结果（ok=false 时 error 为可读原因） */
export interface ChatResult {
  ok: boolean
  message?: string
  conversationId?: number
  title?: string
  error?: string
}

// ---------------------------------------------------------------------------
// 游戏时长
// ---------------------------------------------------------------------------

/** 一次「检测到游戏启动 → 检测到退出」的计时记录 */
export interface GameSession {
  id: number
  gameKey: string
  gameName: string
  playDate: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number
  pausedSeconds: number
  updatedAt: string
}

/** 正在计时的游戏（多款并行时会有多条） */
export interface ActiveGameState {
  key: string
  name: string
  source: GameRuleSource
  processName: string
  sessionId: number
  startedAt: string
  durationSeconds: number
  pausedSeconds: number
}

/** 游戏工具配置 */
export interface GameSettings {
  dailyLimitMinutes: number
  remindIntervalSeconds: number
  nearThresholdMinutes: number
}

/** 按游戏汇总时长 */
export interface GameSecondsByGame {
  gameKey: string
  gameName: string
  seconds: number
  sessions: number
}

/** 监控器推送的完整状态 */
export interface GameState {
  monitoring: boolean
  paused: boolean
  running: boolean
  /** 正在计时的游戏（只含游戏主进程；启动器 / 客户端 / 反作弊等不会出现在这里） */
  games: ActiveGameState[]
  /** 最近开始计时的那款（顶部状态与徽标） */
  game: { key: string; name: string } | null
  session: { id: number; startedAt: string; durationSeconds: number; pausedSeconds: number } | null
  today: {
    date: string
    totalSeconds: number
    limitSeconds: number
    remainingSeconds: number
    overLimit: boolean
    byGame: GameSecondsByGame[]
  }
  sessions: Array<GameSession | null>
  registry: GameProcessMapRow[]
  ignoredProcesses: string[]
  settings: GameSettings
  lastError: string | null
}

/** 图表数据（最近 N 天） */
export interface GameStats {
  days: string[]
  fromDate: string
  toDate: string
  daily: Array<{ date: string; seconds: number; sessions: number }>
  byGame: GameSecondsByGame[]
  totalSeconds: number
  todaySeconds: number
  limitSeconds: number
}

/** 额度提醒事件 */
export interface ReminderPayload {
  level: 'over' | 'near'
  gameName: string
  usedSeconds: number
  limitSeconds: number
  remainingSeconds: number
  at: string
}

/** 进程 → 游戏 的识别记录（界面上可改名 / 屏蔽） */
export interface GameProcessMapRow {
  processName: string
  gameKey: string
  gameName: string
  source: GameRuleSource
  createdAt: string
  updatedAt: string
}

/** 写入类操作（保存规则 / 屏蔽 / 恢复）的统一返回 */
export interface GameActionResult {
  ok: boolean
  error?: string
  /** 操作后的完整状态，便于界面立即刷新 */
  state?: GameState
}

/** 修改配置的返回 */
export interface GameSettingsResult {
  ok: boolean
  error?: string
  settings?: GameSettings
  state?: GameState
}

// ---------------------------------------------------------------------------
// preload 暴露给渲染进程的 API（window.api）
// ---------------------------------------------------------------------------

/**
 * 主进程能力清单
 *
 * 约定：GameState 相关能力都挂在 api.game 下；所有方法在纯浏览器环境（不带 preload
 * 打开页面）下由 renderer/src/api 提供兜底实现，因此返回 Promise 而不是同步值。
 */
export interface AppApi {
  /** 发起一次对话；回复增量通过 onChunk 实时回调（打字机效果用） */
  chat: (payload: ChatRequest, onChunk?: (delta: string) => void) => Promise<ChatResult>
  listConversations: () => Promise<Array<Conversation | null>>
  createConversation: () => Promise<Conversation | null>
  deleteConversation: (id: number) => Promise<{ ok: boolean }>
  getMessages: (id: number) => Promise<MessageRow[]>

  game: {
    /** 当前状态：计时中的游戏（只含游戏主进程）、今日累计、识别名单等 */
    getState: () => Promise<GameState | null>
    /** 图表数据：最近 N 天的每日时长与各游戏占比 */
    getStats: (days?: number) => Promise<GameStats | null>
    /** 手动暂停 / 继续计时 */
    setPaused: (paused: boolean) => Promise<GameActionResult>
    /** 修改配置（每日限额、提醒间隔、预警阈值） */
    updateSettings: (patch: Partial<GameSettings>) => Promise<GameSettingsResult>
    /** 游戏识别名单：游戏名 / 关联进程 / 来源 */
    getRegistry: () => Promise<GameProcessMapRow[]>
    /** 新增 / 覆盖「进程 → 游戏」识别规则（识别错了可手动纠正） */
    saveRule: (rule: { processName: string; gameName: string }) => Promise<GameActionResult>
    /** 删除自定义识别规则（内置与自动识别的记录只能改，不能删） */
    removeRule: (processName: string) => Promise<GameActionResult>
    /** 屏蔽进程（之后不再当作游戏计时） */
    ignoreProcess: (processName: string) => Promise<GameActionResult>
    /** 取消屏蔽 */
    restoreProcess: (processName: string) => Promise<GameActionResult>
    /** 订阅状态推送，返回取消订阅函数（组件卸载时调用） */
    onState: (handler: (state: GameState) => void) => () => void
    /** 订阅提醒（剩余不足预警 / 已达限额，仍在游戏则每 30 秒重复） */
    onReminder: (handler: (payload: ReminderPayload) => void) => () => void
  }
}
