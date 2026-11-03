/**
 * 进程扫描器（主进程专用，跨平台）
 *
 * 职责边界：
 * - 只回答「现在系统里有哪些进程」，不做规则匹配 / 计时联动（那是 monitor 的事）；
 * - 系统调用 / 子进程执行全部在主进程侧完成，渲染进程拿不到 shell 能力；
 * - 用户输入的关键词**从不拼接进命令行**：命令是固定模板，PID 等数字参数单独校验，
 *   从根上杜绝命令注入；
 * - 采集本身是异步 execFile 并带超时，避免命令挂起拖垮轮询循环；
 * - 大段命令文本解析交给解析 Worker（Worker 不可用时回退主进程内联解析）。
 *
 * 字段口径：
 * - Windows：PowerShell CIM 查询（PID / 名称 / 路径 / 工作集 / 创建时间 / 累计 CPU 时间），
 *   瞬时 CPU 占用由两轮采样的累计时间差值估算；
 * - macOS / Linux：ps（PID / 路径 / 生命周期平均 CPU% / RSS / 启动时间），
 *   其 %cpu 为进程生命周期均值，与 Windows 的瞬时口径略有差异。
 */
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { parseCsv, parseUnixPs, parseWindowsCsv, type ParsedProc } from './parse'

export const IS_WINDOWS = process.platform === 'win32'

const SCAN_TIMEOUT_MS = IS_WINDOWS ? 15_000 : 8_000
const PATH_QUERY_TIMEOUT_MS = 10_000
const PARSE_WORKER_TIMEOUT_MS = 3_000

/** 扫描输出（cpuSeconds 为内部采样用，不回传渲染层） */
export interface ScannedProc extends ParsedProc {}

/** 执行命令并返回 stdout（带超时，避免命令挂起） */
function run (command: string, args: string[], timeout = SCAN_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout || '')))
    )
  })
}

// ---------------------------- 解析 Worker ----------------------------

let worker: Worker | null = null
let workerFailed = false
let seq = 0
const pending = new Map<number, (error: Error | null, rows?: ParsedProc[]) => void>()

/** 内联解析兜底（Worker 加载 / 通信失败时使用） */
function parseInline (platform: string, text: string): ParsedProc[] {
  return platform === 'win32' ? parseWindowsCsv(text) : parseUnixPs(text)
}

function releaseWorker (): void {
  if (worker) {
    const current = worker
    worker = null
    current.removeAllListeners()
    void current.terminate().catch(() => undefined)
  }
  for (const callback of pending.values()) callback(new Error('解析线程已退出'))
  pending.clear()
}

/** 优先在 Worker 线程解析；Worker 不可用 / 超时时回退内联解析 */
function parseOffthread (platform: string, text: string): Promise<ParsedProc[]> {
  if (workerFailed) return Promise.resolve(parseInline(platform, text))

  return new Promise((resolve) => {
    if (!worker) {
      try {
        worker = new Worker(path.join(__dirname, 'procmon-worker.js'))
        worker.on('error', () => {
          workerFailed = true
          releaseWorker()
        })
        worker.on('exit', () => {
          if (worker) { workerFailed = true; releaseWorker() }
        })
        worker.on('message', (message: { seq: number; rows?: ParsedProc[]; error?: string }) => {
          const callback = pending.get(message.seq)
          if (!callback) return
          pending.delete(message.seq)
          if (message.error) callback(new Error(message.error))
          else callback(null, message.rows || [])
        })
      } catch {
        workerFailed = true
        resolve(parseInline(platform, text))
        return
      }
    }

    const id = ++seq
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      // 解析超时：不再依赖 Worker，直接内联兜底
      resolve(parseInline(platform, text))
    }, PARSE_WORKER_TIMEOUT_MS)

    pending.set(id, (error, rows) => {
      clearTimeout(timer)
      if (error || !rows) resolve(parseInline(platform, text))
      else resolve(rows)
    })

    try {
      worker.postMessage({ seq: id, platform, text })
    } catch {
      pending.delete(id)
      workerFailed = true
      resolve(parseInline(platform, text))
    }
  })
}

// ---------------------------- 跨平台采集 ----------------------------

