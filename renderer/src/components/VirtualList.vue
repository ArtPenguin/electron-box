<script setup lang="ts" generic="T">
/**
 * 虚拟滚动列表
 *
 * 进程数量很大时，只渲染可视区（外加缓冲）内的行，避免一次挂载数百上千个 DOM 节点
 * 造成列表滚动卡顿。搜索过滤在渲染层完成后，items 传入过滤后的完整数组即可。
 *
 * 通用实现：行高固定，滚动位置驱动可见区间；每行通过默认插槽渲染，
 * 列布局由使用方在插槽内容里自行用 CSS grid 定义，与表头对齐。
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 完整列表（已过滤） */
    items: T[]
    /** 行高（像素，固定行高才能精确计算可见区间） */
    rowHeight?: number
    /** 可视区高度（像素） */
    height?: number
    /** 上下缓冲行数（减少快速滚动时的空白闪烁） */
    buffer?: number
  }>(),
  { rowHeight: 40, height: 480, buffer: 8 }
)

const scrollTop = ref(0)

const totalHeight = computed(() => props.items.length * props.rowHeight)

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.buffer)
)
const endIndex = computed(() =>
  Math.min(props.items.length, Math.ceil((scrollTop.value + props.height) / props.rowHeight) + props.buffer)
)

const visibleItems = computed(() => props.items.slice(startIndex.value, endIndex.value))
const offsetY = computed(() => startIndex.value * props.rowHeight)

function onScroll (event: Event): void {
  const target = event.target as HTMLElement
  scrollTop.value = target.scrollTop
}
</script>

<template>
  <div class="virtual-list" :style="{ height: height + 'px' }" @scroll="onScroll">
    <div class="virtual-spacer" :style="{ height: totalHeight + 'px' }">
      <div class="virtual-viewport" :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="(item, offset) in visibleItems"
          :key="startIndex + offset"
          class="virtual-row"
          :style="{ height: rowHeight + 'px' }"
        >
          <slot :item="item" :index="startIndex + offset" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-list {
  overflow-y: auto;
  overflow-x: hidden;
}

.virtual-spacer {
  position: relative;
  width: 100%;
}

.virtual-viewport {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.virtual-row {
  box-sizing: border-box;
}
</style>
