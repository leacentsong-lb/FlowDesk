<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useJiraStore } from '../../stores/jira'

const emitEvent = defineEmits(['createBranch'])
const jira = useJiraStore()

const showConfig = ref(false)
const testingConnection = ref(false)
const connectionStatus = ref('')

const activeTab = ref('task')
const tabs = [
  { id: 'bug', label: 'Bug' },
  { id: 'task', label: 'Task' }
]

const displayIssues = computed(() => {
  return jira.groupedByType[activeTab.value] || []
})

const testConnection = async () => {
  testingConnection.value = true
  connectionStatus.value = ''
  const result = await jira.testProjectConnection()
  connectionStatus.value = result.success ? 'success' : 'error'
  if (!result.success) jira.error = result.error || '连接失败'
  testingConnection.value = false
}

const openGlobalSettings = () => {
  showConfig.value = false
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'jira' } }))
}

const cancelConfig = () => {
  showConfig.value = false
  connectionStatus.value = ''
}

const fetchIssues = () => {
  if (!jira.isConfigured) {
    showConfig.value = true
    return
  }
  jira.fetchIssues()
}

const getTypeConfig = (type) => {
  const configs = {
    'Bug': { icon: '🐛', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)', label: 'Bug' },
    'Task': { icon: '✅', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', label: 'Task' },
    'Story': { icon: '📖', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', label: 'Story' },
    'Epic': { icon: '⚡', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', label: 'Epic' },
    'Sub-task': { icon: '📎', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)', label: 'Sub' },
    'Subtask': { icon: '📎', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)', label: 'Sub' },
    'Improvement': { icon: '✨', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', label: 'Impr' }
  }
  return configs[type] || { icon: '📋', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)', label: type?.slice(0, 4) || 'Task' }
}

// 获取类型图标 (保留兼容)
const getTypeIcon = (type) => {
  return getTypeConfig(type).icon
}

// 计算截止日期状态（飞书风格倒计时）
const getDeadlineStatus = (dueDate) => {
  if (!dueDate) return null
  
  const now = new Date()
  const due = new Date(dueDate)
  const diffMs = due - now
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) {
    return { 
      text: `已逾期 ${Math.abs(diffDays)} 天`, 
      level: 'overdue', 
      color: '#dc2626',
      bg: 'rgba(220, 38, 38, 0.15)'
    }
  } else if (diffDays === 0) {
    return { 
      text: '今天截止', 
      level: 'danger', 
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.15)'
    }
  } else if (diffDays <= 3) {
    return { 
      text: `剩余 ${diffDays} 天`, 
      level: 'urgent', 
      color: '#f97316',
      bg: 'rgba(249, 115, 22, 0.15)'
    }
  } else if (diffDays <= 7) {
    return { 
      text: `剩余 ${diffDays} 天`, 
      level: 'warning', 
      color: '#eab308',
      bg: 'rgba(234, 179, 8, 0.15)'
    }
  } else {
    return { 
      text: `剩余 ${diffDays} 天`, 
      level: 'normal', 
      color: '#22c55e',
      bg: 'rgba(34, 197, 94, 0.15)'
    }
  }
}

// 获取状态样式
const getStatusClass = (status) => {
  const s = status?.toLowerCase() || ''
  if (s.includes('progress') || s.includes('进行')) return 'status-progress'
  if (s.includes('done') || s.includes('完成') || s.includes('closed')) return 'status-done'
  return 'status-todo'
}

// 是否为 Bug 类型
const isBug = (issue) => {
  return issue.type?.toLowerCase() === 'bug'
}

const handleCreateBranch = (issue) => {
  emitEvent('createBranch', {
    key: issue.key,
    summary: issue.summary,
    type: issue.type
  })
}

// 是否为 Story 类型
const isStory = (issue) => {
  return issue.type === 'Story'
}

const getHierarchyText = (issue) => {
  return issue.hierarchyText || issue.key
}

const triggeringWebhook = ref(new Set())

const showTestModal = ref(false)
const currentTestIssue = ref(null)
const testFormData = ref({
  branch: '',
  taskLink: '',
  remark: '无',
  config: '无',
  script: '无',
  assignee: ''
})

const openTestModal = (issue) => {
  currentTestIssue.value = issue
  testFormData.value = {
    branch: `epic/${issue.parent.key}`,
    taskLink: issue.url,
    remark: '无',
    config: '无',
    script: '无',
    assignee: issue.assignee ? issue.assignee.displayName : '未分配'
  }
  showTestModal.value = true
}

const closeTestModal = () => {
  showTestModal.value = false
  currentTestIssue.value = null
}

const sendTestNotification = async () => {
  const issue = currentTestIssue.value
  const webhookUrl = jira.config.teamsWebhook

  if (!webhookUrl) {
    alert('⚠️ 请先配置 Teams Webhook URL')
    return
  }
  
  triggeringWebhook.value.add(issue.key)
  error.value = ''
  
  try {
    // 提测消息格式
    const message = {
      text: `**【提测】${issue.summary}**\n\n` +
            `【分支】：${testFormData.value.branch}\n\n` +
            `【任务】：${testFormData.value.taskLink}\n\n` +
            `【备注】：${testFormData.value.remark}\n\n` +
            `【配置】：${testFormData.value.config}\n\n` +
            `【脚本】：${testFormData.value.script}\n\n` +
            `【负责人】：${testFormData.value.assignee}`
    }
    
    const result = await invoke('http_post_json', {
      url: webhookUrl,
      body: JSON.stringify(message)
    })
    
    if (result.status >= 200 && result.status < 300) {
      alert(`✅ 提测通知已发送到 Teams\n任务: ${issue.key}`)
      closeTestModal()
    } else {
      throw new Error(`HTTP ${result.status}`)
    }
  } catch (e) {
    console.error('提测通知发送失败:', e)
    jira.error = `发送失败: ${e.message || e}`
    alert(`❌ 发送失败: ${e.message || e}`)
  } finally {
    triggeringWebhook.value.delete(issue.key)
  }
}

const triggerPowerAutomate = (issue) => {
  if (!issue.parent || issue.parent.type !== 'Epic') {
    alert('⚠️ 该 Story 没有关联 Epic，无法生成提测消息')
    return
  }
  if (!jira.config.teamsWebhook) {
    alert('⚠️ 请先配置 Teams Webhook URL')
    return
  }
  openTestModal(issue)
}

const openJiraLink = (issue) => {
  invoke('open_url_raw', { url: issue.url || `https://${jira.config.domain}/browse/${issue.key}` })
}

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return date.toLocaleDateString('zh-CN')
}

onMounted(() => {
  if (jira.isConfigured) {
    if (jira.issues.length === 0) jira.fetchIssues()
  } else {
    showConfig.value = true
  }
})
</script>

<template>
  <div class="panel jira-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="panel-icon">📋</span>
        <span>Jira Tasks</span>
        <span v-if="jira.stats.total" class="task-count">{{ jira.stats.total }}</span>
      </div>
      <div class="header-actions">
        <button class="panel-action" title="设置" @click="showConfig = true">⚙️</button>
        <button class="panel-action" title="刷新" @click="fetchIssues" :disabled="jira.loading">
          <span :class="{ spinning: jira.loading }">🔄</span>
        </button>
      </div>
    </div>
    
    <!-- 配置弹窗 (简化版 - 指向全局设置) -->
    <div v-if="showConfig" class="config-overlay">
      <div class="config-modal">
        <h3>Jira 配置</h3>
        
        <!-- 已配置状态 -->
        <div v-if="jira.isConfigured" class="config-status configured">
          <div class="status-icon">✅</div>
          <div class="status-info">
            <div class="status-title">已配置</div>
            <div class="status-detail">
              <span class="config-label">域名:</span> {{ jira.config.domain }}
            </div>
            <div class="status-detail">
              <span class="config-label">邮箱:</span> {{ jira.config.email }}
            </div>
            <div class="status-detail">
              <span class="config-label">项目:</span> {{ jira.config.project ? jira.config.project.split('\n').join(', ') : '全部项目' }}
            </div>
          </div>
        </div>
        
        <!-- 未配置状态 -->
        <div v-else class="config-status not-configured">
          <div class="status-icon">⚠️</div>
          <div class="status-info">
            <div class="status-title">未配置</div>
            <div class="status-message">请在全局设置中配置 Jira 连接信息</div>
          </div>
        </div>
        
        <div class="config-hint">
          <p>💡 Jira 配置和 Teams Webhook 已移至全局设置</p>
        </div>
        
        <div v-if="jira.isConfigured" class="connection-test">
          <button 
            class="test-btn" 
            @click="testConnection" 
            :disabled="testingConnection"
          >
            <span v-if="testingConnection" class="mini-spinner"></span>
            <span v-else>🔗</span>
            {{ testingConnection ? '测试中...' : '测试连接' }}
          </button>
          <span v-if="connectionStatus === 'success'" class="connection-success">✅ 连接成功</span>
          <span v-else-if="connectionStatus === 'error'" class="connection-error">❌ 连接失败</span>
        </div>
        
        <div v-if="jira.error && showConfig" class="config-error">
          {{ jira.error }}
        </div>
        
        <div class="config-actions">
          <button class="btn-secondary" @click="cancelConfig">关闭</button>
          <button class="btn-primary" @click="openGlobalSettings">
            ⚙️ 去设置
          </button>
        </div>
      </div>
    </div>
    
    <div class="panel-content">
      <div v-if="jira.error" class="error-message">
        {{ jira.error }}
      </div>
      
      <!-- 标签栏 -->
      <div class="task-filters">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          class="filter-btn" 
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <span class="filter-count">
            {{ tab.id === 'bug' ? jira.typeStats.bug : jira.typeStats.task }}
          </span>
        </button>
      </div>
      
      <div v-if="jira.loading" class="loading-state">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>
      
      <!-- 任务列表 -->
      <div v-else-if="displayIssues.length > 0" class="task-list">
        <div 
          v-for="issue in displayIssues" 
          :key="issue.id" 
          class="task-card"
          :class="{ 
            'is-bug': isBug(issue),
            'is-epic': issue.type === 'Epic',
            'has-parent': issue.parent
          }"
        >
          <div class="task-header">
            <!-- 类型标签 -->
            <span 
              class="task-type-tag" 
              :style="{ 
                color: getTypeConfig(issue.type).color, 
                background: getTypeConfig(issue.type).bg 
              }"
              :title="issue.type"
            >
              {{ getTypeConfig(issue.type).icon }} {{ getTypeConfig(issue.type).label }}
            </span>
            <span class="task-key" @click="openJiraLink(issue)">{{ issue.key }}</span>
            <span class="task-status" :class="getStatusClass(issue.status)">{{ issue.status }}</span>
          </div>
          <div class="task-hierarchy" @click="openJiraLink(issue)">{{ getHierarchyText(issue) }}</div>
          <div class="task-title" @click="openJiraLink(issue)">{{ issue.summary }}</div>
          <div class="task-meta">
            <span class="task-project">{{ issue.project }}</span>
            <span class="task-time">{{ formatTime(issue.updated) }}</span>
          </div>
          
          <!-- 截止日期倒计时 -->
          <div 
            v-if="issue.dueDate" 
            class="task-deadline" 
            :class="getDeadlineStatus(issue.dueDate)?.level"
            :style="{ 
              color: getDeadlineStatus(issue.dueDate)?.color,
              background: getDeadlineStatus(issue.dueDate)?.bg 
            }"
          >
            <span class="deadline-icon">⏰</span>
            <span class="deadline-text">{{ getDeadlineStatus(issue.dueDate)?.text }}</span>
          </div>
          
          <!-- Bug 类型显示创建分支按钮 -->
          <div v-if="isBug(issue)" class="task-actions">
            <button class="create-branch-btn" @click="handleCreateBranch(issue)">
              🔀 创建分支
            </button>
          </div>
          
          <!-- Story 类型显示提测按钮 -->
          <div v-if="isStory(issue)" class="task-actions">
            <button 
              class="trigger-webhook-btn" 
              :class="{ 'is-loading': triggeringWebhook.has(issue.key) }"
              :disabled="triggeringWebhook.has(issue.key) || !jira.config.teamsWebhook || !issue.parent || issue.parent.type !== 'Epic'"
              @click="triggerPowerAutomate(issue)"
              :title="!jira.config.teamsWebhook ? '请先配置 Webhook URL' : (!issue.parent || issue.parent.type !== 'Epic') ? '该 Story 未关联 Epic，无法提测' : '发送提测通知到 Teams'"
            >
              <span v-if="triggeringWebhook.has(issue.key)">⏳ 提测中...</span>
              <span v-else>🚀 提测</span>
            </button>
          </div>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <div class="empty-icon">📋</div>
        <p v-if="jira.isConfigured">暂无任务</p>
        <p v-else>请先配置 Jira 账号</p>
      </div>
    </div>
    
    <div class="panel-footer">
      <span class="footer-text">{{ jira.config.domain }}</span>
      <span v-if="jira.stats.total" class="progress-badge">
        {{ activeTab === 'task' ? jira.typeStats.task : jira.typeStats.bug }}
        {{ activeTab === 'task' ? 'Task' : 'Bug' }}
      </span>
    </div>
  </div>
  
  <!-- 提测编辑弹窗 -->
  <div v-if="showTestModal" class="test-modal-overlay" @click.self="closeTestModal">
    <div class="test-modal">
      <div class="test-modal-header">
        <h3>📝 编辑提测信息</h3>
        <button class="modal-close-btn" @click="closeTestModal">✕</button>
      </div>
      
      <div class="test-modal-body">
        <div v-if="currentTestIssue" class="test-issue-info">
          <div class="issue-title">
            <span class="issue-key">{{ currentTestIssue.key }}</span>
            <span class="issue-summary">{{ currentTestIssue.summary }}</span>
          </div>
        </div>
        
        <div class="test-form">
          <div class="form-group">
            <label class="form-label">
              <span class="label-text">分支</span>
              <span class="label-required">*</span>
            </label>
            <input 
              type="text" 
              v-model="testFormData.branch" 
              class="form-input"
              placeholder="epic/CRMCN-xxxx"
            />
          </div>
          
          <div class="form-group">
            <label class="form-label">
              <span class="label-text">任务链接</span>
              <span class="label-required">*</span>
            </label>
            <input 
              type="text" 
              v-model="testFormData.taskLink" 
              class="form-input"
              placeholder="https://..."
            />
          </div>
          
          <div class="form-group">
            <label class="form-label">备注</label>
            <textarea 
              v-model="testFormData.remark" 
              class="form-textarea"
              rows="3"
              placeholder="无"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">配置</label>
            <textarea 
              v-model="testFormData.config" 
              class="form-textarea"
              rows="3"
              placeholder="无"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">脚本</label>
            <textarea 
              v-model="testFormData.script" 
              class="form-textarea"
              rows="3"
              placeholder="无"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">负责人</label>
            <input 
              type="text" 
              v-model="testFormData.assignee" 
              class="form-input"
              placeholder="未分配"
            />
          </div>
        </div>
      </div>
      
      <div class="test-modal-footer">
        <button class="btn-cancel" @click="closeTestModal">取消</button>
        <button 
          class="btn-confirm" 
          @click="sendTestNotification"
          :disabled="triggeringWebhook.has(currentTestIssue?.key)"
        >
          <span v-if="triggeringWebhook.has(currentTestIssue?.key)">⏳ 发送中...</span>
          <span v-else>✅ 确认提测</span>
        </button>
      </div>
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
  transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
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
  font-weight: 600;
  color: var(--text-primary);
}

