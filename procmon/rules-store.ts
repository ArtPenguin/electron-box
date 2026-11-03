/**
 * 监控规则持久化与校验（主进程侧）
 *
 * - 规则存 SQLite（procmon_rules 表），重启应用不丢失；
 * - 保存前做参数校验：关键词只允许普通字符约束长度，动作枚举收敛；
 * - 进程名匹配关键词**只用于内存字符串比较**，不进 shell 命令（见 scanner）；
 * - 缓存内存中的规则列表，避免每轮轮询都查库；写入时同步更新缓存。
 */
import {
  bumpProcmonRuleTrigger,
  deleteProcmonRule,
  getProcmonRule,
  insertProcmonRule,
  listProcmonRules,
  setProcmonRuleEnabled,
  updateProcmonRule,
  type ProcRuleRecordInput,
} from '../db'
import type { ProcRule, ProcRuleActions, ProcRuleInput } from '../types/ipc'

/** 校验失败时的可读原因 */
export interface RulesResult {
  ok: boolean
  error?: string
  rule?: ProcRule | null
}

/** 校验通过后的规范化记录 */
type ValidatedInput = RulesResult & { input: ProcRuleRecordInput }

const MAX_PATTERN = 128
const MAX_LABEL = 60
const MAX_EVENT_LABEL = 60

const MATCH_TYPES = new Set(['exact', 'fuzzy'])
const EVENT_TYPES = new Set(['none', 'start', 'stop', 'both'])

let cache: ProcRule[] | null = null

/** 读取全部规则（首次调用时从数据库载入并缓存） */
export function list (): ProcRule[] {
  if (!cache) cache = listProcmonRules()
  return cache
}

/** 规则列表变化后重置缓存（便于外部改动 / 调试后重新载入） */
function reload (): ProcRule[] {
  cache = null
  return list()
}

/** 规范化动作配置（非法值收敛到安全默认） */
function normalizeActions (raw: Partial<ProcRuleActions> | undefined): ProcRuleActions {
  return {
    log: raw?.log !== false,
    notification: raw?.notification === true,
    event: EVENT_TYPES.has(String(raw?.event || '')) ? (raw!.event as ProcRuleActions['event']) : 'none',
    eventLabel: String(raw?.eventLabel || '').trim().slice(0, MAX_EVENT_LABEL),
  }
}

/** 校验并规范化一条规则入参 */
function validate (input: ProcRuleInput): ValidatedInput | { ok: false; error: string } {
  const pattern = String(input?.pattern || '').trim()
  if (!pattern) return { ok: false, error: '请填写进程名匹配关键词' }
  if (pattern.length > MAX_PATTERN) return { ok: false, error: `关键词过长（最多 ${MAX_PATTERN} 个字符）` }

  const matchType = MATCH_TYPES.has(String(input?.matchType || ''))
    ? (input!.matchType as ProcRule['matchType'])
    : null
  if (!matchType) return { ok: false, error: '匹配方式只能是精确匹配或模糊匹配' }

  const label = String(input?.label || '').trim().slice(0, MAX_LABEL)
  const actions = normalizeActions(input?.actions)
  const enabled = input?.enabled !== false

  return {
    ok: true,
    rule: null,
    input: { label, matchType, pattern, enabled, actions },
  }
}

/** 保存（新增 / 覆盖）规则；id 为空表示新建 */
export function save (input: ProcRuleInput): RulesResult {
  const check = validate(input)
  if (!check.ok) return check

  const record = check.input
  const existingId = Number(input?.id) || null
  const row = existingId
    ? updateProcmonRule(existingId, record)
    : insertProcmonRule(record)

  if (!row) return { ok: false, error: '规则保存失败，请稍后重试' }
  reload()
  return { ok: true, rule: row }
}

/** 删除规则 */
export function remove (id: number): RulesResult {
  const ruleId = Number(id)
  if (!Number.isInteger(ruleId) || ruleId <= 0) return { ok: false, error: '规则编号无效' }
  const existed = Boolean(getProcmonRule(ruleId))
  if (!existed) return { ok: false, error: '该规则不存在或已被删除' }
  deleteProcmonRule(ruleId)
  reload()
  return { ok: true }
}

/** 启用 / 禁用规则 */
export function toggle (id: number, enabled: boolean): RulesResult {
  const ruleId = Number(id)
  if (!Number.isInteger(ruleId) || ruleId <= 0) return { ok: false, error: '规则编号无效' }
  const row = setProcmonRuleEnabled(ruleId, Boolean(enabled))
  if (!row) return { ok: false, error: '该规则不存在或已被删除' }
  reload()
  return { ok: true, rule: row }
}

/** 记录一次触发（计数 +1，更新最后触发时间） */
export function markTriggered (id: number, at: string): void {
  bumpProcmonRuleTrigger(id, at)
  const rule = cache?.find((item) => item.id === id)
  if (rule) {
    rule.triggerCount += 1
    rule.lastTriggeredAt = at
  }
}

/** 规则匹配单个进程名（不区分大小写） */
export function matches (rule: ProcRule, processName: string): boolean {
  const name = String(processName || '').trim().toLowerCase()
  const pattern = rule.pattern.trim().toLowerCase()
  if (!name || !pattern) return false
  return rule.matchType === 'exact' ? name === pattern : name.includes(pattern)
}
