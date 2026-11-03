<script setup lang="ts">
/**
 * 进程监视器页
 *
 * 内容：
 * - 进程列表：PID / 名称 / 路径 / CPU / 内存 / 启动时间 / 状态，支持搜索过滤与虚拟滚动；
 * - 单进程运维：打开所在目录、终止进程（二次确认 + 主进程拦截系统核心进程）；
 * - 监控规则：精确 / 模糊匹配，启用 / 禁用，动作可配置（日志 / 桌面通知 / 联动游戏计时事件）；
 * - 历史日志：规则命中、进程退出、运维操作与异常记录，可清空；
 * - 配置：轮询间隔（1~10 秒，默认 3 秒）、日志保留条数、CSV 快照导出。
 *
 * 安全：渲染层只通过 api.procmon 调用受控 IPC，拿不到 shell / fs 能力；
 *       关键词只在主进程内存中做字符串匹配，从不拼进命令行。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ConfirmModal from '../components/ConfirmModal.vue'
import PageHeader from '../components/PageHeader.vue'
import VirtualList from '../components/VirtualList.vue'
import { useProcmonStore, emptyRuleForm, type ProcRuleForm } from '../stores/procmon'
import {
  formatCpu,
  formatLogLevel,
  formatMemory,
  formatProcessStart,
} from '../utils/format'
import type { ProcProcess, ProcRule } from '../../../types/ipc'

const procmon = useProcmonStore()

// ---------------------------- 进程列表过滤 ----------------------------

const keyword = ref('')

const filteredProcesses = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  const list = procmon.processes
  if (!text) return list
  return list.filter((proc) => {
    if (String(proc.pid).includes(text)) return true
    return (
      proc.name.toLowerCase().includes(text) ||
      (proc.path || '').toLowerCase().includes(text)
    )
  })
})

const runningCount = computed(() => procmon.processes.filter((p) => p.status === 'running').length)

// ---------------------------- 规则编辑 ----------------------------

const editing = ref(false)
const ruleForm = ref<ProcRuleForm>(emptyRuleForm())

const EVENT_OPTIONS: Array<{ value: ProcRuleForm['actions']['event']; label: string }> = [
  { value: 'none', label: '不发送联动事件' },
  { value: 'start', label: '出现时发送「启动计时」' },
  { value: 'stop', label: '退出时发送「停止计时」' },
  { value: 'both', label: '出现 / 退出都发送事件' },
]

const MATCH_OPTIONS = [
  { value: 'exact', label: '精确匹配' },
  { value: 'fuzzy', label: '模糊匹配（包含）' },
]

function startCreateRule (): void {
  ruleForm.value = emptyRuleForm()
  editing.value = true
}

function startEditRule (rule: ProcRule): void {
  ruleForm.value = {
    id: rule.id,
    label: rule.label,
    matchType: rule.matchType,
    pattern: rule.pattern,
    enabled: rule.enabled,
    actions: { ...rule.actions },
  }
  editing.value = true
}

function cancelEdit (): void {
  editing.value = false
  ruleForm.value = emptyRuleForm()
}

async function saveRule (): Promise<void> {
  const ok = await procmon.saveRule(ruleForm.value)
  if (ok) cancelEdit()
}

async function toggleRule (rule: ProcRule): Promise<void> {
  await procmon.toggleRule(rule.id, !rule.enabled)
}

async function removeRule (rule: ProcRule): Promise<void> {
  await procmon.removeRule(rule.id)
}

/** 规则动作徽标文案 */
function actionBadges (rule: ProcRule): string[] {
  const badges: string[] = []
  if (rule.actions.log) badges.push('日志')
  if (rule.actions.notification) badges.push('通知')
  if (rule.actions.event === 'start') badges.push('启动事件')
  if (rule.actions.event === 'stop') badges.push('停止事件')
  if (rule.actions.event === 'both') badges.push('开始/停止事件')
  return badges
}

// ---------------------------- 单进程运维 ----------------------------

const pendingKill = ref<{ pid: number; name: string } | null>(null)

function askKill (proc: ProcProcess): void {
  pendingKill.value = { pid: proc.pid, name: proc.name }
}

async function confirmKill (): Promise<void> {
  const target = pendingKill.value
  pendingKill.value = null
  if (!target) return
  await procmon.killProcess(target.pid)
}

async function openFolder (proc: ProcProcess): Promise<void> {
  await procmon.openFolder(proc.pid)
}

