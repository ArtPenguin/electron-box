/**
 * 工具：获取当前时间
 */
import { tool } from '@langchain/core/tools'

const currentTimeTool = tool(
  async () => ({ time: new Date().toISOString() }),
  {
    name: 'getCurrentTime',
    description: '获取当前系统时间（ISO 8601 格式）。',
    schema: { type: 'object', properties: {} },
  }
)

export default currentTimeTool
