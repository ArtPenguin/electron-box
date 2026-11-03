<script setup lang="ts">
/**
 * 聊天工具页
 *
 * 由原来的单页聊天界面迁移而来，行为保持一致：
 * - 左侧会话列表（新建 / 切换 / 删除，删除二次确认）
 * - 流式回复 + 打字机逐字效果（src/utils/typewriter.ts）
 * - Enter 发送、发送中禁用、错误提示
 * - 消息与会话存本地 SQLite，切换会话不丢上下文
 */
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useChatStore } from '../stores/chat'
import { createTypewriter } from '../utils/typewriter'

const SAMPLES = [
  '帮我查一下今天的科技新闻',
  '用一句话解释什么是 RAG',
  '把这句话翻译成英文：今天天气不错',
]

const router = useRouter()
const chat = useChatStore()
const {
  conversations,
  currentId,
  messages,
  loadingMessages,
  sending,
  streaming,
  error,
} = storeToRefs(chat)

const input = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const messagesEl = ref<HTMLDivElement | null>(null)
const streamBubble = ref<HTMLDivElement | null>(null)

const canSend = computed(() => input.value.trim().length > 0 && !sending.value)
const showWelcome = computed(() => chat.isEmpty && !loadingMessages.value)

function scrollToBottom (): void {
  const el = messagesEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function focusInput (): void {
  if (inputEl.value) inputEl.value.focus()
}

function useSample (sample: string): void {
  input.value = sample
  focusInput()
}

function backHome (): void {
  void router.push('/')
}

onMounted(async () => {
  if (!chat.conversations.length) await chat.loadConversations()
  if (!chat.currentId && chat.conversations.length) {
    await chat.openConversation(chat.conversations[0].id)
  }
  await nextTick()
  scrollToBottom()
  focusInput()
})

/** 回车发送；输入法组合状态下的回车用于选词，不触发发送 */
function onEnter (event: KeyboardEvent): void {
  if (event.isComposing) return
  void send()
}

async function send (): Promise<void> {
  const text = input.value.trim()
  if (!text || sending.value) return

  input.value = ''
  chat.dismissError()
  chat.pushUserMessage(text)
  chat.beginStreaming() // 渲染流式气泡占位
  await nextTick()
  scrollToBottom()

  // 增量写入独立的流式气泡：打字机直接操作该元素的文本节点，
  // 与 v-for 渲染的消息列表互不干扰（避免 Vue 覆盖手写 DOM）
  const bubble = streamBubble.value
  const typewriter = bubble ? createTypewriter(bubble, { onUpdate: scrollToBottom }) : null

  let result
  try {
    result = await chat.sendMessage(text, (delta) => typewriter?.push(delta))
  } finally {
    typewriter?.flush() // 流结束：立刻补齐剩余字符
    await nextTick() // 等列表出现完整回复、流式气泡移除
    scrollToBottom()
    focusInput()
  }

  if (result && !result.ok) {
    chat.setError(result.error || '调用失败')
  }
}

async function newConversation (): Promise<void> {
  await chat.newConversation()
  await nextTick()
  scrollToBottom()
  focusInput()
}

async function removeConversation (conversation: { id: number; title: string }): Promise<void> {
  const title = conversation.title || '新对话'
  if (!window.confirm(`确定删除会话「${title}」吗？其中的消息会一并删除。`)) return

  await chat.removeConversation(conversation.id)
  if (!chat.currentId && chat.conversations.length) {
    await chat.openConversation(chat.conversations[0].id)
  }
  await nextTick()
  scrollToBottom()
}
</script>

<template>
  <div class="page chat-page">
    <aside class="chat-sidebar">
      <div class="side-head">
        <button class="back-btn" title="返回工具箱" @click="backHome">← 工具箱</button>
        <button class="icon-btn" title="新建会话" @click="newConversation">＋</button>
      </div>

      <ul class="conv-list">
        <li
          v-for="conversation in conversations"
          :key="conversation.id"
          :class="{ active: Number(conversation.id) === Number(currentId) }"
          @click="chat.openConversation(conversation.id)"
        >
          <span class="conv-title" :title="conversation.title">{{ conversation.title }}</span>
          <button class="del" title="删除该会话" @click.stop="removeConversation(conversation)">×</button>
        </li>
        <li v-if="!conversations.length" class="empty">暂无会话，输入即新建</li>
      </ul>

      <div class="side-foot">历史记录 · 本地 SQLite</div>
    </aside>

    <main class="chat-main">
      <header class="chat-head">
        <span class="chat-title">{{ chat.currentTitle }}</span>
        <span class="chat-hint">DeepSeek · 支持联网搜索</span>
      </header>

      <div ref="messagesEl" class="chat-messages">
        <div
          v-for="message in messages"
          :key="message.id"
          class="msg"
          :class="message.role"
        >{{ message.content }}</div>

        <!-- 流式气泡：打字机把增量直接写入该元素，避免与列表渲染相互覆盖 -->
        <div v-if="streaming" ref="streamBubble" class="msg assistant typing"></div>

        <div v-if="error" class="msg error">
          <span class="error-text">{{ error }}</span>
          <button class="msg-close" title="关闭" @click="chat.dismissError()">×</button>
        </div>

        <div v-if="showWelcome" class="welcome">
          <div class="welcome-title">你好，我是运行在 Electron 主进程中的 LangChain Agent</div>
          <p class="welcome-desc">支持联网搜索、工具调用与本地历史记录。可直接输入，或试试下面这些：</p>
          <div class="samples">
            <button
              v-for="sample in SAMPLES"
              :key="sample"
              class="sample"
              @click="useSample(sample)"
            >{{ sample }}</button>
          </div>
        </div>
      </div>

      <footer class="chat-input">
        <input
          ref="inputEl"
          v-model="input"
          placeholder="输入消息，回车或点击发送…"
          autocomplete="off"
          @keydown.enter="onEnter"
        >
        <button class="btn primary" :disabled="!canSend" @click="send">发送</button>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* 用 .page.chat-page 提高特异性：本页需要覆盖全局 .page 的内边距与滚动方式 */
.page.chat-page {
  display: flex;
  height: 100vh;
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

/* 左侧会话列表 */
.chat-sidebar {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-side);
  border-right: 1px solid var(--border);
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 12px 14px;
  border-bottom: 1px solid var(--border);
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--accent-hover);
}

