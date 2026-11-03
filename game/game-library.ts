/**
 * 内置游戏库与命名规则（独立模块）
 *
 * 目标：兼容「多种游戏」的场景 —— 界面显示的游戏名来自对进程的统计结果，而不是
 * 写死在业务逻辑里：
 * - 内置库收录的游戏  → 使用官方中文名（可执行文件名 → 游戏名）
 * - 内置库未收录的    → 由可执行文件名/安装目录推断可读名称（inferGameName）
 * - 用户手动指定      → 界面上为某个进程指定游戏名，优先级最高（见 game/registry）
 *
 * 识别口径只有一句话：**只认「游戏主进程」**（GAMES[].processes），
 * 其余进程一律视为「非游戏主进程」（见 isNonGameProcess）—— 不识别、不计时、
 * 不写识别名单、不在界面出现，页面只保留真正在玩的游戏，保持干净整洁。
 *
 * 「非游戏主进程」分三类，语义区分清楚：
 * - 关联客户端进程（GAMES[].clientProcesses）: 客户端、大厅、启动辅助程序
 *   （例：英雄联盟的 LeagueClient.exe —— 挂着客户端不等于在玩，只有
 *     League of Legends.exe 真正对局时才计时）
 * - 平台/启动器进程（LAUNCHER_PROCESSES）  : Steam / Epic / 战网 等，常在后台常驻
 * - 干扰进程（IGNORED_PROCESS_PATTERNS）   : 反作弊、崩溃上报、安装器、系统组件等
 *
 * 扩展新游戏：在 GAMES 里追加一条即可；统计、图表、会话记录都会按 gameKey 自动分组。
 * 若该游戏有独立客户端进程（启动客户端≠在玩游戏），把它们填进 clientProcesses 作为排除项。
 */

/** 内置游戏定义 */
export interface GameDefinition {
  /** 稳定标识：统计分组与数据库主键使用（不要随意改，否则历史记录会分裂） */
  key: string
  /** 官方中文名（界面展示） */
  name: string
  /** 游戏主进程：任意一个出现即认为「正在玩」，开始计时（唯一会被识别与显示的进程） */
  processes: string[]
  /**
   * 关联客户端进程（可选）：客户端 / 大厅 / 启动辅助程序。
   * 这里填的进程属于「非游戏主进程」，只用于排除：
   * 既不识别、也不计时、也不会出现在界面名单里
   * （例如 LeagueClient.exe 常驻后台，只有 League of Legends.exe 启动才是真正在玩）。
   */
  clientProcesses?: string[]
}

