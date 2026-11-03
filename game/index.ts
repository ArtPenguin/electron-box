/**
 * 游戏时长控制工具（主进程对外入口）
 *
 * 把「进程扫描 + 游戏识别 + 多游戏计时状态机 + SQLite 持久化 + 额度提醒」组装成一个服务，
 * main.ts 只需 start()，并在需要时读取状态、转发提醒事件。
 *
 * 内部模块各司其职（都可以单独替换或注入测试）：
 * - process-scanner   进程扫描：跨平台拿到进程名/PID，按需补查可执行文件路径（只查候选进程）
 * - game-library      内置游戏库：只认「游戏主进程」，启动器/客户端/反作弊等一律排除
 * - game-recognizer   游戏识别：内置库 / 安装目录 / 用户规则 → 游戏名（只产出游戏主进程）
 * - registry          识别名单持久化：自动学习 + 用户自定义 + 屏蔽名单
 * - monitor           多游戏计时状态机：各游戏独立会话、跨天归档、额度提醒
 *
 * 测试时可注入假扫描器与假时钟：
 *   const service = createGameService({
 *     scanner: { listProcesses: async () => [{ name: 'League of Legends.exe', pid: 1 }] },
 *     clock: () => new Date('2026-09-30T10:00:00'),
 *   })
 */
import { GAMES } from './game-library'
import * as registry from './registry'
import { createMonitor, type GameStats, type GameState, type Monitor, type MonitorOptions } from './monitor'
import { processScanner } from './process-scanner'

/** 对外服务：在监控器之上补充「内置库规模 / 名单查询」等界面需要的信息 */
export interface GameService {
  /** 启动监控（应用启动后调用；幂等） */
  start: () => void
  /** 停止监控：结束所有进行中的会话并补记结束时间（应用退出前调用） */
  stop: () => void
  /** 立即执行一次检测（调试/测试用） */
  tick: () => Promise<void>
  /** 当前状态：正在计时的游戏（只含游戏主进程）、今日累计、识别名单等 */
  getState: () => GameState
  /** 图表数据：最近 N 天的每日时长与各游戏占比 */
  getStats: (options?: { days?: number }) => GameStats
  /** 手动暂停 / 继续计时（对所有正在计时的游戏生效） */
  setPaused: (paused: boolean) => { ok: boolean; error?: string; state: GameState }
  /** 修改配置（每日限额、提醒间隔、预警阈值） */
  updateSettings: (patch: Partial<Record<string, unknown>>) => {
    ok: true
    settings: GameState['settings']
    state: GameState
  }
  getSettings: () => GameState['settings']
  isMonitoring: () => boolean
  /** 游戏名单：游戏名 / 关联进程 / 来源（user | learned | builtin） */
  getRegistry: () => ReturnType<typeof registry.list>
  /** 内置游戏库规模（界面提示用） */
  builtinGameCount: () => number
  /** 新增 / 覆盖「进程 → 游戏」识别规则 */
  saveGameRule: (rule: { processName: string; gameName: string }) => ReturnType<Monitor['saveGameRule']>
  /** 删除自定义识别规则 */
  removeGameRule: (processName: string) => ReturnType<Monitor['removeGameRule']>
  /** 屏蔽进程（不是游戏，识别错了用它纠正，之后不再计时） */
  ignoreProcess: (processName: string) => ReturnType<Monitor['ignoreProcess']>
  /** 取消屏蔽 */
  restoreProcess: (processName: string) => ReturnType<Monitor['restoreProcess']>
  /** 屏蔽名单 */
  getIgnoredProcesses: () => string[]
  /** 订阅事件（state / reminder / log），返回取消订阅函数 */
  on: Monitor['on']
}

export function createGameService (options: MonitorOptions = {}): GameService {
  const monitor = createMonitor({
    scanner: processScanner,
    registryStore: registry,
    ...options,
  })

  return {
    start: () => monitor.start(),
    stop: () => monitor.stop(),
    tick: () => monitor.tick(),
    getState: () => monitor.getState(),
    getStats: (statsOptions) => monitor.getStats(statsOptions),
    setPaused: (paused) => monitor.setPaused(paused),
    updateSettings: (patch) => monitor.updateSettings(patch),
    getSettings: () => monitor.getSettings(),
    isMonitoring: () => monitor.isMonitoring(),
    getRegistry: () => registry.list(),
    builtinGameCount: () => GAMES.length,
    saveGameRule: (rule) => monitor.saveGameRule(rule),
    removeGameRule: (processName) => monitor.removeGameRule(processName),
    ignoreProcess: (processName) => monitor.ignoreProcess(processName),
    restoreProcess: (processName) => monitor.restoreProcess(processName),
    getIgnoredProcesses: () => registry.listIgnored(),
    on: monitor.on,
  }
}

// 全局单例：应用运行期间只应存在一个监控器
const gameService = createGameService()

export const start = (): void => gameService.start()
export const stop = (): void => gameService.stop()
export const tick = (): Promise<void> => gameService.tick()
export const getState = (): GameState => gameService.getState()
export const getStats = (options?: { days?: number }): GameStats => gameService.getStats(options)
export const setPaused = (paused: boolean): ReturnType<GameService['setPaused']> => gameService.setPaused(paused)
export const updateSettings = (
  patch: Partial<Record<string, unknown>>
): ReturnType<GameService['updateSettings']> => gameService.updateSettings(patch)
export const getSettings = (): GameState['settings'] => gameService.getSettings()
export const isMonitoring = (): boolean => gameService.isMonitoring()
export const getRegistry = (): ReturnType<GameService['getRegistry']> => gameService.getRegistry()
export const builtinGameCount = (): number => gameService.builtinGameCount()
export const saveGameRule = (rule: { processName: string; gameName: string }) =>
  gameService.saveGameRule(rule)
export const removeGameRule = (processName: string) => gameService.removeGameRule(processName)
export const ignoreProcess = (processName: string) => gameService.ignoreProcess(processName)
export const restoreProcess = (processName: string) => gameService.restoreProcess(processName)
export const getIgnoredProcesses = (): string[] => gameService.getIgnoredProcesses()
export const on: Monitor['on'] = (event, handler) => gameService.on(event, handler)
