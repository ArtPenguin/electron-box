/**
 * 游戏时长监控器（多游戏）
 *
 * 职责：
 * 1. 应用启动后开始监控，定时（默认每 5 秒）扫描进程并识别游戏
 * 2. 支持多款游戏：每识别到一款游戏就单独开一条会话计时，多款并行各记各的；
 *    某款退出只结束它自己的会话，其余游戏继续计时
 * 3. **只监控游戏主进程**：客户端 / 启动器 / 反作弊 / 崩溃上报等非游戏主进程
 *    在识别阶段就被排除 —— 既不计时，也不会出现在状态与界面里（页面保持干净整洁）
 * 4. 跨天自动拆分会话，保证「按日期记录」准确
 * 5. 支持手动暂停 / 继续计时（暂停期间所有会话都不累计时长）
 * 6. 额度提醒：剩余不足预警阈值（默认 30 分钟）先预警，达到限额提示超限；
 *    只要还在继续游戏，就每 30 秒（remindIntervalSeconds）重复提醒
 *
 * 进程怎么扫、游戏怎么认，都在独立模块里完成：
 * - game/process-scanner  进程扫描（跨平台，按需补查可执行文件路径，且只查候选进程）
 * - game/game-recognizer  游戏识别（内置库 / 安装目录 / 用户规则，只认游戏主进程）
 * - game/registry         识别名单持久化（自动学习 + 用户自定义）
 *
 * 计时说明：时长按「真实时间差」累加，不依赖定时器是否准时，因此定时器漂移或系统
 *          短暂休眠都不会造成累计误差；进程退出最多延迟一个 tick 被识别。
 *
 * 可测试性：scanner / recognizer / registryStore / clock / tickMs 均可注入。
 */
import { EventEmitter } from 'node:events'

import * as db from '../db'
import type {
  ActiveGameState,
  GameRuleSource,
  GameSession,
  GameState,
  GameStats,
  ReminderPayload,
} from '../types/ipc'
import { formatDate, formatDateTime, recentDates } from './datetime'
import { createGameRecognizer, type GameRecognizer, type RecognizedGame } from './game-recognizer'
import { processScanner, type ProcessScanner, type ScannedProcess } from './process-scanner'
import * as registry from './registry'
import * as settingsStore from './settings'
import type { GameSettings } from './settings'

// 对外契约类型（单点定义在 types/ipc.ts，渲染层共用同一份，避免字段漂移）
export type { ActiveGameState, GameState, GameStats, ReminderPayload }

const DEFAULT_TICK_MS = 5000
// 每 N 轮做一次带路径的深度扫描（默认约 30 秒），覆盖名字不典型的未知游戏
const DEFAULT_DEEP_SCAN_EVERY = 6

const round1 = (value: number): number => Math.round(value * 10) / 10

/** 正在计时的一款游戏（含其数据库会话） */
interface Tracking {
  game: RecognizedGame
  session: GameSession
}

// 对外契约类型已统一到 types/ipc.ts，通过顶部 import 复用，保证与渲染层定义完全一致


/** 监控器对外事件：状态变化 / 额度提醒 / 运行日志 */
export interface MonitorEventMap {
  state: GameState
  reminder: ReminderPayload
  log: string
}

export type MonitorEvent = keyof MonitorEventMap

export interface MonitorOptions {
  /** 进程检测间隔（毫秒） */
  tickMs?: number
  /** 时间源（测试可注入假时钟） */
  clock?: () => Date
  /** 进程扫描器 */
  scanner?: ProcessScanner
  /** 游戏识别器 */
  recognizer?: GameRecognizer
  /** 游戏名单读写 */
  registryStore?: typeof registry
  /** 深度扫描周期（单位：轮） */
  deepScanEveryTicks?: number
}

