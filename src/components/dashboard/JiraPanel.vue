<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const emit = defineEmits(['createBranch'])

// Jira 配置
const jiraConfig = ref({
  domain: localStorage.getItem('jira_domain') || 'thebidgroup.atlassian.net',
  email: localStorage.getItem('jira_email') || '',
  apiToken: localStorage.getItem('jira_token') || '',
  project: localStorage.getItem('jira_project') || 'CRMCN',
  // Teams 提测 Webhook URL（用于 Story 提测通知）
  powerAutomateWebhook: localStorage.getItem('jira_power_automate_webhook') || ''
})

// 状态
const loading = ref(false)
const testingConnection = ref(false)
const connectionStatus = ref('') // 'success', 'error', ''
const error = ref('')
const issues = ref([])
const showConfig = ref(false)

// 状态筛选（默认选中"进行中"）
const activeFilter = ref('in_progress')
const filters = [
  { id: 'all', label: '全部' },
  { id: 'in_progress', label: '进行中' },
  { id: 'todo', label: '待办' },
  { id: 'done', label: '已完成' }
]

// 按状态分组 (In Dev 和 In Progress 合并为"进行中")
const groupedIssues = computed(() => {
  const groups = {
    in_progress: [],
    todo: [],
    done: [],
    other: []
  }
  
  issues.value.forEach(issue => {
    const statusName = issue.status?.toLowerCase() || ''
    // In Dev, In Progress, 进行中 都归为进行中
    if (statusName.includes('progress') || statusName.includes('进行') || statusName.includes('dev') || statusName.includes('review')) {
      groups.in_progress.push(issue)
    } else if (statusName.includes('to do') || statusName.includes('待办') || statusName.includes('open') || statusName.includes('backlog')) {
      groups.todo.push(issue)
    } else if (statusName.includes('done') || statusName.includes('完成') || statusName.includes('closed') || statusName.includes('resolved')) {
      groups.done.push(issue)
    } else {
      groups.other.push(issue)
    }
  })
  
  return groups
})

// 筛选后的任务
const filteredIssues = computed(() => {
  if (activeFilter.value === 'all') {
    return issues.value
  }
  return groupedIssues.value[activeFilter.value] || []
})

// 统计
const stats = computed(() => ({
  total: issues.value.length,
  inProgress: groupedIssues.value.in_progress.length,
  todo: groupedIssues.value.todo.length,
  done: groupedIssues.value.done.length
}))

// 是否已配置
const isConfigured = computed(() => {
  return jiraConfig.value.email && jiraConfig.value.apiToken
})

// 测试连接
const testConnection = async () => {
  testingConnection.value = true
  connectionStatus.value = ''
  error.value = ''
  
  try {
    const result = await invoke('jira_get_projects', {
      domain: jiraConfig.value.domain,
      email: jiraConfig.value.email,
      apiToken: jiraConfig.value.apiToken
    })
    
    if (result.status === 200) {
      connectionStatus.value = 'success'
    } else if (result.status === 401) {
      connectionStatus.value = 'error'
      error.value = '认证失败，请检查邮箱和 API Token'
    } else {
      connectionStatus.value = 'error'
      error.value = `连接失败: HTTP ${result.status} - ${result.body}`
    }
  } catch (e) {
    connectionStatus.value = 'error'
    error.value = `连接失败: ${e.message || e}`
  } finally {
    testingConnection.value = false
  }
}

// 获取任务
const fetchIssues = async () => {
  if (!isConfigured.value) {
    showConfig.value = true
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    const result = await invoke('jira_get_my_issues', {
      domain: jiraConfig.value.domain,
      email: jiraConfig.value.email,
      apiToken: jiraConfig.value.apiToken,
      project: jiraConfig.value.project
    })
    
    if (result.status === 200) {
      const data = JSON.parse(result.body)
      issues.value = (data.issues || []).map(issue => {
        const fields = issue.fields || {}
        
        // 尝试获取"开发预计交付时间"自定义字段
        // 常见的自定义字段名称可能是 customfield_10015, customfield_10016 等
        // 遍历所有 customfield_ 开头的字段，查找包含日期的字段
        let devDueDate = null
        for (const key of Object.keys(fields)) {
          if (key.startsWith('customfield_') && fields[key]) {
            const val = fields[key]
            // 如果是日期格式字符串 (YYYY-MM-DD)
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
              // 可能是开发预计交付时间，保存第一个找到的
              if (!devDueDate) devDueDate = val
            }
          }
        }
        
        // 优先使用特定的字段名（如果知道的话）
        // customfield_10015 是常见的 "Dev Due Date" 字段
        const specificDevDue = fields.customfield_10015 || fields.customfield_10016 || 
                               fields.customfield_10036 || fields.customfield_10037
        if (specificDevDue && typeof specificDevDue === 'string') {
          devDueDate = specificDevDue
        }
        
        return {
          id: issue.id,
          key: issue.key,
          summary: fields.summary || '',
          status: fields.status?.name || 'Unknown',
          statusCategory: fields.status?.statusCategory?.key || '',
          type: fields.issuetype?.name || 'Task',
          typeIcon: fields.issuetype?.iconUrl || '',
          priority: fields.priority?.name || 'Medium',
          priorityIcon: fields.priority?.iconUrl || '',
          project: fields.project?.key || '',
          projectName: fields.project?.name || '',
          created: fields.created,
          updated: fields.updated,
          // 截止日期 (Jira 原生 due date)
          dueDate: fields.duedate || null,
          // 开发预计交付时间 (自定义字段)
          devDueDate: devDueDate,
          // 父任务/Epic 信息
          parent: fields.parent ? {
            key: fields.parent.key,
            summary: fields.parent.fields?.summary || '',
            type: fields.parent.fields?.issuetype?.name || ''
          } : null,
          // 负责人信息
          assignee: fields.assignee ? {
            displayName: fields.assignee.displayName,
            email: fields.assignee.emailAddress,
            avatarUrl: fields.assignee.avatarUrls?.['48x48']
          } : null,
          // 任务链接
          url: `https://${jiraConfig.value.domain}/browse/${issue.key}`
        }
      })
    } else if (result.status === 401) {
      error.value = '认证失败，请检查邮箱和 API Token'
      showConfig.value = true
    } else {
      error.value = `获取失败: HTTP ${result.status} - ${result.body}`
    }
  } catch (e) {
    error.value = `请求失败: ${e.message || e}`
  } finally {
    loading.value = false
  }
}

