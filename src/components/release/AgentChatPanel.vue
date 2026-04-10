<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useReleaseStore } from '../../stores/release'
import {
  formatJson,
  getStatusTone,
  normalizeChatMessage,
  renderCode,
  renderMarkdown
} from './chat-format.js'

const emit = defineEmits(['navigate-home'])
const release = useReleaseStore()
const chatContainer = ref(null)
const composerRef = ref(null)
const userInput = ref('')
const copiedState = ref('')

const displayMessages = computed(() =>
  (release.chatMessages || []).map(message => normalizeChatMessage(message))
)

const agentTitle = computed(() => '开发助手')
const inputPlaceholder = computed(() => `给 ${agentTitle.value} 发消息...`)
const welcomeTitle = computed(() =>
  release.isReleaseMode ? '发布模式已就绪' : '开发助手准备就绪'
)
const welcomeSubtitle = computed(() =>
  release.isReleaseMode
    ? '你已经进入发布模式，可以继续做版本、PR、预检和构建相关操作。'
    : '像 Claude Code 一样工作：对话、按钮操作、代码块和结构化结果都在同一个会话里完成。'
)

const sessionState = computed(() => {
  if (release.agentRunning) return { label: '运行中', tone: 'info' }
  if (release.isReleaseMode && release.pipelineStatus === 'blocked') return { label: '发布阻塞', tone: 'error' }
  if (release.isReleaseMode && release.pipelineStatus === 'pass') return { label: '发布就绪', tone: 'success' }
  if (release.isReleaseMode && release.sessionActive) return { label: '发布中', tone: 'warning' }
  return { label: '通用模式', tone: 'muted' }
})

const quickActions = computed(() => {
  if (release.isReleaseMode) {
    return [
      { id: 'quick-summary', label: '总结当前进度', text: '请总结当前发布检查进度、阻塞点和下一步建议。' },
      { id: 'quick-risks', label: '列出风险', text: '请列出当前版本最值得关注的风险点。' },
      { id: 'quick-next-step', label: '推荐下一步', text: '请告诉我现在最合理的下一步操作。' }
    ]
  }

  return [
    { id: 'quick-workspace', label: '分析工作区', text: '请先分析当前工作区，告诉我你能帮我做什么。' },
    { id: 'quick-repos', label: '查看目录结构', text: '请查看当前项目目录结构，并总结主要模块和可能的工作入口。' },
    { id: 'quick-release', label: '进入发布流程', text: '我要开始一次生产发布，请先检查凭证并引导我继续。' }
  ]
})

/**
 * @returns {void}
 */
function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

watch(
  () => displayMessages.value.map(message => `${message.id}-${message.status}-${message.text.length}`).join('|'),
  () => scrollToBottom()
)

watch(
  () => userInput.value,
  () => nextTick(() => autoResizeComposer())
)

/**
 * @param {object} message
 * @returns {boolean}
 */
function isStreaming(message) {
  return message?._streaming === true
}

/**
 * @param {object} action
 * @returns {boolean}
 */
function isActionDisabled(action) {
  if (typeof action.disabled === 'boolean') return action.disabled
  return action.id?.startsWith('env-') && action.id !== 'env-production'
}

/**
 * @param {object} action
 * @returns {string}
 */
function getActionVariant(action) {
  return action.variant || 'secondary'
}

/**
 * @param {string} actionId
 * @returns {void}
 */
function handleAction(actionId) {
  release.handleChatAction(actionId)
}

/**
 * @returns {void}
 */
function handleSendMessage() {
  const text = userInput.value.trim()
  if (!text) return
  userInput.value = ''
  release.agentChat(text)
  nextTick(() => {
    autoResizeComposer()
    composerRef.value?.focus()
  })
}

/**
 * @returns {void}
 */
function handleStopChat() {
  release.stopAgentChat()
}

/**
 * @returns {void}
 */
function openPromptStudio() {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'prompt' } }))
}

/**
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function handleInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSendMessage()
  }
}

/**
 * @returns {void}
 */
function autoResizeComposer() {
  if (!composerRef.value) return
  composerRef.value.style.height = 'auto'
  composerRef.value.style.height = `${Math.min(composerRef.value.scrollHeight, 180)}px`
}

/**
 * @param {Date | string} date
 * @returns {string}
 */
