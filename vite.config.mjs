import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const rendererRoot = fileURLToPath(new URL('./renderer', import.meta.url))

/**
 * 渲染层构建配置
 *
 * 为什么需要构建：页面/组件使用标准 .vue 单文件组件（<script setup> + 组合式 API），
 * 必须由 @vitejs/plugin-vue 编译成浏览器可执行代码，不能像以前那样用普通 <script> 直接加载。
 *
 * 为什么产出 IIFE 单文件：Electron 打包后页面以 file:// 加载，Chromium 会拦截
 * file:// 下的外部 ES module（document origin 为 null，CORS 校验不通过）。
 * 因此这里不产出 ESM，而是产出「无 import/export 的 IIFE」+ 独立 CSS，
 * 再由 scripts/build-inline.js 内联进 HTML，最终 dist/index.html 自包含、运行时零请求。
 */
export default defineConfig({
  // 前端源码根目录：renderer/（index.html 为 dev 入口，src/ 为源码）
  root: rendererRoot,
  base: './',
  plugins: [vue()],
  define: {
    // 渲染进程开启了 contextIsolation 且未启用 nodeIntegration，运行时没有 process 对象。
    // lib 模式不会自动替换 process.env，因此这里在构建期替换为字面量，
    // 避免出现 "process is not defined" 导致整个页面脚本无法执行（表现为白屏）。
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist', // 相对 root，即 renderer/dist
    emptyOutDir: true,
    target: 'chrome130', // Electron 44 内置 Chromium 版本之上，可放心使用新语法
    cssCodeSplit: false, // 样式集中输出为单个 style.css，便于内联
    // 库模式：只产出一个 JS 与一个 CSS，避免代码分割产生外部 chunk 请求
    lib: {
      entry: fileURLToPath(new URL('./renderer/src/main.ts', import.meta.url)),
      name: 'ElectRenderer',
      formats: ['iife'],
      fileName: () => 'app.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'style[extname]' },
    },
  },
})
