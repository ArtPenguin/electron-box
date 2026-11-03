/**
 * 工具：计算器
 *
 * 安全计算算术表达式：
 * - 先校验字符集，仅允许数字、加减乘除、括号、小数点、空格；
 * - 使用 Function 构造器（非全局 eval）且开启严格模式，避免任意代码执行。
 */
import { tool } from '@langchain/core/tools'

const ALLOWED_PATTERN = /^[0-9+\-*/().\s]+$/

/** 计算表达式（非法输入抛出可读错误） */
export function safeCalc (expression: unknown): number {
  if (typeof expression !== 'string' || !ALLOWED_PATTERN.test(expression)) {
    throw new Error('表达式包含非法字符，仅支持数字、+ - * /、括号和小数点')
  }
  const value = Function(`"use strict"; return (${expression});`)() as unknown
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('无法计算该表达式，请检查是否合法')
  }
  return value
}

const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    try {
      return { result: safeCalc(expression) }
    } catch (err) {
      return { error: (err as Error).message }
    }
  },
  {
    name: 'calculator',
    description: '计算一个算术表达式，例如 "(3+2)*4"。支持数字、加减乘除、括号、小数点。',
    schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要计算的算术表达式字符串' },
      },
      required: ['expression'],
    },
  }
)

export default calculatorTool
