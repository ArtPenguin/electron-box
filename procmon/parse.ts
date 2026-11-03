/**
 * 进程采集文本解析（纯函数，无 Node / DOM 依赖）
 *
 * 同时被主进程扫描器与解析 Worker 引用：命令输出在 Worker 线程完成解析，
 * 避免大进程列表的 CSV / ps 文本解析卡住主进程；纯函数也便于单元测试。
 *
 * 注意：这里的输入是系统命令的**原始 stdout**，用户输入（进程名关键词）从不拼接进
 * 命令行，因此解析不存在注入面；匹配规则在内存中做字符串比较，不碰 shell。
 */
import path from 'node:path'

import type { ProcProcess } from '../types/ipc'

/** 解析后的原始进程记录（CPU 采样差由扫描器二次计算） */
export interface ParsedProc {
  pid: number
  name: string
  path: string | null
  cpuPercent: number | null
  memoryBytes: number | null
  startedAt: string | null
  /** Windows 累计 CPU 秒数（用户态 + 内核态），用于两轮采样差值计算瞬时占用 */
  cpuSeconds: number | null
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Date -> "YYYY-MM-DD HH:mm:ss"（本地时间）；无效日期返回 null */
export function formatDateTimeLocal (date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

/**
 * 解析 Windows 进程创建时间，兼容两种来源：
 * - WMI 时间戳 "20260930120503.123456+480"（偏移量为分钟数，+480 表示东八区）
 * - CIM 序列化的本地日期串（如 "9/30/2026 12:05:03 PM"），直接交给 Date 解析
 */
function parseWmiDateTime (raw: string): string | null {
  const text = String(raw || '').trim()
  if (!text) return null

  const matched = text.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?([+-]\d{3})?$/
  )
  if (matched) {
    // 进程创建时间就是本机本地墙钟时间，直接按本地时区构造；
    // 偏移量用于跨时区远程场景，本地采集时忽略，避免 UTC 二次换算出错。
    const [, y, m, d, hh, mm, ss] = matched
    return formatDateTimeLocal(new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
  }

  const fallback = new Date(text)
  return formatDateTimeLocal(fallback)
}

/** 标准 CSV 解析（双引号包裹，内部双引号转义为两个双引号） */
export function parseCsv (text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      if (char !== '"') {
        field += char
      } else if (text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = false
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ''))
}

const toNumberOrNull = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 解析 Windows PowerShell CIM 输出 CSV。
 * 列顺序：ProcessId, Name, ExecutablePath, WorkingSetSize, CreationDate,
 *         UserModeTime, KernelModeTime
 */
export function parseWindowsCsv (text: string): ParsedProc[] {
  const rows = parseCsv(String(text || ''))
  // 第一行是表头（"ProcessId","Name",...）
  return rows.slice(1).map((cells) => {
    const pid = toNumberOrNull(cells[0])
    const name = String(cells[1] || '').trim()
    const path = cells[2] ? String(cells[2]).trim() : null
    const memoryBytes = toNumberOrNull(cells[3])
    const startedAt = parseWmiDateTime(cells[4] || '')
    const user100ns = toNumberOrNull(cells[5]) ?? 0
    const kernel100ns = toNumberOrNull(cells[6]) ?? 0
    const cpuSeconds = (user100ns + kernel100ns) / 1e7

    return {
      pid: pid ?? 0,
      name,
      path: path || null,
      cpuPercent: null, // 瞬时占用由两轮采样差值计算
      memoryBytes: memoryBytes == null ? null : Math.max(0, memoryBytes),
      startedAt,
      cpuSeconds,
    }
  }).filter((proc) => proc.pid > 0 && proc.name)
}

/**
 * 解析类 Unix（macOS / Linux）ps 输出。
 * 字段：pid, comm(完整路径), %cpu, rss(KB), lstart
 */
export function parseUnixPs (text: string): ParsedProc[] {
  const rows: ParsedProc[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const matched = line.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
    if (!matched) continue
    const [, pidRaw, comm, cpuRaw, rssRaw, lstart] = matched
    const pid = Number(pidRaw)
    if (!pid) continue

    const fullPath = comm.trim()
    const name = fullPath.startsWith('/') ? path.basename(fullPath) : fullPath
    const startedAt = formatDateTimeLocal(new Date(lstart))

    rows.push({
      pid,
      name,
      path: fullPath.startsWith('/') ? fullPath : null,
      cpuPercent: toNumberOrNull(cpuRaw),
      memoryBytes: Math.max(0, (Number(rssRaw) || 0) * 1024),
      startedAt,
      cpuSeconds: null,
    })
  }
  return rows
}

/** 内存字节 -> 友好展示在渲染层完成；这里只做 null 收敛 */
export function toProcProcess (proc: ParsedProc, status: ProcProcess['status'] = 'running'): ProcProcess {
  return {
    pid: proc.pid,
    name: proc.name,
    path: proc.path,
    cpuPercent: proc.cpuPercent,
    memoryBytes: proc.memoryBytes,
    startedAt: proc.startedAt,
    status,
    matchedRuleIds: [],
  }
}