/** 常见游戏库（同一游戏可能有多个进程：本体不同版本、不同平台发行版等） */
export const GAMES: GameDefinition[] = [
  // ---- 竞技 / 射击 ----
  {
    key: 'lol',
    name: '英雄联盟',
    // 只有对局进程才计时：客户端挂着不代表在玩
    processes: ['League of Legends.exe'],
    clientProcesses: ['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe'],
  },
  { key: 'valorant', name: '无畏契约', processes: ['VALORANT.exe', 'VALORANT-Win64-Shipping.exe'] },
  { key: 'cs2', name: '反恐精英 2', processes: ['cs2.exe'] },
  { key: 'csgo', name: '反恐精英：全球攻势', processes: ['csgo.exe'] },
  { key: 'dota2', name: 'Dota 2', processes: ['dota2.exe'] },
  { key: 'pubg', name: '绝地求生', processes: ['TslGame.exe', 'TslGame_BE.exe', 'PUBG.exe'] },
  { key: 'apex', name: 'Apex 英雄', processes: ['r5apex.exe', 'r5apex_dx12.exe'] },
  { key: 'overwatch2', name: '守望先锋', processes: ['Overwatch.exe'] },
  { key: 'naraka', name: '永劫无间', processes: ['NarakaBladepoint.exe'] },
  { key: 'r6', name: '彩虹六号：围攻', processes: ['RainbowSix.exe', 'RainbowSix_BE.exe'] },
  { key: 'destiny2', name: '命运 2', processes: ['destiny2.exe'] },
  { key: 'bf2042', name: '战地风云 2042', processes: ['BF2042.exe'] },
  { key: 'cod', name: '使命召唤', processes: ['cod.exe', 'ModernWarfare.exe', 'BlackOpsColdWar.exe'] },
  { key: 'tarkov', name: '逃离塔科夫', processes: ['EscapeFromTarkov.exe'] },
  { key: 'deltaforce', name: '三角洲行动', processes: ['DeltaForceClient-Win64-Shipping.exe'] },
  { key: 'crossfire', name: '穿越火线', processes: ['crossfire.exe'] },
  { key: 'halo', name: '光环：无限', processes: ['HaloInfinite.exe'] },
  { key: 'warframe', name: '星际战甲', processes: ['Warframe.x64.exe'] },

  // ---- 开放世界 / 角色扮演 ----
  { key: 'genshin', name: '原神', processes: ['GenshinImpact.exe', 'YuanShen.exe'] },
  { key: 'starrail', name: '崩坏：星穹铁道', processes: ['StarRail.exe'] },
  { key: 'zenless', name: '绝区零', processes: ['ZenlessZoneZero.exe'] },
  { key: 'honkai3', name: '崩坏 3', processes: ['BH3.exe'] },
  { key: 'cyberpunk2077', name: '赛博朋克 2077', processes: ['Cyberpunk2077.exe'] },
  { key: 'eldenring', name: '艾尔登法环', processes: ['eldenring.exe'] },
  { key: 'witcher3', name: '巫师 3：狂猎', processes: ['witcher3.exe'] },
  { key: 'rdr2', name: '荒野大镖客 2', processes: ['RDR2.exe'] },
  { key: 'gta5', name: '侠盗猎车手 5', processes: ['GTA5.exe', 'GTA5_Enhanced.exe'] },
  { key: 'skyrim', name: '上古卷轴 5：天际', processes: ['SkyrimSE.exe', 'Skyrim.exe'] },
  { key: 'sekiro', name: '只狼：影逝二度', processes: ['sekiro.exe'] },
  { key: 'mhwilds', name: '怪物猎人：荒野', processes: ['MonsterHunterWilds.exe'] },
  { key: 'mhw', name: '怪物猎人：世界', processes: ['MonsterHunterWorld.exe'] },
  { key: 'forza5', name: '极限竞速：地平线 5', processes: ['ForzaHorizon5.exe'] },
  { key: 'deathstranding', name: '死亡搁浅', processes: ['DeathStranding.exe'] },
  { key: 'fallguys', name: '糖豆人', processes: ['FallGuys_client.exe'] },
  { key: 'ittakestwo', name: '双人成行', processes: ['ItTakesTwo.exe'] },
  { key: 'minecraft', name: '我的世界', processes: ['Minecraft.Windows.exe'] },

  // ---- 策略 / 模拟 / 在线服务型 ----
  { key: 'civ6', name: '文明 6', processes: ['CivilizationVI.exe'] },
  { key: 'totalwar3k', name: '全面战争：三国', processes: ['ThreeKingdoms.exe'] },
  { key: 'wow', name: '魔兽世界', processes: ['Wow.exe', 'WowClassic.exe'] },
  { key: 'hearthstone', name: '炉石传说', processes: ['Hearthstone.exe'] },
  { key: 'diablo4', name: '暗黑破坏神 IV', processes: ['Diablo IV.exe'] },
  { key: 'sc2', name: '星际争霸 II', processes: ['SC2.exe', 'SC2_x64.exe'] },
  { key: 'ffxiv', name: '最终幻想 14', processes: ['ffxiv_dx11.exe', 'ffxiv.exe'] },
  { key: 'dnf', name: '地下城与勇士', processes: ['DNF.exe'] },
  { key: 'jx3', name: '剑网 3', processes: ['JX3Client.exe', 'JX3ClientX64.exe'] },
]

/** 平台 / 启动器进程：位于游戏目录里但本身不是游戏，不识别、不计时、不显示 */
export const LAUNCHER_PROCESSES: string[] = [
  'steam.exe', 'steamwebhelper.exe', 'steamservice.exe',
  'epicgameslauncher.exe', 'epicwebhelper.exe',
  'battle.net.exe', 'blizzarderror.exe',
  'riotclientservices.exe', 'riotclientux.exe',
  'wegame.exe', 'wegamehelper.exe',
  'upc.exe', 'ubisoftconnect.exe', 'ubisoftgamelauncher.exe',
  'eadesktop.exe', 'eabackgroundservice.exe', 'origin.exe',
  'galaxyclient.exe', 'goggalaxy.exe',
  'hoyoplay.exe', 'hyp.exe', 'launcher.exe', 'minecraftlauncher.exe',
  'rockstargameslauncher.exe', 'socialclubhelper.exe',
  'tgp_daemon.exe', 'tencentdl.exe', 'qqprotect.exe',
]

