/**
 * 游戏时长工具状态（Pinia）
 *
 * 数据流：主进程监控器 → IPC 推送（game:state / game:reminder）→ 本 store → 页面渲染。
 * 订阅在 init() 中建立且全局常驻（首页也要显示今日时长与实时徽标），各页面无需自行轮询。
 *
 * 与「多游戏」相关的字段：
 * - status.games     正在计时的游戏：只有游戏主进程启动才会出现在这里
 *   （启动器 / 客户端 / 反作弊 / 崩溃上报等非游戏主进程在主进程侧就被排除，不会传到这里）
 * - status.registry  识别名单（游戏名 / 关联进程 / 来源），由进程统计得出
 * - today.byGame     今日各游戏时长，名称同样来自进程识别
 *
 * 时间显示为什么能每秒跳：主进程仍然每 5 秒检测一次进程、推送一次权威状态，
 * 本 store 在「有游戏正在计时」时启动一个轻量秒表（state.now 每秒刷新），
 * 由 live* 系列 getter 把「距上次推送的秒数」叠加到权威值上，
 * 因此界面时间逐秒更新，而进程检测间隔保持不变（也不会增加 IPC 开销）。
 */
import { defineStore } from 'pinia'

import type {
  ActiveGameState,
  GameProcessMapRow,
  GameSession,
  GameSettings,
  GameState,
  GameStats,
  ReminderPayload,
} from '../../../types/ipc'
import { api } from '../api'
import { formatDuration } from '../utils/format'
import { useUiStore } from './ui'

// 订阅句柄、秒表与提示定时器放在模块作用域：不属于响应式状态，避免被 Pinia 深度代理
let disposers: Array<() => void> = []
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 自定义识别规则表单 */
export interface GameRuleForm {
  processName: string
  gameName: string
}

/** 距上次同步应补记的秒数（只在计时中且未暂停时增长） */
function elapsedSeconds (state: { status: GameState | null; syncedAt: number; now: number }): number {
  const status = state.status
  if (!status || !status.running || status.paused || !state.syncedAt) return 0
  return Math.max(0, Math.floor((state.now - state.syncedAt) / 1000))
}