function formatTime(date) {
  if (!date) return ''
  return new Date(date).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * @param {string} content
 * @returns {string}
 */
function renderMarkdownBlock(content) {
  return renderMarkdown(content)
}

/**
 * @param {object} block
 * @returns {string}
 */
function renderCodeBlock(block) {
  return renderCode(block.content, block.language)
}

/**
 * @param {object} block
 * @returns {string}
 */
function formatJsonBlock(block) {
  return formatJson(block.content ?? block.raw)
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
async function copyText(key, value) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    }
    copiedState.value = key
    window.setTimeout(() => {
      if (copiedState.value === key) {
        copiedState.value = ''
      }
    }, 1200)
  } catch {
    copiedState.value = ''
  }
}

/**
 * @param {object} message
 * @returns {boolean}
 */
function hasToolPayload(message) {
  return Boolean(message.meta?.displayResult)
}

/**
 * @param {object} message
 * @returns {string}
 */
function getActivityKind(message) {
  return message?.meta?.activityKind || (message?.kind === 'skill' ? 'skill' : 'tool')
}

/**
 * @param {object} message
 * @returns {string}
 */
function getActivityBadge(message) {
  return getActivityKind(message) === 'skill' ? 'SKILL' : 'TOOL'
}

/**
 * @param {object} message
 * @returns {string}
 */
function getActivityName(message) {
  return message?.meta?.skillName || message?.meta?.toolName || ''
}

/**
 * @param {object} quickAction
 * @returns {void}
 */
function triggerQuickAction(quickAction) {
  userInput.value = quickAction.text
  handleSendMessage()
}

/**
 * @returns {void}
 */
function resetChat() {
  release.resetSession()
  release.agentStart()
  nextTick(() => composerRef.value?.focus())
}

onMounted(() => {
  if (!release.chatMessages?.length) {
    release.agentStart()
  }
  nextTick(() => {
    autoResizeComposer()
    composerRef.value?.focus()
  })
})
</script>

