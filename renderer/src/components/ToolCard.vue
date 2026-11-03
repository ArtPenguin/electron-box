<script setup lang="ts">
/**
 * 工具卡片（首页）
 *
 * 纯展示组件：文案来自工具注册表，实时状态（在线 / 徽标 / 警示）由父组件传入，
 * 这样首页只关心"有哪些工具、当前状态如何"，卡片样式互不影响。
 */
import type { ToolItem } from '../tools'

withDefaults(
  defineProps<{
    tool: ToolItem
    /** 是否展示实时状态圆点（只有游戏工具这类有后台状态的工具需要） */
    live?: boolean
    /** 实时状态：正在计时 */
    online?: boolean
    /** 底部徽标文案（有实时用量的工具会覆盖注册表里的静态标签） */
    badge?: string
    /** 徽标是否警示样式（超限） */
    warn?: boolean
  }>(),
  { live: false, online: false, badge: '', warn: false }
)

defineEmits<{ (event: 'open', tool: ToolItem): void }>()
</script>

<template>
  <article class="tool-card" :class="'accent-' + tool.accent" @click="$emit('open', tool)">
    <div class="tool-card-head">
      <span class="tool-icon">{{ tool.icon }}</span>
      <span
        v-if="live"
        class="status-dot"
        :class="{ online }"
        :title="online ? '正在计时' : '未检测到游戏'"
      ></span>
    </div>

    <h2 class="tool-name">{{ tool.name }}</h2>
    <p class="tool-summary">{{ tool.summary }}</p>

    <ul class="tool-features">
      <li v-for="feature in tool.features" :key="feature">{{ feature }}</li>
    </ul>

    <div class="tool-foot">
      <span class="tool-badge" :class="{ warn }">{{ badge || tool.badge }}</span>
      <span class="tool-enter">进入 →</span>
    </div>
  </article>
</template>

<style scoped>
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 22px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.tool-card::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--accent);
}

.tool-card.accent-green::before {
  background: var(--success);
}

.tool-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow);
}

.tool-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tool-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--accent-soft);
  font-size: 21px;
}

.tool-card.accent-green .tool-icon {
  background: var(--success-soft);
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-dot.hidden {
  visibility: hidden;
}

.status-dot.online {
  background: var(--success);
  box-shadow: 0 0 0 4px var(--success-soft);
}

.tool-name {
  font-size: 16px;
  font-weight: 650;
}

.tool-summary {
  color: var(--text-dim);
  line-height: 1.65;
  font-size: 13px;
}

.tool-features {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.tool-features li {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 11.5px;
}

.tool-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}

.tool-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
}

.tool-badge.warn {
  background: var(--danger-soft);
  color: var(--danger);
}

.tool-enter {
  color: var(--text-muted);
  font-size: 12.5px;
  transition: color 0.15s ease;
}

.tool-card:hover .tool-enter {
  color: var(--accent);
}
</style>