/**
 * 干扰进程：反作弊、崩溃上报、安装器/更新器、启动辅助、覆盖层、系统宿主进程等，
 * 即使位于游戏目录也不算游戏 —— 一律不识别、不计时、不显示
 */
const IGNORED_PROCESS_PATTERNS: RegExp[] = [
  // 反作弊 / 防护
  /anticheat/i, /easyanti/i, /battleye/i, /beservice/i, /vgtray/i, /xigncode/i,
  // 崩溃上报
  /crashreport/i, /crashpad/i, /crashhandler/i, /werfault/i, /bugreport/i,
  // 启动器 / 安装器 / 更新器 / 命令行辅助进程
  /launcher/i, /unins/i, /^setup/i, /installer/i, /updater/i, /patcher/i,
  /webhelper/i, /shipping-cmd/i, /-cmd$/i,
  /^dxsetup/i, /^vcredist/i, /^dotnetfx/i, /helper/i,
  // 覆盖层（录屏 / 加速器 / 聊天等叠加在游戏画面上的辅助程序）
  /overlay/i,
  // 运行环境与系统宿主进程（本工具自身也在此列）
  /^node$/, /^electron/, /^cmd$/, /^conhost$/, /^powershell$/, /^pwsh$/,
  /^svchost$/, /^explorer$/, /^dwm$/, /^csrss$/, /^wininit$/, /^winlogon$/,
  /^services$/, /^lsass$/, /^smss$/, /^taskhostw?$/, /^runtimebroker$/,
  /^sihost$/, /^ctfmon$/, /^dllhost$/, /^backgroundtaskhost$/, /^searchapp$/,
  /^searchindexer$/, /^applicationframehost$/, /^textinputhost$/,
]

/** 明显像游戏本体的可执行文件名特征（用于决定是否值得补查安装路径） */
const GAME_PROCESS_PATTERNS: RegExp[] = [
  /-win64-shipping$/i,
  /-win32-shipping$/i,
  /-shipping$/i,
  /-win64$/i,
  /-win32$/i,
]

/** 常见游戏安装目录关键字（路径统一小写 + 正斜杠后匹配），用于识别未收录的游戏 */
export const GAME_PATH_HINTS: string[] = [
  '/steamapps/common/',
  '/steamlibrary/',
  '/epic games/',
  '/gog games/',
  '/riot games/',
  '/battle.net/',
  '/blizzard entertainment/',
  '/ubisoft game launcher/games/',
  '/ea games/',
  '/origin games/',
  '/wegameapps/',
  '/mihoyo/',
  '/hoyoplay/',
  '/games/',
]

/**
 * 明确不是游戏本体的目录：系统组件、商店应用、公共运行库等。
 * 这些目录里同样躺着大量 exe（例如商店版计算器、M365 Copilot、微信），
 * 若不排除就会把它们当成游戏误报，因此优先于 GAME_PATH_HINTS 判断。
 */
const IGNORED_PATH_HINTS: string[] = [
  '/windows/windowsapps/',
  '/program files/windowsapps/',
  '/windows/system32/',
  '/windows/syswow64/',
  '/common files/',
  '/windows/installer/',
  '/programdata/package cache/',
  '/appdata/local/temp/',
]

/** 内置库的进程分类结果 */
export interface BuiltinProcessMatch {
  key: string
  name: string
  /** true = 游戏主进程（出现即计时）；false = 关联客户端进程（属于非游戏主进程，不会参与识别） */
  timing: boolean
}

/** 进程名（小写）→ 内置游戏定义，便于 O(1) 匹配（只含游戏主进程） */
const TIMING_INDEX = new Map<string, GameDefinition>()
/** 进程名（小写）→ 内置游戏定义（只含关联客户端进程） */
const CLIENT_INDEX = new Map<string, GameDefinition>()

for (const game of GAMES) {
  for (const processName of game.processes) {
    TIMING_INDEX.set(processName.toLowerCase(), game)
  }
  for (const processName of game.clientProcesses || []) {
    CLIENT_INDEX.set(processName.toLowerCase(), game)
  }
}

const LAUNCHER_INDEX = new Set(LAUNCHER_PROCESSES.map((name) => name.toLowerCase()))

const normalize = (value: unknown): string => String(value == null ? '' : value).trim()
const normalizeLower = (value: unknown): string => normalize(value).toLowerCase()

