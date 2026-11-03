/**
 * 进程监视器工具（主进程对外入口）
 *
 * 组装「跨平台进程扫描 + 规则匹配 + 状态推送 + 单进程运维 + CSV 快照导出」，
 * main.ts 只需 start() 并把 IPC 调用转发到这里。
 *
 * 安全边界：
 * - 子进程执行 / shell / 文件对话框全部在主进程侧，渲染进程拿不到任何 Node 能力；
 * - IPC 入参只传 PID（数字）与已校验的规则结构，命令行不拼接用户输入；
 * - 跨工具联动走事件总线（bus），游戏工具通过可插拔 adapter 接入，
 *   本模块不 import 游戏统计模块内部实现；adapter 未挂载时事件静默忽略。
 */
import { BrowserWindow, dialog, Notification, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bus } from '../events'
import type {
  GameTimerEventPayload,
  ProcActionResult,
  ProcExportResult,
  ProcmonState,
  ProcRuleInput,
  ProcScanErrorKind,
} from '../types/ipc'
import { classifyError, logInternalError } from './errors'
import { createMonitor, type Monitor } from './monitor'
import {
  isProtectedProcess,
  killPid,
  listProcesses,
  resolveExecutablePath,
} from './scanner'

/** 游戏工具接入适配器（由 main.ts 装配；未挂载时联动事件静默忽略） */
export interface GameTimerAdapter {
  externalStart: (payload: GameTimerEventPayload) => void
  externalStop: (payload: GameTimerEventPayload) => void
}

let gameAdapter: GameTimerAdapter | null = null

/** 挂载 / 卸载游戏工具联动适配器（松耦合：进程监视器不直接依赖游戏模块） */
export function attachGameAdapter (adapter: GameTimerAdapter | null): void {
  gameAdapter = adapter
}

/** 进程扫描器（真实系统调用，可测试时替换为假实现） */
const scanner = { listProcesses }

