<script setup lang="ts">
/**
 * 工具页顶部：返回按钮 + 标题 + 右侧插槽（放状态药丸等）
 *
 * 抽成组件是为了让每个工具页的头部结构、返回行为保持一致。
 */
import { useRouter } from 'vue-router'

defineProps<{
  title: string
}>()

const router = useRouter()

const backHome = (): void => { void router.push('/') }
</script>

<template>
  <header class="page-head">
    <div class="head-main">
      <button class="back-btn" title="返回工具箱" @click="backHome">← 工具箱</button>
      <h1>{{ title }}</h1>
    </div>
    <slot />
  </header>
</template>
