/**
 * 进程监视器：错误分类与友好文案
 *
 * 三类典型异常分别给出可读的中文提示（界面展示用），原始堆栈 / 底层命令输出
 * 只写到主进程内部日志（console.error），不直接暴露给普通用户。
 *
 * - permission：无权限读取 / 操作进程（Access denied / EPERM）
 * - gone：进程已经提前退出（ESRCH / no such process）
 * - timeout：命令执行超时（命令挂起，避免拖垮轮询循环）
 * - unknown：其余失败（命令不存在 / 解析异常等），文案笼统化处理
 */
import type { ProcScanError, ProcScanErrorKind } from '../types/ipc'

/** 提取底层错误的可检索信息（code / signal / stderr / message） */
function collect (err: unknown): { code: string; signal: string; text: string } {
  const anyErr = err as { code?: string; signal?: string; stderr?: Buffer | string; message?: string }
  const stderr = typeof anyErr?.stderr === 'string' ? anyErr.stderr : String(anyErr?.stderr || '')
  return {
    code: String(anyErr?.code || ''),
    signal: String(anyErr?.signal || ''),
    text: `${stderr}\n${anyErr?.message || String(err)}`.toLowerCase(),
  }
}

/** 命令执行超时（execFile timeout 触发时错误特征） */
function isTimeout (info: { code: string; signal: string }): boolean {
  return info.code === 'ETIMEDOUT' || info.signal === 'SIGTERM'
}

/** 权限不足特征 */
function isPermission (info: { code: string; text: string }): boolean {
  return (
    info.code === 'EPERM' ||
    info.code === 'EACCES' ||
    info.text.includes('access denied') ||
    info.text.includes('拒绝访问') ||
    info.text.includes('permission denied') ||
    info.text.includes('unauthorizedaccess')
  )
}

/** 进程已不存在特征 */
function isGone (info: { code: string; text: string }): boolean {
  return (
    info.code === 'ESRCH' ||
    info.text.includes('no such process') ||
    info.text.includes('找不到进程') ||
    info.text.includes('进程不存在')
  )
}

/**
 * 把底层异常分类成界面可展示的结构化错误。
 * @param scope 场景描述（如「读取进程列表」「终止进程」），拼进友好文案
 */
export function classifyError (err: unknown, scope: string): ProcScanError {
  const info = collect(err)

  if (isTimeout(info)) {
    return {
      kind: 'timeout',
      message: `${scope}超时：系统命令响应过慢，已跳过本轮采集，请稍后重试。`,
    }
  }
  if (isPermission(info)) {
    return {
      kind: 'permission',
      message: `${scope}失败：权限不足，请以管理员身份运行应用后重试。`,
    }
  }
  if (isGone(info)) {
    return {
      kind: 'gone',
      message: `${scope}失败：该进程已提前退出，状态可能已变化。`,
    }
  }
  return {
    kind: 'unknown',
    message: `${scope}失败：系统命令执行异常，详细原因已记录到内部日志。`,
  }
}

/** 把分类后的错误与原始堆栈写到主进程内部日志（不上屏） */
export function logInternalError (scope: string, err: unknown): void {
  console.error(`[procmon] ${scope}:`, err)
}

/** 友好文案映射（规则动作 / 日志展示用） */
export const ERROR_KIND_LABEL: Record<ProcScanErrorKind, string> = {
  permission: '权限不足',
  gone: '进程已退出',
  timeout: '执行超时',
  unknown: '未知错误',
}
