/**
 * 主题偏好（Pinia）
 *
 * 职责：记住用户选择（含「跟随系统」）、把偏好落盘（localStorage）、
 * 并在启动与切换时调用 theme/apply 应用主题。
 *
 * 与其他业务 store 完全隔离：主题相关的状态、持久化、系统监听都只在这里，
 * 页面只需 useThemeStore() + ThemePicker 组件即可，不感知实现细节。
 */
import { defineStore } from 'pinia'

import { applyTheme } from '../theme/apply'
import {
  DEFAULT_THEME_ID,
  LEGACY_THEME_IDS,
  SYSTEM_THEME_IDS,
  THEMES,
  getTheme,
  type Theme,
  type ThemeId,
  type ThemePreference,
} from '../theme/themes'
import type { ChartPalette } from '../theme/tokens'

const STORAGE_KEY = 'elect:theme'

/** 从 localStorage 读取偏好（非法值回退默认，存储损坏也不影响启动） */
function readPreference (): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_THEME_ID
    if (raw === 'system') return 'system'
    // 旧版本的主题 id（当时是深色皮肤）映射到同色系的浅色主题，老用户的偏好不丢
    const id = LEGACY_THEME_IDS[raw] ?? raw
    return THEMES.some((theme) => theme.id === id) ? (id as ThemeId) : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

function persist (preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // 隐私模式等场景写入失败：仅影响下次启动的记忆，不影响本次使用
  }
}

/** 系统主题监听句柄（放模块作用域，避免被 Pinia 代理） */
let mediaQuery: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

/** 当前系统是否为暗色 */
function systemPrefersDark (): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    /** 用户偏好：具体主题 id 或 'system'（跟随系统） */
    preference: readPreference() as ThemePreference,
    /** 系统当前明暗（跟随系统时使用） */
    systemMode: (systemPrefersDark() ? 'dark' : 'light') as 'light' | 'dark',
    /** 可选主题列表（切换器渲染用） */
    themes: THEMES as Theme[],
  }),

  getters: {
    /** 实际生效的主题对象 */
    theme (state): Theme {
      const id = state.preference === 'system' ? SYSTEM_THEME_IDS[state.systemMode] : state.preference
      return getTheme(id)
    },
    themeId (state): ThemeId {
      return state.preference === 'system' ? SYSTEM_THEME_IDS[state.systemMode] : state.preference
    },
    /** 是否跟随系统 */
    isSystem (state): boolean {
      return state.preference === 'system'
    },
    /** 当前主题的图表配色（ECharts 用） */
    chartPalette (state): ChartPalette {
      const id = state.preference === 'system' ? SYSTEM_THEME_IDS[state.systemMode] : state.preference
      return getTheme(id).chart
    },
  },

  actions: {
    /** 应用当前偏好（启动时调用一次；切换时由 setPreference 调用） */
    apply (): void {
      applyTheme(this.themeId)
    },

    /** 切换主题（或切换为跟随系统） */
    setPreference (preference: ThemePreference): void {
      this.preference = preference
      persist(preference)
      this.apply()
    },

    /** 开始监听系统主题变化：跟随系统时切换主题，其它情况只记录状态 */
    watchSystem (): void {
      if (mediaQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return
      }
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaListener = (event) => {
        this.systemMode = event.matches ? 'dark' : 'light'
        if (this.isSystem) this.apply()
      }
      mediaQuery.addEventListener('change', mediaListener)
    },

    /** 停止监听（应用退出或调试时调用） */
    unwatchSystem (): void {
      if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener)
      mediaQuery = null
      mediaListener = null
    },
  },
})
