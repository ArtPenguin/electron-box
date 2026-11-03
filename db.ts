/**
 * SQLite 本地持久化（TypeScript，基于 Node 内置 node:sqlite，无原生编译依赖）
 *
 * 存储数据：
 * - conversations：会话（标题、创建/更新时间）
 * - messages：每条会话下的消息（role: user / assistant / system）
 * - game_sessions：游戏时长会话（按「日期 + 游戏」记录开始/结束时间与累计时长）
 * - game_settings：游戏工具配置（每日限额、提醒间隔等）
 * - game_process_map：进程 → 游戏 的识别名单（内置命中 / 自动识别 / 用户自定义）
 * - game_ignored_processes：被用户屏蔽的进程（识别错误时排除）
 *
 * 设计说明：
 * - 本模块不依赖 electron，方便单独测试；Electron 侧在 app.whenReady 后
 *   用 userData 下的路径调用 initDatabase() 完成初始化
 * - 数据库列名是 snake_case，对外统一返回 camelCase 对象（rowTo* 函数集中转换），
 *   避免调用方各自拼写列名
 * - node:sqlite 返回值类型较宽（SQLOutputValue），此处用 toText / toNumber 收敛，
 *   既保证类型安全又避免到处写 as 断言
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'

// 与渲染层共享的契约类型（单点定义在 types/ipc.ts，前后端不会各写一套而漂移）
import type {
  Conversation,
  GameProcessMapRow,
  GameRuleSource,
  GameSecondsByGame,
  GameSession,
  MessageRole,
  MessageRow,
} from './types/ipc'

export type {
  Conversation,
  GameProcessMapRow,
  GameRuleSource,
  GameSecondsByGame,
  GameSession,
  MessageRole,
  MessageRow,
}

/** 屏蔽名单记录 */
export interface IgnoredProcessRow {
  processName: string
  createdAt: string
}

/** 日期区间条件（含首尾，格式 YYYY-MM-DD） */
export interface DateRange {
  fromDate?: string
  toDate?: string
}

export interface GameSessionQuery extends DateRange {
  gameKey?: string
  limit?: number
}

/** 游戏会话的更新字段（只写传入的字段） */
export interface GameSessionPatch {
  durationSeconds?: number
  pausedSeconds?: number
  /** null 表示仍在进行中；undefined 表示本次不修改 */
  endedAt?: string | null
}

/** 按天汇总结果（统计内部使用） */
export interface DailyGameSeconds {
  playDate: string
  seconds: number
  sessions: number
}

let db: DatabaseSync | null = null