// ---------------------------- 快照导出 / 配置 ----------------------------

async function exportSnapshot (): Promise<void> {
  await procmon.exportSnapshot()
}

const intervalInput = ref(3)
const retentionInput = ref(500)

watch(
  () => procmon.settings,
  (settings) => {
    if (settings) {
      intervalInput.value = settings.intervalSeconds
      retentionInput.value = settings.logRetention
    }
  },
  { immediate: true }
)

async function saveSettings (): Promise<void> {
  await procmon.updateSettings({
    intervalSeconds: intervalInput.value,
    logRetention: retentionInput.value,
  })
}

// ---------------------------- 生命周期 ----------------------------

onMounted(async () => {
  await procmon.init()
})

onBeforeUnmount(() => {
  procmon.dispose()
})

const ruleNameById = (id: number): string =>
  procmon.rules.find((rule) => rule.id === id)?.label || `#${id}`
</script>

<template>
  <div class="page procmon-page">
    <PageHeader title="进程监视器">
      <span
        class="status-pill"
        :class="{ online: procmon.monitoring }"
      >{{ procmon.monitoring ? `监控中 · ${runningCount} 个运行进程` : '监控已停止' }}</span>
    </PageHeader>

    <!-- 状态 / 异常提示 -->
    <section v-if="procmon.lastError" class="error-banner">
      ⚠️ {{ procmon.lastError.message }}
      <span class="muted">（原始技术细节已记录到内部日志）</span>
    </section>

    <!-- 进程列表 -->
    <section class="panel">
      <div class="panel-head">
        <h2>系统进程</h2>
        <span class="muted">
          {{ procmon.platform === 'darwin' ? 'macOS' : procmon.platform === 'win32' ? 'Windows' : procmon.platform }}
          · 最后扫描 {{ procmon.lastScanAt || '—' }}
        </span>
      </div>

      <div class="toolbar">
        <input
          v-model="keyword"
          class="text-input search"
          type="search"
          placeholder="搜索进程名 / 路径 / PID"
          autocomplete="off"
        >
        <button class="btn" :disabled="procmon.busy" @click="procmon.refresh()">刷新</button>
        <button class="btn primary" :disabled="procmon.busy" @click="exportSnapshot">导出 CSV 快照</button>
      </div>

      <div class="process-table">
        <div class="table-head grid-row">
          <span>PID</span>
          <span>进程名称</span>
          <span>可执行文件路径</span>
          <span>CPU</span>
          <span>内存</span>
          <span>启动时间</span>
          <span>状态</span>
          <span>操作</span>
        </div>

        <VirtualList
          :items="filteredProcesses"
          :height="460"
          :row-height="40"
        >
          <template #default="{ item: proc }">
            <div class="grid-row process-row" :class="{ gone: proc.status === 'gone' }">
              <span class="mono">{{ proc.pid }}</span>
              <span class="name-cell">
                <span class="name" :title="proc.name">{{ proc.name }}</span>
                <span
                  v-for="ruleId in proc.matchedRuleIds"
                  :key="ruleId"
                  class="rule-tag"
                  :title="`命中规则：${ruleNameById(ruleId)}`"
                >规则</span>
              </span>
              <span class="path-cell" :title="proc.path || ''">{{ proc.path || '—' }}</span>
              <span class="mono">{{ formatCpu(proc.cpuPercent) }}</span>
              <span class="mono">{{ formatMemory(proc.memoryBytes) }}</span>
              <span class="mono">{{ formatProcessStart(proc.startedAt) }}</span>
              <span>
                <span class="status" :class="proc.status === 'gone' ? 'gone' : 'running'">
                  {{ proc.status === 'gone' ? '已消失' : '运行中' }}
                </span>
              </span>
              <span class="actions-cell">
                <button class="mini-btn" title="在文件管理器中打开所在目录" @click="openFolder(proc)">目录</button>
                <button
                  class="mini-btn danger"
                  title="终止该进程（系统核心进程将被拦截）"
                  :disabled="proc.status === 'gone'"
                  @click="askKill(proc)"
                >终止</button>
              </span>
            </div>
          </template>
        </VirtualList>

        <div v-if="!filteredProcesses.length" class="empty-list">
          {{ keyword ? '没有匹配的进程' : '暂无进程数据，请点击刷新' }}
        </div>
      </div>
    </section>

    <!-- 监控规则 -->
    <section class="panel">
      <div class="panel-head">
        <h2>监控规则</h2>
        <span class="muted">进程名精确 / 模糊匹配；命中后可记录日志、弹出通知，或联动游戏计时</span>
      </div>

      <div class="rule-list">
        <div v-for="rule in procmon.rules" :key="rule.id" class="rule-card" :class="{ off: !rule.enabled }">
          <div class="rule-main">
            <div class="rule-title">
              <span class="rule-pattern">{{ rule.pattern }}</span>
              <span class="match-type">{{ rule.matchType === 'exact' ? '精确' : '模糊' }}</span>
              <span v-if="rule.label" class="rule-label">{{ rule.label }}</span>
            </div>
            <div class="rule-meta">
              <span v-for="badge in actionBadges(rule)" :key="badge" class="action-tag">{{ badge }}</span>
              <span class="muted">触发 {{ rule.triggerCount }} 次</span>
              <span v-if="rule.lastTriggeredAt" class="muted">· 上次 {{ rule.lastTriggeredAt }}</span>
            </div>
          </div>
          <div class="rule-actions">
            <button class="mini-btn" @click="startEditRule(rule)">编辑</button>
            <button
              class="mini-btn"
              :class="rule.enabled ? 'warn' : ''"
              @click="toggleRule(rule)"
            >{{ rule.enabled ? '禁用' : '启用' }}</button>
            <button class="mini-btn danger" @click="removeRule(rule)">删除</button>
          </div>
        </div>
        <div v-if="!procmon.rules.length" class="empty-list">还没有监控规则，在下方创建第一条</div>
      </div>

      <!-- 规则编辑表单 -->
      <div class="rule-editor">
        <div class="panel-head">
          <h3>{{ ruleForm.id ? '编辑规则' : '新建规则' }}</h3>
          <button v-if="!editing" class="btn primary" @click="startCreateRule">新建规则</button>
        </div>

        <template v-if="editing">
          <div class="form-row">
            <label>进程名关键词</label>
            <input
              v-model="ruleForm.pattern"
              class="text-input"
              placeholder="例如 SomeGame.exe 或 Game"
              autocomplete="off"
            >
            <select v-model="ruleForm.matchType" class="text-input">
              <option v-for="opt in MATCH_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>

          <div class="form-row">
            <label>备注名（可选）</label>
            <input
              v-model="ruleForm.label"
              class="text-input"
              placeholder="便于识别这条规则"
              autocomplete="off"
            >
            <label class="inline-check">
              <input type="checkbox" v-model="ruleForm.enabled"> 启用规则
            </label>
          </div>

          <div class="form-row actions-grid">
            <label class="inline-check">
              <input type="checkbox" v-model="ruleForm.actions.log"> 记录命中日志
            </label>
            <label class="inline-check">
              <input type="checkbox" v-model="ruleForm.actions.notification"> 弹出系统通知
            </label>
          </div>

          <div class="form-row">
            <label>联动游戏计时</label>
            <select v-model="ruleForm.actions.event" class="text-input">
              <option v-for="opt in EVENT_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <input
              v-model="ruleForm.actions.eventLabel"
              class="text-input"
              placeholder="游戏显示名（留空则用进程名）"
              autocomplete="off"
              :disabled="ruleForm.actions.event === 'none'"
            >
          </div>

          <div v-if="!procmon.notifySupported" class="muted warn-text">当前平台不支持系统桌面通知，通知动作将不会弹出。</div>

          <div class="form-row">
            <button class="btn primary" :disabled="procmon.busy" @click="saveRule">保存规则</button>
            <button class="btn" :disabled="procmon.busy" @click="cancelEdit">取消</button>
          </div>
        </template>
      </div>
    </section>

    <!-- 历史日志 -->
    <section class="panel">
      <div class="panel-head">
        <h2>监控日志</h2>
        <button class="btn" :disabled="procmon.busy || !procmon.logs.length" @click="procmon.clearLogs()">清空日志</button>
      </div>

      <div class="log-list">
        <div v-for="entry in procmon.logs" :key="entry.id" class="log-row" :class="entry.level">
          <span class="log-time mono">{{ entry.at }}</span>
          <span class="log-level">{{ formatLogLevel(entry.level) }}</span>
          <span class="log-action">{{ entry.action }}</span>
          <span class="log-message">{{ entry.message }}</span>
        </div>
        <div v-if="!procmon.logs.length" class="empty-list">暂无日志记录</div>
      </div>
    </section>

    <!-- 采集配置 -->
    <section class="panel">
      <div class="panel-head">
        <h2>采集配置</h2>
        <span class="muted">轮询间隔越短越实时，但 CPU 占用越高；默认 3 秒</span>
      </div>

      <div class="form-row">
        <label>轮询间隔（秒）</label>
        <input
          v-model.number="intervalInput"
          class="num-input"
          type="number"
          min="1"
          max="10"
          step="1"
        >
        <span class="unit">1 ~ 10 秒，不能小于 1 秒</span>
      </div>

      <div class="form-row">
        <label>日志保留条数</label>
        <input
          v-model.number="retentionInput"
          class="num-input"
          type="number"
          min="50"
          max="5000"
          step="50"
        >
        <span class="unit">超出后自动清理最旧记录</span>
        <button class="btn primary" :disabled="procmon.busy" @click="saveSettings">保存配置</button>
      </div>

      <div v-if="procmon.notice" class="notice">{{ procmon.notice }}</div>
    </section>

    <ConfirmModal
      :open="pendingKill !== null"
      title="终止进程"
      :body="pendingKill ? `确定要终止进程「${pendingKill.name}」（PID ${pendingKill.pid}）吗？\n终止后该程序未保存的工作可能丢失，系统核心进程将被拒绝终止。` : ''"
      confirm-label="终止进程"
      @confirm="confirmKill"
      @cancel="pendingKill = null"
    />
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

