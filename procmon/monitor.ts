/**
 * 进程监视器（主进程状态机）
 *
 * 职责：
 * 1. 按可配置间隔（默认 3 秒，1~10s）异步扫描进程；采集失败保留上一轮状态，
 *    不会把「采集失败」误判成「进程全部退出」；
 * 2. 规则匹配只在内存中做字符串比较（精确 / 模糊，不区分大小写），关键词不进 shell；
 * 3. 规则命中 / 退出的可配置动作：写日志、系统通知、向事件总线发联动事件
 *    （game-timer-start / game-timer-stop）；联动是可选松耦合，游戏工具不存在时静默无异常；
 * 4. 进程「已消失」状态保留若干轮用于界面展示，之后清理；
 * 5. 解析 / 命令执行都在 scanner 层异步完成，本模块不阻塞主进程事件循环。
 *
 * 可测试性：scanner / clock / notify 均可注入。
 */
import { EventEmitter } from 'node:events'

import { bus } from '../events'
import type {
  ProcLogEntry,
  ProcLogLevel,
  ProcmonSettings,
  ProcmonState,
  ProcProcess,
  ProcRule,
  ProcScanError,
} from '../types/ipc'
import { formatDateTimeLocal, type ParsedProc } from './parse'
import * as logsStore from './logs-store'
import * as rulesStore from './rules-store'
import * as settingsStore from './settings'
import { classifyError, logInternalError } from './errors'

/** 扫描器接口（便于测试注入假实现） */
export interface ProcmonScanner {
  listProcesses: () => Promise<ParsedProc[]>
}

export interface MonitorOptions {
  scanner?: ProcmonScanner
  clock?: () => Date
  /** 系统通知回调（由服务层注入 Electron Notification；平台不支持时不调用） */
  notify?: (title: string, body: string) => void
  /** 平台是否支持原生桌面通知 */
  notifySupported?: boolean
}

/** 对外事件 */
export interface MonitorEventMap {
  state: ProcmonState
  log: ProcLogEntry
  notify: { title: string; body: string }
}

export type MonitorEvent = keyof MonitorEventMap

/** 进程消失后保留的轮数（界面短暂展示「已消失」，随后清理） */
const GONE_RETENTION_TICKS = 2

/** 上一轮进程缓存：pid -> 进程记录与已消失轮数 */
interface PrevProcess {
  proc: ProcProcess
  goneTicks: number
}

export interface Monitor {
  start: () => void
  stop: () => void
  tick: () => Promise<void>
  getState: () => ProcmonState
  getSettings: () => ProcmonSettings
  updateSettings: (patch: Partial<Record<string, unknown>>) => ProcmonSettings
  saveRule: (rule: import('../types/ipc').ProcRuleInput) => rulesStore.RulesResult
  removeRule: (id: number) => rulesStore.RulesResult
  toggleRule: (id: number, enabled: boolean) => rulesStore.RulesResult
  writeLog: (input: { level?: ProcLogLevel; ruleId?: number | null; ruleName?: string; processName?: string; pid?: number | null; action?: string; message: string }) => ProcLogEntry | null
  clearLogs: () => void
  on: <E extends MonitorEvent>(event: E, handler: (payload: MonitorEventMap[E]) => void) => () => void
  isMonitoring: () => boolean
}

