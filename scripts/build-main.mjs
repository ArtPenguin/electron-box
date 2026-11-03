/**
 * 主进程构建：TypeScript → CommonJS
 *
 * 为什么需要这一步：主进程源码（main.ts / preload.ts / db.ts / agent.ts /
 * game/ 与 tools/）全部用 TypeScript 编写，而 Electron 只能执行 JavaScript，
 * 因此在 `npm run build`（以及 npm run dev、npm run package）中先用 esbuild
 * 做一次「快速转译 + 打包」。
 *
 * 设计取舍：
 * - bundle: true     —— 自家模块（./game、./tools、../db 等）合并进 dist/main.js，
 *                       因此打包时源码目录可以整体忽略，asar 更干净
 * - packages:'external' —— 第三方依赖（@langchain/*、dotenv 等）保留 require，
 *                       运行时仍从 node_modules 解析，避免把 ESM/CJS 混合的
 *                       依赖内联进产物带来兼容风险
 * - external: electron —— electron 由运行时注入，不能也无法打包
 * - format: cjs       —— Electron 主进程/预加载脚本默认按 CommonJS 加载
 *
 * 用法：node scripts/build-main.mjs（由 npm run build:main 调用）
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = path.join(PROJECT_ROOT, 'dist')

/** 需要产出独立文件的主进程入口（输出的文件名与 Electron 约定一致） */
export const MAIN_ENTRIES = [
  { entry: 'main.ts', out: 'main.js' },
  { entry: 'preload.ts', out: 'preload.js' },
]

/** 所有入口共用的 esbuild 配置（dev 模式的 watch 也复用这份配置） */
export function createBuildOptions () {
  return {
    absWorkingDir: PROJECT_ROOT,
    entryPoints: MAIN_ENTRIES.map((item) => item.entry),
    outdir: OUT_DIR,
    bundle: true,
    platform: 'node',
    target: 'node22', // Electron 44 内置 Node 22，可放心使用新语法与内置模块
    format: 'cjs',
    sourcemap: false,
    external: ['electron'],
    packages: 'external',
    logLevel: 'info',
  }
}

/** 执行一次主进程构建（返回 esbuild 结果，便于 dev 模式判断是否成功） */
export async function buildMain () {
  return build(createBuildOptions())
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectRun) {
  buildMain()
    .then(() => console.log(`[build] 主进程已构建：${path.relative(PROJECT_ROOT, OUT_DIR)}\\main.js`))
    .catch((err) => {
      console.error('[build] 主进程构建失败:', err)
      process.exit(1)
    })
}
