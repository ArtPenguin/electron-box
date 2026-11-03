/**
 * 主题定义（换肤数据）
 *
 * 每套主题给出完整的颜色令牌与图表配色，切换时由 apply.ts 写入 :root 的 CSS 变量，
 * 因此新增主题只需在此追加一份数据，界面样式无需改动。
 *
 * 现有主题：
 * - dark              暗色（唯一深色主题，夜间使用）
 * - light / ocean     亮色（中性浅灰） / 海蓝（冷蓝浅色）
 * - garden / sunrise  森绿（自然绿浅色） / 暖阳（暖橙浅色）
 * - lilac             紫罗兰（淡紫浅色）
 *
 * 除 dark 外都是浅色皮肤：底色浅、文字深，主色为同色系深一点的高对比色，
 * 保证「主色按钮 + 白色文字」「主色描边 / 浅底标签」在浅背景上都清晰。
 */
import type { ChartPalette, ThemeColors } from './tokens'

/** 可选主题 ID */
export type ThemeId = 'dark' | 'light' | 'ocean' | 'garden' | 'sunrise' | 'lilac'

/** 旧版本主题 ID（当时是深色皮肤）→ 现在的同色系浅色主题，老用户的偏好不会丢 */
export const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  midnight: 'ocean',
  forest: 'garden',
  sunset: 'sunrise',
  violet: 'lilac',
}

/** 用户偏好：具体主题，或跟随系统（在 dark / light 间自动切换） */
export type ThemePreference = ThemeId | 'system'

export interface Theme {
  id: ThemeId
  /** 切换器上显示的名称 */
  name: string
  /** 明暗属性（跟随系统时据此选择；也用于给用户分组展示） */
  mode: 'light' | 'dark'
  /** 一句话描述（帮助用户挑选） */
  description: string
  colors: ThemeColors
  chart: ChartPalette
}

/** 暗色（默认）：Catppuccin Mocha 风格 */
const dark: Theme = {
  id: 'dark',
  name: '暗色',
  mode: 'dark',
  description: '默认深色主题，夜间使用更护眼',
  colors: {
    bg: '#1e1e2e',
    bgSide: '#181825',
    surface: '#313244',
    surface2: '#24273a',
    surface3: '#2a2b3c',
    border: '#313244',
    borderStrong: '#45475a',
    text: '#cdd6f4',
    textDim: '#a6adc8',
    textMuted: '#6c7086',
    accent: '#89b4fa',
    accentSoft: 'rgba(137, 180, 250, 0.14)',
    accentContrast: '#11111b',
    accentHover: '#a6c8ff',
    success: '#a6e3a1',
    successSoft: 'rgba(166, 227, 161, 0.16)',
    warn: '#f9e2af',
    warnSoft: 'rgba(249, 226, 175, 0.16)',
    danger: '#f38ba8',
    dangerSoft: 'rgba(243, 139, 168, 0.16)',
    overlay: 'rgba(24, 24, 37, 0.96)',
    tableHover: 'rgba(49, 50, 68, 0.45)',
    shadow: '0 14px 34px rgba(0, 0, 0, 0.3)',
  },
  chart: {
    text: '#a6adc8',
    axisLine: '#45475a',
    splitLine: '#313244',
    tooltipBg: '#1e1e2e',
    tooltipBorder: '#45475a',
    tooltipText: '#cdd6f4',
    series: ['#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7', '#94e2d5'],
    today: '#f9e2af',
    limit: '#f38ba8',
    empty: '#45475a',
    pieBorder: '#181825',
  },
}

