/**
 * 监控历史日志持久化（与规则分开存储）
 *
 * - 规则配置走 procmon_rules，运行日志走 procmon_logs，互不影响；
 * - 日志按保留条数（settings.logRetention）自动清理最旧记录，不无限堆积；
 * - 频繁写入的日志只写 SQLite，历史查询由 monitor 在内存中缓存最近一批。
 */
import { clearProcmonLogs, insertProcmonLog, listProcmonLogs, purgeProcmonLogs, type ProcLogRecordInput } from '../db'
import type { ProcLogEntry } from '../types/ipc'

/** 查询日志（最新在前，最多 limit 条） */
export function list (limit = 500): ProcLogEntry[] {
  return listProcmonLogs(limit)
}

/**
 * 写入一条日志，并按保留条数清理最旧记录。
 * @returns 落库后的完整记录（便于 monitor 推送给界面）
 */
export function add (input: ProcLogRecordInput, retention: number): ProcLogEntry | null {
  const entry = insertProcmonLog(input)
  if (retention > 0) purgeProcmonLogs(retention)
  return entry
}

/** 清空全部日志 */
export function clear (): void {
  clearProcmonLogs()
}

/** 配置变更后按新的保留条数清理一次旧日志 */
export function applyRetention (retention: number): number {
  return purgeProcmonLogs(retention)
}
