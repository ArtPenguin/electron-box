/**
 * 工具清单（首页功能列表的数据源）
 *
 * 新增一个工具的步骤：
 * 1. 在这里追加一项（key / 名称 / 图标 / 简介 / 功能点 / 路由）
 * 2. 在 renderer/src/pages 下新增页面组件（.vue，<script setup lang="ts">）
 * 3. 在 renderer/src/router/index.ts 注册路由
 */

/** 工具卡片的数据结构（ToolCard 组件按此渲染） */
export interface ToolItem {
  key: string
  name: string
  icon: string
  /** 卡片主色调（对应 ToolCard 的 accent-* 样式） */
  accent: 'blue' | 'green'
  badge: string
  summary: string
  features: string[]
  route: string
}

export const TOOLS: ToolItem[] = [
  {
    key: 'chat',
    name: 'AI 聊天助手',
    icon: '💬',
    accent: 'blue',
    badge: '对话',
    summary: '基于 DeepSeek 的流式对话助手，支持联网搜索与本地历史会话',
    features: ['流式打字回复', '联网搜索实时信息', '会话存本地 SQLite'],
    route: '/chat',
  },
  {
    key: 'game',
    name: '游戏时长',
    icon: '🎮',
    accent: 'green',
    badge: '统计',
    summary: '自动识别正在运行的游戏并计时，支持多款游戏并行统计与超时提醒',
    features: ['只统计游戏本体进程', '多款游戏各记各的', 'ECharts 图表分析'],
    route: '/game',
  },
]
