# Elect 工具箱

Electron 桌面工具箱，全部业务代码使用 **TypeScript** 编写：

- **AI 聊天助手**：LangChain Agent（DeepSeek）+ 工具调用（计算器 / 当前时间 / 联网搜索）+ 流式打字回复，会话存本地 SQLite
- **游戏时长控制**：自动识别正在运行的游戏并计时，支持多款游戏并行统计、超时提醒、ECharts 图表分析、换肤主题

## 技术栈

| 层 | 技术 |
| --- | --- |
| 主进程 | Electron + TypeScript（ESM 源码，esbuild 打包为 CJS）、node:sqlite、LangChain |
| 渲染层 | Vue 3（`<script setup lang="ts">`）+ Pinia + Vue Router + ECharts，Vite 构建 |
| 构建 | esbuild（主进程）、Vite + 自包含单文件内联（渲染层）、Electron Forge（打包） |
| 校验 | `tsc`（主进程）+ `vue-tsc`（渲染层）类型检查 |

## 目录结构

```
main.ts / preload.ts      Electron 主进程入口与预加载脚本（构建产物在 dist/）
agent.ts                  LangChain Agent（DeepSeek + 工具调用）
db.ts                     SQLite 持久化（对话 / 游戏会话 / 识别名单）
types/ipc.ts              主进程 ↔ 渲染进程 的共享契约类型（IPC 单点定义）
game/                     游戏时长工具
  ├─ process-scanner.ts   进程扫描（跨平台，按需补查可执行文件路径）
  ├─ game-library.ts      内置游戏库：只认「游戏主进程」（启动器/客户端/反作弊等一律排除）
  ├─ game-recognizer.ts   游戏识别（内置库 / 安装目录 / 用户规则）
  ├─ registry.ts          识别名单与屏蔽名单持久化
  ├─ monitor.ts           多游戏计时状态机（会话、跨天归档、额度提醒）
  └─ index.ts             服务装配（对外入口）
tools/                    Agent 工具与搜索源（Tavily / 博查 / 360 / Bing）
renderer/                 Vue 3 渲染层
  ├─ src/theme/           换肤：tokens（变量）/ themes（6 套主题）/ apply（写入 CSS 变量）
  ├─ src/stores/          Pinia：chat / game / ui / theme
  ├─ src/pages/           页面：HomePage / ChatPage / GamePage
  └─ dist/index.html      构建产物：自包含单文件页面（file:// 加载无外部请求）
scripts/                  构建脚本（Node 原生 ESM，无需编译即可执行）
```

## 常用命令

```bash
npm run dev        # 开发：esbuild watch 主进程 + Vite 热更新 + Electron（主进程改动自动重启）
npm run typecheck  # 类型检查：主进程 tsc + 渲染层 vue-tsc
npm run build      # 构建：渲染层自包含页面 + 主进程 dist/main.js、dist/preload.js
npm start          # 构建后直接以生产模式启动
npm run package    # 类型检查 + 构建 + 打包到 out/
npm run make       # 生成安装包 / 压缩包
```

> 主进程源码是 `.ts`，Electron 无法直接执行，因此 `npm start` / `npm run package` 前必须先构建
> （两条命令已内置构建步骤）；只有 `npm run dev` 是「构建 + 监听 + 启动」一体化。

## 两个容易踩坑的设计点

### 1. 只监控「游戏主进程」

`game/game-library.ts` 里每款游戏只把**本体 / 对局进程**当作游戏：

```ts
{
  key: 'lol',
  name: '英雄联盟',
  processes: ['League of Legends.exe'],                                          // 游戏主进程：出现即开始计时
  clientProcesses: ['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe'], // 客户端：只作为排除项
}
```

