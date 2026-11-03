<script setup lang="ts">
/**
 * 首页：功能列表 + 换肤入口
 *
 * 从 tools.ts 的工具注册表渲染卡片，点击进入对应工具页；
 * 游戏工具卡片额外展示实时状态与今日时长（数据来自常驻的 game store）。
 * 右上角挂载 ThemePicker（跟随系统 / 亮色 / 海蓝 / 森绿 / 暖阳 / 紫罗兰 / 暗色，
 * 除「暗色」外均为浅色皮肤）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import ThemePicker from '../components/ThemePicker.vue'
import ToolCard from '../components/ToolCard.vue'
import { useGameStore } from '../stores/game'
import { TOOLS, type ToolItem } from '../tools'

const router = useRouter()
const game = useGameStore()

const tools: ToolItem[] = TOOLS

/** 游戏工具是唯一带后台实时状态的工具，其余卡片展示注册表里的静态标签 */
const isGameTool = (tool: ToolItem): boolean => tool.key === 'game'

const gameOnline = computed(() => game.running && !game.paused)

const badgeOf = (tool: ToolItem): string => (isGameTool(tool) ? game.homeBadge : tool.badge)

function openTool (tool: ToolItem): void {
  void router.push(tool.route)
}
</script>

<template>
  <div class="page home-page">
    <header class="home-hero">
      <div class="hero-main">
        <div class="hero-tag">Electron · Vue 3 · Pinia · LangChain</div>
        <h1>Elect 工具箱</h1>
        <p class="hero-desc">
          选择一个工具开始使用。AI 聊天助手支持联网搜索实时信息；
          游戏时长工具会在后台识别正在运行的游戏（支持多款并行）并自动统计时间，在超时前提醒。
        </p>
      </div>

      <!-- 换肤入口：状态与持久化在 stores/theme，这里只挂组件 -->
      <ThemePicker />
    </header>

    <section class="tool-grid">
      <ToolCard
        v-for="tool in tools"
        :key="tool.key"
        :tool="tool"
        :live="isGameTool(tool)"
        :online="gameOnline"
        :badge="badgeOf(tool)"
        :warn="isGameTool(tool) && game.overLimit"
        @open="openTool"
      />
    </section>

    <footer class="home-foot">
      聊天记录与游戏时长均保存在本地 SQLite 数据库（userData/chat.db），不会上传；
      主题偏好保存在本地浏览器存储中。
    </footer>
  </div>
</template>

<style scoped>
.home-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 26px;
}

.hero-main {
  min-width: 0;
}

.hero-tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  margin-bottom: 12px;
}

.home-hero h1 {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 8px;
}

.hero-desc {
  max-width: 760px;
  color: var(--text-dim);
  line-height: 1.75;
  font-size: 13.5px;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
}

.home-foot {
  margin-top: 26px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