/** 初始化数据库（幂等）：建表 + WAL + 外键 */
export function initDatabase (dbPath: string): DatabaseSync {
  if (db) return db
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const instance = new DatabaseSync(dbPath)
  instance.exec('PRAGMA journal_mode = WAL;')
  instance.exec('PRAGMA foreign_keys = ON;')
  instance.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '新对话',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content         TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, id);

    -- 游戏时长：一次「检测到启动 → 检测到退出」记为一条会话；
    -- play_date 为本地日期，跨天会自动拆成两条，便于按天统计。
    CREATE TABLE IF NOT EXISTS game_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      game_key         TEXT NOT NULL,
      game_name        TEXT NOT NULL,
      play_date        TEXT NOT NULL,
      started_at       TEXT NOT NULL,
      ended_at         TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      paused_seconds   INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_game_sessions_date
      ON game_sessions(play_date, game_key);

    -- 游戏工具配置（key-value，便于后续扩展更多可调项）
    CREATE TABLE IF NOT EXISTS game_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 进程 → 游戏 的识别名单：游戏名称随进程统计得出并记录下来
    -- source：builtin（内置游戏库命中）/ learned（自动识别或目录推断）/ user（用户自定义，优先级最高）
    CREATE TABLE IF NOT EXISTS game_process_map (
      process_name TEXT PRIMARY KEY,
      game_key     TEXT NOT NULL,
      game_name    TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'learned'
                   CHECK (source IN ('builtin', 'learned', 'user')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_game_process_map_game
      ON game_process_map(game_key);

    -- 被用户屏蔽的进程：识别错了可以屏蔽，屏蔽后不再参与游戏识别与计时
    CREATE TABLE IF NOT EXISTS game_ignored_processes (
      process_name TEXT PRIMARY KEY,
      created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `)
  db = instance
  return instance
}

/** 关闭数据库（应用退出时调用） */
export function closeDatabase (): void {
  if (!db) return
  try {
    db.close()
  } catch {
    // 已关闭或文件被占用：退出流程不因此中断
  }
  db = null
}

function getDb (): DatabaseSync {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase(dbPath)')
  return db
}

// ---------------------------------------------------------------------------
// 类型收敛辅助（node:sqlite 的返回值是宽类型 SQLOutputValue）
// ---------------------------------------------------------------------------

/** 文本字段：null / undefined 统一转为 '' */
const toText = (value: SQLOutputValue | undefined): string => (value == null ? '' : String(value))

/** 数字字段：无法解析时回退 0 */
const toNumber = (value: SQLOutputValue | undefined): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/** 数字字段：无法解析时回退默认值（用于可选统计列） */
const toNumberOr = (value: SQLOutputValue | undefined, fallback: number): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

const TOUCH_SQL = `UPDATE conversations
                   SET updated_at = datetime('now', 'localtime')
                   WHERE id = ?`

function rowToConversation (row: Record<string, SQLOutputValue> | undefined): Conversation | null {
  if (!row) return null
  return {
    id: toNumber(row.id),
    title: toText(row.title),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
  }
}

export function createConversation (title = '新对话'): Conversation | null {
  const info = getDb().prepare('INSERT INTO conversations (title) VALUES (?)').run(title)
  return getConversation(Number(info.lastInsertRowid))
}

export function getConversation (id: number): Conversation | null {
  const row = getDb()
    .prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?')
    .get(id)
  return rowToConversation(row)
}

/** 按最近更新排序返回会话列表 */
export function listConversations (): Array<Conversation | null> {
  const rows = getDb()
    .prepare(
      `SELECT id, title, created_at, updated_at
         FROM conversations
        ORDER BY updated_at DESC, id DESC`
    )
    .all()
  return rows.map(rowToConversation)
}

export function renameConversation (id: number, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
  getDb().prepare(TOUCH_SQL).run(id)
}

export function deleteConversation (id: number): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// 游戏时长
// ---------------------------------------------------------------------------

const GAME_COLUMNS = `id, game_key, game_name, play_date, started_at, ended_at,
                      duration_seconds, paused_seconds, updated_at`

function rowToGameSession (row: Record<string, SQLOutputValue> | undefined): GameSession | null {
  if (!row) return null
  const endedAt = row.ended_at
  return {
    id: toNumber(row.id),
    gameKey: toText(row.game_key),
    gameName: toText(row.game_name),
    playDate: toText(row.play_date),
    startedAt: toText(row.started_at),
    endedAt: endedAt == null || endedAt === '' ? null : String(endedAt),
    durationSeconds: toNumber(row.duration_seconds),
    pausedSeconds: toNumber(row.paused_seconds),
    updatedAt: toText(row.updated_at),
  }
}

/** 新建一条游戏会话（计时开始），startedAt 为本地时间字符串 */
export function createGameSession (input: {
  gameKey: string
  gameName: string
  playDate: string
  startedAt: string
}): GameSession | null {
  const info = getDb()
    .prepare(
      `INSERT INTO game_sessions (game_key, game_name, play_date, started_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.gameKey, input.gameName, input.playDate, input.startedAt)
  return getGameSession(Number(info.lastInsertRowid))
}

export function getGameSession (id: number): GameSession | null {
  const row = getDb()
    .prepare(`SELECT ${GAME_COLUMNS} FROM game_sessions WHERE id = ?`)
    .get(id)
  return rowToGameSession(row)
}

/** 更新会话（只写传入的字段）；endedAt 传 null 表示仍在进行中 */
export function updateGameSession (id: number, patch: GameSessionPatch = {}): GameSession | null {
  const sets: string[] = []
  const args: Array<string | number | null> = []

  if (patch.durationSeconds != null) {
    sets.push('duration_seconds = ?')
    args.push(Math.max(0, Math.round(patch.durationSeconds)))
  }
  if (patch.pausedSeconds != null) {
    sets.push('paused_seconds = ?')
    args.push(Math.max(0, Math.round(patch.pausedSeconds)))
  }
  if (patch.endedAt !== undefined) {
    sets.push('ended_at = ?')
    args.push(patch.endedAt)
  }
  if (!sets.length) return getGameSession(id)

  sets.push(`updated_at = datetime('now', 'localtime')`)
  args.push(id)
  getDb().prepare(`UPDATE game_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...args)
  return getGameSession(id)
}

/** 查询尚未结束（ended_at 为空）的会话；用于重启后清理残留记录 */
export function findOpenGameSessions (gameKey?: string): Array<GameSession | null> {
  const rows = gameKey
    ? getDb()
        .prepare(
          `SELECT ${GAME_COLUMNS} FROM game_sessions
            WHERE ended_at IS NULL AND game_key = ? ORDER BY id DESC`
        )
        .all(gameKey)
    : getDb()
        .prepare(
          `SELECT ${GAME_COLUMNS} FROM game_sessions
            WHERE ended_at IS NULL ORDER BY id DESC`
        )
        .all()
  return rows.map(rowToGameSession)
}

/** 按日期区间（含首尾）与游戏查询会话明细，最新的在前 */
export function listGameSessions (query: GameSessionQuery = {}): Array<GameSession | null> {
  const { fromDate, toDate, gameKey, limit = 200 } = query
  const where: string[] = []
  const args: Array<string | number> = []

  if (fromDate) {
    where.push('play_date >= ?')
    args.push(fromDate)
  }
  if (toDate) {
    where.push('play_date <= ?')
    args.push(toDate)
  }
  if (gameKey) {
    where.push('game_key = ?')
    args.push(gameKey)
  }
  args.push(Math.max(1, Math.round(limit)))

  const rows = getDb()
    .prepare(
      `SELECT ${GAME_COLUMNS} FROM game_sessions
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY play_date DESC, started_at DESC, id DESC
       LIMIT ?`
    )
    .all(...args)
  return rows.map(rowToGameSession)
}

/** 按天汇总（仅返回有记录的日期，缺失日期由上层补零） */
export function sumGameSecondsByDate (range: DateRange = {}): DailyGameSeconds[] {
  const { fromDate, toDate } = range
  const where: string[] = []
  const args: string[] = []

  if (fromDate) {
    where.push('play_date >= ?')
    args.push(fromDate)
  }
  if (toDate) {
    where.push('play_date <= ?')
    args.push(toDate)
  }

  const rows = getDb()
    .prepare(
      `SELECT play_date AS playDate,
              SUM(duration_seconds) AS seconds,
              COUNT(*) AS sessions
         FROM game_sessions
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY play_date
        ORDER BY play_date ASC`
    )
    .all(...args)

  return rows.map((row) => ({
    playDate: toText(row.playDate),
    seconds: toNumberOr(row.seconds, 0),
    sessions: toNumberOr(row.sessions, 0),
  }))
}

/** 按游戏汇总时长（跨游戏统计） */
export function sumGameSecondsByGame (range: DateRange = {}): GameSecondsByGame[] {
  const { fromDate, toDate } = range
  const where: string[] = []
  const args: string[] = []

  if (fromDate) {
    where.push('play_date >= ?')
    args.push(fromDate)
  }
  if (toDate) {
    where.push('play_date <= ?')
    args.push(toDate)
  }

  const rows = getDb()
    .prepare(
      `SELECT game_key AS gameKey,
              game_name AS gameName,
              SUM(duration_seconds) AS seconds,
              COUNT(*) AS sessions
         FROM game_sessions
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY game_key
        ORDER BY seconds DESC`
    )
    .all(...args)

  return rows.map((row) => ({
    gameKey: toText(row.gameKey),
    gameName: toText(row.gameName),
    seconds: toNumberOr(row.seconds, 0),
    sessions: toNumberOr(row.sessions, 0),
  }))
}

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------


const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system']

const isMessageRole = (role: string): role is MessageRole =>
  (MESSAGE_ROLES as readonly string[]).includes(role)

export function addMessage (conversationId: number, role: MessageRole, content: string): number {
  if (!isMessageRole(role)) throw new Error(`非法角色: ${role}`)
  const info = getDb()
    .prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
    .run(conversationId, role, content)
  getDb().prepare(TOUCH_SQL).run(conversationId)
  return Number(info.lastInsertRowid)
}

/** 按时间正序返回某会话的全部消息 */
export function listMessages (conversationId: number): MessageRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, role, content, created_at
         FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC`
    )
    .all(conversationId)

  return rows.map((row) => {
    const role = toText(row.role)
    return {
      id: toNumber(row.id),
      role: isMessageRole(role) ? role : 'system',
      content: toText(row.content),
      createdAt: toText(row.created_at),
    }
  })
}

// ---------------------------------------------------------------------------
// 游戏配置（key-value）
// ---------------------------------------------------------------------------

/** 读取游戏配置（存的是 JSON，读不出时回退到 fallback） */
export function getGameSetting<T> (key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM game_settings WHERE key = ?').get(key)
  if (!row) return fallback
  const raw = toText(row.value)
  try {
    return JSON.parse(raw) as T
  } catch {
    // 历史数据可能不是合法 JSON（早期版本直接写字符串），原样返回
    return raw as unknown as T
  }
}

/** 写入游戏配置（upsert） */
export function setGameSetting<T> (key: string, value: T): T {
  getDb()
    .prepare(
      `INSERT INTO game_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value))
  return value
}

// ---------------------------------------------------------------------------
// 游戏识别名单（进程 → 游戏）
// ---------------------------------------------------------------------------

const GAME_MAP_COLUMNS = 'process_name, game_key, game_name, source, created_at, updated_at'

function rowToGameProcessMap (
  row: Record<string, SQLOutputValue> | undefined
): GameProcessMapRow | null {
  if (!row) return null
  const source = toText(row.source)
  return {
    processName: toText(row.process_name),
    gameKey: toText(row.game_key),
    gameName: toText(row.game_name),
    source: source === 'user' || source === 'builtin' ? source : 'learned',
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
  }
}

/** 全部识别记录（按游戏名、进程名排序，供界面生成「游戏 → 进程」名单） */
export function listGameProcessMap (): Array<GameProcessMapRow | null> {
  const rows = getDb()
    .prepare(
      `SELECT ${GAME_MAP_COLUMNS} FROM game_process_map
        ORDER BY game_name COLLATE NOCASE ASC, process_name ASC`
    )
    .all()
  return rows.map(rowToGameProcessMap)
}

export function getGameProcessMap (processName: string): GameProcessMapRow | null {
  const name = normalizeProcessName(processName)
  if (!name) return null
  const row = getDb()
    .prepare(`SELECT ${GAME_MAP_COLUMNS} FROM game_process_map WHERE process_name = ?`)
    .get(name)
  return rowToGameProcessMap(row)
}

/** 进程名统一小写存储，匹配时不区分大小写；空值直接报错，避免脏数据 */
function normalizeProcessName (processName: string): string {
  return String(processName == null ? '' : processName).trim().toLowerCase()
}

/** 新增/更新识别记录（source: builtin / learned / user） */
export function upsertGameProcessMap (input: {
  processName: string
  gameKey: string
  gameName: string
  source?: GameRuleSource
}): GameProcessMapRow | null {
  const { gameKey, gameName, source = 'learned' } = input
  const name = normalizeProcessName(input.processName)
  if (!name) throw new Error('processName 不能为空')
  if (!gameKey || !gameName) throw new Error('gameKey / gameName 不能为空')

  getDb()
    .prepare(
      `INSERT INTO game_process_map (process_name, game_key, game_name, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(process_name) DO UPDATE SET game_key = excluded.game_key,
                                              game_name = excluded.game_name,
                                              source = excluded.source,
                                              updated_at = datetime('now', 'localtime')`
    )
    .run(name, gameKey, gameName, source)
  return getGameProcessMap(name)
}

/** 删除识别记录（界面只允许删除用户自定义记录） */
export function removeGameProcessMap (processName: string): boolean {
  const name = normalizeProcessName(processName)
  if (!name) return false
  const info = getDb().prepare('DELETE FROM game_process_map WHERE process_name = ?').run(name)
  return Number(info.changes) > 0
}

// ---------------------------------------------------------------------------
// 屏蔽名单（识别错误的进程，用户可屏蔽，之后不再计为游戏）
// ---------------------------------------------------------------------------

export function listIgnoredProcesses (): IgnoredProcessRow[] {
  const rows = getDb()
    .prepare(
      'SELECT process_name, created_at FROM game_ignored_processes ORDER BY process_name ASC'
    )
    .all()
  return rows.map((row) => ({
    processName: toText(row.process_name),
    createdAt: toText(row.created_at),
  }))
}

export function addIgnoredProcess (processName: string): string {
  const name = normalizeProcessName(processName)
  if (!name) throw new Error('processName 不能为空')
  getDb()
    .prepare(
      `INSERT INTO game_ignored_processes (process_name) VALUES (?)
       ON CONFLICT(process_name) DO NOTHING`
    )
    .run(name)
  return name
}

export function removeIgnoredProcess (processName: string): boolean {
  const name = normalizeProcessName(processName)
  if (!name) return false
  const info = getDb()
    .prepare('DELETE FROM game_ignored_processes WHERE process_name = ?')
    .run(name)
  return Number(info.changes) > 0
}