export function createMonitor (options: MonitorOptions = {}): Monitor {
  const {
    clock = () => new Date(),
    notify = () => undefined,
    notifySupported = false,
  } = options

  // 真实扫描器由服务层装配（避免本模块直接依赖命令实现，便于注入测试）
  let scanner: ProcmonScanner | null = options.scanner || null

  const emitter = new EventEmitter()

  let timer: NodeJS.Timeout | null = null
  let ticking = false
  let stopped = false

  /** 上一轮进程缓存（含已消失保留中的进程） */
  const prevProcesses = new Map<number, PrevProcess>()
  /** 规则当前命中的 PID 集合：ruleId -> Set<pid>（用于出现 / 退出转换判定） */
  const activeRulePids = new Map<number, Set<number>>()

  const state = {
    lastError: null as ProcScanError | null,
    lastScanAt: null as string | null,
    logs: [] as ProcLogEntry[],
    processesCache: [] as ProcProcess[],
  }

  // ---------------------------- 配置 ----------------------------

  function getSettings (): ProcmonSettings {
    return settingsStore.getSettings()
  }

  function updateSettings (patch: Partial<Record<string, unknown>>): ProcmonSettings {
    const next = settingsStore.updateSettings(patch)
    logsStore.applyRetention(next.logRetention)
    state.logs = logsStore.list(next.logRetention)
    // 间隔变化后重启定时器，让新间隔立即生效
    restartTimer()
    emitState()
    return next
  }

  // ---------------------------- 日志 ----------------------------

  function writeLog (input: {
    level?: ProcLogLevel
    ruleId?: number | null
    ruleName?: string
    processName?: string
    pid?: number | null
    action?: string
    message: string
  }): ProcLogEntry | null {
    const entry = logsStore.add(
      {
        level: input.level || 'info',
        ruleId: input.ruleId ?? null,
        ruleName: input.ruleName || '',
        processName: input.processName || '',
        pid: input.pid ?? null,
        action: input.action || 'system',
        message: input.message,
      },
      getSettings().logRetention
    )
    if (entry) {
      state.logs = [entry, ...state.logs].slice(0, getSettings().logRetention)
      emitter.emit('log', entry)
    }
    return entry
  }

  function clearLogs (): void {
    logsStore.clear()
    state.logs = []
    emitState()
  }

  // ---------------------------- 规则动作 ----------------------------

  /** 当前本地时间字符串（事件负载 / 触发时间字段契约要求 string） */
  function nowString (): string {
    return formatDateTimeLocal(clock()) ?? ''
  }

  /** 规则触发时的联动事件负载（松耦合：发往总线，消费方不存在也不报错） */
  function timerEventPayload (rule: ProcRule, proc: ParsedProc): import('../types/ipc').GameTimerEventPayload {
    return {
      processName: proc.name,
      gameName: rule.actions.eventLabel || null,
      pid: proc.pid,
      source: 'procmon',
      ruleId: rule.id,
      ruleLabel: rule.label || rule.pattern,
      at: nowString(),
    }
  }

  function ruleTitle (rule: ProcRule): string {
    return rule.label || rule.pattern
  }

  /** 进程出现命中规则：按动作配置写日志 / 通知 / 发启动联动事件 */
  function onRuleAppear (rule: ProcRule, proc: ParsedProc): void {
    const at = nowString()
    const name = proc.name
    const pid = proc.pid

    if (rule.actions.log) {
      writeLog({
        ruleId: rule.id,
        ruleName: ruleTitle(rule),
        processName: name,
        pid,
        action: 'rule-match',
        message: `规则「${ruleTitle(rule)}」命中进程 ${name}（PID ${pid}）`,
      })
    }

    if (rule.actions.notification) {
      notify('进程命中监控规则', `${name}（PID ${pid}）匹配规则「${ruleTitle(rule)}」`)
    }

    if (rule.actions.event === 'start' || rule.actions.event === 'both') {
      // 松耦合联动：总线无人订阅时静默忽略，不抛异常
      bus.emit('game-timer-start', timerEventPayload(rule, proc))
    }

    rulesStore.markTriggered(rule.id, at)
  }

  /** 命中进程退出：按动作配置写日志 / 通知 / 发停止联动事件 */
  function onRuleExit (rule: ProcRule, proc: { pid: number; name: string }): void {
    const name = proc.name
    const pid = proc.pid

    if (rule.actions.log) {
      writeLog({
        ruleId: rule.id,
        ruleName: ruleTitle(rule),
        processName: name,
        pid,
        action: 'rule-exit',
        message: `进程 ${name}（PID ${pid}）已退出，规则「${ruleTitle(rule)}」停止联动`,
      })
    }

    if (rule.actions.notification) {
      notify('监控进程已退出', `${name}（PID ${pid}）退出，规则「${ruleTitle(rule)}」已停止联动`)
    }

    if (rule.actions.event === 'stop' || rule.actions.event === 'both') {
      bus.emit('game-timer-stop', {
        processName: name,
        gameName: rule.actions.eventLabel || null,
        pid,
        source: 'procmon',
        ruleId: rule.id,
        ruleLabel: rule.label || rule.pattern,
        at: nowString(),
      })
    }
  }

  // ---------------------------- 检测循环 ----------------------------

  function restartTimer (): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (stopped) return
    const intervalMs = Math.max(1, getSettings().intervalSeconds) * 1000
    timer = setInterval(() => {
      tick().catch((err: Error) => logInternalError('检测异常', err))
    }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function start (): void {
    if (timer) return
    stopped = false
    // 启动时先拉一次状态与日志，避免界面空窗
    state.logs = logsStore.list(getSettings().logRetention)
    restartTimer()
    void tick().catch((err: Error) => logInternalError('首轮检测异常', err))
  }

  function stop (): void {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

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
    if (!scanner) {
      // 服务层尚未装配扫描器：本轮跳过，不报错上屏
      emitState()
      return
    }

    let scanned: ParsedProc[]
    try {
      scanned = await scanner.listProcesses()
      state.lastError = null
    } catch (err) {
      state.lastError = classifyError(err, '读取进程列表')
      logInternalError('读取进程列表失败', err)
      emitState()
      return
    }

    if (stopped) return

    const rules = rulesStore.list()
    const enabledRules = rules.filter((rule) => rule.enabled)

    // 当前轮命中：pid -> 命中的规则；ruleId -> 命中的 pid 集合
    const matchedByPid = new Map<number, ProcRule[]>()
    const currentRulePids = new Map<number, Set<number>>()

    for (const proc of scanned) {
      const matched = enabledRules.filter((rule) => rulesStore.matches(rule, proc.name))
      if (matched.length) matchedByPid.set(proc.pid, matched)
      for (const rule of matched) {
        if (!currentRulePids.has(rule.id)) currentRulePids.set(rule.id, new Set())
        currentRulePids.get(rule.id)!.add(proc.pid)
      }
    }

    // 出现 / 退出转换判定
    for (const rule of enabledRules) {
      const current = currentRulePids.get(rule.id) || new Set<number>()
      const previous = activeRulePids.get(rule.id) || new Set<number>()

      for (const pid of current) {
        if (previous.has(pid)) continue
        const proc = scanned.find((item) => item.pid === pid)
        if (proc) onRuleAppear(rule, proc)
      }
      for (const pid of previous) {
        if (current.has(pid)) continue
        const known = prevProcesses.get(pid)?.proc
        onRuleExit(rule, { pid, name: known?.name || scanned.find((p) => p.pid === pid)?.name || `PID ${pid}` })
      }

      activeRulePids.set(rule.id, new Set(current))
    }
    // 被禁用的规则清空活跃集合，避免重新启用后把存量进程误判为「新出现」
    for (const rule of rules) {
      if (!rule.enabled) activeRulePids.delete(rule.id)
    }

    // 组装进程列表：当前运行中的 + 短暂保留的「已消失」进程
    const currentPids = new Set<number>()
    const currentList: ProcProcess[] = scanned.map((proc) => ({
      pid: proc.pid,
      name: proc.name,
      path: proc.path,
      cpuPercent: proc.cpuPercent,
      memoryBytes: proc.memoryBytes,
      startedAt: proc.startedAt,
      status: 'running',
      matchedRuleIds: (matchedByPid.get(proc.pid) || []).map((rule) => rule.id),
    }))

    const nextPrev = new Map<number, PrevProcess>()
    for (const proc of currentList) {
      currentPids.add(proc.pid)
      nextPrev.set(proc.pid, { proc, goneTicks: 0 })
    }

    const goneList: ProcProcess[] = []
    for (const [pid, previous] of prevProcesses) {
      if (currentPids.has(pid)) continue
      const goneTicks = previous.goneTicks + 1
      if (goneTicks <= GONE_RETENTION_TICKS) {
        nextPrev.set(pid, { proc: { ...previous.proc, status: 'gone' }, goneTicks })
        goneList.push({ ...previous.proc, status: 'gone' })
      }
    }
    prevProcesses.clear()
    for (const [key, value] of nextPrev) prevProcesses.set(key, value)

    // 运行中的排在前面（按 CPU 降序），已消失的附在后面
    currentList.sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))
    state.processesCache = [...currentList, ...goneList]
    state.lastScanAt = formatDateTimeLocal(clock())

    emitState()
  }

  // ---------------------------- 状态推送 ----------------------------

  function emitState (): void {
    emitter.emit('state', getState())
  }

  // ---------------------------- 查询与规则 ----------------------------

  function getState (): ProcmonState {
    const settings = getSettings()
    const rules = rulesStore.list()
    const processes = state.processesCache
    return {
      monitoring: Boolean(timer),
      platform: process.platform,
      processes,
      rules,
      logs: state.logs,
      settings,
      lastError: state.lastError,
      lastScanAt: state.lastScanAt,
      processCount: processes.filter((proc) => proc.status === 'running').length,
      notifySupported,
    }
  }

  /** 启用 / 禁用规则：禁用前先为当前命中的进程补发停止联动事件，避免外部会话残留 */
  function toggleRule (id: number, enabled: boolean): rulesStore.RulesResult {
    const rule = rulesStore.list().find((item) => item.id === id)
    if (rule && !enabled) {
      emitExitForRule(rule)
    }
    return rulesStore.toggle(id, enabled)
  }

  /** 删除规则：同样先补发停止联动事件，清理残留的外部会话 */
  function removeRule (id: number): rulesStore.RulesResult {
    const rule = rulesStore.list().find((item) => item.id === id)
    if (rule) emitExitForRule(rule)
    return rulesStore.remove(id)
  }

  /** 规则失效（禁用 / 删除）时，为当前命中的进程补发退出动作 */
  function emitExitForRule (rule: ProcRule): void {
    const pids = activeRulePids.get(rule.id)
    if (pids?.size) {
      for (const pid of pids) {
        const proc = prevProcesses.get(pid)?.proc
        if (proc) onRuleExit(rule, { pid, name: proc.name })
      }
    }
    activeRulePids.delete(rule.id)
  }

  return {
    start,
    stop,
    tick,
    getState,
    getSettings,
    updateSettings,
    saveRule: rulesStore.save,
    removeRule,
    toggleRule,
    writeLog,
    clearLogs,
    isMonitoring: () => Boolean(timer),
    on: <E extends MonitorEvent>(event: E, handler: (payload: MonitorEventMap[E]) => void) => {
      emitter.on(event, handler as (...args: unknown[]) => void)
      return () => emitter.off(event, handler as (...args: unknown[]) => void)
    },
  }
}
