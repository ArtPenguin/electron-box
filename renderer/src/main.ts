/**
 * 渲染进程入口
 *
 * 技术栈：Vue 3（单文件组件 + 组合式 API + TypeScript）+ Pinia + Vue Router + ECharts。
 * - 开发：npm run dev（Vite dev server，热更新）
 * - 构建：vite build 产出 IIFE 单文件，再由 scripts/build-inline.mjs 内联成
 *   自包含页面 renderer/dist/index.html（Electron 以 file:// 加载，外部 ESM 会被 CORS 拦截）
 */
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { useGameStore } from './stores/game'
import { useThemeStore } from './stores/theme'
import './styles/base.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 换肤：挂载前先应用一次用户偏好（读取 localStorage），避免首屏先用默认色再闪一下；
// 随后监听系统主题变化，用户选择「跟随系统」时自动在亮 / 暗之间切换
const theme = useThemeStore()
theme.apply()
theme.watchSystem()

app.mount('#app')

// 游戏时长工具需要全局常驻：首页徽标、任意页面的超时提醒都依赖它，
// 因此应用挂载后立即初始化（store 内部幂等）
useGameStore()
  .init()
  .catch((err) => console.error('[game] 初始化失败:', err))
