<script setup lang="ts">
/**
 * 游戏时长控制页
 *
 * 内容：
 * - 概览：今日累计时长与限额进度、正在计时的游戏（可多款）、监控状态
 * - 控制：暂停 / 继续计时，调整每日限额
 * - 图表（ECharts）：最近 N 天每日时长柱状图（含限额线）+ 各游戏时长占比环形图
 * - 游戏识别：名单（游戏名 / 关联进程 / 来源）+ 自定义规则，识别错了可手动纠正
 * - 详情：今日会话记录（开始 / 结束 / 时长 / 暂停时长）
 *
 * 只展示「游戏主进程」：启动器 / 客户端 / 反作弊 / 崩溃上报等非游戏主进程
 * 在主进程侧就被排除（既不计时，也不出现在状态里），页面因此保持干净整洁。
 *
 * 数据来源：常驻的 game store（主进程每 5 秒检测进程并推送状态）。
 * 时间显示：使用 store 的 live* 系列数据（权威值 + 本地秒级推算），因此时长逐秒更新，
 *          而进程检测间隔保持 5 秒不变；图表仍在状态推送后重绘，不做每秒刷新。
 * 配色：ECharts 无法读取 CSS 变量，因此从 theme store 取图表配色，切换主题后自动重绘。
 */
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import PageHeader from '../components/PageHeader.vue'
import { useGameStore } from '../stores/game'
import { useThemeStore } from '../stores/theme'
import type { ChartPalette } from '../theme/tokens'
import {
  formatClock,
  formatDateLabel,
  formatDuration,
  formatGameSource,
  formatMonthDay,
  formatTimeOfDay,
  toMinutes,
} from '../utils/format'

const DAY_OPTIONS = [7, 14, 30]

const game = useGameStore()
const theme = useThemeStore()

const dailyChartEl = ref<HTMLDivElement | null>(null)
const gameChartEl = ref<HTMLDivElement | null>(null)
let dailyChart: echarts.ECharts | null = null
let gameChart: echarts.ECharts | null = null

/** 当前主题的图表配色 */
const palette = computed<ChartPalette>(() => theme.chartPalette)

const ratioPercent = computed(() => Math.round(game.usageRatio * 100))
const pauseLabel = computed(() => (game.paused ? '继续计时' : '暂停计时'))
const hasActiveGames = computed(() => game.activeGames.length > 0)

// 逐秒更新的展示值（权威值 + 本地推算；见 stores/game.ts 的 live* getters）
const activeGames = computed(() => game.liveActiveGames)
const todaySeconds = computed(() => game.liveTotalSeconds)
const remainingSeconds = computed(() => game.liveRemainingSeconds)
/** 剩余额度已不足预警阈值（此时主进程会弹窗，并在仍在游戏时每 30 秒重复提醒） */
const remainingWarning = computed(() => game.overLimit || game.liveRemainingSeconds < game.nearThresholdMinutes * 60)

// ---------------------------- 图表 ----------------------------

function initCharts (): void {
  if (dailyChartEl.value && !dailyChart) dailyChart = echarts.init(dailyChartEl.value)
  if (gameChartEl.value && !gameChart) gameChart = echarts.init(gameChartEl.value)
  renderCharts()
}

function renderCharts (): void {
  renderDailyChart()
  renderGameChart()
}

/** 每日时长柱状图（今日高亮 + 限额虚线） */
function renderDailyChart (): void {
  if (!dailyChart || !game.stats) return

  const colors = palette.value
  const daily = game.stats.daily
  const limitMinutes = game.limitMinutes

  dailyChart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 52, right: 20, top: 36, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText },
      valueFormatter: (value: unknown) => `${String(value)} 分钟`,
    },
    xAxis: {
      type: 'category',
      data: daily.map((item) => formatMonthDay(item.date)),
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: colors.text },
    },
    yAxis: {
      type: 'value',
      name: '分钟',
      nameTextStyle: { color: colors.text },
      axisLabel: { color: colors.text },
      splitLine: { lineStyle: { color: colors.splitLine } },
    },
    series: [
      {
        name: '游戏时长',
        type: 'bar',
        barMaxWidth: 34,
        data: daily.map((item, index) => ({
          value: toMinutes(item.seconds),
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: index === daily.length - 1 ? colors.today : colors.series[0],
          },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: limitMinutes,
              lineStyle: { color: colors.limit, type: 'dashed' },
              label: {
                formatter: `限额 ${limitMinutes} 分钟`,
                color: colors.limit,
                position: 'insideEndTop',
              },
            },
          ],
        },
      },
    ],
  }, true)
}