<template>
  <div class="chat-panel cursor-chat">
    <header data-testid="chat-topbar" class="chat-topbar">
      <div class="topbar-left">
        <button class="icon-btn" @click="emit('navigate-home')" title="返回主页">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="agent-mark">
          <span class="agent-mark-dot"></span>
        </div>
        <div class="topbar-copy">
          <div class="chat-title">{{ agentTitle }}</div>
          <div class="chat-subtitle">{{ release.isReleaseMode ? 'Release workflow' : 'Workspace chat' }}</div>
        </div>
      </div>

      <div class="topbar-right">
        <span v-if="release.version" class="chat-version">v{{ release.version }}</span>
        <span class="session-badge" :class="`tone-${sessionState.tone}`">{{ sessionState.label }}</span>
        <button
          data-testid="open-prompt-studio-btn"
          class="icon-btn"
          title="打开提示词调试台"
          @click="openPromptStudio"
        >
          Prompt
        </button>
        <button
          v-if="release.agentRunning"
          data-testid="chat-stop-btn"
          class="stop-btn"
          @click="handleStopChat"
          title="终止当前对话"
        >
          终止
        </button>
        <button class="icon-btn" @click="resetChat" title="重新开始">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>
      </div>
    </header>

    <section ref="chatContainer" data-testid="chat-timeline" class="chat-timeline">
      <div class="timeline-inner">
        <div v-if="displayMessages.length === 0" class="timeline-empty">
          <div class="empty-kicker">{{ welcomeTitle }}</div>
          <h2 class="empty-title">{{ agentTitle }}</h2>
          <p class="empty-subtitle">{{ welcomeSubtitle }}</p>
          <div class="empty-grid">
            <button
              v-for="quickAction in quickActions"
              :key="quickAction.id"
              class="empty-action-card"
              @click="triggerQuickAction(quickAction)"
            >
              <span class="empty-action-label">{{ quickAction.label }}</span>
              <span class="empty-action-hint">{{ quickAction.text }}</span>
            </button>
          </div>
        </div>

        <template v-for="msg in displayMessages" :key="msg.id">
          <article v-if="msg.role === 'agent'" class="timeline-entry agent-entry" :class="[`entry-${msg.kind || 'message'}`]">
            <div class="entry-rail">
              <span class="entry-node" :class="[`tone-${getStatusTone(msg.status)}`]"></span>
            </div>

            <div class="entry-main">
              <div class="entry-meta">
                <span class="entry-author">Agent</span>
                <span class="entry-separator">·</span>
                <span class="entry-time">{{ formatTime(msg.ts) }}</span>
              </div>

              <details v-if="msg._reasoning" class="reasoning-block">
                <summary class="reasoning-toggle">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  思考过程
                </summary>
                <pre class="reasoning-text">{{ msg._reasoning }}</pre>
              </details>

              <div
                v-if="msg.kind === 'tool' || msg.kind === 'skill'"
                data-testid="tool-status-card"
                class="tool-card"
                :class="[`${getActivityKind(msg)}-card`, `tone-${getStatusTone(msg.status)}`]"
                :data-activity-kind="getActivityKind(msg)"
              >
                <div class="activity-header">
                  <span class="activity-badge" :class="`kind-${getActivityKind(msg)}`">{{ getActivityBadge(msg) }}</span>
                  <span v-if="getActivityName(msg)" class="activity-name">{{ getActivityName(msg) }}</span>
                </div>
                <p class="tool-summary compact-tool-line">{{ msg.meta?.compactText || msg.text }}</p>
                <details v-if="hasToolPayload(msg)" class="tool-details">
                  <summary>详情</summary>
                  <pre class="tool-json">{{ formatJson(msg.meta.displayResult) }}</pre>
                </details>
              </div>

              <div v-else class="message-shell">
                <div v-if="isStreaming(msg) && !msg.text" class="thinking-indicator">
                  <span class="thinking-dot"></span>
                  <span class="thinking-dot"></span>
                  <span class="thinking-dot"></span>
                  <span class="thinking-label">思考中</span>
                </div>

                <template v-for="(block, blockIndex) in msg.blocks" :key="`${msg.id}-${blockIndex}-${block.type}`">
                  <div
                    v-if="block.type === 'markdown'"
                    class="message-block markdown-block"
                    v-html="renderMarkdownBlock(block.content)"
                  ></div>

                  <div
                    v-else-if="block.type === 'code'"
                    data-testid="code-block"
                    class="message-block code-block"
                  >
                    <div class="code-toolbar">
                      <span class="code-language">{{ block.language || 'text' }}</span>
                      <button
                        data-testid="copy-code-btn"
                        class="block-copy-btn"
                        @click="copyText(`${msg.id}-${blockIndex}`, block.content)"
                      >
                        {{ copiedState === `${msg.id}-${blockIndex}` ? '已复制' : '复制代码' }}
                      </button>
                    </div>
                    <pre class="code-surface"><code v-html="renderCodeBlock(block)"></code></pre>
                  </div>

                  <div
                    v-else-if="block.type === 'json'"
                    data-testid="json-block"
                    class="message-block json-block"
                  >
                    <div class="json-toolbar">
                      <span class="json-label">JSON</span>
                      <button
                        class="block-copy-btn"
                        @click="copyText(`${msg.id}-${blockIndex}`, formatJsonBlock(block))"
                      >
                        {{ copiedState === `${msg.id}-${blockIndex}` ? '已复制' : '复制 JSON' }}
                      </button>
                    </div>
                    <pre class="json-surface">{{ formatJsonBlock(block) }}</pre>
                  </div>

                  <div v-else-if="block.type === 'actions'" class="message-block msg-actions">
                    <button
                      v-for="action in block.items"
                      :key="action.id"
                      :data-testid="`chat-action-${action.id}`"
                      class="action-btn"
                      :class="[`variant-${getActionVariant(action)}`]"
                      :disabled="isActionDisabled(action)"
                      @click="handleAction(action.id)"
                    >
                      {{ action.label }}
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </article>

          <article v-else-if="msg.role === 'user'" class="timeline-entry user-entry">
            <div class="entry-main user-main">
              <div class="entry-meta user-meta">
                <span class="entry-author">You</span>
                <span class="entry-separator">·</span>
                <span class="entry-time">{{ formatTime(msg.ts) }}</span>
              </div>
              <div class="user-inline">{{ msg.text }}</div>
            </div>
          </article>
        </template>
      </div>
    </section>

    <footer data-testid="chat-composer" class="composer-panel">
      <div class="composer-inner">
        <div class="composer-shell">
          <span class="composer-prefix">Agent</span>
          <textarea
            ref="composerRef"
            v-model="userInput"
            class="chat-input composer-input"
            rows="1"
            :placeholder="inputPlaceholder"
            @keydown="handleInputKeydown"
          ></textarea>
          <button class="send-btn" :disabled="!userInput.trim() || release.agentRunning" @click="handleSendMessage">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>

        <div class="composer-hint-row">
          <span class="input-hint">Enter 发送，Shift + Enter 换行</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 96%, transparent), color-mix(in srgb, var(--bg-primary) 98%, transparent));
}

