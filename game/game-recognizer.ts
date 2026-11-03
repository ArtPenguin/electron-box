/**
 * 游戏识别器（独立模块）
 *
 * 输入：进程扫描结果（进程名 + 可选可执行文件路径）
 * 输出：识别到的游戏列表 —— 可能同时有多个，支持多款游戏并行或交替运行
 *
 * 识别优先级（高 → 低，且**只对「游戏主进程」生效**）：
 * 1. 用户自定义映射（game_process_map.source = 'user'）
 * 2. 历史识别记录（source = 'builtin' / 'learned'，避免每次重新推断）
 * 3. 内置游戏库（game-library，使用官方名称）
 * 4. 安装目录启发：可执行文件位于 Steam / Epic / WeGame 等游戏目录，
 *    且不是启动器/反作弊/安装器，则按文件名推断显示名
 *
 * 非游戏主进程（客户端 / 启动器 / 反作弊 / 崩溃上报 / 系统组件等）一律不识别：
 * 不产生识别结果、不计时、不写识别名单、不在界面出现（见 isNonGameProcess），
 * 因此界面只保留真正在玩的游戏。唯一例外是用户显式保存的规则（优先级 1）。
 *
 * 计时判定（timing 字段，多游戏场景的关键）：
 * - 内置库的「游戏主进程」（游戏本体/对局）  → timing = true，出现即开始计时
 * - 内置库的「关联客户端进程」（客户端/大厅）→ 属于非游戏主进程，识别阶段即被跳过
 * - 用户自定义规则                          → timing = true（用户明确指定，优先尊重用户）
 * - 历史学习记录（builtin / learned）        → 仍以「内置库分类」为准，
 *   避免早期版本把客户端进程学成游戏后一直在计时
 */
import type { GameRuleSource } from '../types/ipc'
import {
  classifyBuiltinProcess,
  findBuiltinGame,
  inferGameName,
  isNonGameProcess,
  looksLikeGamePath,
  looksLikeGameProcess,
  slugify,
} from './game-library'
import type { ScannedProcess } from './process-scanner'

/** 识别名单里的一条记录（来自 game/registry，即数据库 game_process_map 表） */
export interface KnownGameRule {
  processName: string
  gameKey: string
  gameName: string
  source: GameRuleSource
}

/** 识别结果（不含进程聚合信息，供单进程判定使用） */
export interface GameIdentity {
  key: string
  name: string
  source: GameRuleSource
  /** 是否计入游戏时长（识别器只产出游戏主进程，因此恒为 true） */
  timing: boolean
}

/** 一轮识别结果：一条记录代表一款正在运行的游戏 */
export interface RecognizedGame extends GameIdentity {
  /** 触发识别的进程（同款游戏的多个进程只保留第一个，其余在 processes 里） */
  processName: string
  /** 本轮命中的该游戏全部进程 */
  processes: string[]
  /** 可执行文件路径（补查到时才有） */
  path: string | null
}

export interface GameRecognizer {
  /** 识别单个进程（未命中、或属于非游戏主进程时返回 null） */
  identify: (processName: string, executablePath?: string | null) => GameIdentity | null
  /** 从进程列表识别游戏（只含游戏主进程，可能多款，按名称排序） */
  recognize: (processes: ScannedProcess[] | undefined) => RecognizedGame[]
  /** 是否需要补查可执行文件路径（见下方说明） */
  needsPathLookup: (processes: ScannedProcess[] | undefined) => boolean
  /** 补查路径的候选进程名：已剔除启动器 / 客户端 / 反作弊等非游戏主进程 */
  candidatesForPathLookup: (processes: ScannedProcess[] | undefined) => string[]
  /** 名单变化时同步（传 null 表示回到初始来源） */
  setMap: (next: ReadonlyMap<string, KnownGameRule> | null) => void
}

export interface GameRecognizerOptions {
  /**
   * 进程名（小写）→ 已知游戏 的映射，来自 game/registry（含用户自定义与历史识别结果）；
   * 传函数可延迟加载 —— 模块装配阶段（应用启动时）不应要求数据库已经初始化
   */
  map?: ReadonlyMap<string, KnownGameRule> | (() => ReadonlyMap<string, KnownGameRule>)
  /** 屏蔽名单判断：用户明确表示「这不是游戏」的进程直接跳过 */
  isIgnored?: (processName: string) => boolean
}