/** 各游戏时长占比环形图 */
function renderGameChart (): void {
  if (!gameChart || !game.stats) return

  const colors = palette.value
  const byGame = game.stats.byGame
  const data = byGame.length
    ? byGame.map((item, index) => ({
        name: item.gameName,
        value: toMinutes(item.seconds),
        itemStyle: { color: colors.series[index % colors.series.length] },
      }))
    : [{ name: '暂无记录', value: 1, itemStyle: { color: colors.empty }, label: { color: colors.text } }]

  gameChart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number }
        return `${item.name}<br/>${item.value} 分钟（${item.percent}%）`
      },
    },
    legend: { bottom: 0, icon: 'circle', textStyle: { color: colors.text } },
    series: [
      {
        name: '各游戏占比',
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: colors.pieBorder, borderWidth: 2 },
        label: { color: colors.tooltipText, formatter: '{b}' },
        labelLine: { lineStyle: { color: colors.axisLine } },
        data,
      },
    ],
  }, true)
}

function resizeCharts (): void {
  if (dailyChart) dailyChart.resize()
  if (gameChart) gameChart.resize()
}

// ---------------------------- 生命周期 ----------------------------

// 主进程推送新状态（含识别名单、限额变化）或切换主题后，同步刷新图表
watch(
  () => [game.stats, game.limitMinutes, theme.themeId],
  () => renderCharts(),
  { deep: true }
)

onMounted(async () => {
  await game.init() // 常驻 store，内部幂等
  await game.refresh() // 进入页面时同步一次（含最新的识别名单）
  await game.loadStats(game.statsDays)
  game.limitInput = game.limitMinutes
  await nextTick()
  initCharts()
  window.addEventListener('resize', resizeCharts)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts)
  if (dailyChart) {
    dailyChart.dispose()
    dailyChart = null
  }
  if (gameChart) {
    gameChart.dispose()
    gameChart = null
  }
})

// ---------------------------- 操作 ----------------------------

/** 暂停 / 继续计时（对所有正在计时的游戏生效） */
async function togglePause (): Promise<void> {
  await game.setPaused(!game.paused)
}

/** 保存每日限额并刷新图表上的限额线 */
async function saveLimit (): Promise<void> {
  const ok = await game.saveLimit(game.limitInput)
  if (ok) {
    game.limitInput = game.limitMinutes
    renderCharts()
  }
}

/** 切换统计区间（近 7 / 14 / 30 天） */
async function changeDays (days: number): Promise<void> {
  await game.loadStats(days)
  await nextTick()
  renderCharts()
}

/** 保存自定义识别规则（进程名 → 游戏名） */
async function saveRule (): Promise<void> {
  await game.saveRule({ ...game.ruleForm })
}

/** 删除自定义识别规则 */
async function removeRule (processName: string): Promise<void> {
  await game.removeRule(processName)
}

/** 屏蔽该进程：它不是游戏，识别错了用它纠正（之后不再计时） */
async function ignoreProcess (processName: string): Promise<void> {
  await game.ignoreProcess(processName)
}

/** 取消屏蔽 */
async function restoreProcess (processName: string): Promise<void> {
  await game.restoreProcess(processName)
}
</script>