/**
 * 内置库进程分类（识别器的依据）
 * 返回 null 表示内置库不认识这个进程。
 */
export function classifyBuiltinProcess (processName: string): BuiltinProcessMatch | null {
  const name = normalizeLower(processName)
  if (!name) return null

  const timing = TIMING_INDEX.get(name)
  if (timing) return { key: timing.key, name: timing.name, timing: true }

  const client = CLIENT_INDEX.get(name)
  if (client) return { key: client.key, name: client.name, timing: false }

  return null
}

/** 按进程名查内置游戏（不区分大小写；客户端进程也能命中，但会被 isNonGameProcess 拦下） */
export function findBuiltinGame (processName: string): { key: string; name: string } | null {
  const matched = classifyBuiltinProcess(processName)
  return matched ? { key: matched.key, name: matched.name } : null
}

/** 是否是内置库中的「关联客户端进程」（客户端运行中，但不参与计时） */
export function isBuiltinClientProcess (processName: string): boolean {
  return CLIENT_INDEX.has(normalizeLower(processName))
}

/** 是否是平台 / 启动器进程（不作为游戏计时） */
export function isLauncherProcess (processName: string): boolean {
  return LAUNCHER_INDEX.has(normalizeLower(processName))
}

/** 是否是干扰进程（反作弊、崩溃上报、启动器、安装器、系统组件等） */
export function isIgnoredProcess (processName: string): boolean {
  const name = normalizeLower(processName).replace(/\.exe$/, '')
  if (!name) return true
  return IGNORED_PROCESS_PATTERNS.some((pattern) => pattern.test(name))
}

/**
 * 是否是「非游戏主进程」：启动器 / 客户端 / 反作弊 / 崩溃上报 / 系统组件等
 *
 * 统一口径：这类进程不识别、不计时、不写入识别名单、不在界面出现 ——
 * 界面只保留真正在玩的游戏（游戏主进程 GAMES[].processes）。
 * 唯一的例外是用户显式保存的规则（用户判断优先，见 game-recognizer）。
 */
export function isNonGameProcess (processName: string): boolean {
  return (
    isIgnoredProcess(processName) ||
    isLauncherProcess(processName) ||
    isBuiltinClientProcess(processName)
  )
}

/** 进程名是否具备「游戏本体」特征（用于决定是否值得补查安装路径） */
export function looksLikeGameProcess (processName: string): boolean {
  const name = normalizeLower(processName)
  if (!name || isNonGameProcess(name)) return false
  const base = name.replace(/\.exe$/, '')
  return GAME_PROCESS_PATTERNS.some((pattern) => pattern.test(base))
}

/** 可执行文件是否位于常见游戏安装目录（排除系统 / 商店应用等目录） */
export function looksLikeGamePath (executablePath: string | null | undefined): boolean {
  const value = normalize(executablePath).toLowerCase().replace(/\\/g, '/')
  if (!value) return false
  if (isIgnoredPath(value)) return false
  return GAME_PATH_HINTS.some((hint) => value.includes(hint))
}

/** 是否位于明确非游戏的目录（系统组件、商店应用、安装缓存等） */
export function isIgnoredPath (executablePath: string | null | undefined): boolean {
  const value = normalize(executablePath).toLowerCase().replace(/\\/g, '/')
  if (!value) return false
  return IGNORED_PATH_HINTS.some((hint) => value.includes(hint))
}

/** 结尾噪声段：Game-Win64-Shipping.exe → Game */
const TRAILING_NOISE = /[-_. ](win64|win32|shipping|release|retail|final|stable|demo|client|dx11|dx12|vulkan|x64|x86|64|32)$/i

/**
 * 从可执行文件名推断游戏显示名
 * 例：DeltaForceClient-Win64-Shipping.exe → "Delta Force Client"
 *     narakaBladepoint.exe               → "Naraka Bladepoint"
 */
export function inferGameName (processName: string): string {
  let base = normalize(processName).replace(/\.exe$/i, '')

  // 反复剥离结尾噪声段；至少保留 3 个字符，避免把名字削光
  let previous = ''
  while (base !== previous && base.length > 3) {
    previous = base
    base = base.replace(TRAILING_NOISE, '')
  }

  const words = base
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))

  return words.join(' ') || normalize(processName)
}

/** 由游戏名生成稳定的 key（用于统计分组与数据库主键，中文也保留） */
export function slugify (text: string): string {
  const slug = normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'game'
}
