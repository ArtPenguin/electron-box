import path from 'node:path'

import { app, BrowserWindow, Notification, ipcMain, type IpcMainInvokeEvent } from 'electron'
import dotenv from 'dotenv'

// 加载环境变量（DEEPSEEK_API_KEY 等）
dotenv.config()

// 主进程中的 LangChain Agent
import { streamAgent } from './agent'

// SQLite 本地持久化（对话历史 / 会话管理 / 游戏时长）
import * as db from './db'

// 游戏时长控制工具（进程扫描 + 游戏识别 + 多游戏计时 + 额度提醒）
import * as game from './game'
import type { GameState, ReminderPayload } from './game/monitor'

// 流式增量频道：主进程 -> 渲染进程，按 requestId 区分每次请求
const STREAM_CHANNEL = 'chat:stream'

// 游戏工具的推送频道：状态变化 / 需要弹窗提醒
const GAME_STATE_CHANNEL = 'game:state'
const GAME_REMINDER_CHANNEL = 'game:reminder'

/** 渲染进程发起的对话请求 */
interface ChatRequest {
  message?: string
  conversationId?: number | null
  requestId?: string
}

/** 游戏识别规则（界面自定义：进程名 → 游戏名） */
interface GameRuleInput {
  processName?: string
  gameName?: string
}

// 创建窗口函数
function createWindow (): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      // 使用 preload 暴露安全 IPC，保持渲染进程隔离
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 开发模式（npm run dev）由 Vite dev server 提供热更新；
  // 生产/打包则加载构建产物 renderer/dist/index.html —— 该文件已把编译后的
  // JS/CSS 内联为单文件，因为以 file:// 加载时外部 ES module 会被 Chromium 的
  // CORS 策略拦截（document origin 为 null）。
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    // 主进程产物位于 dist/，因此页面相对路径向上回退一层
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'))
  }

  // 仅在开发模式下自动打开调试控制台；打包后不弹 DevTools
  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }
}

/** 用首条消息为会话自动生成标题（取前 18 个字符） */
function makeTitle (text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed
}

// ---------------------------------------------------------------------------
// 游戏时长工具：状态推送与提醒
// ---------------------------------------------------------------------------

/** 把消息推送给所有存活窗口 */
function broadcast (channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** 是否存在「用户能看到」的窗口（不可见时改用系统通知，保证提醒不被忽略） */
function hasVisibleWindow (): boolean {
  return BrowserWindow.getAllWindows().some(
    (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  )
}

/** 秒 -> 「1 小时 5 分钟」/「12 分钟」 */
function formatMinutes (seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) / 60))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours ? `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}` : `${minutes} 分钟`
}

/** 生成提醒文案（剩余不足预警 / 已达上限） */
function reminderText (payload: ReminderPayload): { title: string; body: string } {
  if (payload.level === 'over') {
    return {
      title: '游戏时长已达上限',
      body: `「${payload.gameName}」今日已玩 ${formatMinutes(payload.usedSeconds)}，达到 ${payload.limitSeconds / 60} 分钟限额，请适度游戏。`,
    }
  }
  return {
    title: '剩余游戏时长不足',
    body: `「${payload.gameName}」今日已玩 ${formatMinutes(payload.usedSeconds)}，仅剩 ${formatMinutes(payload.remainingSeconds)}，仍在游戏将每 ${game.getSettings().remindIntervalSeconds} 秒提醒一次。`,
  }
}

/** 启动游戏监控：状态推给界面，提醒推给界面并在窗口不可见时用系统通知兜底 */
function setupGameMonitoring (): void {
  game.on('state', (state) => broadcast(GAME_STATE_CHANNEL, state))
  game.on('reminder', (payload) => {
    broadcast(GAME_REMINDER_CHANNEL, payload)
    if (!hasVisibleWindow() && Notification.isSupported()) {
      const { title, body } = reminderText(payload)
      new Notification({ title, body }).show()
    }
  })

  game.start()
}