/** 海蓝：冷调蓝浅色，背景明亮通透，适合白天 / 强光环境 */
const ocean: Theme = {
  id: 'ocean',
  name: '海蓝',
  mode: 'light',
  description: '冷蓝浅色，清爽通透',
  colors: {
    bg: '#eef4fc',
    bgSide: '#e3ecf9',
    surface: '#ffffff',
    surface2: '#ffffff',
    surface3: '#f0f5fd',
    border: '#d9e4f4',
    borderStrong: '#b3c8e6',
    text: '#1b3557',
    textDim: '#3f5c85',
    textMuted: '#7d92ad',
    accent: '#1668d8',
    accentSoft: 'rgba(22, 104, 216, 0.12)',
    accentContrast: '#ffffff',
    accentHover: '#0f56bd',
    success: '#1f7a3a',
    successSoft: 'rgba(31, 122, 58, 0.12)',
    warn: '#b45309',
    warnSoft: 'rgba(180, 83, 9, 0.14)',
    danger: '#cb2b3f',
    dangerSoft: 'rgba(203, 43, 63, 0.12)',
    overlay: 'rgba(255, 255, 255, 0.97)',
    tableHover: 'rgba(22, 104, 216, 0.06)',
    shadow: '0 12px 28px rgba(27, 53, 87, 0.14)',
  },
  chart: {
    text: '#5c7391',
    axisLine: '#b3c8e6',
    splitLine: '#e3ecf9',
    tooltipBg: '#ffffff',
    tooltipBorder: '#b3c8e6',
    tooltipText: '#1b3557',
    series: ['#1a6fe0', '#19a05a', '#e0900f', '#e0455f', '#8155e0', '#0ea5b7'],
    today: '#e0900f',
    limit: '#e0455f',
    empty: '#c8d6ea',
    pieBorder: '#ffffff',
  },
}

/** 森绿：自然绿浅色，柔和低刺激 */
const garden: Theme = {
  id: 'garden',
  name: '森绿',
  mode: 'light',
  description: '自然绿浅色，柔和不刺眼',
  colors: {
    bg: '#eef7f1',
    bgSide: '#e3f1e8',
    surface: '#ffffff',
    surface2: '#ffffff',
    surface3: '#f1f9f4',
    border: '#d6e9dd',
    borderStrong: '#aed3bd',
    text: '#17402c',
    textDim: '#3c6252',
    textMuted: '#789181',
    accent: '#0f7a4a',
    accentSoft: 'rgba(15, 122, 74, 0.12)',
    accentContrast: '#ffffff',
    accentHover: '#0a6339',
    success: '#1f7a3a',
    successSoft: 'rgba(31, 122, 58, 0.12)',
    warn: '#a16207',
    warnSoft: 'rgba(161, 98, 7, 0.14)',
    danger: '#c2333a',
    dangerSoft: 'rgba(194, 51, 58, 0.12)',
    overlay: 'rgba(255, 255, 255, 0.97)',
    tableHover: 'rgba(15, 122, 74, 0.06)',
    shadow: '0 12px 28px rgba(23, 64, 44, 0.14)',
  },
  chart: {
    text: '#5d7a6b',
    axisLine: '#aed3bd',
    splitLine: '#e3f1e8',
    tooltipBg: '#ffffff',
    tooltipBorder: '#aed3bd',
    tooltipText: '#17402c',
    series: ['#12894f', '#2f8fd8', '#e3a008', '#d94f5c', '#8b5cf6', '#0ea5b7'],
    today: '#e3a008',
    limit: '#d94f5c',
    empty: '#c3ddce',
    pieBorder: '#ffffff',
  },
}

/** 亮色：Catppuccin Latte 风格（白天 / 强光环境更清晰） */
const light: Theme = {
  id: 'light',
  name: '亮色',
  mode: 'light',
  description: '清爽浅色，白天使用对比更清晰',
  colors: {
    bg: '#eff1f5',
    bgSide: '#e6e9ef',
    surface: '#ffffff',
    surface2: '#ffffff',
    surface3: '#f2f4f8',
    border: '#dce0e8',
    borderStrong: '#bcc0cc',
    text: '#4c4f69',
    textDim: '#5c5f77',
    textMuted: '#8c8fa1',
    accent: '#1e66f5',
    accentSoft: 'rgba(30, 102, 245, 0.12)',
    accentContrast: '#ffffff',
    accentHover: '#3b7bff',
    success: '#40a02b',
    successSoft: 'rgba(64, 160, 43, 0.14)',
    warn: '#df8e1d',
    warnSoft: 'rgba(223, 142, 29, 0.16)',
    danger: '#d20f39',
    dangerSoft: 'rgba(210, 15, 57, 0.12)',
    overlay: 'rgba(255, 255, 255, 0.97)',
    tableHover: 'rgba(30, 102, 245, 0.06)',
    shadow: '0 12px 28px rgba(76, 79, 105, 0.14)',
  },
  chart: {
    text: '#6c6f85',
    axisLine: '#bcc0cc',
    splitLine: '#e6e9ef',
    tooltipBg: '#ffffff',
    tooltipBorder: '#bcc0cc',
    tooltipText: '#4c4f69',
    series: ['#1e66f5', '#40a02b', '#df8e1d', '#d20f39', '#8839ef', '#179299'],
    today: '#df8e1d',
    limit: '#d20f39',
    empty: '#ccd0da',
    pieBorder: '#ffffff',
  },
}

