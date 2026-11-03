/**
 * 通用格式化工具
 *
 * 约定：时长统一以「秒」在前后端之间传递，展示时才转换，
 *      避免各处自行换算导致口径不一致。
 */
const pad2 = (value: number): string => String(value).padStart(2, '0')

/** 秒 -> 01:23:45 / 23:45（看板大数字） */
export function formatClock (seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours ? `${pad2(hours)}:${pad2(minutes)}:${pad2(rest)}` : `${pad2(minutes)}:${pad2(rest)}`
}

/** 秒 -> 「1 小时 23 分钟」/「23 分钟」/「45 秒」（文案） */
export function formatDuration (seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours) return `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}`
  if (minutes) return `${minutes} 分钟`
  return `${total} 秒`
}

/** 秒 -> 分钟（保留一位小数，图表使用） */
export function toMinutes (seconds: number): number {
  return Math.round(((Number(seconds) || 0) / 60) * 10) / 10
}

/** "2026-09-30 12:05:03" -> "12:05" */
export function formatTimeOfDay (dateTime: string | null | undefined): string {
  const matched = String(dateTime || '').match(/(\d{2}):(\d{2})/)
  return matched ? `${matched[1]}:${matched[2]}` : '--:--'
}

/** "2026-09-30" -> "09-30"（图表轴标签） */
export function formatMonthDay (date: string): string {
  const matched = String(date || '').match(/^\d{4}-(\d{2})-(\d{2})$/)
  return matched ? `${matched[1]}-${matched[2]}` : String(date || '')
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** "2026-09-30" -> "9月30日 周三" */
export function formatDateLabel (date: string): string {
  const matched = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return String(date || '')
  const value = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  return `${value.getMonth() + 1}月${value.getDate()}日 ${WEEKDAYS[value.getDay()]}`
}

/** 识别来源 -> 界面文案 */
const SOURCE_LABELS: Record<string, string> = {
  builtin: '内置库',
  learned: '自动识别',
  user: '自定义',
}

export function formatGameSource (source: string): string {
  return SOURCE_LABELS[source] || '未知'
}