// electron 就绪后创建窗口
app.whenReady().then(() => {
  // 初始化本地 SQLite（存放在 userData 目录，即系统应用数据目录下）
  db.initDatabase(path.join(app.getPath('userData'), 'chat.db'))

  // ---- 对话：渲染进程通过 window.api.chat(payload, onChunk) 调用 ----
  // 回复以 token 流式推送（chat:stream 频道），返回值仍为完整结果，便于落库与容错。
  ipcMain.handle('chat', async (event: IpcMainInvokeEvent, payload: ChatRequest) => {
    try {
      const { message, conversationId, requestId } = payload || {}
      if (!message || !message.trim()) {
        return { ok: false, error: '消息不能为空' }
      }
      const text = message.trim()

      // 1) 定位会话；未提供或不存在则自动创建
      let conversation = conversationId ? db.getConversation(conversationId) : null
      const isNewConversation = !conversation
      if (!conversation) conversation = db.createConversation()
      if (!conversation) return { ok: false, error: '创建会话失败' }

      // 2) 从数据库读取历史消息（切换会话后不丢上下文）
      const history = db.listMessages(conversation.id).map((row) => ({
        role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: row.content,
      }))

      // 3) 调用 Agent，并把增量文本实时推送给发起本次请求的窗口
      const answer = await streamAgent(text, history, (delta) => {
        if (!requestId || event.sender.isDestroyed()) return
        event.sender.send(STREAM_CHANNEL, { requestId, delta })
      })

      // 4) 持久化本轮 user / assistant 消息
      db.addMessage(conversation.id, 'user', text)
      db.addMessage(conversation.id, 'assistant', answer)

      // 5) 新会话自动用首条消息命名
      if (isNewConversation) {
        db.renameConversation(conversation.id, makeTitle(text))
      }

      const fresh = db.getConversation(conversation.id)
      return {
        ok: true,
        message: answer,
        conversationId: conversation.id,
        title: fresh ? fresh.title : '',
      }
    } catch (err) {
      console.error('[agent] 调用失败:', err)
      return { ok: false, error: (err as Error)?.message || String(err) }
    }
  })

  // ---- 会话管理 ----
  ipcMain.handle('conversations:list', () => db.listConversations())

  ipcMain.handle('conversations:create', () => db.createConversation())

  ipcMain.handle('conversations:delete', (_event, id: number) => {
    db.deleteConversation(id)
    return { ok: true }
  })

  ipcMain.handle('conversations:messages', (_event, id: number) => db.listMessages(id))

  // ---- 游戏时长工具：状态查询 / 手动暂停 / 配置修改 ----
  ipcMain.handle('game:state', (): GameState => game.getState())

  ipcMain.handle('game:stats', (_event, days?: number) => game.getStats({ days }))

  ipcMain.handle('game:pause', (_event, paused: boolean) => game.setPaused(paused))

  ipcMain.handle('game:settings', (_event, patch: Partial<Record<string, unknown>>) =>
    game.updateSettings(patch)
  )

  // ---- 游戏识别名单：查看 / 自定义 / 屏蔽（游戏名来自进程统计，识别错了可以纠正）----
  ipcMain.handle('game:registry', () => game.getRegistry())

  ipcMain.handle('game:registry:save', (_event, rule: GameRuleInput) =>
    game.saveGameRule({
      processName: String(rule?.processName || ''),
      gameName: String(rule?.gameName || ''),
    })
  )

  ipcMain.handle('game:registry:remove', (_event, processName: string) =>
    game.removeGameRule(processName)
  )

  ipcMain.handle('game:ignore', (_event, processName: string) => game.ignoreProcess(processName))

  ipcMain.handle('game:restore', (_event, processName: string) => game.restoreProcess(processName))

  // 应用启动即开始监控：检测到游戏主进程启动会自动计时
  // （启动器 / 客户端 / 反作弊等非游戏主进程不检测、不计时、不在界面显示）
  setupGameMonitoring()

  createWindow()
})

// 全部窗口关闭退出应用(windows)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前结束进行中的游戏会话（补记结束时间），再关闭数据库
app.on('will-quit', () => {
  game.stop()
  db.closeDatabase()
})