export function createGameRecognizer (options: GameRecognizerOptions = {}): GameRecognizer {
  const { map = new Map<string, KnownGameRule>(), isIgnored = () => false } = options
  const sourceMap = typeof map === 'function' ? map : () => map
  let override: ReadonlyMap<string, KnownGameRule> | null = null

  const knownMap = (): ReadonlyMap<string, KnownGameRule> => override || sourceMap() || new Map()

  /** 名单里是否是该进程的「用户显式规则」（用户判断优先，可越过非游戏主进程过滤） */
  function userRuleOf (processName: string): KnownGameRule | null {
    const known = knownMap().get(String(processName || '').trim().toLowerCase())
    return known && known.source === 'user' && known.gameName ? known : null
  }

  /** 识别单个进程对应的游戏（未命中、或属于非游戏主进程时返回 null） */
  function identify (processName: string, executablePath?: string | null): GameIdentity | null {
    const name = String(processName || '').trim()
    if (!name) return null

    // 1) 用户自定义规则：优先级最高（用户明确指定即视为游戏主进程）
    const userRule = userRuleOf(name)
    if (userRule) {
      return { key: userRule.gameKey, name: userRule.gameName, source: 'user', timing: true }
    }

    // 2) 非游戏主进程（客户端 / 启动器 / 反作弊 / 崩溃上报 / 系统组件）：一律不识别
    if (isNonGameProcess(name)) return null

    const builtin = classifyBuiltinProcess(name)
    const known = knownMap().get(name.toLowerCase())

    // 3) 历史识别记录（builtin / learned）：名称沿用记录，计时仍以内置库分类为准
    if (known && known.gameName) {
      return {
        key: known.gameKey,
        name: known.gameName,
        source: known.source,
        timing: builtin ? builtin.timing : true,
      }
    }

    // 4) 内置游戏库命中（只认游戏主进程）
    if (builtin) return { ...builtin, source: 'builtin' }

    // 5) 安装目录启发：位于游戏目录的未知进程按文件名推断显示名
    if (executablePath && looksLikeGamePath(executablePath)) {
      const inferred = inferGameName(name)
      return { key: slugify(inferred), name: inferred, source: 'learned', timing: true }
    }

    return null
  }

  /**
   * 从进程列表识别游戏（多款游戏各记各的）
   * 只产出「游戏主进程」：启动器 / 客户端 / 反作弊 / 崩溃上报等直接跳过，
   * 因此界面不会出现与游玩无关的进程（用户显式规则除外）。
   */
  function recognize (processes: ScannedProcess[] | undefined): RecognizedGame[] {
    const found = new Map<string, RecognizedGame>()

    for (const process of processes || []) {
      const processName = String(process?.name || '').trim()
      if (!processName) continue

      // 用户屏蔽的进程，以及非游戏主进程（启动器 / 客户端 / 反作弊等）一律跳过
      if (isIgnored(processName)) continue
      if (!userRuleOf(processName) && isNonGameProcess(processName)) continue

      const game = identify(processName, process?.path || null)
      if (!game || !game.timing) continue

      const existing = found.get(game.key)
      if (existing) {
        if (!existing.processes.includes(processName)) existing.processes.push(processName)
        if (!existing.path && process.path) existing.path = process.path
        continue
      }

      found.set(game.key, {
        ...game,
        processName,
        processes: [processName],
        path: process?.path || null,
      })
    }

    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  /**
   * 补查路径的候选进程名
   * 只保留「可能是游戏、且不在名单里」的进程：启动器 / 客户端 / 反作弊 / 崩溃上报等
   * 非游戏主进程不参与查询，既减少 PowerShell 开销，也避免把它们推断成游戏。
   */
  function candidatesForPathLookup (processes: ScannedProcess[] | undefined): string[] {
    const names: string[] = []
    const seen = new Set<string>()

    for (const process of processes || []) {
      const processName = String(process?.name || '').trim()
      const key = processName.toLowerCase()
      if (!processName || seen.has(key)) continue
      if (isIgnored(processName) || isNonGameProcess(processName)) continue
      if (userRuleOf(processName) || knownMap().has(key)) continue
      if (findBuiltinGame(processName)) continue // 内置库已认得，不需要再补路径
      seen.add(key)
      names.push(processName)
    }

    return names
  }

  /**
   * 是否需要补查可执行文件路径
   * 只有出现「名字像游戏本体、但当前认不出来」的进程时才值得，避免每轮都跑 PowerShell；
   * 监控器另外还会按固定轮次做深度扫描（同样只查候选进程），覆盖名字不典型的未知游戏。
   */
  function needsPathLookup (processes: ScannedProcess[] | undefined): boolean {
    return (processes || []).some((process) => {
      const processName = String(process?.name || '').trim()
      if (!processName || process?.path) return false
      if (isIgnored(processName)) return false
      if (findBuiltinGame(processName)) return false
      return looksLikeGameProcess(processName)
    })
  }

  function setMap (next: ReadonlyMap<string, KnownGameRule> | null): void {
    override = next instanceof Map ? next : null
  }

  return { recognize, needsPathLookup, candidatesForPathLookup, setMap, identify }
}