.chat-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 82%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar-right {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.stop-btn {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--error-border);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  color: var(--error);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.stop-btn:hover {
  background: color-mix(in srgb, var(--error) 16%, transparent);
  border-color: color-mix(in srgb, var(--error) 60%, var(--error-border));
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.icon-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--glass-bg) 90%, transparent);
  border-color: color-mix(in srgb, var(--glass-border) 90%, transparent);
}

.agent-mark {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, transparent);
}

.agent-mark-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-primary);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent-primary) 56%, transparent);
}

.topbar-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.chat-subtitle {
  font-size: 11px;
  color: var(--text-tertiary);
}

.chat-version,
.session-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
}

.chat-version {
  font-family: var(--font-mono);
  color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent-primary) 20%, transparent);
}

.session-badge.tone-info {
  color: var(--accent-secondary);
  background: color-mix(in srgb, var(--accent-secondary) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent-secondary) 22%, transparent);
}

.session-badge.tone-success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: var(--success-border);
}

.session-badge.tone-warning {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-color: var(--warning-border);
}

.session-badge.tone-error {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 12%, transparent);
  border-color: var(--error-border);
}

.session-badge.tone-muted {
  color: var(--text-tertiary);
  background: color-mix(in srgb, var(--glass-bg) 84%, transparent);
  border-color: color-mix(in srgb, var(--glass-border) 82%, transparent);
}

.chat-timeline {
  flex: 1;
  overflow-y: auto;
  padding: 18px 0 136px;
}

.timeline-inner {
  width: min(900px, calc(100% - 32px));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.timeline-empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 28px 8px 4px;
}

.empty-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-primary);
}

.empty-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.empty-subtitle {
  margin: 0;
  max-width: 620px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.empty-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 6px;
}

.empty-action-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 90%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.empty-action-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-primary) 24%, var(--glass-border));
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
}

.empty-action-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.empty-action-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

.timeline-entry {
  display: flex;
  gap: 14px;
  animation: msg-in 0.18s ease-out;
}

.entry-rail {
  display: flex;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
  position: relative;
}

.entry-rail::after {
  content: '';
  position: absolute;
  top: 14px;
  bottom: -18px;
  width: 1px;
  background: color-mix(in srgb, var(--glass-border) 72%, transparent);
}

.timeline-entry:last-child .entry-rail::after {
  display: none;
}

.entry-node {
  margin-top: 6px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-tertiary) 45%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-border) 84%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bg-primary) 94%, transparent);
}

.entry-node.tone-info {
  background: var(--accent-secondary);
}

.entry-node.tone-success {
  background: var(--success);
}

.entry-node.tone-warning {
  background: var(--warning);
}

.entry-node.tone-error {
  background: var(--error);
}

.entry-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.entry-author {
  font-weight: 700;
  color: var(--text-secondary);
}

.entry-separator {
  opacity: 0.55;
}

.user-entry {
  justify-content: flex-end;
  margin-left: 28px;
}

.user-main {
  max-width: min(680px, 100%);
  align-items: flex-end;
}

.user-meta .entry-author {
  color: var(--text-tertiary);
}

.user-inline {
  width: fit-content;
  max-width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.message-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.message-block {
  min-width: 0;
  max-width: 100%;
}

.markdown-block {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.72;
  overflow-wrap: break-word;
}

.tool-card,
.code-block,
.json-block {
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 92%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 4%, transparent);
  overflow: hidden;
}

.tool-card {
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}

.activity-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.activity-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.activity-badge.kind-tool {
  color: var(--accent-secondary);
  background: color-mix(in srgb, var(--accent-secondary) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent-secondary) 26%, transparent);
}

