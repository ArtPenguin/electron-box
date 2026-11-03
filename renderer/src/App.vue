<script setup lang="ts">
/**
 * 应用根组件
 *
 * 只做两件事：渲染当前路由页面、挂载全局右下角提醒（ToastHost），
 * 这样无论停留在哪个工具页，游戏时长的提醒都能弹出。
 */
import ToastHost from './components/ToastHost.vue'
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="page" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>

  <ToastHost />
</template>
