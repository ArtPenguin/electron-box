/**
 * 主题令牌（设计变量）
 *
 * 全部界面颜色都通过 CSS 变量消费，这里集中声明：
 * - ThemeColors：变量名 → 取值，切换主题时整体写入 :root（见 apply.ts）
 * - ChartPalette：ECharts 的配色（图表不能用 CSS 变量，需要 JS 值）
 *
 * 新增一个可换肤的颜色，只需在此加字段 + 在所有主题里给值，
 * 界面样式直接使用 var(--xxx)，无需改动组件代码。
 */

/** 界面颜色令牌（对应 :root 上的 CSS 变量） */
export interface ThemeColors {
  /** 页面底色 */
  bg: string
  /** 侧栏 / 输入区等次级底色 */
  bgSide: string
  /** 控件底色 */
  surface: string
  /** 面板底色 */
  surface2: string
  /** 悬浮态控件底色 */
  surface3: string
  /** 常规描边 */
  border: string
  /** 强调描边（hover / 输入聚焦） */
  borderStrong: string
  /** 正文颜色 */
  text: string
  /** 次级文字 */
  textDim: string
  /** 弱化文字（说明、占位） */
  textMuted: string
  /** 主色 */
  accent: string
  /** 主色浅底（标签、徽标背景） */
  accentSoft: string
  /** 主色之上的文字色（按钮文字） */
  accentContrast: string
  /** 主色 hover（按钮悬停） */
  accentHover: string
  success: string
  successSoft: string
  warn: string
  warnSoft: string
  danger: string
  dangerSoft: string
  /** 弹出层（Toast）背景 */
  overlay: string
  /** 表格行悬停背景 */
  tableHover: string
  /** 卡片阴影 */
  shadow: string
}

/** 图表配色（ECharts 无法读取 CSS 变量，因此随主题一起提供） */
export interface ChartPalette {
  /** 坐标轴文字 */
  text: string
  /** 坐标轴线 */
  axisLine: string
  /** 网格分割线 */
  splitLine: string
  /** tooltip 背景 / 描边 / 文字 */
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  /** 分类色板（各游戏占比等） */
  series: string[]
  /** 今日柱高亮色 */
  today: string
  /** 限额参考线 */
  limit: string
  /** 无数据时的占位色 */
  empty: string
  /** 环形图分隔描边 */
  pieBorder: string
}

/** CSS 变量名映射（ThemeColors 字段 → CSS 自定义属性名） */
export const CSS_VAR_NAMES: Record<keyof ThemeColors, string> = {
  bg: '--bg',
  bgSide: '--bg-side',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  border: '--border',
  borderStrong: '--border-strong',
  text: '--text',
  textDim: '--text-dim',
  textMuted: '--text-muted',
  accent: '--accent',
  accentSoft: '--accent-soft',
  accentContrast: '--accent-contrast',
  accentHover: '--accent-hover',
  success: '--success',
  successSoft: '--success-soft',
  warn: '--warn',
  warnSoft: '--warn-soft',
  danger: '--danger',
  dangerSoft: '--danger-soft',
  overlay: '--overlay',
  tableHover: '--table-hover',
  shadow: '--shadow',
}

/** 与主题无关的尺寸令牌（圆角等，写在样式表里，不参与换肤） */
export const LAYOUT_VARS = {
  radius: '--radius',
  radiusSm: '--radius-sm',
} as const