.panel-icon {
  font-size: 18px;
}

.task-count {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  border-radius: 10px;
}

.header-actions {
  display: flex;
  gap: 6px;
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
}

.panel-action:hover {
  background: var(--glass-bg-hover);
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Config Modal */
.config-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.config-modal {
  width: 90%;
  max-width: 320px;
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}

.config-modal h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px 0;
}

/* Config Status */
.config-status {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.config-status.configured {
  background: var(--success-bg);
  border: 1px solid var(--success-border);
}

.config-status.not-configured {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
}

.config-status .status-icon {
  font-size: 24px;
}

.config-status .status-info {
  flex: 1;
}

.config-status .status-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.config-status .status-detail {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.config-status .config-label {
  color: var(--text-tertiary);
}

.config-status .status-message {
  font-size: 12px;
  color: var(--text-secondary);
}

.config-hint {
  padding: 12px;
  background: var(--glass-bg);
  border-radius: var(--radius-sm);
  margin-bottom: 16px;
}

.config-hint p {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
}

.form-group input:focus {
  border-color: var(--accent-warm);
}

.help-link {
  font-size: 11px;
  color: var(--accent-warm);
  text-decoration: none;
}

.help-link:hover {
  text-decoration: underline;
}

.hint-text {
  font-size: 10px;
  color: var(--text-tertiary);
}

.connection-test {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--glass-bg);
  border-radius: 8px;
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-warm);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.connection-success {
  font-size: 12px;
  color: var(--success);
}

.connection-error {
  font-size: 12px;
  color: var(--error);
}

.config-error {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--error);
  background: var(--error-glow);
  border: 1px solid var(--error);
  border-radius: 6px;
  word-break: break-word;
}

