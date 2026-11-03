/// <reference types="vite/client" />

import type { AppApi } from '../types/ipc'

declare global {
  interface Window {
    /**
     * preload（contextBridge）暴露的主进程能力。
     * 在纯浏览器里打开 Vite dev server 调试界面时不存在，因此声明为可选，
     * 由 renderer/src/api/index.ts 统一给出兜底实现。
     */
    api?: AppApi
  }
}

export {}
