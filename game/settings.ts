/**
 * 游戏工具配置（持久化在 SQLite 的 game_settings 表）
 *
 * - dailyLimitMinutes      每日游戏时长上限，默认 30 分钟；当日累计达到该值即触发提醒
 * - remindIntervalSeconds  提醒间隔，默认 30 秒（需求：只要还在继续游戏，就每 30s 持续提醒）
 * - nearThresholdMinutes   剩余额度预警阈值，默认 30 分钟（需求：剩余不足 30 分钟即弹窗提醒）
 */
import { getGameSetting, setGameSetting } from '../db'
import type { GameSettings } from '../types/ipc'

// 可配置项类型定义在共享契约里（前后端一致）
export type { GameSettings }

export const DEFAULTS: GameSettings = {
  dailyLimitMinutes: 30,
  remindIntervalSeconds: 30,
  nearThresholdMinutes: 30,
}

/**
 * 历史默认值：这些值曾经是默认值，而界面上从未开放修改过对应配置项，
 * 因此读到它们只可能是旧版本写下的默认值（不是用户的自定义选择），
 * 升级时直接沿用新默认值，避免用户继续按旧阈值（先弹不出来）运行。
 */
const LEGACY_DEFAULTS: Partial<Record<keyof GameSettings, number[]>> = {
  nearThresholdMinutes: [5],
}

/** 各项的取值范围（含首尾），越界值会被收敛 */
export const RANGES: Record<keyof GameSettings, { min: number; max: number }> = {
  dailyLimitMinutes: { min: 1, max: 1440 },
  remindIntervalSeconds: { min: 10, max: 600 },
  nearThresholdMinutes: { min: 0, max: 120 },
}

const SETTING_KEYS = Object.keys(DEFAULTS) as Array<keyof GameSettings>

/** 收敛到合法范围（非法值回落默认值） */
function clamp (key: keyof GameSettings, raw: unknown): number {
  const num = Math.round(Number(raw))
  if (!Number.isFinite(num)) return DEFAULTS[key]
  const { min, max } = RANGES[key]
  return Math.min(max, Math.max(min, num))
}

/** 是否为历史默认值（旧版本写入，应当升级为新默认值） */
function isLegacyDefault (key: keyof GameSettings, raw: unknown): boolean {
  const legacy = LEGACY_DEFAULTS[key]
  return Boolean(legacy && legacy.includes(Math.round(Number(raw))))
}

/** 读取全部配置（含非法值纠正与旧默认值升级） */
export function getSettings (): GameSettings {
  const settings = {} as GameSettings
  for (const key of SETTING_KEYS) {
    const stored = getGameSetting<unknown>(key, DEFAULTS[key])
    settings[key] = clamp(key, isLegacyDefault(key, stored) ? DEFAULTS[key] : stored)
  }
  return settings
}

/**
 * 增量更新配置（只写传入且合法的键）
 * @param patch 需要修改的配置
 * @returns 更新后的完整配置
 */
export function updateSettings (patch: Partial<Record<string, unknown>> = {}): GameSettings {
  const settings = getSettings()
  for (const [key, raw] of Object.entries(patch)) {
    if (!SETTING_KEYS.includes(key as keyof GameSettings)) continue
    const settingKey = key as keyof GameSettings
    const value = clamp(settingKey, raw)
    if (value !== settings[settingKey]) {
      setGameSetting(settingKey, value)
      settings[settingKey] = value
    }
  }
  return settings
}
