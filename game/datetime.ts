/**
 * 本地时间工具（游戏时长统计专用）
 *
 * 约定：数据库中时间统一存 "YYYY-MM-DD HH:mm:ss" 本地时间字符串，
 *      与 SQLite 的 datetime('now', 'localtime') 格式一致，便于比较、排序与展示。
 */
const pad = (value: number): string => String(value).padStart(2, '0')

/** YYYY-MM-DD（本地日期，用于按天归档） */
export function formatDate (date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** YYYY-MM-DD HH:mm:ss（本地） */
export function formatDateTime (date: Date): string {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** HH:mm:ss（本地，用于展示会话开始时间） */
export function formatClock (date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 当天 00:00:00（返回新对象，不修改入参） */
export function startOfDay (date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** 按天偏移（返回新对象，用于生成「最近 N 天」的日期区间） */
export function addDays (date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

/** 最近 days 天的日期列表（含今天，升序） */
export function recentDates (days: number, now: Date = new Date()): string[] {
  const base = startOfDay(now)
  return Array.from({ length: days }, (_, index) => formatDate(addDays(base, index - days + 1)))
}
