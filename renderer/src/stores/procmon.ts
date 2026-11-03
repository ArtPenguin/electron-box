/**
 * 进程监视器状态（Pinia）
 *
 * 数据流：主进程扫描器 / 监控器 → IPC 推送（procmon:state / procmon:log）→ 本 store → 页面渲染。
 * 订阅在 init() 中建立（进入工具页时初始化），离开页面时 dispose() 取消订阅，避免重复监听。
 *
 * 与游戏时长工具完全解耦：本 store 不 import 游戏模块，跨工具联动只发生在主进程事件总线。
 */
import { defineStore } from 'pinia'

import type {
  ProcActionResult,
  ProcExportResult,
  ProcLogEntry,
  ProcmonSettings,
  ProcmonState,
  ProcProcess,
  ProcRule,
  ProcRuleInput,
} from '../../../types/ipc'
import { api } from '../api'
import { useUiStore } from './ui'

/** 规则表单（界面编辑用） */
export interface ProcRuleForm {
  id: number | null
  label: string
  matchType: 'exact' | 'fuzzy'
  pattern: string
  enabled: boolean
  actions: {
    log: boolean
    notification: boolean
    event: 'none' | 'start' | 'stop' | 'both'
    eventLabel: string
  }
}

const emptyRuleForm = (): ProcRuleForm => ({
  id: null,
  label: '',
  matchType: 'fuzzy',
  pattern: '',
  enabled: true,
  actions: { log: true, notification: false, event: 'none', eventLabel: '' },
})

