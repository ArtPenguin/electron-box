/**
 * 主题应用（唯一一处操作 DOM 的地方）
 *
 * 换肤原理：主题数据 → 写入 :root 的 CSS 变量 → 所有样式（含 .vue 的 scoped 样式）
 * 通过 var(--xxx) 自动跟随，组件代码零改动。
 * 同时标记 data-theme / data-theme-mode 与 color-scheme，便于：
 * - CSS 针对亮/暗做细微调整（如滚动条、阴影）
 * - 浏览器原生控件（滚动条、输入框、下拉）跟随主题明暗
 */
import { CSS_VAR_NAMES, type ThemeColors } from './tokens'
import { getTheme, type Theme, type ThemeId } from './themes'

/** 当前生效的主题（供 ECharts 等需要用 JS 取色的地方读取） */
let currentTheme: Theme = getTheme(null)

export function getCurrentTheme (): Theme {
  return currentTheme
}

/** 应用主题并返回生效的主题对象 */
export function applyTheme (id: ThemeId): Theme {
  const theme = getTheme(id)
  const root = document.documentElement

  for (const [key, cssVar] of Object.entries(CSS_VAR_NAMES)) {
    root.style.setProperty(cssVar, theme.colors[key as keyof ThemeColors])
  }

  root.dataset.theme = theme.id
  root.dataset.themeMode = theme.mode
  root.style.colorScheme = theme.mode

  currentTheme = theme
  return theme
}
