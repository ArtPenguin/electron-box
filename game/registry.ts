/**
 * 游戏名单（进程 → 游戏 映射）读写
 *
 * 角色：把数据库里的识别记录与用户自定义规则，转换成识别器使用的查询表；
 * 并在识别到新游戏时自动落库（自动学习），让「游戏名称来自进程统计」这件事稳定下来。
 *
 * - 首次访问时从数据库载入一次，之后读写都同步更新内存表，
 *   避免每轮检测（默认 5 秒一次）都去查库；载入时顺手清掉「非游戏主进程」的
 *   历史记录（老版本可能把启动器 / 客户端 / 反作弊等学进名单）
 * - source 优先级：user（用户指定）> learned（自动识别）> builtin（内置库命中）；
 *   自动学习不会覆盖用户配置
 * - 只会记录「游戏主进程」：启动器 / 客户端 / 反作弊 / 崩溃上报等一律不写名单，
 *   保证界面上的识别名单只有真正在玩的游戏
 * - 另外维护「屏蔽名单」：用户点一下就能把识别错误的进程（聊天工具、系统组件等）
 *   排除在游戏识别之外，避免反复误报
 */
import {
  addIgnoredProcess,
  listGameProcessMap,
  listIgnoredProcesses,
  removeGameProcessMap,
  removeIgnoredProcess,
  upsertGameProcessMap,
} from '../db'
import type { GameProcessMapRow, GameRuleSource } from '../types/ipc'
import { isNonGameProcess, slugify } from './game-library'

/** 写入类操作的统一返回结构 */
export interface RegistryResult {
  ok: boolean
  error?: string
  row?: GameProcessMapRow | null
}

let cache: Map<string, GameProcessMapRow> | null = null
let ignoredCache: Set<string> | null = null

/** 进程名（小写）→ 记录 的查询表（首次调用时从数据库载入，并清理非游戏主进程的历史记录） */
export function getMap (): Map<string, GameProcessMapRow> {
  if (!cache) {
    cache = new Map()
    for (const row of listGameProcessMap()) {
      if (row) cache.set(row.processName, row)
    }
    pruneNonGameRows()
  }
  return cache
}

/**
 * 清理「非游戏主进程」的历史识别记录（启动器 / 客户端 / 反作弊 / 崩溃上报等）
 * 老版本可能把它们学进了名单，界面上会多出一堆与游玩无关的条目；
 * 这里直接删掉数据库记录，界面只保留真正在玩的游戏。用户自定义规则保留。
 */
function pruneNonGameRows (): void {
  if (!cache) return
  const removed: string[] = []
  for (const row of [...cache.values()]) {
    if (row.source === 'user') continue
    if (!isNonGameProcess(row.processName)) continue
    removeGameProcessMap(row.processName)
    cache.delete(row.processName)
    removed.push(row.processName)
  }
  if (removed.length) {
    console.log(`[game] 已清理非游戏主进程的识别记录：${removed.join('、')}`)
  }
}

/** 取某个进程对应的游戏（不区分大小写） */
export function get (processName: string): GameProcessMapRow | null {
  const name = String(processName == null ? '' : processName).trim().toLowerCase()
  return name ? getMap().get(name) || null : null
}

/** 名单列表（供界面按游戏分组展示：游戏名 / 进程 / 来源） */
export function list (): GameProcessMapRow[] {
  return [...getMap().values()]
}

/**
 * 记录一次识别结果（自动学习）
 * - 内置库命中记为 builtin，其余（安装目录推断等）记为 learned
 * - 不覆盖用户自定义规则
 * - 只记录「游戏主进程」：启动器 / 客户端 / 反作弊 / 崩溃上报等一律不写名单，
 *   否则界面会多出一堆与游玩无关的条目（用户显式规则除外）
 * - 结果没有变化时不写库，避免无意义更新
 */
