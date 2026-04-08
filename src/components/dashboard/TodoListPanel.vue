<script setup>
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useJiraStore } from '../../stores/jira'
import { useGithubStore } from '../../stores/github'

const jira = useJiraStore()
const github = useGithubStore()

// =========================
// Storage (personal todos)
// =========================
const TODOS_STORAGE_KEY = 'flow-desk-todos'
const myTodos = ref([])
const newTodo = ref({ title: '', description: '' })
const adding = ref(false)

const loadMyTodos = () => {
  try {
    const raw = localStorage.getItem(TODOS_STORAGE_KEY)
    myTodos.value = raw ? JSON.parse(raw) : []
  } catch {
    myTodos.value = []
  }
}

const saveMyTodos = () => {
  try {
    localStorage.setItem(TODOS_STORAGE_KEY, JSON.stringify(myTodos.value))
  } catch { /* ignore */ }
}

const addMyTodo = () => {
  const title = (newTodo.value.title || '').trim()
  const description = (newTodo.value.description || '').trim()
  if (!title) return
  myTodos.value.unshift({
    id: Date.now(),
    title,
    description,
    done: false,
    createdAt: new Date().toISOString()
  })
  newTodo.value = { title: '', description: '' }
  adding.value = false
  saveMyTodos()
}

const toggleMyTodo = (id) => {
  const idx = myTodos.value.findIndex(t => t.id === id)
  if (idx === -1) return
  myTodos.value[idx].done = !myTodos.value[idx].done
  saveMyTodos()
}

const deleteMyTodo = (id) => {
  myTodos.value = myTodos.value.filter(t => t.id !== id)
  saveMyTodos()
}

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return date.toLocaleDateString('zh-CN')
}

const openUrl = (url) => {
  if (!url) return
  invoke('open_url_raw', { url })
}

const refreshAll = async () => {
  github.reset()
  const tasks = [github.fetchPrTodos()]
  if (jira.isConfigured && jira.issues.length === 0) {
    tasks.push(jira.fetchIssues())
  }
  await Promise.all(tasks)
}

onMounted(async () => {
  loadMyTodos()
  if (myTodos.value.length === 0) {
    myTodos.value = [
      { id: Date.now(), title: '整理今天的优先级', description: '先看 Jira 截止提醒 + PR 待办', done: false, createdAt: new Date().toISOString() }
    ]
    saveMyTodos()
  }
  await refreshAll()
})
</script>

