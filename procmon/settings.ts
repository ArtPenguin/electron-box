/**
 * 进程监视器配置（持久化在 SQLite 的 app_settings 表，JSON 存值）
 *
 * - intervalSeconds  进程轮询间隔（秒）：合法区间 1~10，默认 3；不能小于 1 秒
 * - logRetention     运行日志保留条数：超出后自动清理最旧记录，不无限堆积
 */
import { getAppSetting, setAppSetting } from '../db'
import type { ProcmonSettings } from '../types/ipc'

export const DEFAULTS: ProcmonSettings = {
  intervalSeconds: 3,
  logRetention: 500,
}

/** 各项取值范围（含首尾），越界值收敛到边界 */
export const RANGES: Record<keyof ProcmonSettings, { min: number; max: number }> = {
  intervalSeconds: { min: 1, max: 10 },
  logRetention: { min: 50, max: 5000 },
}

const SETTING_KEYS = Object.keys(DEFAULTS) as Array<keyof ProcmonSettings>

/** 收敛到合法范围（非法值回落默认值） */
function clamp (key: keyof ProcmonSettings, raw: unknown): number {
  const num = Math.round(Number(raw))
  if (!Number.isFinite(num)) return DEFAULTS[key]
  const { min, max } = RANGES[key]
  return Math.min(max, Math.max(min, num))
}

/** 读取全部配置（含非法值纠正） */
export function getSettings (): ProcmonSettings {
  const settings = {} as ProcmonSettings
  for (const key of SETTING_KEYS) {
    const stored = getAppSetting<unknown>(`procmon.${key}`, DEFAULTS[key])
    settings[key] = clamp(key, stored)
  }
  return settings
}

/** 增量更新配置（只写传入且合法的键），返回更新后的完整配置 */
export function updateSettings (patch: Partial<Record<string, unknown>> = {}): ProcmonSettings {
  const settings = getSettings()
  for (const [key, raw] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(key as keyof ProcmonSettings)) continue
    const settingKey = key as keyof ProcmonSettings
    const value = clamp(settingKey, raw)
    if (value !== settings[settingKey]) {
      setAppSetting(`procmon.${settingKey}`, value)
      settings[settingKey] = value
    }
  }
  return settings
}