// 打开全局设置
const openGlobalSettings = () => {
  showConfig.value = false
  // 触发全局事件打开设置抽屉，并切换到 Jira 标签
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'jira' } }))
}

// 保存配置 (保留兼容性，但主要使用全局设置)
const saveConfig = () => {
  localStorage.setItem('jira_domain', jiraConfig.value.domain)
  localStorage.setItem('jira_email', jiraConfig.value.email)
  localStorage.setItem('jira_token', jiraConfig.value.apiToken)
  localStorage.setItem('jira_project', jiraConfig.value.project)
  localStorage.setItem('jira_power_automate_webhook', jiraConfig.value.powerAutomateWebhook)
  showConfig.value = false
  connectionStatus.value = ''
  fetchIssues()
}

// 取消配置
const cancelConfig = () => {
  showConfig.value = false
  connectionStatus.value = ''
  jiraConfig.value.email = localStorage.getItem('jira_email') || ''
  jiraConfig.value.apiToken = localStorage.getItem('jira_token') || ''
  jiraConfig.value.project = localStorage.getItem('jira_project') || 'CRMCN'
  jiraConfig.value.powerAutomateWebhook = localStorage.getItem('jira_power_automate_webhook') || ''
}

// 单独保存 Webhook 配置
const saveWebhookConfig = () => {
  localStorage.setItem('jira_power_automate_webhook', jiraConfig.value.powerAutomateWebhook)
  alert('✅ Webhook URL 已保存')
}

// 获取类型配置 (图标 + 颜色)
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

// 创建分支
const handleCreateBranch = (issue) => {
  emit('createBranch', {
    key: issue.key,
    summary: issue.summary,
    type: issue.type
  })
}

// 是否为 Story 类型
const isStory = (issue) => {
  return issue.type === 'Story'
}

// 触发提测通知状态
const triggeringWebhook = ref(new Set())

// 提测弹窗状态
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

// 打开提测编辑弹窗
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

// 关闭提测弹窗
const closeTestModal = () => {
  showTestModal.value = false
  currentTestIssue.value = null
}

// 发送提测通知到 Teams
const sendTestNotification = async () => {
  const issue = currentTestIssue.value
  const webhookUrl = jiraConfig.value.powerAutomateWebhook
  
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
    error.value = `发送失败: ${e.message || e}`
    alert(`❌ 发送失败: ${e.message || e}`)
  } finally {
    triggeringWebhook.value.delete(issue.key)
  }
}

// 触发提测通知到 Teams（仅 Story 类型且有 Epic）
const triggerPowerAutomate = (issue) => {
  // 检查是否有 Epic 信息
  if (!issue.parent || issue.parent.type !== 'Epic') {
    alert('⚠️ 该 Story 没有关联 Epic，无法生成提测消息')
    return
  }
  
  const webhookUrl = jiraConfig.value.powerAutomateWebhook
  if (!webhookUrl) {
    alert('⚠️ 请先配置 Teams Webhook URL')
    return
  }
  
  // 打开提测编辑弹窗
  openTestModal(issue)
}

// 打开 Jira 链接
const openJiraLink = (issue) => {
  const url = `https://${jiraConfig.value.domain}/browse/${issue.key}`
  invoke('open_url_raw', { url })
}

// 格式化时间
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

// 监听全局 Jira 配置更新
const handleJiraConfigUpdated = (event) => {
  const newConfig = event.detail
  jiraConfig.value = {
    domain: newConfig.domain || jiraConfig.value.domain,
    email: newConfig.email || jiraConfig.value.email,
    apiToken: newConfig.apiToken || jiraConfig.value.apiToken,
    project: newConfig.project || jiraConfig.value.project
  }
  // 配置更新后重新获取任务
  if (isConfigured.value) {
    fetchIssues()
  }
}