/** 监控器对外能力（game/index.ts 与测试都只依赖这个接口） */
export interface Monitor {
  start: () => void
  stop: () => void
  tick: () => Promise<void>
  on: <E extends MonitorEvent>(event: E, handler: (payload: MonitorEventMap[E]) => void) => () => void
  getState: () => GameState
  getStats: (options?: { days?: number }) => GameStats
  setPaused: (paused: boolean) => { ok: boolean; error?: string; state: GameState }
  updateSettings: (patch: Partial<Record<string, unknown>>) => {
    ok: true
    settings: GameSettings
    state: GameState
  }
  getSettings: () => GameSettings
  saveGameRule: (rule: { processName: string; gameName: string }) => registry.RegistryResult & {
    state: GameState
  }
  removeGameRule: (processName: string) => registry.RegistryResult & { state: GameState }
  ignoreProcess: (processName: string) => registry.RegistryResult & { state: GameState }
  restoreProcess: (processName: string) => registry.RegistryResult & { state: GameState }
  isMonitoring: () => boolean
}


/**
 * 创建监控器实例（默认单例由 game/index.ts 装配；测试可注入假扫描器与假时钟）
 */
export function createMonitor (options: MonitorOptions = {}): Monitor {
  const {
    tickMs = DEFAULT_TICK_MS,
    clock = () => new Date(),
    scanner = processScanner,
    registryStore = registry,
    deepScanEveryTicks = DEFAULT_DEEP_SCAN_EVERY,
  } = options

  // 识别器：名单延迟加载（首次使用时才读数据库），屏蔽名单在此生效
  const recognizer = options.recognizer || createGameRecognizer({
    map: () => registryStore.getMap(),
    isIgnored: (processName: string) => registryStore.isIgnored(processName),
  })

  const emitter = new EventEmitter()

  let timer: NodeJS.Timeout | null = null
  let ticking = false
  let stopped = false // stop() 后置位：让检测期间的「迟到写库」不再发生
  let tickCount = 0
  let lastTickAt: Date | null = null // 上一次结算时间

  /** 正在计时的游戏：gameKey → { game, session }（多游戏并行，各记各的） */
  const trackings = new Map<string, Tracking>()

  const state = {
    paused: false, // 手动暂停：暂停期间所有会话都不累计时长
    lastError: null as string | null,
    reminderDate: null as string | null,
    lastRemindLevel: null as 'over' | 'near' | null, // 上次提醒的等级（用于「升级为超限」时立即提醒）
    lastRemindAt: null as Date | null, // 上次提醒时间（与 remindIntervalSeconds 配合做节流）
  }

  // ---------------------------- 生命周期 ----------------------------

  /** 开始监控（幂等）：清理上次残留会话 + 启动检测循环 */
  function start (): void {
    if (timer) return
    stopped = false
    recoverOpenSessions()

    timer = setInterval(() => {
      tick().catch((err: Error) => log(`检测异常：${err.message}`))
    }, tickMs)
    if (typeof timer.unref === 'function') timer.unref()

    log(`开始监控：每 ${tickMs / 1000} 秒检测一次进程，只有游戏本体进程启动才会计时`)
    tick().catch((err: Error) => log(`检测异常：${err.message}`))
  }

  /** 停止监控：结束进行中的会话（补记结束时间）并清理定时器 */
  function stop (): void {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }

    const now = clock()
    accumulate(Math.max(0, (now.getTime() - (lastTickAt || now).getTime()) / 1000))
    for (const key of [...trackings.keys()]) closeTracking(key, now, '应用退出')
  }

  /**
   * 上次异常退出时可能留下「未结束」的会话，
   * 按最后写入时间补上结束时间，避免出现永远在计时的脏数据。
   */
  function recoverOpenSessions (): void {
    for (const session of db.findOpenGameSessions()) {
      if (!session) continue
      const endedAt = session.updatedAt || session.startedAt
      db.updateGameSession(session.id, { endedAt })
      log(`清理未结束的会话：#${session.id}（${session.gameName}），已补记结束时间`)
    }
  }

  // ---------------------------- 检测循环 ----------------------------

  /** 防止上一轮检测（进程命令较慢）尚未结束就重入 */
  async function tick (): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      await runTick()
    } finally {
      ticking = false
    }
  }

  async function runTick (): Promise<void> {
    const now = clock()
    const deltaSeconds = lastTickAt ? Math.max(0, (now.getTime() - lastTickAt.getTime()) / 1000) : 0
    lastTickAt = now
    tickCount += 1

    let processes: ScannedProcess[]
    try {
      processes = await scanner.listProcesses()
      state.lastError = null
      if (needsDeepScan(processes)) processes = await scanWithPaths(processes)
    } catch (err) {
      // 检测失败：保持当前状态继续结算，避免把「检测失败」误判成「游戏已退出」而中断计时
      state.lastError = (err as Error).message
      accumulate(deltaSeconds)
      emitState()
      return
    }

    // 检测期间可能已被 stop()（应用退出），此时不再写库
    if (stopped) return

    syncTrackings(recognizer.recognize(processes), now, deltaSeconds)
    evaluateReminder(now)
    emitState()
  }

  /** 是否需要补查可执行文件路径：名字像游戏，或到了周期性深度扫描轮次 */
  function needsDeepScan (processes: ScannedProcess[]): boolean {
    if (tickCount % Math.max(1, deepScanEveryTicks) === 0) return true
    return recognizer.needsPathLookup(processes)
  }

  /**
   * 补查可执行文件路径并与进程列表合并
   * 只查询「可能是游戏」的候选进程（识别器给出的名单，已剔除启动器 / 客户端 /
   * 反作弊等非游戏主进程），避免为无关进程浪费一次 PowerShell 调用。
   * 路径查询失败（例如 PowerShell 不可用）不影响主流程，降级为「只按进程名识别」。
   */
  async function scanWithPaths (processes: ScannedProcess[]): Promise<ScannedProcess[]> {
    const candidates = recognizer.candidatesForPathLookup(processes)
    if (!candidates.length) return processes

    let detailed: ScannedProcess[]
    try {
      detailed = await scanner.listProcessesWithPaths(candidates)
    } catch (err) {
      state.lastError = `路径补查失败：${(err as Error).message}`
      return processes
    }
    if (!detailed.length) return processes

    const pathByName = new Map<string, string>()
    for (const item of detailed) {
      const key = item.name.toLowerCase()
      if (item.path && !pathByName.has(key)) pathByName.set(key, item.path)
    }

    return processes.map((item) => {
      const path = pathByName.get(item.name.toLowerCase())
      return path ? { ...item, path } : item
    })
  }

  // ---------------------------- 会话与计时 ----------------------------

  /**
   * 同步追踪的会话（多游戏的核心逻辑）：
   * 顺序很重要：先结算历史时长 → 再结束已退出的 → 再开始新出现的 → 最后处理跨天，
   * 这样每款游戏都有自己独立的开始/结束与累计时长。
   *
   * 传入的识别结果只含「游戏主进程」（客户端 / 启动器 / 反作弊等非游戏主进程
   * 在识别阶段就被排除），因此这里只负责会话的开启 / 结束，
   * 不会产生任何与游玩无关的进程记录。
   */
  function syncTrackings (games: RecognizedGame[], now: Date, deltaSeconds: number): void {
    // 1) 按真实时间差结算所有正在计时的会话
    accumulate(deltaSeconds)

    const timingGames = games.filter((game) => game.timing)
    const activeKeys = new Set(timingGames.map((game) => game.key))

    // 2) 进程退出：只结束它自己的会话，其它游戏继续计时
    for (const key of [...trackings.keys()]) {
      if (!activeKeys.has(key)) closeTracking(key, now, '进程已退出')
    }

    // 3) 新识别的游戏：自动开始计时（游戏名取自进程识别结果）
    for (const game of timingGames) {
      if (!trackings.has(game.key)) openTracking(game, now)
    }

    // 4) 跨天：旧会话按前一天归档结束，再以同一款游戏开新会话
    const today = formatDate(now)
    for (const tracking of [...trackings.values()]) {
      if (tracking.session.playDate === today) continue
      const game = tracking.game
      closeTracking(game.key, now, '跨天归档')
      openTracking(game, now)
    }
  }

  /** 开始一条会话：记录游戏与开始时间，并把识别结果写入名单（自动学习） */
  function openTracking (game: RecognizedGame, now: Date): void {
    const session = db.createGameSession({
      gameKey: game.key,
      gameName: game.name,
      playDate: formatDate(now),
      startedAt: formatDateTime(now),
    })
    if (!session) return

    trackings.set(game.key, { game, session })
    registryStore.learn({
      processName: game.processName,
      gameKey: game.key,
      gameName: game.name,
      source: game.source, // builtin（内置库命中）或 learned（目录推断）
    })

    const via = game.source === 'learned' ? '，按安装目录识别' : ''
    log(`检测到「${game.name}」启动（进程 ${game.processName}${via}），开始计时（会话 #${session.id}）`)
  }

  /** 结束一条会话：补记结束时间并落库 */
  function closeTracking (key: string, now: Date, reason: string): void {
    const tracking = trackings.get(key)
    if (!tracking) return

    const finished = db.updateGameSession(tracking.session.id, { endedAt: formatDateTime(now) })
    trackings.delete(key)
    log(
      `「${finished ? finished.gameName : tracking.game.name}」结束计时（${reason}），` +
        `本次 ${round1((finished ? finished.durationSeconds : 0) / 60)} 分钟，已记录结束时间`
    )
  }

  /**
   * 结算一段时间：把「上次结算 → 现在」的真实时间差累加到所有正在计时的会话
   * 暂停中累计到 paused_seconds（便于回溯），运行中累计到 duration_seconds
   */
  function accumulate (deltaSeconds: number): void {
    if (!(deltaSeconds > 0) || !trackings.size) return

    for (const tracking of trackings.values()) {
      const field = state.paused ? 'pausedSeconds' : 'durationSeconds'
      const next = db.updateGameSession(tracking.session.id, {
        [field]: tracking.session[field] + deltaSeconds,
      })
      if (next) tracking.session = next
    }
  }

  /** 手动暂停 / 继续计时（对所有正在计时的游戏生效） */
  function setPaused (paused: boolean): { ok: boolean; error?: string; state: GameState } {
    if (!trackings.size) {
      return { ok: false, error: '当前没有正在计时的游戏，无法暂停', state: getState() }
    }

    const next = Boolean(paused)
    if (next !== state.paused) {
      const now = clock()
      accumulate(Math.max(0, (now.getTime() - (lastTickAt || now).getTime()) / 1000)) // 先按旧状态结算，避免误记
      lastTickAt = now
      state.paused = next
      log(next ? '已暂停计时' : '已恢复计时')
      emitState()
    }
    return { ok: true, state: getState() }
  }

  // ---------------------------- 额度提醒 ----------------------------

  /**
   * 提醒规则（按「今日所有游戏累计时长」判断，两条都按 remindIntervalSeconds 重复）：
   * - 剩余额度不足预警阈值（nearThresholdMinutes，默认 30 分钟）→ 弹窗预警「即将用完」
   * - 达到 / 超过限额（dailyLimitMinutes）→ 弹窗提示「已达上限」（由预警升级为超限时立即提醒）
   * - 只要还有游戏在计时且未暂停，就每 remindIntervalSeconds（默认 30 秒）再提醒一次
   * - 暂停计时或没有游戏在运行时都不打扰；跨天自动重置
   */
  function evaluateReminder (now: Date): void {
    const today = formatDate(now)
    if (state.reminderDate !== today) {
      state.reminderDate = today
      state.lastRemindLevel = null
      state.lastRemindAt = null
    }

    if (!trackings.size || state.paused) return

    const settings = settingsStore.getSettings()
    const limitSeconds = settings.dailyLimitMinutes * 60
    const usedSeconds = db.sumGameSecondsByDate({ fromDate: today, toDate: today })[0]?.seconds || 0
    const remainingSeconds = limitSeconds - usedSeconds

    const level: ReminderPayload['level'] | null =
      remainingSeconds <= 0
        ? 'over'
        : remainingSeconds < settings.nearThresholdMinutes * 60
          ? 'near'
          : null

    // 额度回升（例如把每日限额调大）后重新计时，下次不足时再提醒
    if (!level) {
      state.lastRemindLevel = null
      return
    }

    const intervalMs = settings.remindIntervalSeconds * 1000
    const escalated = level === 'over' && state.lastRemindLevel === 'near' // 刚超限：立即提醒，不等节流
    const due = !state.lastRemindAt || now.getTime() - state.lastRemindAt.getTime() >= intervalMs
    if (!escalated && !due) return

    state.lastRemindLevel = level
    state.lastRemindAt = now
    emitReminder({ level, usedSeconds, limitSeconds, remainingSeconds })
  }

  /** 提醒文案里的游戏名：可能同时有多款游戏在计时 */
  function trackingGameNames (): string {
    return [...trackings.values()].map((tracking) => tracking.game.name).join('、')
  }

  function emitReminder (input: {
    level: 'over' | 'near'
    usedSeconds: number
    limitSeconds: number
    remainingSeconds: number
  }): void {
    const payload: ReminderPayload = {
      level: input.level,
      gameName: trackingGameNames(),
      usedSeconds: Math.round(input.usedSeconds),
      limitSeconds: input.limitSeconds,
      remainingSeconds: Math.max(0, Math.round(input.remainingSeconds)),
      at: formatDateTime(clock()),
    }
    emitter.emit('reminder', payload)
  }

  // ---------------------------- 查询与手动控制 ----------------------------

  /** 当前完整状态（首页徽标、工具页与提醒都基于它渲染） */
  function getState (): GameState {
    const now = clock()
    const today = formatDate(now)
    const settings = settingsStore.getSettings()
    const limitSeconds = settings.dailyLimitMinutes * 60
    const todayRow = db.sumGameSecondsByDate({ fromDate: today, toDate: today })[0]
    const totalSeconds = todayRow ? todayRow.seconds : 0

    const games: ActiveGameState[] = [...trackings.values()].map((tracking) => ({
      key: tracking.game.key,
      name: tracking.game.name,
      source: tracking.game.source,
      processName: tracking.game.processName,
      sessionId: tracking.session.id,
      startedAt: tracking.session.startedAt,
      durationSeconds: tracking.session.durationSeconds,
      pausedSeconds: tracking.session.pausedSeconds,
    }))
    const primary = games.length ? games[games.length - 1] : null

    return {
      monitoring: Boolean(timer),
      paused: state.paused,
      running: games.length > 0,
      games, // 正在计时的游戏：多款并行时会有多条，各自独立计时
      game: primary ? { key: primary.key, name: primary.name } : null, // 最近开始的那款（顶部状态与徽标）
      session: primary
        ? {
            id: primary.sessionId,
            startedAt: primary.startedAt,
            durationSeconds: primary.durationSeconds,
            pausedSeconds: primary.pausedSeconds,
          }
        : null,
      today: {
        date: today,
        totalSeconds,
        limitSeconds,
        remainingSeconds: Math.max(0, limitSeconds - totalSeconds),
        overLimit: totalSeconds >= limitSeconds,
        byGame: db.sumGameSecondsByGame({ fromDate: today, toDate: today }), // 按游戏统计，名称来自进程识别
      },
      sessions: db.listGameSessions({ fromDate: today, toDate: today, limit: 100 }),
      registry: registryStore.list(), // 游戏名单：游戏名 / 关联进程 / 来源
      ignoredProcesses: registryStore.listIgnored(), // 屏蔽名单：识别错误的进程，不再计为游戏
      settings,
      lastError: state.lastError,
    }
  }

  /** 图表数据：最近 N 天的每日时长（缺失日期补零）与各游戏占比 */
  function getStats ({ days = 7 }: { days?: number } = {}): GameStats {
    const range = Math.min(90, Math.max(1, Math.round(Number(days)) || 7))
    const dates = recentDates(range, clock())
    const fromDate = dates[0]
    const toDate = dates[dates.length - 1]

    const byDate = new Map(
      db.sumGameSecondsByDate({ fromDate, toDate }).map((row) => [row.playDate, row])
    )
    const daily = dates.map((date) => ({
      date,
      seconds: byDate.get(date) ? byDate.get(date)!.seconds : 0,
      sessions: byDate.get(date) ? byDate.get(date)!.sessions : 0,
    }))

    return {
      days: dates,
      fromDate,
      toDate,
      daily,
      byGame: db.sumGameSecondsByGame({ fromDate, toDate }),
      totalSeconds: daily.reduce((sum, item) => sum + item.seconds, 0),
      todaySeconds: daily[daily.length - 1].seconds,
      limitSeconds: settingsStore.getSettings().dailyLimitMinutes * 60,
    }
  }

  /** 修改配置（每日限额等），立即生效 */
  function updateSettings (
    patch: Partial<Record<string, unknown>>
  ): { ok: true; settings: GameSettings; state: GameState } {
    const settings = settingsStore.updateSettings(patch)
    emitState()
    return { ok: true, settings, state: getState() }
  }

  function getSettings (): GameSettings {
    return settingsStore.getSettings()
  }

  // ---------------------------- 游戏名单（用户自定义） ----------------------------

  /** 新增/覆盖「进程 → 游戏」识别规则（用户规则优先，且视为游戏主进程） */
  function saveGameRule (
    rule: { processName: string; gameName: string }
  ): registry.RegistryResult & { state: GameState } {
    const result = registryStore.save(rule)
    if (result.ok) {
      recognizer.setMap(registryStore.getMap()) // 立即生效，无需重启应用
      const row = result.row
      log(`已保存自定义识别：${(row && row.processName) || rule.processName} → ${(row && row.gameName) || rule.gameName}`)
      emitState()
    }
    return { ...result, state: getState() }
  }

  /** 删除自定义识别规则（内置与自动学习记录保留，避免下次检测重新学习） */
  function removeGameRule (processName: string): registry.RegistryResult & { state: GameState } {
    const result = registryStore.remove(processName)
    if (result.ok) {
      recognizer.setMap(registryStore.getMap())
      log(`已删除自定义识别：${processName}`)
      emitState()
    }
    return { ...result, state: getState() }
  }

  /**
   * 屏蔽某个进程：它不是游戏，之后不再参与识别与计时
   * 识别错了（例如把聊天工具当成游戏）时使用；正在计时的会话会立即结束
   */
  function ignoreProcess (processName: string): registry.RegistryResult & { state: GameState } {
    const name = String(processName == null ? '' : processName).trim()
    const result = registryStore.ignore(name)
    if (!result.ok) return { ...result, state: getState() }

    for (const [key, tracking] of [...trackings.entries()]) {
      if (tracking.game.processName.toLowerCase() === name.toLowerCase()) {
        closeTracking(key, clock(), '进程已被屏蔽')
      }
    }
    recognizer.setMap(registryStore.getMap())
    log(`已屏蔽进程：${name}（之后不再计为游戏）`)
    emitState()
    return { ok: true, state: getState() }
  }

  /** 取消屏蔽（之后该进程会重新参与识别） */
  function restoreProcess (processName: string): registry.RegistryResult & { state: GameState } {
    const result = registryStore.unignore(processName)
    if (result.ok) {
      recognizer.setMap(registryStore.getMap())
      log(`已取消屏蔽：${processName}`)
      emitState()
    }
    return { ...result, state: getState() }
  }

  // ---------------------------- 对外事件 ----------------------------

  function emitState (): void {
    emitter.emit('state', getState())
  }

  function log (message: string): void {
    console.log(`[game] ${message}`)
    emitter.emit('log', message)
  }

  /** 订阅事件（state / reminder / log），返回取消订阅函数 */
  function on<E extends MonitorEvent> (
    event: E,
    handler: (payload: MonitorEventMap[E]) => void
  ): () => void {
    emitter.on(event, handler as (...args: unknown[]) => void)
    return () => emitter.off(event, handler as (...args: unknown[]) => void)
  }

  return {
    start,
    stop,
    tick,
    on,
    getState,
    getStats,
    setPaused,
    updateSettings,
    getSettings,
    saveGameRule,
    removeGameRule,
    ignoreProcess,
    restoreProcess,
    isMonitoring: () => Boolean(timer),
  }
}