<template>
  <div class="page game-page">
    <PageHeader title="游戏时长">
      <span
        class="status-pill"
        :class="{ online: game.running && !game.paused, paused: game.paused, over: game.overLimit }"
      >{{ game.statusText }}</span>
    </PageHeader>

    <!-- 概览 -->
    <section class="stat-row">
      <div class="stat-card primary">
        <div class="stat-label">今日游戏时长（所有游戏合计）</div>
        <div class="stat-value">{{ formatClock(todaySeconds) }}</div>
        <div class="stat-hint" :class="{ 'warn-text': remainingWarning }">
          限额 {{ game.limitMinutes }} 分钟 ·
          {{ game.overLimit ? '已超出限额' : '剩余 ' + formatDuration(remainingSeconds) }}
        </div>
        <div class="progress">
          <div
            class="progress-bar"
            :class="{ over: game.overLimit }"
            :style="{ width: ratioPercent + '%' }"
          ></div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">正在计时（{{ activeGames.length }} 款）</div>
        <ul v-if="hasActiveGames" class="active-list">
          <li v-for="item in activeGames" :key="item.key" class="active-item">
            <span class="active-name" :title="item.processName">{{ item.name }}</span>
            <span class="active-time">{{ formatClock(item.durationSeconds) }}</span>
            <span class="source-tag">{{ formatGameSource(item.source) }}</span>
          </li>
        </ul>
        <div v-else class="stat-value small">--:--</div>

        <div class="stat-hint">
          {{ game.paused
              ? '已暂停：暂停期间不累计时长'
              : (hasActiveGames
                  ? '每款游戏各自计时，游戏主进程退出即结束'
                  : '只监控游戏主进程；启动器 / 客户端 / 反作弊等非游戏进程不检测也不显示') }}
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-label">监控状态</div>
        <div class="stat-value small">{{ game.monitoring ? '后台监控中' : '已停止' }}</div>
        <div class="stat-hint">{{ game.monitorHint }}</div>
        <div v-if="game.lastError" class="stat-hint warn-text">检测异常：{{ game.lastError }}</div>
      </div>
    </section>

    <!-- 计时控制 -->
    <section class="panel">
      <div class="panel-head">
        <h2>计时控制</h2>
        <span v-if="game.notice" class="notice">{{ game.notice }}</span>
      </div>

      <div class="control-row">
        <button class="btn primary" :disabled="!hasActiveGames || game.busy" @click="togglePause">
          {{ pauseLabel }}
        </button>
        <span class="control-hint">暂停对当前所有正在计时的游戏同时生效</span>
      </div>

      <div class="control-row">
        <label class="field-label" for="gameLimitInput">每日限额</label>
        <input
          id="gameLimitInput"
          v-model.number="game.limitInput"
          class="num-input"
          type="number"
          min="1"
          max="1440"
        >
        <span class="unit">分钟</span>
        <button class="btn" :disabled="game.busy" @click="saveLimit">保存</button>
        <span class="control-hint">
          剩余不足 {{ game.nearThresholdMinutes }} 分钟即弹窗提醒；仍在游戏则每
          {{ game.remindIntervalSeconds }} 秒重复提醒
        </span>
      </div>
    </section>

    <!-- 图表分析 -->
    <section class="panel">
      <div class="panel-head">
        <h2>数据分析</h2>
        <div class="segmented">
          <button
            v-for="day in DAY_OPTIONS"
            :key="day"
            :class="{ active: game.statsDays === day }"
            @click="changeDays(day)"
          >近 {{ day }} 天</button>
        </div>
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <div class="chart-title">每日时长（分钟）</div>
          <div ref="dailyChartEl" class="chart"></div>
        </div>
        <div class="chart-box">
          <div class="chart-title">各游戏占比</div>
          <div ref="gameChartEl" class="chart"></div>
        </div>
      </div>

      <div class="summary-row">
        <span>区间合计：{{ formatDuration(game.stats ? game.stats.totalSeconds : 0) }}</span>
        <span>日均：{{ formatDuration(game.avgSeconds) }}</span>
        <span>单日峰值：{{ formatDuration(game.maxSeconds) }}</span>
        <span v-if="game.stats">
          统计区间：{{ formatDateLabel(game.stats.fromDate) }} ~ {{ formatDateLabel(game.stats.toDate) }}
        </span>
      </div>
    </section>

    <!-- 游戏识别：游戏名来自进程统计，识别不对可手动纠正 -->
    <section class="panel">
      <div class="panel-head">
        <h2>游戏识别</h2>
        <span class="muted">内置库 → 官方名称；未收录 → 按安装目录推断；也可手动指定；只收录游戏主进程</span>
      </div>

      <div class="rule-form">
        <input
          v-model="game.ruleForm.processName"
          class="text-input"
          placeholder="进程名，例如 SomeGame.exe"
          autocomplete="off"
        >
        <span class="arrow">→</span>
        <input
          v-model="game.ruleForm.gameName"
          class="text-input"
          placeholder="显示名称，例如 我的游戏"
          autocomplete="off"
        >
        <button class="btn primary" :disabled="game.busy" @click="saveRule">保存规则</button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>游戏</th>
            <th>关联进程（来源）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in game.gameGroups" :key="group.key">
            <td class="game-cell">{{ group.name }}</td>
            <td>
              <span
                v-for="row in group.processes"
                :key="row.processName"
                class="process-tag"
                :title="'来源：' + formatGameSource(row.source)"
              >
                {{ row.processName }}
                <em class="source-tag">{{ formatGameSource(row.source) }}</em>
                <button
                  class="tag-close"
                  :title="row.source === 'user' ? '删除该自定义规则' : '屏蔽该进程（不再当作游戏计时）'"
                  @click="row.source === 'user' ? removeRule(row.processName) : ignoreProcess(row.processName)"
                >×</button>
              </span>
            </td>
          </tr>
          <tr v-if="!game.gameGroups.length">
            <td colspan="2" class="empty">还没有识别记录，启动游戏后会自动记录进程与游戏名</td>
          </tr>
        </tbody>
      </table>

      <div v-if="game.ignoredProcesses.length" class="ignored-row">
        <span class="ignored-label">已屏蔽进程（识别错误的可在此恢复）：</span>
        <span v-for="name in game.ignoredProcesses" :key="name" class="process-tag ignored">
          {{ name }}
          <button class="tag-close restore" title="恢复识别" @click="restoreProcess(name)">↺</button>
        </span>
      </div>
    </section>

    <!-- 今日记录 -->
    <section class="panel">
      <div class="panel-head">
        <h2>今日记录</h2>
        <span class="muted">开始 / 结束时间与时长已写入本地 SQLite，并按日期归档</span>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>游戏</th>
            <th>开始</th>
            <th>结束</th>
            <th>时长</th>
            <th>暂停</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="session in game.sessions" :key="session.id">
            <td>{{ session.gameName }}</td>
            <td>{{ formatTimeOfDay(session.startedAt) }}</td>
            <td>
              <span v-if="session.endedAt">{{ formatTimeOfDay(session.endedAt) }}</span>
              <span v-else class="live">进行中</span>
            </td>
            <td>{{ formatDuration(session.durationSeconds) }}</td>
            <td>{{ session.pausedSeconds ? formatDuration(session.pausedSeconds) : '—' }}</td>
          </tr>
          <tr v-if="!game.sessions.length">
            <td colspan="5" class="empty">今天还没有游戏记录，启动游戏后会自动开始计时</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.status-pill {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12.5px;
  white-space: nowrap;
}