<template>
  <div class="panel todo-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="panel-icon">✅</span>
        <span>Todo</span>
      </div>
      <div class="panel-actions">
        <button class="panel-action" title="刷新 PR / Jira" @click="refreshAll" :disabled="github.prLoading || jira.loading">🔄</button>
        <button class="panel-action add-btn" :title="adding ? '取消' : '新增 todo'" @click="adding = !adding">{{ adding ? '✕' : '＋' }}</button>
      </div>
    </div>

    <div class="panel-content">
      <!-- Add personal todo -->
      <div v-if="adding" class="add-form">
        <input v-model="newTodo.title" class="text-input" placeholder="Todo 标题（必填）" />
        <textarea v-model="newTodo.description" class="text-area" placeholder="描述（可选）" rows="2" />
        <div class="form-actions">
          <span class="hint">⌘ + Enter 保存</span>
          <button class="save-btn" @click="addMyTodo">保存</button>
        </div>
      </div>

      <!-- PR todos -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">PR 待办</span>
          <span v-if="github.prLoading" class="mini-muted">加载中...</span>
          <span v-else class="mini-muted">{{ github.prTodos.length }} 项</span>
        </div>
        <div v-if="github.prError" class="inline-error">{{ github.prError }}</div>
        <div v-else-if="!github.prLoading && github.prTodos.length === 0" class="empty-row">暂无相关 PR</div>
        <div v-else class="todo-list">
          <div v-for="t in github.prTodos" :key="t.id" class="todo-item readonly">
            <div class="todo-main">
              <button class="todo-title link" @click="openUrl(t.url)">{{ t.title }}</button>
              <div class="todo-desc">{{ t.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Jira reminders -->
      <div class="section jira-section" :class="{ 'has-urgent': jira.upcomingDeadlines.some(t => t.urgency === 'overdue' || t.urgency === 'today') }">
        <div class="section-header">
          <span class="section-title">
            <span v-if="jira.upcomingDeadlines.some(t => t.urgency === 'overdue')" class="alert-icon pulse">🚨</span>
            <span v-else-if="jira.upcomingDeadlines.some(t => t.urgency === 'today')" class="alert-icon">⚠️</span>
            Jira 提醒
          </span>
          <span v-if="jira.loading" class="mini-muted">加载中...</span>
          <span v-else-if="jira.upcomingDeadlines.length > 0" class="urgency-badge" :class="jira.upcomingDeadlines[0]?.urgency">{{ jira.upcomingDeadlines.length }} 项</span>
          <span v-else class="mini-muted">{{ jira.upcomingDeadlines.length }} 项</span>
        </div>
        <div v-if="jira.error" class="inline-error">{{ jira.error }}</div>
        <div v-else-if="!jira.loading && jira.upcomingDeadlines.length === 0" class="empty-row">暂无 3 天内截止/逾期任务</div>
        <div v-else class="todo-list">
          <div v-for="t in jira.upcomingDeadlines" :key="t.id" class="todo-item readonly" :class="['urgency-' + t.urgency]">
            <div class="urgency-indicator" :class="t.urgency"></div>
            <div class="todo-main">
              <button class="todo-title link" :class="t.urgency" @click="openUrl(t.url)">{{ t.title }}</button>
              <div class="todo-desc" :class="t.urgency">{{ t.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- My todos -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">我的 Todo</span>
          <span class="mini-muted">{{ myTodos.length }} 项</span>
        </div>
        <div v-if="myTodos.length === 0" class="empty-row">暂无 todo，点右上角 + 添加</div>
        <div v-else class="todo-list">
          <div v-for="t in myTodos" :key="t.id" class="todo-item" :class="{ done: t.done }">
            <label class="checkbox">
              <input type="checkbox" :checked="t.done" @change="toggleMyTodo(t.id)" />
              <span class="checkmark"></span>
            </label>
            <div class="todo-main">
              <div class="todo-title">{{ t.title }}</div>
              <div v-if="t.description" class="todo-desc">{{ t.description }}</div>
              <div class="todo-meta">{{ formatTime(t.createdAt) }}</div>
            </div>
            <button class="icon-btn" title="删除" @click="deleteMyTodo(t.id)">✕</button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-footer">
      <span class="footer-text">PR {{ github.prTodos.length }} · Jira {{ jira.upcomingDeadlines.length }} · 我的 {{ myTodos.length }}</span>
      <span class="footer-hint">本地存储</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-glass);
  transition: background 0.3s ease, border-color 0.3s ease;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.panel-icon { font-size: 18px; }

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-action {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
  color: var(--text-secondary);
}

.panel-action:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
  color: var(--text-primary);
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.add-btn { color: var(--success); }

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.add-form {
  margin-bottom: 14px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}

.text-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
  margin-bottom: 10px;
}

.text-input:focus { border-color: var(--accent-primary); }

.text-area {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
  resize: vertical;
}

.text-area:focus { border-color: var(--accent-primary); }

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.save-btn {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: white;
  background: var(--success);
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.save-btn:hover { filter: brightness(1.04); }

.section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--glass-border);
}

.section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-primary);
}

.mini-muted {
  font-size: 11px;
  color: var(--text-tertiary);
}

.inline-error {
  font-size: 12px;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.22);
  padding: 10px 12px;
  border-radius: 12px;
}