export function learn (input: {
  processName: string
  gameKey: string
  gameName: string
  source?: GameRuleSource
}): GameProcessMapRow | null {
  const { processName, gameKey, gameName } = input
  const source: GameRuleSource = input.source === 'builtin' ? 'builtin' : 'learned'
  const existing = get(processName)
  const isUserRule = Boolean(existing && existing.source === 'user')

  if (!isUserRule && isNonGameProcess(processName)) return null

  const unchanged = existing && (
    existing.source === 'user' ||
    (existing.gameKey === gameKey && existing.gameName === gameName && existing.source === source)
  )
  if (unchanged) return existing

  const row = upsertGameProcessMap({ processName, gameKey, gameName, source })
  if (row) getMap().set(row.processName, row)
  return row
}

/**
 * 用户自定义：把某个进程指定为某个游戏
 * （可覆盖内置名称，例如改成自己习惯的叫法）
 */
export function save (input: { processName: string; gameName: string }): RegistryResult {
  const name = String(input.processName == null ? '' : input.processName).trim()
  const label = String(input.gameName == null ? '' : input.gameName).trim()
  if (!name) return { ok: false, error: '请填写进程名（例如 SomeGame.exe）' }
  if (!label) return { ok: false, error: '请填写游戏名称' }
  if (name.length > 120 || label.length > 60) return { ok: false, error: '进程名或游戏名过长' }

  const row = upsertGameProcessMap({
    processName: name,
    gameKey: slugify(label),
    gameName: label,
    source: 'user',
  })
  if (row) getMap().set(row.processName, row)
  return { ok: true, row }
}

/** 删除自定义规则：内置与自动学习记录不删除，否则下次检测会重新学习 */
export function remove (processName: string): RegistryResult {
  const existing = get(processName)
  if (!existing) return { ok: false, error: '没有找到该进程的记录' }
  if (existing.source !== 'user') {
    return { ok: false, error: '内置库与自动识别的记录不能删除，只能改名覆盖' }
  }

  removeGameProcessMap(existing.processName)
  getMap().delete(existing.processName)
  return { ok: true }
}

/** 变更后重新从数据库载入（供外部改动或调试使用） */
export function reload (): Map<string, GameProcessMapRow> {
  cache = null
  ignoredCache = null
  return getMap()
}

// ---------------------------- 屏蔽名单 ----------------------------

/**
 * 屏蔽名单：用户明确表示「这不是游戏」的进程
 * 用在识别之前过滤，避免把聊天工具、系统组件等误当成游戏反复计时。
 */
function getIgnored (): Set<string> {
  if (!ignoredCache) {
    ignoredCache = new Set(listIgnoredProcesses().map((row) => row.processName))
  }
  return ignoredCache
}

export function isIgnored (processName: string): boolean {
  const name = String(processName == null ? '' : processName).trim().toLowerCase()
  return name ? getIgnored().has(name) : false
}

/** 屏蔽名单（升序进程名，界面展示用） */
export function listIgnored (): string[] {
  return [...getIgnored()].sort()
}

/** 屏蔽某个进程：同时清掉它的识别记录，避免名单里残留错误游戏名 */
export function ignore (processName: string): RegistryResult {
  const name = String(processName == null ? '' : processName).trim()
  if (!name) return { ok: false, error: '缺少进程名' }

  addIgnoredProcess(name)
  getIgnored().add(name.toLowerCase())
  removeGameProcessMap(name)
  getMap().delete(name.toLowerCase())
  return { ok: true }
}

/** 取消屏蔽（之后该进程会重新参与识别） */
export function unignore (processName: string): RegistryResult {
  const name = String(processName == null ? '' : processName).trim()
  if (!name) return { ok: false, error: '缺少进程名' }

  const removed = removeIgnoredProcess(name)
  getIgnored().delete(name.toLowerCase())
  return removed ? { ok: true } : { ok: false, error: '该进程不在屏蔽名单中' }
}