.config-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.btn-primary,
.btn-secondary {
  flex: 1;
  padding: 10px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  color: #fff;
  background: var(--accent-primary);
  border: none;
  box-shadow: var(--shadow-button);
}

.btn-primary:hover {
  filter: brightness(1.1);
  box-shadow: var(--shadow-button-hover);
}

.btn-secondary {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.btn-secondary:hover {
  background: var(--glass-bg-hover);
}

/* Filters */
.task-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-secondary);
}

.filter-btn.active {
  background: var(--accent-warm-glow);
  border-color: var(--accent-warm);
  color: var(--accent-warm);
}

.filter-count {
  padding: 1px 5px;
  font-size: 10px;
  background: var(--glass-bg);
  border-radius: 4px;
}

.filter-btn.active .filter-count {
  background: var(--accent-warm-glow);
}

/* Error */
.error-message {
  padding: 10px 14px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--error);
  background: var(--error-glow);
  border: 1px solid var(--error);
  border-radius: 8px;
}

/* Loading */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-warm);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Task List */
.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-card {
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  transition: all 0.2s ease;
}

.task-card:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-strong);
}

.task-card.is-bug {
  border-left: 3px solid var(--error);
}

.task-card.is-epic {
  border-left: 3px solid var(--accent-warm);
  background: var(--accent-warm-glow);
}