let disposers: Array<() => void> = []
let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useProcmonStore = defineStore('procmon', {
  state: () => ({
    status: null as ProcmonState | null,
    ready: false,
    busy: false,
    notice: '',
    /** 最近一次操作的结果（页面据此弹出错误提示，原始堆栈不上屏） */
    lastAction: null as ProcActionResult | ProcExportResult | null,
  }),

  getters: {
    processes (state): ProcProcess[] {
      return state.status ? state.status.processes : []
    },
    rules (state): ProcRule[] {
      return state.status ? state.status.rules : []
    },
    logs (state): ProcLogEntry[] {
      return state.status ? state.status.logs : []
    },
    settings (state): ProcmonSettings | null {
      return state.status ? state.status.settings : null
    },
    lastError (state): ProcmonState['lastError'] {
      return state.status ? state.status.lastError : null
    },
    monitoring (state): boolean {
      return state.status ? state.status.monitoring : false
    },
    processCount (state): number {
      return state.status ? state.status.processCount : 0
    },
    lastScanAt (state): string | null {
      return state.status ? state.status.lastScanAt : null
    },
    platform (state): string {
      return state.status ? state.status.platform : ''
    },
    notifySupported (state): boolean {
      return state.status ? state.status.notifySupported : true
    },
  },

  actions: {
    /** 首次初始化：读状态 + 建立推送订阅（幂等） */
    async init (): Promise<void> {
      if (this.ready) return
      this.ready = true

      try {
        this.applyState(await api.procmon.getState())
      } catch (err) {
        console.error('[procmon] 读取状态失败:', err)
      }

      disposers.push(api.procmon.onState((state) => this.applyState(state)))
      disposers.push(
        api.procmon.onLog((entry) => {
          if (!this.status) return
          const logs = [entry, ...this.status.logs]
          const retention = this.status.settings.logRetention
          this.status = { ...this.status, logs: logs.slice(0, retention) }
        })
      )
      await this.refresh()
    },

    applyState (state: ProcmonState | null): void {
      this.status = state
    },

    /** 主动采集一次进程 */
    async refresh (): Promise<void> {
      try {
        const res = await api.procmon.refresh()
        if (res && !res.ok) this.flashNotice(res.error || '刷新失败')
      } catch (err) {
        console.error('[procmon] 刷新失败:', err)
      }
    },

    /** 保存规则（新增 / 编辑） */
    async saveRule (form: ProcRuleForm): Promise<boolean> {
      const pattern = form.pattern.trim()
      if (!pattern) {
        this.flashNotice('请填写进程名匹配关键词')
        return false
      }

      const input: ProcRuleInput = {
        id: form.id,
        label: form.label.trim(),
        matchType: form.matchType,
        pattern,
        enabled: form.enabled,
        actions: { ...form.actions, eventLabel: form.actions.eventLabel.trim() },
      }

      this.busy = true
      try {
        const res = await api.procmon.saveRule(input)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        if (res && res.ok) {
          this.flashNotice(form.id ? '规则已更新' : `已保存规则：${pattern}`)
          return true
        }
        this.flashNotice((res && res.error) || '保存失败')
        return false
      } finally {
        this.busy = false
      }
    },

    /** 删除规则 */
    async removeRule (id: number): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.procmon.removeRule(id)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        this.flashNotice(res && res.ok ? '规则已删除' : ((res && res.error) || '删除失败'))
        return Boolean(res && res.ok)
      } finally {
        this.busy = false
      }
    },

    /** 启用 / 禁用规则 */
    async toggleRule (id: number, enabled: boolean): Promise<void> {
      this.busy = true
      try {
        const res = await api.procmon.toggleRule(id, enabled)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        if (!(res && res.ok)) this.flashNotice((res && res.error) || '操作失败')
      } finally {
        this.busy = false
      }
    },

    /** 终止单个进程（二次确认由页面发起） */
    async killProcess (pid: number): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.procmon.killProcess(pid)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        if (res && res.ok) {
          this.flashNotice('已请求终止进程')
          return true
        }
        this.flashNotice((res && res.error) || '终止失败')
        this.pushErrorToast(res)
        return false
      } finally {
        this.busy = false
      }
    },

    /** 在文件管理器中打开进程目录 */
    async openFolder (pid: number): Promise<void> {
      this.busy = true
      try {
        const res = await api.procmon.openFolder(pid)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        if (!(res && res.ok)) {
          this.flashNotice((res && res.error) || '打开目录失败')
          this.pushErrorToast(res)
        }
      } finally {
        this.busy = false
      }
    },

    /** 导出 CSV 快照 */
    async exportSnapshot (): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.procmon.exportSnapshot()
        this.lastAction = res
        if (res && res.ok && res.filePath) {
          this.flashNotice(`快照已导出：${res.filePath}`)
          return true
        }
        if (res && res.canceled) return false
        this.flashNotice((res && res.error) || '导出失败')
        this.pushErrorToast(res)
        return false
      } finally {
        this.busy = false
      }
    },

    /** 修改配置（轮询间隔 / 日志保留条数） */
    async updateSettings (patch: Partial<ProcmonSettings>): Promise<boolean> {
      this.busy = true
      try {
        const res = await api.procmon.updateSettings(patch)
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        if (res && res.ok) {
          this.flashNotice('配置已保存')
          return true
        }
        this.flashNotice((res && res.error) || '保存失败')
        return false
      } finally {
        this.busy = false
      }
    },

    /** 清空历史日志 */
    async clearLogs (): Promise<void> {
      this.busy = true
      try {
        const res = await api.procmon.clearLogs()
        this.lastAction = res
        if (res && res.state) this.applyState(res.state)
        this.flashNotice(res && res.ok ? '历史日志已清空' : '清空失败')
      } finally {
        this.busy = false
      }
    },

    /** 失败时在右下角弹出错误级 Toast（友好文案，不含底层堆栈） */
    pushErrorToast (res: ProcActionResult | ProcExportResult | null): void {
      if (!res || res.ok) return
      const ui = useUiStore()
      ui.pushToast({
        level: 'error',
        title: '操作失败',
        body: res.error || '请稍后重试',
        duration: 6000,
      })
    },

    /** 轻提示（3 秒后自动消失） */
    flashNotice (text: string): void {
      this.notice = text
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { this.notice = '' }, 3000)
    },

    /** 取消订阅（组件卸载时调用） */
    dispose (): void {
      disposers.forEach((unsubscribe) => unsubscribe())
      disposers = []
      this.ready = false
    },
  },
})

export { emptyRuleForm }
