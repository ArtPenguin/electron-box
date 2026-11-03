/**
 * Electron Forge 打包/制作安装包配置
 *
 * 用法：
 *   npm run package   -> 生成未压缩的应用目录（out/Elect-win32-x64/）
 *   npm run make      -> 在 package 基础上生成安装包 / 压缩包：
 *                         - Squirrel.Windows 安装器（Setup .exe，Windows）
 *                         - 绿色版 zip 压缩包（Windows / macOS）
 *
 * 说明：主进程与 preload 用 TypeScript 编写，由 scripts/build-main.mjs（esbuild）
 *       转译并打包到 dist/main.js 与 dist/preload.js，package.json 的 main 指向 dist/main.js。
 *       运行时会随 asar 打包的内容：
 *       - dist/（主进程构建产物）、renderer/dist/（Vue 3 单文件组件构建出的自包含页面）
 *       - node_modules/ 中的运行时依赖（@langchain/*、dotenv、echarts 等）
 *       源码目录（game/、tools/、renderer/src、*.ts、tsconfig、scripts）只在开发/构建阶段需要，
 *       因此全部忽略，既减小体积也避免源码明文散落。
 *       注意：打包前需先执行 npm run build（npm run package / npm run make 已自动包含该步骤）。
 */
module.exports = {
  // 应用打包配置（electron-packager）
  packagerConfig: {
    // 将应用运行时代码打包进 app.asar，避免源码明文散落
    asar: true,
    // 离线/受限网络下复用本机 npm 安装 Electron 时已下载的缓存 zip；
    // @electron/get 命中缓存后仍会实时联网拉取 SHASUMS256.txt 二次校验，
    // 而本地 zip 早已在安装阶段通过官方校验，故此处跳过重复校验。
    download: {
      unsafelyDisableChecksums: true,
    },
    // 只保留运行时需要的文件，忽略开发期产物与敏感配置
    ignore: [
      /^\/out($|\/)/,
      /^\/\.git($|\/)/,
      /^\/\.env$/,
      /^\/\.env\.example$/,
      /^\/forge\.config\.js$/,
      /^\/package-lock\.json$/,
      // 主进程 TypeScript 源码（运行时用的是 dist 中的构建产物）
      /^\/main\.ts$/,
      /^\/preload\.ts$/,
      /^\/agent\.ts$/,
      /^\/db\.ts$/,
      /^\/game($|\/)/,
      /^\/tools($|\/)/,
      /^\/types($|\/)/,
      /^\/tsconfig(\.node)?\.json$/,
      // 文档与临时日志（不参与运行）
      /^\/.*\.md$/,
      /^\/.*\.txt$/,
      /^\/tmp-/,
      // 渲染层源码与构建配置（运行时用的是 renderer/dist 中的自包含页面）
      /^\/renderer\/src($|\/)/,
      /^\/renderer\/env\.d\.ts$/,
      /^\/renderer\/tsconfig\.json$/,
      /^\/renderer\/index\.html$/,
      /^\/vite\.config\.mjs$/,
      /^\/scripts($|\/)/,
    ],
  },

  // 制作安装包的 maker 列表
  makers: [
    // Windows 安装器（NSIS 之外 Forge 官方默认方案：Squirrel.Windows）
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // 安装后的应用名与快捷方式名称
        name: 'Elect',
      },
    },
    // 通用 zip 压缩包（Windows / macOS 绿色版，便于直接分发）
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin'],
    },
  ],
}