function timestamp (): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** CSV 字段转义（双引号包裹，内部双引号写成两个双引号） */
function csvField (value: unknown): string {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function toActionResult (result: { ok: boolean; error?: string; errorKind?: ProcScanErrorKind; state?: ProcmonState }): ProcActionResult {
  return result
}

/** 当前平台是否允许发系统通知（不支持 / 被拒绝都视为不可用） */
function permissionGranted (): boolean {
  if (!Notification.isSupported()) return false
  try {
    const staticApi = Notification as unknown as { getPermission?: () => string }
    const permission = typeof staticApi.getPermission === 'function' ? staticApi.getPermission() : 'granted'
    return permission !== 'denied'
  } catch {
    return true
  }
}

function createService (): { monitor: Monitor } & ServiceSurface {
  const notifySupported = permissionGranted()

  const monitor: Monitor = createMonitor({
    scanner,
    notify: (title, body) => {
      if (!permissionGranted()) return
      try {
        new Notification({ title, body }).show()
      } catch (err) {
        logInternalError('系统通知弹出失败', err)
      }
    },
    notifySupported,
  })

  // 联动事件转发到游戏工具适配器；adapter 不存在 / 内部异常都不影响发布方
  bus.on('game-timer-start', (payload) => {
    try {
      gameAdapter?.externalStart(payload)
    } catch (err) {
      logInternalError('转发 game-timer-start 失败', err)
    }
  })
  bus.on('game-timer-stop', (payload) => {
    try {
      gameAdapter?.externalStop(payload)
    } catch (err) {
      logInternalError('转发 game-timer-stop 失败', err)
    }
  })

  // ---------------------------- 进程查询 / 运维 ----------------------------

  function findProcess (pid: number) {
    return monitor.getState().processes.find((proc) => proc.pid === pid) || null
  }

  /** 终止单个进程（受保护的系统核心进程拒绝结束，不重试） */
  function killProcess (pidInput: number): ProcActionResult {
    const pid = Number(pidInput)
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: false, error: '进程编号无效', errorKind: 'unknown' }
    }

    const proc = findProcess(pid)
    if (!proc) {
      return { ok: false, error: '该进程已不存在或已退出', errorKind: 'gone' }
    }
    if (proc.status === 'gone') {
      return { ok: false, error: '该进程已消失，无法终止', errorKind: 'gone' }
    }
    if (isProtectedProcess(proc.name, pid)) {
      monitor.writeLog({
        processName: proc.name,
        pid,
        action: 'kill-denied',
        level: 'warn',
        message: `系统核心进程 ${proc.name}（PID ${pid}）受保护，已拒绝终止`,
      })
      return { ok: false, error: '系统核心进程受保护，不允许终止', errorKind: 'permission' }
    }

    try {
      killPid(pid)
    } catch (err) {
      const scanned = classifyError(err, '终止进程')
      logInternalError(`终止进程 ${pid} 失败`, err)
      monitor.writeLog({
        processName: proc.name,
        pid,
        action: 'kill-failed',
        level: 'error',
        message: `终止 ${proc.name}（PID ${pid}）失败：${scanned.message}`,
      })
      return { ok: false, error: scanned.message, errorKind: scanned.kind }
    }

    monitor.writeLog({
      processName: proc.name,
      pid,
      action: 'kill',
      message: `已请求终止进程 ${proc.name}（PID ${pid}）`,
    })
    void monitor.tick().catch((err) => logInternalError('终止后刷新失败', err))
    return { ok: true, state: monitor.getState() }
  }

  /** 在文件管理器中打开进程所在目录（选中可执行文件） */
  async function openFolder (pidInput: number): Promise<ProcActionResult> {
    const pid = Number(pidInput)
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: false, error: '进程编号无效', errorKind: 'unknown' }
    }

    const proc = findProcess(pid)
    const name = proc?.name || `PID ${pid}`
    const pathValue = await resolveExecutablePath(pid, proc?.path || null)

    if (!pathValue) {
      return {
        ok: false,
        error: '无法获取该进程的可执行文件路径（权限不足或进程已退出）',
        errorKind: proc?.status === 'gone' ? 'gone' : 'permission',
      }
    }

    try {
      shell.showItemInFolder(pathValue)
    } catch (err) {
      const scanned = classifyError(err, '打开进程目录')
      logInternalError(`打开目录失败：${pathValue}`, err)
      return { ok: false, error: scanned.message, errorKind: scanned.kind }
    }

    monitor.writeLog({ processName: name, pid, action: 'open-folder', message: `已打开进程目录：${pathValue}` })
    return { ok: true }
  }

  // ---------------------------- 快照导出（仅 CSV） ----------------------------

  /** 把进程列表写成 CSV 内容（BOM 保证 Excel 中文不乱码） */
  function buildCsv (state: ProcmonState): string {
    const header = ['PID', '进程名称', '可执行文件路径', 'CPU(%)', '内存(MB)', '启动时间', '状态', '匹配规则']
    const ruleLabel = new Map(state.rules.map((rule) => [rule.id, rule.label || rule.pattern]))

    const rows = state.processes.map((proc) => {
      const memoryMb = proc.memoryBytes == null ? '' : (proc.memoryBytes / 1048576).toFixed(1)
      const cpu = proc.cpuPercent == null ? '' : String(proc.cpuPercent)
      const status = proc.status === 'gone' ? '已消失' : '运行中'
      const matched = proc.matchedRuleIds.map((id) => ruleLabel.get(id) || `#${id}`).join('; ')
      return [proc.pid, proc.name, proc.path || '', cpu, memoryMb, proc.startedAt || '', status, matched]
    })

    const lines = [header, ...rows].map((cells) => cells.map(csvField).join(','))
    // 前置 UTF-8 BOM：Excel 打开时正确识别中文编码
    return '\ufeff' + lines.join('\r\n') + '\r\n'
  }

  async function exportSnapshot (): Promise<ProcExportResult> {
    const state = monitor.getState()
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())

    const defaultPath = path.join(os.homedir(), `process-snapshot-${timestamp()}.csv`)

    let filePath: string
    try {
      const options = {
        title: '导出进程快照（CSV）',
        defaultPath,
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      }
      const choice = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { ok: true, canceled: true }
      filePath = choice.filePath
    } catch (err) {
      const scanned = classifyError(err, '选择保存位置')
      logInternalError('保存对话框失败', err)
      return { ok: false, error: scanned.message, errorKind: scanned.kind }
    }

    try {
      fs.writeFileSync(filePath, buildCsv(state), 'utf8')
    } catch (err) {
      const scanned = classifyError(err, '写入快照文件')
      logInternalError(`写入 CSV 失败：${filePath}`, err)
      return { ok: false, error: scanned.message, errorKind: scanned.kind }
    }

    monitor.writeLog({ action: 'export', message: `已导出进程快照（${state.processCount} 个运行中进程）：${filePath}` })
    return { ok: true, filePath }
  }

  // ---------------------------- 规则 / 配置 / 日志 ----------------------------

  function saveRule (rule: ProcRuleInput): ProcActionResult {
    const result = monitor.saveRule(rule)
    return { ...toActionResult(result), state: monitor.getState() }
  }

  function removeRule (id: number): ProcActionResult {
    const result = monitor.removeRule(id)
    return { ...toActionResult(result), state: monitor.getState() }
  }

  function toggleRule (id: number, enabled: boolean): ProcActionResult {
    const result = monitor.toggleRule(id, enabled)
    return { ...toActionResult(result), state: monitor.getState() }
  }

  function updateSettings (patch: Partial<Record<string, unknown>>): ProcActionResult {
    monitor.updateSettings(patch)
    return { ok: true, state: monitor.getState() }
  }

  function clearLogs (): ProcActionResult {
    monitor.clearLogs()
    return { ok: true, state: monitor.getState() }
  }

  return {
    monitor,
    start: () => monitor.start(),
    stop: () => monitor.stop(),
    getState: () => monitor.getState(),
    refresh: () => {
      return monitor
        .tick()
        .then(() => ({ ok: true, state: monitor.getState() }))
        .catch((err: Error) => {
          const scanned = classifyError(err, '刷新进程列表')
          logInternalError('刷新进程列表失败', err)
          return { ok: false, error: scanned.message, errorKind: scanned.kind, state: monitor.getState() }
        })
    },
    saveRule,
    removeRule,
    toggleRule,
    killProcess,
    openFolder,
    exportSnapshot,
    updateSettings,
    clearLogs,
    onState: (handler) => monitor.on('state', handler),
    onLog: (handler) => monitor.on('log', handler),
  }
}