.activity-badge.kind-skill {
  color: #8b5cf6;
  background: color-mix(in srgb, #8b5cf6 14%, transparent);
  border-color: color-mix(in srgb, #8b5cf6 26%, transparent);
}

.activity-name {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.tool-card.tone-info {
  border-color: color-mix(in srgb, var(--accent-secondary) 20%, var(--glass-border));
}

.tool-card.tone-success {
  border-color: var(--success-border);
}

.tool-card.tone-error {
  border-color: var(--error-border);
}

.tool-card.tone-warning {
  border-color: var(--warning-border);
}

.tool-card.skill-card {
  background: color-mix(in srgb, #8b5cf6 8%, var(--bg-secondary));
  border-color: color-mix(in srgb, #8b5cf6 24%, var(--glass-border));
}

.tool-card.tool-card {
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
}

.tool-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.compact-tool-line {
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.tool-details {
  margin-top: 10px;
}

.tool-details summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-tertiary);
}

.tool-json,
.json-surface,
.code-surface,
.reasoning-text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.68;
  overflow: auto;
}

.tool-json,
.reasoning-text {
  margin-top: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 84%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
  color: var(--text-secondary);
}

.code-toolbar,
.json-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 86%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 46%, var(--bg-secondary));
}

.code-language,
.json-label {
  font-size: 11px;
  font-family: var(--font-mono);
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.block-copy-btn {
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--glass-border) 84%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.block-copy-btn:hover {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--glass-border-strong) 88%, transparent);
  background: color-mix(in srgb, var(--glass-bg) 90%, transparent);
}

.code-surface,
.json-surface {
  padding: 14px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-primary) 44%, var(--bg-secondary));
}

.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-btn {
  min-height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 86%, transparent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn.variant-primary {
  color: #fff;
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.action-btn.variant-secondary {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
}

.action-btn.variant-ghost {
  color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent-primary) 18%, transparent);
}

.action-btn.variant-danger {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  border-color: var(--error-border);
}

.action-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--glass-border-strong) 92%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
}

.action-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.reasoning-block {
  margin-bottom: 2px;
}

.reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 84%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
}

.thinking-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-primary);
  animation: thinking-bounce 1.2s ease-in-out infinite;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.3s;
}

.thinking-label {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.composer-panel {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  background:
    linear-gradient(to top, color-mix(in srgb, var(--bg-secondary) 98%, transparent), color-mix(in srgb, var(--bg-secondary) 72%, transparent), transparent);
}

.composer-inner {
  width: min(900px, calc(100% - 8px));
  margin: 0 auto;
}

.composer-shell {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--glass-border) 92%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
  box-shadow: 0 12px 30px color-mix(in srgb, black 12%, transparent);
}

.composer-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent-primary) 24%, var(--glass-border));
  box-shadow:
    0 12px 30px color-mix(in srgb, black 12%, transparent),
    0 0 0 3px color-mix(in srgb, var(--accent-primary) 12%, transparent);
}

.composer-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 64%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--glass-border) 82%, transparent);
  color: var(--text-tertiary);
  font-size: 11px;
  font-family: var(--font-mono);
}

.chat-input {
  flex: 1;
  min-height: 36px;
  max-height: 180px;
  padding: 6px 0;
  resize: none;
  overflow-y: auto;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 24px;
  box-sizing: border-box;
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.chat-input:focus-visible {
  box-shadow: none;
}

.send-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  color: #fff;
  background: var(--accent-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
}

.send-btn:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}

.composer-hint-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
}

.input-hint {
  font-size: 10px;
  color: var(--text-tertiary);
}

.chat-panel :deep(p),
.chat-panel :deep(ul),
.chat-panel :deep(ol),
.chat-panel :deep(blockquote),
.chat-panel :deep(pre) {
  margin: 0;
}

.chat-panel :deep(ul),
.chat-panel :deep(ol) {
  padding-left: 18px;
}

.chat-panel :deep(blockquote) {
  padding-left: 12px;
  border-left: 2px solid var(--glass-border);
  color: var(--text-secondary);
}

.chat-panel :deep(code) {
  font-family: var(--font-mono);
}

.chat-panel :deep(.hljs-keyword),
.chat-panel :deep(.hljs-built_in),
.chat-panel :deep(.hljs-selector-tag) {
  color: #8b5cf6;
}

.chat-panel :deep(.hljs-string),
.chat-panel :deep(.hljs-attr) {
  color: #16a34a;
}

.chat-panel :deep(.hljs-number),
.chat-panel :deep(.hljs-literal) {
  color: #dc2626;
}

.chat-panel :deep(.hljs-title),
.chat-panel :deep(.hljs-function) {
  color: #2563eb;
}

@media (max-width: 960px) {
  .timeline-inner,
  .composer-inner {
    width: min(100%, calc(100% - 16px));
  }

  .empty-grid {
    grid-template-columns: 1fr;
  }

  .user-entry {
    margin-left: 0;
  }

  .chat-topbar {
    padding: 12px;
  }

  .chat-timeline {
    padding-bottom: 128px;
  }
}

@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes thinking-bounce {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: scale(0.82);
  }
  30% {
    opacity: 1;
    transform: scale(1.08);
  }
}
</style>
