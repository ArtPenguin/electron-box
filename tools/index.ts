/**
 * Agent 工具注册表
 *
 * 新增工具只需实现「LangChain tool」并在此登记，agent.ts 无需改动。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'

import calculatorTool from './calculator'
import currentTimeTool from './current-time'
import webSearchTool from './web-search'

export const tools: StructuredToolInterface[] = [calculatorTool, currentTimeTool, webSearchTool]