.task-card.has-parent {
  padding-top: 8px;
}

/* 父任务/Epic 信息 */
.task-parent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin: -8px -14px 10px -14px;
  background: var(--accent-warm-glow);
  border-bottom: 1px solid var(--accent-warm);
  font-size: 11px;
}

.parent-icon {
  font-size: 12px;
}

.parent-key {
  color: var(--accent-warm);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
}

.parent-summary {
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

/* 类型标签 */
.task-type-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  white-space: nowrap;
}

.task-key {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--accent-warm);
  cursor: pointer;
  transition: color 0.2s;
}

.task-key:hover {
  color: var(--accent-warm-light);
  text-decoration: underline;
}

.task-status {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 500;
  border-radius: 4px;
}

.status-progress {
  color: var(--accent-secondary);
  background: var(--accent-secondary-glow);
}

.status-todo {
  color: var(--text-tertiary);
  background: var(--glass-bg);
}

.status-done {
  color: var(--success);
  background: var(--success-glow);
}

.task-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 10px;
  cursor: pointer;
}

.task-title:hover {
  color: var(--accent-primary);
}

.task-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-tertiary);
}

.task-project {
  padding: 2px 6px;
  background: var(--glass-bg);
  border-radius: 4px;
}

/* 截止日期倒计时 */
.task-deadline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  margin-top: 10px;
}