.conv-list {
  flex: 1;
  list-style: none;
  overflow-y: auto;
}

.conv-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}

.conv-list li:hover {
  background: var(--surface-2);
}

.conv-list li.active {
  background: var(--surface);
}

.conv-list li.empty {
  justify-content: center;
  color: var(--text-muted);
  font-size: 12.5px;
  cursor: default;
}

.conv-title {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.del {
  visibility: hidden;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--danger);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.conv-list li:hover .del {
  visibility: visible;
}

.del:hover {
  background: var(--danger-soft);
}

.side-foot {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
}

/* 右侧聊天区 */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  background: var(--bg-side);
  border-bottom: 1px solid var(--border);
}

.chat-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 600;
}

.chat-hint {
  color: var(--text-muted);
  font-size: 11.5px;
}

.chat-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  overflow-y: auto;
}

.msg {
  max-width: 82%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}

.msg.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--accent-contrast);
}

.msg.assistant {
  align-self: flex-start;
  background: var(--surface);
}

.msg.error {
  align-self: flex-start;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  color: var(--danger);
}

.error-text {
  flex: 1;
}

.msg-close {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}

.msg-close:hover {
  opacity: 1;
}

/* 流式输出的打字光标 */
.msg.typing::after {
  content: '▍';
  margin-left: 2px;
  color: var(--accent);
  animation: caret-blink 1s steps(1, end) infinite;
}

@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

.welcome {
  align-self: center;
  margin: auto 0;
  max-width: 560px;
  text-align: center;
  color: var(--text-dim);
}

.welcome-title {
  margin-bottom: 10px;
  color: var(--text);
  font-size: 14.5px;
  font-weight: 600;
}

.welcome-desc {
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.8;
}

.samples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.sample {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sample:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--surface);
}

.chat-input {
  display: flex;
  gap: 10px;
  padding: 12px 18px;
  background: var(--bg-side);
  border-top: 1px solid var(--border);
}

.chat-input input {
  flex: 1;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.chat-input input:focus {
  border-color: var(--accent);
}
</style>