/** 服务对外接口（与 preload 契约一致，便于测试替换） */
export interface ServiceSurface {
  start: () => void
  stop: () => void
  getState: () => ProcmonState
  refresh: () => Promise<ProcActionResult>
  saveRule: (rule: ProcRuleInput) => ProcActionResult
  removeRule: (id: number) => ProcActionResult
  toggleRule: (id: number, enabled: boolean) => ProcActionResult
  killProcess: (pid: number) => ProcActionResult
  openFolder: (pid: number) => Promise<ProcActionResult>
  exportSnapshot: () => Promise<ProcExportResult>
  updateSettings: (patch: Partial<Record<string, unknown>>) => ProcActionResult
  clearLogs: () => ProcActionResult
  onState: (handler: (state: ProcmonState) => void) => () => void
  onLog: (handler: (entry: import('../types/ipc').ProcLogEntry) => void) => () => void
}

// 全局单例
const service = createService()

export const start = (): void => service.start()
export const stop = (): void => service.stop()
export const getState = (): ProcmonState => service.getState()
export const refresh = service.refresh
export const saveRule = service.saveRule
export const removeRule = service.removeRule
export const toggleRule = service.toggleRule
export const killProcess = service.killProcess
export const openFolder = service.openFolder
export const exportSnapshot = service.exportSnapshot
export const updateSettings = service.updateSettings
export const clearLogs = service.clearLogs
export const onState = service.onState
export const onLog = service.onLog