.task-deadline.overdue {
  animation: pulse-overdue 1.5s ease-in-out infinite;
}

.task-deadline.danger {
  animation: pulse-danger 2s ease-in-out infinite;
}

@keyframes pulse-overdue {
  0%, 100% { 
    opacity: 1; 
    transform: scale(1);
  }
  50% { 
    opacity: 0.7; 
    transform: scale(1.02);
  }
}

@keyframes pulse-danger {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.deadline-icon {
  font-size: 12px;
}

.deadline-text {
  letter-spacing: 0.3px;
}

.task-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);
}

.create-branch-btn {
  width: 100%;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--success);
  background: var(--success-glow);
  border: 1px solid var(--success);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.create-branch-btn:hover {
  filter: brightness(1.1);
}

/* Trigger Webhook Button (Story) */
.trigger-webhook-btn {
  width: 100%;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-warm);
  background: var(--accent-warm-glow);
  border: 1px solid var(--accent-warm);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.trigger-webhook-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.trigger-webhook-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.trigger-webhook-btn.is-loading {
  opacity: 0.7;
}

/* Webhook Config */
.webhook-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--accent-warm);
  border-radius: 8px;
}

.webhook-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-warm);
}

.webhook-input {
  padding: 8px 12px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-primary);
  background: var(--bg-gradient-start);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.2s;
}