onMounted(() => {
  // 监听全局配置更新事件
  window.addEventListener('jira-config-updated', handleJiraConfigUpdated)
  
  if (isConfigured.value) {
    fetchIssues()
  } else {
    showConfig.value = true
  }
})

onUnmounted(() => {
  window.removeEventListener('jira-config-updated', handleJiraConfigUpdated)
})
</script>

<template>
  <div class="panel jira-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="panel-icon">📋</span>
        <span>Jira Tasks</span>
        <span v-if="stats.total" class="task-count">{{ stats.total }}</span>
      </div>
      <div class="header-actions">
        <button class="panel-action" title="设置" @click="showConfig = true">⚙️</button>
        <button class="panel-action" title="刷新" @click="fetchIssues" :disabled="loading">
          <span :class="{ spinning: loading }">🔄</span>
        </button>
      </div>
    </div>
    
    <!-- 配置弹窗 (简化版 - 指向全局设置) -->
    <div v-if="showConfig" class="config-overlay">
      <div class="config-modal">
        <h3>Jira 配置</h3>
        
        <!-- 已配置状态 -->
        <div v-if="isConfigured" class="config-status configured">
          <div class="status-icon">✅</div>
          <div class="status-info">
            <div class="status-title">已配置</div>
            <div class="status-detail">
              <span class="config-label">域名:</span> {{ jiraConfig.domain }}
            </div>
            <div class="status-detail">
              <span class="config-label">邮箱:</span> {{ jiraConfig.email }}
            </div>
            <div class="status-detail">
              <span class="config-label">项目:</span> {{ jiraConfig.project || '全部项目' }}
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
          <p>💡 Jira 配置已移至全局设置，点击下方按钮前往设置</p>
        </div>
        
        <!-- Teams 提测 Webhook 配置 -->
        <div class="webhook-config">
          <label class="webhook-label">
            🚀 Teams 提测 Webhook
          </label>
          <input 
            type="text" 
            v-model="jiraConfig.powerAutomateWebhook"
            placeholder="https://xxx.webhook.office.com/..."
            class="webhook-input"
          />
          <button 
            class="btn-sm" 
            @click="saveWebhookConfig"
            :disabled="!jiraConfig.powerAutomateWebhook"
          >
            保存 Webhook
          </button>
        </div>
        
        <!-- 测试连接 -->
        <div v-if="isConfigured" class="connection-test">
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
        
        <!-- 错误信息 -->
        <div v-if="error && showConfig" class="config-error">
          {{ error }}
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
      <!-- 错误提示 -->
      <div v-if="error" class="error-message">
        {{ error }}
      </div>
      
      <!-- 筛选器 -->
      <div class="task-filters">
        <button 
          v-for="f in filters" 
          :key="f.id"
          class="filter-btn" 
          :class="{ active: activeFilter === f.id }"
          @click="activeFilter = f.id"
        >
          {{ f.label }}
          <span v-if="f.id === 'in_progress'" class="filter-count">{{ stats.inProgress }}</span>
          <span v-else-if="f.id === 'todo'" class="filter-count">{{ stats.todo }}</span>
          <span v-else-if="f.id === 'done'" class="filter-count">{{ stats.done }}</span>
        </button>
      </div>
      
      <!-- 加载中 -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>
      
      <!-- 任务列表 -->
      <div v-else-if="filteredIssues.length > 0" class="task-list">
        <div 
          v-for="issue in filteredIssues" 
          :key="issue.id" 
          class="task-card"
          :class="{ 
            'is-bug': isBug(issue),
            'is-epic': issue.type === 'Epic',
            'has-parent': issue.parent
          }"
        >
          <!-- 父任务/Epic 信息 -->
          <div v-if="issue.parent" class="task-parent">
            <span class="parent-icon">{{ getTypeIcon(issue.parent.type) }}</span>
            <span class="parent-key">{{ issue.parent.key }}</span>
            <span class="parent-summary">{{ issue.parent.summary }}</span>
          </div>
          
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
              :disabled="triggeringWebhook.has(issue.key) || !jiraConfig.powerAutomateWebhook || !issue.parent || issue.parent.type !== 'Epic'"
              @click="triggerPowerAutomate(issue)"
              :title="!jiraConfig.powerAutomateWebhook ? '请先配置 Webhook URL' : (!issue.parent || issue.parent.type !== 'Epic') ? '该 Story 未关联 Epic，无法提测' : '发送提测通知到 Teams'"
            >
              <span v-if="triggeringWebhook.has(issue.key)">⏳ 提测中...</span>
              <span v-else>🚀 提测</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">📋</div>
        <p v-if="isConfigured">暂无任务</p>
        <p v-else>请先配置 Jira 账号</p>
      </div>
    </div>
    
    <div class="panel-footer">
      <span class="footer-text">{{ jiraConfig.domain }}</span>
      <span v-if="stats.inProgress" class="progress-badge">{{ stats.inProgress }} 进行中</span>
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