- **只识别游戏主进程**：客户端（启动器 / 大厅）、平台启动器（Steam / Epic / 战网）、
  反作弊与崩溃上报（EasyAntiCheat / CrashReportClient 等）、系统宿主进程，
  统一由 `isNonGameProcess` 判定为「非游戏主进程」—— 不识别、不计时、不写识别名单、
  不在界面出现，页面因此只保留真正在玩的游戏；
- **路径补查也只查候选进程**（`candidatesForPathLookup`）：启动器 / 客户端 / 反作弊等
  不参与 PowerShell 查询，既省开销，也避免把它们按安装目录推断成游戏；
- **名单自清理**：`game/registry.ts` 首次载入名单时会删掉历史版本可能学进来的
  非游戏主进程记录（用户自定义规则保留），保证界面的「游戏识别」表格干净；
- 用户自定义规则（`user`）视为游戏主进程，尊重用户判断（这是上面过滤的唯一例外）；
- 新增游戏：在 `GAMES` 追加一条即可，统计、图表、会话记录都按 `gameKey` 自动分组。

### 2. 额度提醒规则（`game/monitor.ts` 的 `evaluateReminder`）

按「今日所有游戏累计时长」判断，等级从低到高只有两档，且**只要还在继续游戏就每 30 秒重复**：

| 条件 | 等级 | 弹窗标题 |
| --- | --- | --- |
| 剩余额度 < `nearThresholdMinutes`（默认 **30 分钟**） | `near` | 剩余游戏时长不足 |
| 剩余额度 ≤ 0（达到 `dailyLimitMinutes`） | `over` | 游戏时长已达上限 |

- 由 `near` 升级为 `over` 时**立即**提醒一次（不等 30 秒节流）；
- 暂停计时、没有游戏运行时都不打扰；跨天自动重置提醒状态；
- 额度回升（把每日限额调大）后重新计数，下次不足时再提醒；
- 窗口不可见时由系统通知兜底（`main.ts` 的 `reminderText`），窗口可见时走右下角弹窗。

> 阈值等配置存在 SQLite 的 `game_settings`，读取时会把旧版本的默认值（`nearThresholdMinutes = 5`）升级为新默认值 30，
> 因此升级后「剩余不足 30 分钟」的预警会立即生效，不需要手动改配置。

### 3. 界面时间每秒更新，而进程检测仍是 5 秒一次

- 主进程监控器固定 5 秒扫描一次进程并推送权威状态（`game:state`）；
- 渲染层 `stores/game.ts` 记录同步时间戳，在有游戏计时时启动一个轻量秒表，
  用 `live*` 系列 getter 把「距上次推送的秒数」叠加到权威值上；
- 因此时长逐秒跳动，IPC 频率与检测间隔都不变（空闲 / 暂停时秒表自动停止）。

## 换肤

- 颜色一律通过 CSS 变量（`renderer/src/styles/base.css` 的 `:root` 为默认值）消费，组件里禁止写死色值；
- 新增主题：在 `renderer/src/theme/themes.ts` 追加一份 `Theme` 数据（含 `colors` 与 ECharts 用的 `chart` 配色）；
- 新增可换肤颜色：先在 `renderer/src/theme/tokens.ts` 登记字段，再在所有主题中给值；
- 切换与持久化都在 `renderer/src/stores/theme.ts`（localStorage），入口是首页右上角的 `ThemePicker`；
- 内置主题：暗色（唯一深色皮肤）、亮色、海蓝、森绿、暖阳、紫罗兰（均为浅色皮肤），另支持「跟随系统」；
- 主题数据带 `mode`（`light` / `dark`），切换器按「系统 / 浅色 / 深色」分组展示，`color-scheme` 也随它切换。

## 环境变量

复制 `.env.example` 为 `.env` 后按需填写（均为可选，不配也能运行）：

```
DEEPSEEK_API_KEY=      # AI 聊天必需
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
TAVILY_API_KEY=        # 联网搜索（可选，未配置时自动降级到免 Key 的搜索源）
BOCHA_API_KEY=
```
