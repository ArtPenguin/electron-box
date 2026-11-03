/**
 * 构建收尾：把渲染层产物合并成自包含的单文件页面
 *
 * 背景：应用打包后页面以 file:// 加载，Chromium 会拦截 file:// 下的外部 ES module
 * （origin 为 null，CORS 校验不通过），所以这里把 IIFE 形式的 app.js 与 style.css
 * 直接内联进 HTML，产出运行时零外部请求的 index.html。
 *
 * 用法：node scripts/build-inline.mjs（由 npm run build:renderer 自动调用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST_DIR = fileURLToPath(new URL('../renderer/dist/', import.meta.url))
const APP_JS = path.join(DIST_DIR, 'app.js')
const STYLE_CSS = path.join(DIST_DIR, 'style.css')
const INDEX_HTML = path.join(DIST_DIR, 'index.html')

const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')

/** 内联脚本里出现 "</script" 会提前闭合标签，统一转义 */
const escapeInlineScript = (code) => code.replace(/<\/script/gi, '<\\/script')

function main () {
  if (!fs.existsSync(APP_JS)) {
    console.error('[build] 未找到 renderer/dist/app.js，请先执行 vite build')
    process.exit(1)
  }

  const script = escapeInlineScript(readIfExists(APP_JS))
  const style = readIfExists(STYLE_CSS)

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Elect 工具箱</title>
${style ? `    <style>\n${style}\n    </style>\n` : ''}  </head>
  <body>
    <div id="app"></div>
    <script>
${script}
    </script>
  </body>
</html>
`

  fs.writeFileSync(INDEX_HTML, html, 'utf8')
  // 中间产物已内联，删除后保证打包体积不重复
  fs.rmSync(APP_JS, { force: true })
  if (style) fs.rmSync(STYLE_CSS, { force: true })

  console.log(`[build] 已生成自包含页面 renderer/dist/index.html（${Math.round(html.length / 1024)} KB）`)
}

main()
