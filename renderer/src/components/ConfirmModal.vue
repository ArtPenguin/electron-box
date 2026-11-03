<script setup lang="ts">
/**
 * 二次确认弹窗（高危操作保护）
 *
 * 用于「终止进程」这类不可逆操作：系统核心进程在主进程侧还会再拦截一道，
 * 这里先在界面层要求用户明确确认，避免误点。
 */
withDefaults(
  defineProps<{
    open: boolean
    title?: string
    body?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 确认按钮使用危险样式 */
    danger?: boolean
  }>(),
  { title: '确认操作', body: '', confirmLabel: '确认', cancelLabel: '取消', danger: true }
)

const emit = defineEmits<{
  (event: 'confirm'): void
  (event: 'cancel'): void
}>()
</script>

<template>
  <transition name="modal">
    <div v-if="open" class="modal-mask" @click.self="emit('cancel')">
      <div class="modal-card" role="alertdialog" aria-modal="true">
        <h3 class="modal-title">{{ title }}</h3>
        <p v-if="body" class="modal-body">{{ body }}</p>
        <div class="modal-actions">
          <button class="btn" @click="emit('cancel')">{{ cancelLabel }}</button>
          <button class="btn" :class="danger ? 'danger' : 'primary'" :disabled="false" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
}

.modal-card {
  width: min(420px, calc(100vw - 48px));
  padding: 22px 24px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--overlay);
  box-shadow: var(--shadow);
}

.modal-title {
  font-size: 16px;
  font-weight: 650;
  margin-bottom: 10px;
}

.modal-body {
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.7;
  margin-bottom: 20px;
  white-space: pre-wrap;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  font-weight: 600;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
