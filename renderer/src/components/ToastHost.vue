<script setup lang="ts">
/**
 * 全局提醒容器（右下角弹窗）
 *
 * 游戏时长达到限额时的提醒、各类操作反馈都会在这里显示；
 * 因为挂在应用根组件上，切到任何工具页都不会丢失提醒。
 */
import type { ToastLevel } from '../stores/ui'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

const ICONS: Record<ToastLevel, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⏰',
  error: '⚠️',
}

const iconOf = (level: ToastLevel): string => ICONS[level] || ICONS.info
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <transition-group name="toast">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="toast"
        :class="'toast-' + toast.level"
      >
        <div class="toast-icon">{{ iconOf(toast.level) }}</div>
        <div class="toast-body">
          <div class="toast-title">{{ toast.title }}</div>
          <div v-if="toast.body" class="toast-text">{{ toast.body }}</div>
        </div>
        <button class="toast-close" title="关闭" @click="ui.dismissToast(toast.id)">×</button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
/* 容器本身不拦截点击，只有弹窗可交互 */
.toast-host {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 340px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--overlay);
  box-shadow: var(--shadow);
  pointer-events: auto;
}

.toast-warning,
.toast-error {
  border-color: var(--danger);
}

.toast-success {
  border-color: var(--success);
}

.toast-icon {
  font-size: 16px;
  line-height: 1.4;
}

.toast-body {
  flex: 1;
}

.toast-title {
  margin-bottom: 4px;
  font-size: 13.5px;
  font-weight: 600;
}

.toast-text {
  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.6;
}

.toast-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.toast-close:hover {
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
