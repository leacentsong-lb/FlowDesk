<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// =========================
// Storage (personal todos)
// =========================
const TODOS_STORAGE_KEY = 'dev-helper-todos'

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
  } catch {}
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

// =========================
// PR todos (read-only)
// =========================
const githubToken = ref(localStorage.getItem('github_token') || '')
const brokerPaths = ref(JSON.parse(localStorage.getItem('broker_project_paths') || '{}'))
const me = ref('')

const prTodos = ref([])
const prLoading = ref(false)
const prError = ref('')

const normalize = (s) => (s || '').toString().trim().toLowerCase()

const fetchCurrentUser = async () => {
  if (!githubToken.value) return ''
  try {
    const result = await invoke('github_get_current_user', { token: githubToken.value })
    if (result.status === 200) {
      const user = JSON.parse(result.body || '{}')
      return user.login || ''
    }
  } catch {}
  return ''
}

const parseOwnerRepo = (remoteInfo) => {
  const normalized = (remoteInfo || '').trim().replace(/\.git$/i, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return { owner: parts[0], repo: parts[1] }
}

const mapPrToTodo = (owner, repo, pr) => {
  const number = pr.number
  const title = pr.title || ''
  const base = pr.base?.ref || ''
  const head = pr.head?.ref || ''
  const updatedAt = pr.updated_at || pr.created_at || ''
  const url = pr.html_url || ''
  return {
    id: `${owner}/${repo}#${number}`,
    title: `[#${number}] ${title}`,
    description: `${owner}/${repo}: ${base} ← ${head} · 更新于 ${formatTime(updatedAt)}`,
    url
  }
}

const fetchPrTodos = async () => {
  prLoading.value = true
  prError.value = ''
  prTodos.value = []

  if (!githubToken.value) {
    prLoading.value = false
    prError.value = '请先在设置中配置 GitHub Token'
    return
  }

  try {
    if (!me.value) {
      me.value = await fetchCurrentUser()
    }
    const myLogin = normalize(me.value)
    if (!myLogin) {
      prError.value = '无法获取当前 GitHub 用户信息'
      prLoading.value = false
      return
    }

    const entries = Object.entries(brokerPaths.value || {})
    if (entries.length === 0) {
      prLoading.value = false
      prError.value = '未配置项目仓库（请在设置中配置 broker paths）'
      return
    }

    // limited concurrency
    const CONCURRENCY = 4
    let idx = 0
    const collected = []

    const worker = async () => {
      while (idx < entries.length) {
        const cur = entries[idx++]
        if (!cur) return
        const [, path] = cur
        try {
          const remoteInfo = await invoke('git_get_remote_info', { projectPath: path }).catch(() => '')
          const parsed = parseOwnerRepo(remoteInfo)
          if (!parsed) continue
          const { owner, repo } = parsed

          const res = await invoke('github_list_open_prs', { owner, repo, token: githubToken.value })
          if (res.status !== 200) continue
          const prs = JSON.parse(res.body || '[]') || []

          const relevant = prs.filter(pr => {
            const author = normalize(pr.user?.login)
            if (author === myLogin) return true
            const reviewers = (pr.requested_reviewers || []).map(r => normalize(r.login))
            return reviewers.includes(myLogin)
          })

          relevant.forEach(pr => collected.push(mapPrToTodo(owner, repo, pr)))
        } catch {
          // ignore a single repo failure
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()))

    // stable-ish: keep newest first by parsing time out of description is hard; keep as collected order
    prTodos.value = collected
  } catch (e) {
    prError.value = `获取 PR 待办失败: ${e?.message || e}`
  } finally {
    prLoading.value = false
  }
}

const openUrl = (url) => {
  if (!url) return
  invoke('open_url_raw', { url })
}

// =========================
// Jira reminders (read-only)
// =========================
const jiraTodos = ref([])
const jiraLoading = ref(false)
const jiraError = ref('')

const jiraConfig = ref({
  domain: localStorage.getItem('jira_domain') || 'thebidgroup.atlassian.net',
  email: localStorage.getItem('jira_email') || '',
  apiToken: localStorage.getItem('jira_token') || '',
  project: localStorage.getItem('jira_project') || ''
})

const isJiraConfigured = computed(() => !!jiraConfig.value.email && !!jiraConfig.value.apiToken && !!jiraConfig.value.domain)

const isDoneStatus = (status) => {
  const s = normalize(status)
  return s.includes('done') || s.includes('完成') || s.includes('closed') || s.includes('resolved')
}

const getDeadlineStatusText = (dueDate) => {
  if (!dueDate) return ''
  const now = new Date()
  const due = new Date(dueDate)
  const diffMs = due - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return `已逾期 ${Math.abs(diffDays)} 天`
  if (diffDays === 0) return '今天截止'
  return `剩余 ${diffDays} 天`
}

const isDueSoonOrOverdue = (dueDate) => {
  if (!dueDate) return false
  const now = new Date()
  const due = new Date(dueDate)
  const diffMs = due - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return diffDays <= 3 // includes overdue (negative)
}

const fetchJiraTodos = async () => {
  jiraLoading.value = true
  jiraError.value = ''
  jiraTodos.value = []

  if (!isJiraConfigured.value) {
    jiraLoading.value = false
    jiraError.value = '请先在设置中配置 Jira（邮箱 + Token）'
    return
  }

  try {
    const result = await invoke('jira_get_my_issues', {
      domain: jiraConfig.value.domain,
      email: jiraConfig.value.email,
      apiToken: jiraConfig.value.apiToken,
      project: jiraConfig.value.project
    })

    if (result.status !== 200) {
      jiraError.value = `获取 Jira 失败: HTTP ${result.status}`
      jiraLoading.value = false
      return
    }

    const data = JSON.parse(result.body || '{}')
    const issues = (data.issues || []).map(issue => {
      const fields = issue.fields || {}
      
      // 尝试获取"开发预计交付时间"自定义字段
      let devDueDate = null
      for (const key of Object.keys(fields)) {
        if (key.startsWith('customfield_') && fields[key]) {
          const val = fields[key]
          // 如果是日期格式字符串 (YYYY-MM-DD)
          if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
            if (!devDueDate) devDueDate = val
          }
        }
      }
      // 尝试常见的自定义字段名
      const specificDevDue = fields.customfield_10015 || fields.customfield_10016 || 
                             fields.customfield_10036 || fields.customfield_10037
      if (specificDevDue && typeof specificDevDue === 'string') {
        devDueDate = specificDevDue
      }
      
      return {
        key: issue.key,
        summary: fields.summary || '',
        status: fields.status?.name || '',
        type: fields.issuetype?.name || '',
        dueDate: fields.duedate || null,
        devDueDate: devDueDate
      }
    })

    // 收集提醒：优先使用开发预计交付时间，其次使用原生截止日期
    const reminders = issues
      .filter(i => {
        const effectiveDate = i.devDueDate || i.dueDate
        return effectiveDate && isDueSoonOrOverdue(effectiveDate)
      })
      .filter(i => !isDoneStatus(i.status))
      .map(i => {
        const effectiveDate = i.devDueDate || i.dueDate
        const isDevDue = !!i.devDueDate
        return {
          id: `jira-${i.key}`,
          title: `${i.key} ${i.summary}`,
          description: `${i.status} · ${isDevDue ? '开发交付' : '截止'}${getDeadlineStatusText(effectiveDate)}`,
          url: `https://${jiraConfig.value.domain}/browse/${i.key}`
        }
      })

    jiraTodos.value = reminders
  } catch (e) {
    jiraError.value = `获取 Jira 提醒失败: ${e?.message || e}`
  } finally {
    jiraLoading.value = false
  }
}

const refreshAll = async () => {
  githubToken.value = localStorage.getItem('github_token') || ''
  brokerPaths.value = JSON.parse(localStorage.getItem('broker_project_paths') || '{}')
  jiraConfig.value = {
    domain: localStorage.getItem('jira_domain') || 'thebidgroup.atlassian.net',
    email: localStorage.getItem('jira_email') || '',
    apiToken: localStorage.getItem('jira_token') || '',
    project: localStorage.getItem('jira_project') || ''
  }
  me.value = ''
  await Promise.all([fetchPrTodos(), fetchJiraTodos()])
}

onMounted(async () => {
  loadMyTodos()
  // seed default my todos if empty (simple, non-sensitive)
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
        <button class="panel-action" title="刷新 PR / Jira" @click="refreshAll" :disabled="prLoading || jiraLoading">🔄</button>
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
          <span v-if="prLoading" class="mini-muted">加载中...</span>
          <span v-else class="mini-muted">{{ prTodos.length }} 项</span>
        </div>
        <div v-if="prError" class="inline-error">{{ prError }}</div>
        <div v-else-if="!prLoading && prTodos.length === 0" class="empty-row">暂无相关 PR</div>
        <div v-else class="todo-list">
          <div v-for="t in prTodos" :key="t.id" class="todo-item readonly">
            <div class="todo-main">
              <button class="todo-title link" @click="openUrl(t.url)">{{ t.title }}</button>
              <div class="todo-desc">{{ t.description }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Jira reminders -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Jira 提醒</span>
          <span v-if="jiraLoading" class="mini-muted">加载中...</span>
          <span v-else class="mini-muted">{{ jiraTodos.length }} 项</span>
        </div>
        <div v-if="jiraError" class="inline-error">{{ jiraError }}</div>
        <div v-else-if="!jiraLoading && jiraTodos.length === 0" class="empty-row">暂无 3 天内截止/逾期任务</div>
        <div v-else class="todo-list">
          <div v-for="t in jiraTodos" :key="t.id" class="todo-item warning readonly">
            <div class="todo-main">
              <button class="todo-title link" @click="openUrl(t.url)">{{ t.title }}</button>
              <div class="todo-desc">{{ t.description }}</div>
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
      <span class="footer-text">PR {{ prTodos.length }} · Jira {{ jiraTodos.length }} · 我的 {{ myTodos.length }}</span>
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
}

.todo-item.warning {
  border-color: rgba(249, 115, 22, 0.35);
  background: rgba(249, 115, 22, 0.08);
}

.todo-item.readonly {
  padding-left: 14px;
}

.todo-item.done {
  opacity: 0.7;
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