.status-pill.online {
  background: var(--success-soft);
  color: var(--success);
}

.status-pill.paused {
  background: var(--warn-soft);
  color: var(--warn);
}

.status-pill.over {
  background: var(--danger-soft);
  color: var(--danger);
}

/* 顶部三个概览卡 */
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.stat-card {
  padding: 18px 20px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.stat-card.primary {
  background: linear-gradient(140deg, var(--accent-soft), transparent 72%);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.stat-label {
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}

.stat-value.small {
  font-size: 20px;
}

.stat-hint {
  margin-top: 8px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.warn-text {
  color: var(--warn);
}

.progress {
  height: 6px;
  margin-top: 12px;
  border-radius: 999px;
  background: var(--surface);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.4s ease;
}

.progress-bar.over {
  background: var(--danger);
}

/* 正在计时的游戏列表（多款并行时会有多条） */
.active-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.active-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.active-name {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}

.active-time {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.source-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

/* 控制区 */
.control-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 0;
}

.control-row + .control-row {
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px dashed var(--border);
}

.field-label {
  color: var(--text-dim);
  font-size: 13px;
}

.unit {
  color: var(--text-muted);
  font-size: 12.5px;
}

.control-hint {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}

/* 图表 */
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.chart-box {
  padding: 12px 14px 6px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-side);
}

.chart-title {
  margin-bottom: 6px;
  color: var(--text-dim);
  font-size: 12.5px;
}

.chart {
  width: 100%;
  height: 260px;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 14px;
  color: var(--text-dim);
  font-size: 12.5px;
}

/* 游戏识别：自定义规则表单与名单 */
.rule-form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.text-input {
  min-width: 200px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  outline: none;
}

.text-input:focus {
  border-color: var(--accent);
}

.arrow {
  color: var(--text-muted);
}

.process-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 2px 6px 2px 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--surface);
  font-size: 11.5px;
}

.tag-close {
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.tag-close.restore {
  color: var(--success);
}

/* 屏蔽名单：识别错误的进程可在此一键恢复 */
.ignored-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}

.ignored-label {
  color: var(--text-muted);
  font-size: 12px;
}

.process-tag.ignored {
  opacity: 0.72;
}

.game-cell {
  font-weight: 600;
}
</style>
