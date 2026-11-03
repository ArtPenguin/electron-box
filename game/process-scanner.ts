/**
 * 进程扫描（独立模块）
 *
 * 职责单一：只回答「现在系统里跑着哪些进程」，不判断哪个是游戏
 * —— 游戏识别交给 game-recognizer，这样扫描能力（Windows / macOS / Linux、
 *    PID、可执行文件路径）与识别规则可以各自独立演进与测试。
 *
 * 两级查询，兼顾性能与覆盖面：
 * 1. listProcesses()            轻量：只取进程名 + PID（Windows 用 tasklist，类 Unix 用 ps）
 * 2. listProcessesWithPaths()   重量：补查可执行文件路径（Windows 用 PowerShell/CIM）
 *    由监控器按需调用（疑似游戏进程出现时，或每隔若干轮做一次深度扫描），
 *    避免每轮都启动 PowerShell 造成不必要的开销。
 *
 * 失败一律向上抛出，由监控器决定如何处理：监控器会保留上一轮状态继续计时，
 * 不会把「检测失败」误判成「游戏已全部退出」。
 */
import { execFile } from 'node:child_process'
import path from 'node:path'

/** 统一的进程记录结构 */
export interface ScannedProcess {
  name: string
  pid: number | null
  /** 可执行文件路径（轻量扫描时为 null，补查后填充） */
  path?: string | null
}

export const IS_WINDOWS = process.platform === 'win32'
const DEFAULT_TIMEOUT_MS = 8000
const PATH_QUERY_TIMEOUT_MS = 15000

/** 执行命令并返回 stdout（带超时，避免命令挂起拖垮监控循环） */
function run (command: string, args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout || '')))
    )
  })
}

/**
 * 解析 CSV（tasklist 与 PowerShell ConvertTo-Csv 都是标准 CSV：
 * 字段用双引号包裹，内部双引号写成两个双引号）
 */
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

/** 统一进程记录结构：{ name, pid, path } */
function toProcess (name: unknown, pid: unknown, extra: Partial<ScannedProcess> = {}): ScannedProcess {
  return { name: String(name || '').trim(), pid: Number(pid) || null, ...extra }
}

/** Windows：tasklist /FO CSV /NH -> "[进程名]","PID","会话名","会话#","内存" */
async function listWindowsProcesses (): Promise<ScannedProcess[]> {
  const rows = parseCsv(await run('tasklist', ['/FO', 'CSV', '/NH']))
  return rows
    .filter((cells) => /\.exe$/i.test(cells[0] || ''))
    .map((cells) => toProcess(cells[0], cells[1]))
}

/** 类 Unix：ps -axo pid=,comm=（comm 通常是可执行文件的完整路径） */
async function listUnixProcesses (): Promise<ScannedProcess[]> {
  const text = await run('ps', ['-axo', 'pid=,comm='])
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((matched): matched is RegExpMatchArray => Boolean(matched))
    .map((matched) => {
      const fullPath = matched[2].trim()
      return toProcess(path.basename(fullPath), matched[1], { path: fullPath })
    })
}

/** 列出当前运行中的进程（轻量查询，失败时抛出） */
export function listProcesses (): Promise<ScannedProcess[]> {
  return IS_WINDOWS ? listWindowsProcesses() : listUnixProcesses()
}

/** PowerShell 过滤条件里只允许安全字符，避免注入与语法错误 */
const SAFE_PROCESS_NAME = /^[A-Za-z0-9._ -]+$/

/**
 * Windows：用 CIM 查询指定进程的可执行文件路径
 * 只查询候选进程名，避免整表扫描
 */
async function listWindowsProcessPaths (names: string[]): Promise<ScannedProcess[]> {
  const safe = names.filter((name) => SAFE_PROCESS_NAME.test(name))
  if (!safe.length) return []

  const filter = safe.map((name) => `Name='${name}'`).join(' or ')
  const script = [
    `Get-CimInstance Win32_Process -Filter "${filter}"`,
    'Select-Object ProcessId,Name,ExecutablePath',
    'ConvertTo-Csv -NoTypeInformation',
  ].join(' | ')

  const rows = parseCsv(
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], PATH_QUERY_TIMEOUT_MS)
  )

  // 第一行是 CSV 表头（"ProcessId","Name","ExecutablePath"）
  return rows.slice(1).map((cells) => toProcess(cells[1], cells[0], { path: cells[2] || null }))
}

/** 补查可执行文件路径（只查询传入的进程名） */
export async function listProcessesWithPaths (names: string[] = []): Promise<ScannedProcess[]> {
  const unique = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))]
  if (!unique.length) return []
  if (IS_WINDOWS) return listWindowsProcessPaths(unique)

  // 类 Unix 的 ps 已经返回完整路径，直接过滤即可
  const wanted = new Set(unique.map((name) => name.toLowerCase()))
  return (await listUnixProcesses()).filter((item) => wanted.has(item.name.toLowerCase()))
}

/** 扫描器接口（便于测试注入假实现） */
export interface ProcessScanner {
  listProcesses: () => Promise<ScannedProcess[]>
  listProcessesWithPaths: (names: string[]) => Promise<ScannedProcess[]>
}

/** 默认扫描器（真实系统调用） */
export const processScanner: ProcessScanner = { listProcesses, listProcessesWithPaths }