.error-banner {
  margin-bottom: 18px;
  padding: 12px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 13px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.text-input.search {
  flex: 1;
  min-width: 220px;
}

/* 进程表格（列宽与表头、虚拟行一致） */
.grid-row {
  display: grid;
  grid-template-columns: 80px 1.2fr 1.8fr 86px 104px 128px 80px 148px;
  gap: 10px;
  align-items: center;
}

.table-head {
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}

.process-row {
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.process-row:hover {
  background: var(--table-hover);
}

.process-row.gone {
  opacity: 0.55;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 13px;
}

.rule-tag {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
}

.path-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
  font-size: 12px;
}

.status {
  font-size: 12px;
}

.status.running {
  color: var(--success);
}

.status.gone {
  color: var(--text-muted);
}

.actions-cell {
  display: flex;
  gap: 6px;
}

.mini-btn {
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}

.mini-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.mini-btn.danger {
  color: var(--danger);
}

.mini-btn.danger:hover:not(:disabled) {
  border-color: var(--danger);
  background: var(--danger-soft);
}

.mini-btn.warn {
  color: var(--warn);
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.empty-list {
  padding: 24px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 12.5px;
}

/* 规则卡片 */
.rule-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 18px;
}

.rule-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.rule-card.off {
  opacity: 0.6;
}

.rule-main {
  min-width: 0;
}

.rule-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rule-pattern {
  font-weight: 650;
}

.match-type,
.rule-label {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 11px;
}

.rule-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.action-tag {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
}

.rule-actions {
  display: flex;
  gap: 6px;
  flex: none;
}

/* 规则表单 */
.rule-editor {
  border-top: 1px dashed var(--border);
  padding-top: 14px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.form-row label {
  color: var(--text-dim);
  font-size: 13px;
  min-width: 96px;
}

.form-row .text-input {
  min-width: 180px;
  flex: 1;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: auto !important;
  color: var(--text);
  font-size: 13px;
}

.actions-grid {
  gap: 24px;
}

.unit {
  color: var(--text-muted);
  font-size: 12px;
}

.warn-text {
  color: var(--warn);
}

/* 日志 */
.log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}

.log-row {
  display: grid;
  grid-template-columns: 150px 64px 110px 1fr;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 12.5px;
}

.log-level {
  padding: 2px 8px;
  border-radius: 999px;
  text-align: center;
  font-size: 11px;
}

.log-row.info .log-level {
  background: var(--accent-soft);
  color: var(--accent);
}

.log-row.warn .log-level {
  background: var(--warn-soft);
  color: var(--warn);
}

.log-row.error .log-level {
  background: var(--danger-soft);
  color: var(--danger);
}

.log-action {
  color: var(--text-muted);
  font-size: 11.5px;
}

.log-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice {
  margin-top: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  display: inline-block;
}

select.text-input {
  min-width: 130px;
  flex: none;
  color: var(--text);
}
</style>
