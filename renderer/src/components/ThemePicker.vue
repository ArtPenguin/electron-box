<script setup lang="ts">
/**
 * 主题切换器（首页右上角）
 *
 * 纯展示 + 交互组件：主题数据、持久化、系统监听都在 stores/theme，
 * 这里只负责渲染选项与触发切换，因此换肤实现变化时本组件无需改动。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { SYSTEM_THEME_IDS, getTheme, type Theme, type ThemePreference } from '../theme/themes'
import { useThemeStore } from '../stores/theme'

const theme = useThemeStore()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

/** 当前主题名（跟随系统时额外标注实际生效的主题） */
const currentLabel = computed(() =>
  theme.isSystem ? `跟随系统 · ${theme.theme.name}` : theme.theme.name
)

interface ThemeOption {
  value: ThemePreference
  label: string
  hint: string
  /** 用于预览的三个代表色：底色 / 主色 / 文字色 */
  swatches: string[]
}

/** 选项分组（面板里的小标题）：系统 / 浅色 / 深色——浅色皮肤一眼可分 */
interface ThemeGroup {
  key: string
  label: string
  options: ThemeOption[]
}

function toOption (item: Theme): ThemeOption {
  return {
    value: item.id,
    label: item.name,
    hint: item.description,
    swatches: [item.colors.bg, item.colors.accent, item.colors.text],
  }
}

/** 预览色取「跟随系统」实际可能生效的两个主题（亮 / 暗），避免依赖数组下标 */
const systemSwatches = [
  getTheme(SYSTEM_THEME_IDS.light).colors.bg,
  getTheme(SYSTEM_THEME_IDS.light).colors.accent,
  getTheme(SYSTEM_THEME_IDS.dark).colors.bg,
]

/** 选项：跟随系统 + 按明暗属性分组的全部主题（分组顺序与 THEMES 一致） */
const groups = computed<ThemeGroup[]>(() => [
  {
    key: 'system',
    label: '系统',
    options: [
      {
        value: 'system',
        label: '跟随系统',
        hint: '随系统亮色 / 暗色自动切换',
        swatches: systemSwatches,
      },
    ],
  },
  ...(['light', 'dark'] as const).map((mode) => ({
    key: mode,
    label: mode === 'light' ? '浅色' : '深色',
    options: theme.themes.filter((item) => item.mode === mode).map(toOption),
  })),
])

function isActive (value: ThemePreference): boolean {
  return theme.preference === value
}

function choose (value: ThemePreference): void {
  theme.setPreference(value)
  open.value = false
}

/** 点击组件外部时收起面板 */
function onDocumentClick (event: MouseEvent): void {
  if (!open.value || !rootEl.value) return
  if (!rootEl.value.contains(event.target as Node)) open.value = false
}

function onKeydown (event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="theme-picker">
    <button
      class="theme-trigger"
      type="button"
      :aria-expanded="open"
      title="切换主题与皮肤"
      @click="open = !open"
    >
      <span class="theme-dot" aria-hidden="true"></span>
      <span class="theme-label">{{ currentLabel }}</span>
      <span class="theme-arrow" :class="{ open }">▾</span>
    </button>

    <transition name="theme-panel">
      <div v-if="open" class="theme-panel" role="listbox">
        <div class="panel-title">主题与皮肤</div>
        <template v-for="group in groups" :key="group.key">
          <div class="panel-group">{{ group.label }}</div>
          <button
            v-for="option in group.options"
            :key="option.value"
            type="button"
            class="theme-option"
            :class="{ active: isActive(option.value) }"
            role="option"
            :aria-selected="isActive(option.value)"
            @click="choose(option.value)"
          >
            <span class="swatch-group" aria-hidden="true">
              <i
                v-for="(color, index) in option.swatches"
                :key="index"
                class="swatch"
                :style="{ background: color }"
              ></i>
            </span>
            <span class="option-text">
              <span class="option-label">{{ option.label }}</span>
              <span class="option-hint">{{ option.hint }}</span>
            </span>
            <span v-if="isActive(option.value)" class="option-check">✓</span>
          </button>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.theme-picker {
  position: relative;
}

.theme-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12.5px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.theme-trigger:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--surface-3);
}

.theme-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.theme-label {
  white-space: nowrap;
}

.theme-arrow {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.theme-arrow.open {
  transform: rotate(180deg);
}

.theme-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 50;
  width: 268px;
  padding: 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  box-shadow: var(--shadow);
}

.panel-title {
  padding: 6px 8px 10px;
  color: var(--text-muted);
  font-size: 11.5px;
}

/* 分组小标题（系统 / 浅色 / 深色）：组与组之间用细线分隔 */
.panel-group {
  margin-top: 6px;
  padding: 9px 8px 5px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11.5px;
}

.panel-title + .panel-group {
  margin-top: 0;
  border-top: none;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.theme-option:hover {
  background: var(--surface);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.swatch-group {
  display: flex;
  flex-shrink: 0;
}

.swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
}

.swatch + .swatch {
  margin-left: -6px;
}

.option-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-label {
  font-size: 13px;
  font-weight: 600;
}

.option-hint {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.option-check {
  color: var(--accent);
  font-size: 13px;
}

.theme-panel-enter-active,
.theme-panel-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.theme-panel-enter-from,
.theme-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