/** Windows：CIM 全量查询（CSV 输出，字段顺序见 parseWindowsCsv） */
function windowsCommand (): { command: string; args: string[] } {
  // CreationDate 显式格式化为 yyyyMMddHHmmss.ffffff，避免本地化系统 ToString 格式不同导致解析失败
  const creationDate = `@{Name='CreationDate';Expression={if ($_.CreationDate) { $_.CreationDate.ToString('yyyyMMddHHmmss.ffffff') } else { '' }}}`
  const script = [
    'Get-CimInstance Win32_Process',
    `Select-Object ProcessId,Name,ExecutablePath,WorkingSetSize,${creationDate},UserModeTime,KernelModeTime`,
    'ConvertTo-Csv -NoTypeInformation',
  ].join(' | ')
  return { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
}

/** 类 Unix：ps 一次性给出 PID / 路径 / CPU% / RSS / 启动时间 */
function unixCommand (): { command: string; args: string[] } {
  return { command: 'ps', args: ['-axo', 'pid=,comm=,%cpu=,rss=,lstart='] }
}

/** 上一轮 Windows 累计 CPU 采样：pid -> { 累计 CPU 秒数, 采样时刻 ms } */
const prevCpuSample = new Map<number, { cpuSeconds: number; wallMs: number }>()

const round1 = (value: number): number => Math.round(value * 10) / 10

/** 两轮采样估算瞬时 CPU%（Windows）；类 Unix 使用 ps 给出的生命周期均值 */
function applyCpuSample (rows: ParsedProc[], now: number): ParsedProc[] {
  if (!IS_WINDOWS) return rows

  const cores = Math.max(1, os.cpus().length)
  const nextSample = new Map<number, { cpuSeconds: number; wallMs: number }>()

  const result = rows.map((proc) => {
    const previous = prevCpuSample.get(proc.pid)
    const cpuSeconds = proc.cpuSeconds ?? 0
    nextSample.set(proc.pid, { cpuSeconds, wallMs: now })

    if (!previous) return { ...proc, cpuPercent: null }
    const cpuDelta = Math.max(0, cpuSeconds - previous.cpuSeconds)
    const wallDelta = Math.max(1, (now - previous.wallMs) / 1000)
    const ratio = cpuDelta / wallDelta // 1.0 = 一个核心跑满
    const cpuPercent = Math.min(100 * cores, round1(ratio * 100))
    return { ...proc, cpuPercent }
  })

  prevCpuSample.clear()
  for (const [key, value] of nextSample) prevCpuSample.set(key, value)
  return result
}

/** 列出当前运行中的进程（异步；失败向上抛出由 monitor 分类处理） */
export async function listProcesses (): Promise<ScannedProc[]> {
  const platform = process.platform
  const { command, args } = IS_WINDOWS ? windowsCommand() : unixCommand()
  const text = await run(command, args)
  const rows = await parseOffthread(platform, text)
  return applyCpuSample(rows, Date.now())
}

// ---------------------------- 单进程运维 ----------------------------

/**
 * 终止进程（SIGTERM；Windows 上等价于 TerminateProcess）。
 * 不经过 shell：PID 为数字，直接调用 Node 进程能力，拒绝 / 不存在的错误向上抛出分类。
 */
export function killPid (pid: number): void {
  process.kill(pid, 'SIGTERM')
}

/**
 * 受保护的系统核心进程：不允许在工具箱内终止（即使二次确认也拒绝）。
 * 覆盖 Windows 关键系统进程、macOS launchd / kernel_task、Linux systemd / init。
 */
const PROTECTED_PIDS = new Set([0, 1, 4])
const PROTECTED_NAMES = new Set([
  // Windows
  'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
  'services.exe', 'winlogon.exe', 'lsass.exe', 'svchost.exe', 'win32k.sys', 'fontdrvhost.exe',
  // macOS
  'kernel_task', 'launchd', 'kernel',
  // Linux
  'systemd', 'init', 'kthreadd', 'systemd-journald', 'systemd-udevd', 'dbus-daemon',
])

/** 判断是否为系统核心进程（名称大小写不敏感） */
export function isProtectedProcess (name: string, pid: number): boolean {
  if (PROTECTED_PIDS.has(pid)) return true
  return PROTECTED_NAMES.has(String(name || '').trim().toLowerCase())
}

/** 尽力补查进程可执行路径（快照里没有路径时用于「打开目录」）；失败返回 null */
export async function resolveExecutablePath (pid: number, knownPath: string | null): Promise<string | null> {
  if (knownPath) return knownPath
  if (!Number.isInteger(pid) || pid <= 0) return null

  try {
    if (IS_WINDOWS) {
      // -Filter 使用数字 PID，不拼接用户输入
      const script = [
        `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
        'Select-Object ExecutablePath',
        'ConvertTo-Csv -NoTypeInformation',
      ].join(' | ')
      const text = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], PATH_QUERY_TIMEOUT_MS)
      // 输出只有 ExecutablePath 一列；第一行是表头
      const rows = parseCsv(text).slice(1)
      const pathValue = rows[0]?.[0]?.trim()
      return pathValue || null
    }

    const text = await run('ps', ['-p', String(pid), '-o', 'comm='], PATH_QUERY_TIMEOUT_MS)
    const line = text.trim().split(/\r?\n/)[0]?.trim()
    return line && line.startsWith('/') ? line : null
  } catch {
    return null
  }
}
