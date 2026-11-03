/**
 * 开发模式（npm run dev）
 *
 * 三件事并行进行，改动即时生效：
 * 1. esbuild watch 主进程（TypeScript）——重新构建成功后自动重启 Electron；
 * 2. Vite dev server 提供渲染层（Vue 单文件组件）热更新；
 * 3. 启动 Electron 并让它加载 dev server 地址（VITE_DEV_SERVER_URL）。
 *
 * 生产/打包不走这里：npm start / npm run package 会先构建再启动（见 package.json）。
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { context } from 'esbuild'
import { createServer } from 'vite'

import { createBuildOptions } from './build-main.mjs'

const require = createRequire(import.meta.url)
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

async function main () {
  const server = await createServer({
    configFile: path.join(PROJECT_ROOT, 'vite.config.mjs'),
  })
  await server.listen()

  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('Vite dev server 未返回本地地址')
  console.log(`[dev] Vite dev server: ${url}`)

  /** Electron 子进程；主进程代码变更时会被重启 */
  let electron = null
  let quitting = false

  const stopElectron = () => new Promise((resolve) => {
    if (!electron || electron.exitCode !== null || electron.signalCode) return resolve()
    electron.once('close', () => resolve())
    electron.kill()
  })

  const startElectron = () => {
    electron = spawn(require('electron'), [PROJECT_ROOT], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_SERVER_URL: url },
    })

    // 用户手动关闭窗口：结束整个开发会话
    electron.on('close', async (code) => {
      if (quitting) return
      quitting = true
      await buildContext.dispose()
      await server.close()
      process.exit(code ?? 0)
    })
  }

  let booted = false
  const buildContext = await context({
    ...createBuildOptions(),
    plugins: [
      {
        name: 'restart-electron',
        setup (build) {
          build.onEnd(async (result) => {
            if (result.errors.length) {
              console.error('[dev] 主进程构建失败，继续使用上一次的产物')
              return
            }
            if (!booted) {
              booted = true
              startElectron()
              return
            }
            console.log('[dev] 主进程已更新，重启 Electron')
            await stopElectron()
            startElectron()
          })
        },
      },
    ],
  })

  await buildContext.watch()
}

main().catch((err) => {
  console.error('[dev] 启动失败:', err)
  process.exit(1)
})
