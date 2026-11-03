/**
 * 路由表
 *
 * 使用 hash 模式（createWebHashHistory）：打包后页面通过 file:// 加载，
 * history 模式无法工作，hash 模式始终可靠，并保留前进 / 后退能力。
 *
 * 页面统一是 .vue 单文件组件；构建时打包为单个文件，因此不做路由懒加载
 * （file:// 下动态 import 会被 CORS 拦截）。
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

import ChatPage from '../pages/ChatPage.vue'
import GamePage from '../pages/GamePage.vue'
import HomePage from '../pages/HomePage.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage, meta: { title: '工具箱' } },
  { path: '/chat', name: 'chat', component: ChatPage, meta: { title: 'AI 聊天助手' } },
  { path: '/game', name: 'game', component: GamePage, meta: { title: '游戏时长控制' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/** 切换页面时同步窗口标题 */
router.afterEach((to) => {
  const base = 'Elect 工具箱'
  const title = typeof to.meta?.title === 'string' ? to.meta.title : ''
  document.title = title ? `${title} · ${base}` : base
})

export default router