.webhook-input:focus {
  border-color: var(--accent-warm);
}

.webhook-input::placeholder {
  color: var(--text-tertiary);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent-warm);
  background: transparent;
  border: 1px solid var(--accent-warm);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-sm:hover:not(:disabled) {
  background: var(--accent-warm-glow);
}

.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* Footer */
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--glass-bg);
  border-top: 1px solid var(--glass-border);
}

.footer-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

.progress-badge {
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 500;
  color: var(--accent-secondary);
  background: var(--accent-secondary-glow);
  border-radius: 4px;
}

/* 提测编辑弹窗 */
.test-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.test-modal {
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border-strong);
  border-radius: 16px;
  overflow: hidden;
  animation: slideUp 0.3s ease;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.test-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg-hover);
}

.test-modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-close-btn:hover {
  background: var(--glass-border);
  color: var(--text-primary);
}

.test-modal-body {
  padding: 24px;
  max-height: calc(85vh - 160px);
  overflow-y: auto;
}

.test-issue-info {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--accent-secondary-glow);
  border: 1px solid var(--accent-secondary);
  border-radius: 8px;
}

.issue-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.issue-key {
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  color: var(--accent-secondary);
  background: var(--glass-bg);
  border-radius: 4px;
}

.issue-summary {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.test-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.label-text {
  color: var(--text-primary);
}

.label-required {
  color: var(--error);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-gradient-start);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  outline: none;
  transition: all 0.2s;
  resize: vertical;
}

.form-input:focus,
.form-textarea:focus {
  border-color: var(--accent-secondary);
  background: var(--glass-bg-hover);
}

.form-textarea {
  min-height: 80px;
  line-height: 1.5;
}

.test-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--glass-border);
  background: var(--glass-bg-hover);
}

.btn-cancel,
.btn-confirm {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--glass-border);
}

.btn-cancel:hover {
  background: var(--glass-bg);
  border-color: var(--glass-border-strong);
}

.btn-confirm {
  color: white;
  background: linear-gradient(135deg, var(--accent-secondary), var(--accent-primary));
  border: none;
  box-shadow: 0 4px 12px var(--accent-secondary-glow);
}

.btn-confirm:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px var(--accent-secondary-glow);
}

.btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