.empty-row {
  padding: 10px 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.todo-item {
  display: flex;
  gap: 10px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

/* 紧急程度指示条 */
.urgency-indicator {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 12px 0 0 12px;
}

.urgency-indicator.overdue {
  background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);
}

.urgency-indicator.today {
  background: linear-gradient(180deg, #f97316 0%, #ea580c 100%);
  box-shadow: 0 0 10px rgba(249, 115, 22, 0.5);
}

.urgency-indicator.urgent {
  background: linear-gradient(180deg, #fb923c 0%, #f97316 100%);
  box-shadow: 0 0 8px rgba(251, 146, 60, 0.4);
}

.urgency-indicator.warning {
  background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.35);
}

/* 已逾期 - 红色危险样式 */
.todo-item.urgency-overdue {
  border-color: rgba(239, 68, 68, 0.5);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.08) 100%);
  animation: urgentPulse 2s ease-in-out infinite;
}

/* 今天截止 - 红橙色紧急样式 */
.todo-item.urgency-today {
  border-color: rgba(249, 115, 22, 0.5);
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.14) 0%, rgba(234, 88, 12, 0.08) 100%);
  animation: urgentPulse 3s ease-in-out infinite;
}

/* 明天截止 - 橙色紧急样式 */
.todo-item.urgency-urgent {
  border-color: rgba(251, 146, 60, 0.45);
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.12) 0%, rgba(249, 115, 22, 0.06) 100%);
}

/* 3天内 - 黄橙色警告样式 */
.todo-item.urgency-warning {
  border-color: rgba(251, 191, 36, 0.4);
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%);
}

@keyframes urgentPulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
  50% {
    box-shadow: 0 0 12px 2px rgba(239, 68, 68, 0.25);
  }
}

.todo-item.readonly {
  padding-left: 18px;
}

.todo-item.done {
  opacity: 0.7;
}

/* Jira section 样式 */
.jira-section.has-urgent .section-title {
  color: #ef4444;
  font-weight: 800;
}

.alert-icon {
  margin-right: 4px;
}

.alert-icon.pulse {
  animation: iconPulse 1.5s ease-in-out infinite;
}

@keyframes iconPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

/* 紧急程度徽章 */
.urgency-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
}

.urgency-badge.overdue {
  color: #fff;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  animation: badgePulse 2s ease-in-out infinite;
}

.urgency-badge.today {
  color: #fff;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
}

.urgency-badge.urgent {
  color: #fff;
  background: linear-gradient(135deg, #fb923c 0%, #f97316 100%);
}

.urgency-badge.warning {
  color: #92400e;
  background: linear-gradient(135deg, #fde047 0%, #fbbf24 100%);
}

@keyframes badgePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(239, 68, 68, 0.4); }
}

.todo-main {
  flex: 1;
  min-width: 0;
}

.todo-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-title.link {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: var(--accent-primary);
  max-width: 100%;
  display: block;
}

.todo-title.link:hover { text-decoration: underline; }

/* 紧急程度链接颜色 */
.todo-title.link.overdue {
  color: #dc2626;
  font-weight: 800;
}

.todo-title.link.today {
  color: #ea580c;
  font-weight: 700;
}

.todo-title.link.urgent {
  color: #d97706;
  font-weight: 600;
}

.todo-title.link.warning {
  color: #b45309;
}

.todo-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 紧急程度描述颜色 */
.todo-desc.overdue {
  color: #ef4444;
  font-weight: 600;
}

.todo-desc.today {
  color: #f97316;
  font-weight: 500;
}

.todo-desc.urgent {
  color: #fb923c;
}

.todo-desc.warning {
  color: #fbbf24;
}

.todo-meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.checkbox {
  position: relative;
  display: inline-flex;
  align-items: flex-start;
  padding-top: 2px;
}

.checkbox input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.checkmark {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  display: inline-block;
  position: relative;
}

.checkbox input:checked + .checkmark {
  background: var(--success-glow);
  border-color: var(--success);
}

.checkbox input:checked + .checkmark::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 6px;
  height: 10px;
  border: solid var(--success);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-tertiary);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.panel-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>

