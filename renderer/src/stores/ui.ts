/**
 * 全局提示（右下角弹窗）
 *
 * 游戏时长的提醒、各类操作反馈都走这里：挂在应用根组件上，
 * 因此切到任何工具页都能弹出，并支持自动消失。
 * duration 为 0 表示不自动关闭（需要手动点 ×）。
 */
import { defineStore } from 'pinia'

/** 提示等级（决定图标与描边颜色） */
export type ToastLevel = 'info' | 'warning' | 'success' | 'error'

export interface Toast {
  id: number
  title: string
  body: string
  level: ToastLevel
}

export interface ToastPayload {
  title: string
  body?: string
  level?: ToastLevel
  /** 自动关闭延时（毫秒），0 表示不自动关闭 */
  duration?: number
}

const DEFAULT_DURATION = 6000

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    seq: 0,
  }),

  actions: {
    /** 弹出一条提示，返回其 id（便于手动关闭） */
    pushToast (payload: ToastPayload): number {
      const { title, body = '', level = 'info', duration = DEFAULT_DURATION } = payload
      const id = ++this.seq
      this.toasts.push({ id, title, body, level })

      if (duration > 0) {
        setTimeout(() => this.dismissToast(id), duration)
      }
      return id
    },

    dismissToast (id: number): void {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },

    clearToasts (): void {
      this.toasts = []
    },
  },
})