export const useGameStore = defineStore('game', {
  state: () => ({
    status: null as GameState | null, // 主进程推送的完整状态
    stats: null as GameStats | null, // 图表数据（最近 N 天）
    statsDays: 7,
    limitInput: 30, // 设置面板里的限额输入值
    ruleForm: { processName: '', gameName: '' } as GameRuleForm,
    ready: false,
    busy: false,
    notice: '', // 页面上的轻提示
    /** 收到主进程状态时的本地时间戳（用于每秒推算） */
    syncedAt: 0,
    /** 本地秒表（仅在有游戏计时时推进） */
    now: Date.now(),
  }),

  getters: {
    today (state) {
      return state.status ? state.status.today : null
    },
    /** 正在计时的游戏列表（多游戏并行时不止一条） */
    activeGames (state): ActiveGameState[] {
      return state.status ? state.status.games : []
    },
    /** 识别名单（进程 → 游戏） */
    registry (state): GameProcessMapRow[] {
      return state.status ? state.status.registry : []
    },
    /** 今日会话记录（界面「今日记录」表格；过滤掉历史脏数据里的空行） */
    sessions (state): GameSession[] {
      const rows = state.status ? state.status.sessions : []
      return rows.filter((row): row is GameSession => Boolean(row))
    },
    /** 屏蔽名单（识别错误的进程，用户可恢复） */
    ignoredProcesses (state): string[] {
      return state.status ? state.status.ignoredProcesses : []
    },
    running (state): boolean {
      return state.status ? state.status.running : false
    },
    paused (state): boolean {
      return state.status ? state.status.paused : false
    },
    monitoring (state): boolean {
      return state.status ? state.status.monitoring : false
    },
    gameName (state): string {
      return state.status && state.status.game ? state.status.game.name : ''
    },
    /** 每日限额（分钟） */
    limitMinutes (state): number {
      return state.status ? state.status.settings.dailyLimitMinutes : 30
    },
    /** 剩余额度预警阈值（分钟）：剩余不足该值即弹窗提醒 */
    nearThresholdMinutes (state): number {
      return state.status ? state.status.settings.nearThresholdMinutes : 30
    },
    /** 重复提醒间隔（秒）：仍在继续游戏时按它重复提醒 */
    remindIntervalSeconds (state): number {
      return state.status ? state.status.settings.remindIntervalSeconds : 30
    },
    overLimit (state): boolean {
      return state.status ? state.status.today.overLimit : false
    },
    lastError (state): string | null {
      return state.status ? state.status.lastError : null
    },
    /** 是否有多款游戏同时在计时 */
    multiGame (state): boolean {
      return Boolean(state.status && state.status.games.length > 1)
    },
    /**
     * 距上次主进程推送、本地应补记的秒数
     * 只在「有游戏正在计时且未暂停」时累加，因此暂停 / 空闲时不会虚增
     */
    liveTickSeconds (state): number {
      return elapsedSeconds(state)
    },
    /** 今日累计（含本地推算）：秒级实时刷新 */
    liveTotalSeconds (state): number {
      const status = state.status
      if (!status) return 0
      return status.today.totalSeconds + elapsedSeconds(state)
    },
    /** 正在计时的游戏（时长含本地推算，逐秒跳动） */
    liveActiveGames (state): ActiveGameState[] {
      const status = state.status
      if (!status) return []
      const tick = elapsedSeconds(state)
      if (!tick) return status.games
      return status.games.map((game) => ({ ...game, durationSeconds: game.durationSeconds + tick }))
    },
    /** 今日剩余额度（秒，随本地推算递减） */
    liveRemainingSeconds (state): number {
      const status = state.status
      if (!status) return 0
      return Math.max(0, status.today.limitSeconds - (status.today.totalSeconds + elapsedSeconds(state)))
    },
    /** 今日用量占限额的比例（0~1），进度条使用 */
    usageRatio (state): number {
      const status = state.status
      if (!status) return 0
      const { limitSeconds, totalSeconds } = status.today
      if (!limitSeconds) return 0
      return Math.min(1, (totalSeconds + elapsedSeconds(state)) / limitSeconds)
    },
    /** 游戏名单按游戏名分组：界面展示「游戏 → 关联进程 / 来源」 */
    gameGroups (state): Array<{ name: string; key: string; processes: GameProcessMapRow[] }> {
      const groups = new Map<string, { name: string; key: string; processes: GameProcessMapRow[] }>()
      for (const row of state.status ? state.status.registry : []) {
        if (!groups.has(row.gameName)) {
          groups.set(row.gameName, { name: row.gameName, key: row.gameKey, processes: [] })
        }
        groups.get(row.gameName)!.processes.push(row)
      }
      return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    },
    settings (state): GameSettings | null {
      return state.status ? state.status.settings : null
    },
    /** 首页卡片上的实时徽标 */
    homeBadge (state): string {
      const status = state.status
      if (!status) return ''
      const used = status.today.totalSeconds + elapsedSeconds(state)
      const usage = `${formatDuration(used)} / ${status.settings.dailyLimitMinutes} 分钟`
      const count = status.games.length
      if (status.running && !status.paused) {
        return count > 1 ? `计时中（${count} 款） · ${usage}` : `计时中 · ${usage}`
      }
      if (status.running && status.paused) return `已暂停 · ${usage}`
      return `今日 ${usage}`
    },
    /** 状态药丸文案 */
    statusText (state): string {
      const status = state.status
      if (!status) return '连接中…'
      if (status.running && status.paused) return '已暂停计时'
      if (status.running) return `正在计时 · ${status.games.map((game) => game.name).join('、')}`
      return status.monitoring ? '监控中（未检测到游戏）' : '监控已停止'
    },
    /** 监控能力说明：识别方式 + 已记录的进程规则数量 */
    monitorHint (state): string {
      const count = state.status ? state.status.registry.length : 0
      return `内置游戏库 + 安装目录自动识别，已记录 ${count} 条进程规则；只监控游戏主进程`
    },
    /** 图表：区间日均时长 */
    avgSeconds (state): number {
      if (!state.stats || !state.stats.daily.length) return 0
      return state.stats.totalSeconds / state.stats.daily.length
    },
    /** 图表：区间内单日峰值 */
    maxSeconds (state): number {
      if (!state.stats) return 0
      return state.stats.daily.reduce((max, item) => Math.max(max, item.seconds), 0)
    },
  },

  actions: {
    /** 首次初始化：读状态 + 建立推送订阅（幂等） */
    async init (): Promise<void> {
      if (this.ready) return
      this.ready = true

      try {
        this.applyStatus(await api.game.getState())
        this.limitInput = this.limitMinutes
        this.stats = await api.game.getStats(this.statsDays)
      } catch (err) {
        console.error('[game] 读取状态失败:', err)
      }

      disposers.push(api.game.onState((status) => this.applyStatus(status)))
      disposers.push(api.game.onReminder((payload) => this.handleReminder(payload)))
      await this.refresh()
    },

    /**
     * 接收一次主进程状态：记录本地时间戳并按需启停秒表
     * （时间显示之所以每秒更新，就是靠这里的 syncedAt + 秒表推算，
     *   主进程的进程检测间隔仍然是 5 秒一次）
     */
    applyStatus (status: GameState | null): void {
      this.status = status
      this.syncedAt = Date.now()
      this.now = this.syncedAt
      this.syncClock(Boolean(status && status.running && !status.paused))
    },

    /** 有游戏在计时时才推进的 1 秒秒表（空闲 / 暂停时自动停掉，零额外开销） */
    syncClock (active: boolean): void {
      if (active && !tickTimer) {
        tickTimer = setInterval(() => {
          this.now = Date.now()
        }, 1000)
      } else if (!active && tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
    },

    /** 主动拉取一次状态（页面进入时兜底同步） */
    async refresh (): Promise<void> {
      try {
        this.applyStatus(await api.game.getState())
      } catch (err) {
        console.error('[game] 刷新状态失败:', err)
      }
    },

    /** 加载图表数据（最近 days 天） */
    async loadStats (days?: number): Promise<void> {
      if (days) this.statsDays = days
      try {
        this.stats = await api.game.getStats(this.statsDays)
      } catch (err) {
        console.error('[game] 加载图表数据失败:', err)
      }
    },

    /** 手动暂停 / 继续计时 */
    async setPaused (paused: boolean): Promise<void> {
      this.busy = true
      try {
        const res = await api.game.setPaused(paused)
        if (res && res.state) this.applyStatus(res.state)
        if (res && !res.ok) this.flashNotice(res.error || '操作失败')
        else this.flashNotice(paused ? '已暂停计时' : '已继续计时')
      } finally {
        this.busy = false
      }
    },

    /** 保存每日限额（分钟） */
    async saveLimit (minutes: number | string): Promise<boolean> {
      const value = Math.round(Number(minutes))
      if (!Number.isFinite(value) || value < 1 || value > 1440) {
        this.flashNotice('请输入 1 ~ 1440 之间的分钟数')
        return false
      }

      this.busy = true
      try {
        const res = await api.game.updateSettings({ dailyLimitMinutes: value })
        if (res && res.state) {
          this.applyStatus(res.state)
          this.limitInput = res.state.settings.dailyLimitMinutes
        }
        this.flashNotice(`每日限额已更新为 ${this.limitMinutes} 分钟`)
        await this.loadStats()
        return true
      } finally {
        this.busy = false
      }
    },

    /**
     * 保存「进程 → 游戏」识别规则（识别错了可手动纠正，优先级最高）
     * 用户指定的进程视为游戏本体，因此会参与计时
     */
    async saveRule (rule: GameRuleForm): Promise<boolean> {
      const processName = String((rule && rule.processName) || '').trim()
      const gameName = String((rule && rule.gameName) || '').trim()
      if (!processName || !gameName) {
        this.flashNotice('请同时填写进程名与游戏名称')
        return false
      }

      this.busy = true
      try {
        const res = await api.game.saveRule({ processName, gameName })
        if (res && res.state) this.applyStatus(res.state)
        if (res && res.ok) {
          this.ruleForm = { processName: '', gameName: '' }
          this.flashNotice(`已保存：${processName} → ${gameName}`)
          return true
        }
        this.flashNotice((res && res.error) || '保存失败')
        return false
      } finally {
        this.busy = false
      }
    },

    /** 删除自定义识别规则（内置库与自动识别的记录只能改名覆盖） */
    async removeRule (processName: string): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.game.removeRule(processName)
        if (res && res.state) this.applyStatus(res.state)
        this.flashNotice(res && res.ok ? `已删除规则：${processName}` : ((res && res.error) || '删除失败'))
        return Boolean(res && res.ok)
      } finally {
        this.busy = false
      }
    },

    /**
     * 屏蔽进程：识别错了（把聊天工具、系统组件当成游戏）用它纠正
     * 屏蔽后该进程不再参与识别，正在计时的会话会立即结束
     */
    async ignoreProcess (processName: string): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.game.ignoreProcess(processName)
        if (res && res.state) this.applyStatus(res.state)
        this.flashNotice(res && res.ok ? `已屏蔽：${processName}` : ((res && res.error) || '屏蔽失败'))
        return Boolean(res && res.ok)
      } finally {
        this.busy = false
      }
    },

    /** 取消屏蔽 */
    async restoreProcess (processName: string): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.game.restoreProcess(processName)
        if (res && res.state) this.applyStatus(res.state)
        this.flashNotice(res && res.ok ? `已恢复识别：${processName}` : ((res && res.error) || '操作失败'))
        return Boolean(res && res.ok)
      } finally {
        this.busy = false
      }
    },

    /** 主进程提醒 → 右下角弹窗（剩余不足阈值 / 超限后，每 30 秒会重复推送） */
    handleReminder (payload: ReminderPayload): void {
      const ui = useUiStore()
      const over = payload.level === 'over'
      ui.pushToast({
        level: over ? 'warning' : 'info',
        title: over ? '游戏时长已达上限' : '剩余游戏时长不足',
        body: over
          ? `「${payload.gameName}」今日已玩 ${formatDuration(payload.usedSeconds)}，已达 ${payload.limitSeconds / 60} 分钟限额，仍在游戏每 ${this.remindIntervalSeconds} 秒提醒一次。`
          : `「${payload.gameName}」今日已玩 ${formatDuration(payload.usedSeconds)}，仅剩 ${formatDuration(payload.remainingSeconds)}，仍在游戏每 ${this.remindIntervalSeconds} 秒提醒一次。`,
        duration: 12000,
      })
    },

    /** 轻提示（3 秒后自动消失） */
    flashNotice (text: string): void {
      this.notice = text
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { this.notice = '' }, 3000)
    },

    /** 取消所有订阅与秒表（应用级 store，一般只在调试时调用） */
    dispose (): void {
      disposers.forEach((unsubscribe) => unsubscribe())
      disposers = []
      this.syncClock(false)
    },
  },
})