/** 暖阳：暖橙浅色，保留日落氛围但整体明亮 */
const sunrise: Theme = {
  id: 'sunrise',
  name: '暖阳',
  mode: 'light',
  description: '暖橙浅色，氛围感强',
  colors: {
    bg: '#fdf4ed',
    bgSide: '#fbebe0',
    surface: '#ffffff',
    surface2: '#ffffff',
    surface3: '#fef8f2',
    border: '#f2ddcd',
    borderStrong: '#e0bfa5',
    text: '#4a2a18',
    textDim: '#7a4c30',
    textMuted: '#a8806a',
    accent: '#c2410c',
    accentSoft: 'rgba(194, 65, 12, 0.12)',
    accentContrast: '#ffffff',
    accentHover: '#a13609',
    success: '#2c8a4b',
    successSoft: 'rgba(44, 138, 75, 0.12)',
    warn: '#a9701a',
    warnSoft: 'rgba(169, 112, 26, 0.14)',
    danger: '#c92a2a',
    dangerSoft: 'rgba(201, 42, 42, 0.12)',
    overlay: 'rgba(255, 255, 255, 0.97)',
    tableHover: 'rgba(194, 65, 12, 0.06)',
    shadow: '0 12px 28px rgba(74, 42, 24, 0.15)',
  },
  chart: {
    text: '#8a6046',
    axisLine: '#e0bfa5',
    splitLine: '#fbebe0',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e0bfa5',
    tooltipText: '#4a2a18',
    series: ['#d9601b', '#2f8fd8', '#0f9d58', '#d94f5c', '#8b5cf6', '#0ea5b7'],
    today: '#e0a020',
    limit: '#d94f5c',
    empty: '#f0d6c2',
    pieBorder: '#ffffff',
  },
}

/** 紫罗兰：淡紫浅色，层次分明 */
const lilac: Theme = {
  id: 'lilac',
  name: '紫罗兰',
  mode: 'light',
  description: '淡紫浅色，层次分明',
  colors: {
    bg: '#f5f2fd',
    bgSide: '#ece7fb',
    surface: '#ffffff',
    surface2: '#ffffff',
    surface3: '#f9f7fe',
    border: '#e3ddf7',
    borderStrong: '#c6b9ef',
    text: '#2f2450',
    textDim: '#554a80',
    textMuted: '#8b83ad',
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.12)',
    accentContrast: '#ffffff',
    accentHover: '#6930d4',
    success: '#2c8a4b',
    successSoft: 'rgba(44, 138, 75, 0.12)',
    warn: '#b06a05',
    warnSoft: 'rgba(176, 106, 5, 0.14)',
    danger: '#cf2d5a',
    dangerSoft: 'rgba(207, 45, 90, 0.12)',
    overlay: 'rgba(255, 255, 255, 0.97)',
    tableHover: 'rgba(124, 58, 237, 0.06)',
    shadow: '0 12px 28px rgba(47, 36, 80, 0.15)',
  },
  chart: {
    text: '#6b6390',
    axisLine: '#c6b9ef',
    splitLine: '#ece7fb',
    tooltipBg: '#ffffff',
    tooltipBorder: '#c6b9ef',
    tooltipText: '#2f2450',
    series: ['#8b5cf6', '#0f9d58', '#e3a008', '#d94f5c', '#2f8fd8', '#14b8a6'],
    today: '#e3a008',
    limit: '#d94f5c',
    empty: '#d9d1f5',
    pieBorder: '#ffffff',
  },
}

/** 全部主题（切换器按此顺序展示；除 dark 外都是浅色皮肤，切换器会按明暗分组） */
export const THEMES: Theme[] = [dark, light, ocean, garden, sunrise, lilac]

/** 默认主题（与 base.css 的 :root 初值一致，避免首屏闪烁） */
export const DEFAULT_THEME_ID: ThemeId = 'dark'

/** 跟随系统时使用的两个主题 */
export const SYSTEM_THEME_IDS: { light: ThemeId; dark: ThemeId } = { light: 'light', dark: 'dark' }

/** 按 id 取主题（不存在的 id 回退到默认主题） */
export function getTheme (id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) || THEMES[0]
}
