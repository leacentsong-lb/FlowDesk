import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const normalizeProjectInput = (value) => {
  const lines = (value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  return lines.join('\n')
}

export const useJiraStore = defineStore('jira', () => {
  // ============================================
  // 配置 (单一来源)
  // ============================================
  const config = ref({
    domain: localStorage.getItem('jira_domain') || 'thebidgroup.atlassian.net',
    email: localStorage.getItem('jira_email') || '',
    apiToken: localStorage.getItem('jira_token') || '',
    project: normalizeProjectInput(localStorage.getItem('jira_project') || 'CRMCN') || 'CRMCN',
    teamsWebhook: localStorage.getItem('jira_power_automate_webhook') || ''
  })

  const isConfigured = computed(() => !!config.value.email && !!config.value.apiToken)

  function saveConfig() {
    config.value.project = normalizeProjectInput(config.value.project)
    localStorage.setItem('jira_domain', config.value.domain)
    localStorage.setItem('jira_email', config.value.email)
    localStorage.setItem('jira_token', config.value.apiToken)
    localStorage.setItem('jira_project', config.value.project)
    localStorage.setItem('jira_power_automate_webhook', config.value.teamsWebhook)
  }

  function updateConfig(newConfig) {
    config.value = {
      ...config.value,
      ...newConfig,
      project: normalizeProjectInput(newConfig.project ?? config.value.project)
    }
    saveConfig()
  }

  // ============================================
  // 任务数据 (单一来源，所有组件共享)
  // ============================================
  const issues = ref([])
  const loading = ref(false)
  const error = ref('')

  /**
   * @param {Object|null|undefined} rawParent
   * @returns {{ key: string, summary: string, type: string } | null}
   */
  function normalizeParent(rawParent) {
    if (!rawParent?.key) return null

    return {
      key: rawParent.key,
      summary: rawParent.fields?.summary || '',
      type: rawParent.fields?.issuetype?.name || ''
    }
  }

  /**
   * @param {Object} issue
   * @returns {Object}
   */
  function normalizeIssue(issue) {
    const fields = issue.fields || {}
    const devDueDate = parseDevDueDate(fields)

    return {
      id: issue.id || issue.key,
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
      dueDate: fields.duedate || null,
      devDueDate,
      parent: normalizeParent(fields.parent),
      assignee: fields.assignee ? {
        displayName: fields.assignee.displayName,
        email: fields.assignee.emailAddress,
        avatarUrl: fields.assignee.avatarUrls?.['48x48']
      } : null,
      hierarchyTrail: [],
      hierarchyText: '',
      url: `https://${config.value.domain}/browse/${issue.key}`
    }
  }

  /**
   * @param {Array<Object>} issueList
   * @returns {Map<string, Object>}
   */
  function buildIssueMap(issueList) {
    return new Map(issueList.map(issue => [issue.key, issue]))
  }

  /**
   * @param {string} issueKey
   * @param {Map<string, Object|null>} remoteCache
   * @returns {Promise<Object|null>}
   */
  async function fetchIssueByKey(issueKey, remoteCache) {
    if (!issueKey) return null
    if (remoteCache.has(issueKey)) return remoteCache.get(issueKey)

    try {
      const result = await invoke('jira_get_issue', {
        domain: config.value.domain,
        email: config.value.email,
        apiToken: config.value.apiToken,
        issueKey
      })

      if (result.status !== 200) {
        remoteCache.set(issueKey, null)
        return null
      }

      const normalizedIssue = normalizeIssue(JSON.parse(result.body))
      remoteCache.set(issueKey, normalizedIssue)
      return normalizedIssue
    } catch {
      remoteCache.set(issueKey, null)
      return null
    }
  }

  /**
   * @param {Object} issue
   * @param {Map<string, Object>} localIssueMap
   * @param {Map<string, Object|null>} remoteCache
   * @returns {Promise<Array<{ key: string, summary: string, type: string }>>}
   */
  async function resolveIssueHierarchy(issue, localIssueMap, remoteCache) {
    const trail = [{ key: issue.key, summary: issue.summary, type: issue.type }]
    const visited = new Set([issue.key])
    let parentKey = issue.parent?.key

    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey)
      const parentIssue = localIssueMap.get(parentKey) || await fetchIssueByKey(parentKey, remoteCache)

      if (!parentIssue) break

      trail.unshift({
        key: parentIssue.key,
        summary: parentIssue.summary,
        type: parentIssue.type
      })

      parentKey = parentIssue.parent?.key
    }

    return trail
  }

  /**
   * @param {Array<Object>} issueList
   * @returns {Promise<Array<Object>>}
   */
  async function attachHierarchy(issueList) {
    const localIssueMap = buildIssueMap(issueList)
    const remoteCache = new Map()

    return Promise.all(issueList.map(async issue => {
      const hierarchyTrail = await resolveIssueHierarchy(issue, localIssueMap, remoteCache)
      return {
        ...issue,
        hierarchyTrail,
        hierarchyText: hierarchyTrail.map(node => node.key).join(' / ')
      }
    }))
  }

  /**
   * @param {Object} fields - Jira issue fields
   * @returns {string|null} 找到的第一个自定义日期字段
   */
  function parseDevDueDate(fields) {
    const specificDevDue = fields.customfield_10015 || fields.customfield_10016 ||
                           fields.customfield_10036 || fields.customfield_10037
    if (specificDevDue && typeof specificDevDue === 'string') return specificDevDue

    for (const key of Object.keys(fields)) {
      if (key.startsWith('customfield_') && fields[key]) {
        const val = fields[key]
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
          return val
        }
      }
    }
    return null
  }

  async function fetchIssues() {
    if (!isConfigured.value) return

    loading.value = true
    error.value = ''

    try {
      const result = await invoke('jira_get_my_issues', {
        domain: config.value.domain,
        email: config.value.email,
        apiToken: config.value.apiToken,
        project: config.value.project
      })

      if (result.status === 200) {
        const data = JSON.parse(result.body)
        const normalizedIssues = (data.issues || []).map(issue => normalizeIssue(issue))
        issues.value = await attachHierarchy(normalizedIssues)
      } else if (result.status === 401) {
        error.value = '认证失败，请检查邮箱和 API Token'
      } else {
        error.value = `获取失败: HTTP ${result.status}`
      }
    } catch (e) {
      error.value = `请求失败: ${e.message || e}`
    } finally {
      loading.value = false
    }
  }

  // ============================================
  // Computed: 按状态分组
  // ============================================
  const groupedByStatus = computed(() => {
    const groups = { in_progress: [], todo: [], done: [], other: [] }

    issues.value.forEach(issue => {
      const s = issue.status?.toLowerCase() || ''
      if (s.includes('progress') || s.includes('进行') || s.includes('dev') || s.includes('review')) {
        groups.in_progress.push(issue)
      } else if (s.includes('to do') || s.includes('待办') || s.includes('open') || s.includes('backlog')) {
        groups.todo.push(issue)
      } else if (s.includes('done') || s.includes('完成') || s.includes('closed') || s.includes('resolved')) {
        groups.done.push(issue)
      } else {
        groups.other.push(issue)
      }
    })

    return groups
  })

  const groupedByType = computed(() => {
    const groups = { bug: [], task: [] }

    issues.value.forEach(issue => {
      if (issue.type?.toLowerCase() === 'bug') {
        groups.bug.push(issue)
      } else {
        groups.task.push(issue)
      }
    })

    return groups
  })

  const stats = computed(() => ({
    total: issues.value.length,
    inProgress: groupedByStatus.value.in_progress.length,
    todo: groupedByStatus.value.todo.length,
    done: groupedByStatus.value.done.length
  }))

  const typeStats = computed(() => ({
    bug: groupedByType.value.bug.length,
    task: groupedByType.value.task.length
  }))

  // ============================================
  // Computed: 截止提醒 (TodoListPanel 使用)
  // ============================================
  const upcomingDeadlines = computed(() => {
    return issues.value
      .filter(i => {
        const effectiveDate = i.devDueDate || i.dueDate
        if (!effectiveDate) return false
        const s = i.status?.toLowerCase() || ''
        const isDone = s.includes('done') || s.includes('完成') || s.includes('closed') || s.includes('resolved')
        if (isDone) return false

        const diffDays = Math.ceil((new Date(effectiveDate) - new Date()) / (1000 * 60 * 60 * 24))
        return diffDays <= 3
      })
      .map(i => {
        const effectiveDate = i.devDueDate || i.dueDate
        const isDevDue = !!i.devDueDate
        const diffDays = Math.ceil((new Date(effectiveDate) - new Date()) / (1000 * 60 * 60 * 24))

        let urgency = 'normal'
        if (diffDays < 0) urgency = 'overdue'
        else if (diffDays === 0) urgency = 'today'
        else if (diffDays <= 1) urgency = 'urgent'
        else if (diffDays <= 3) urgency = 'warning'

        let deadlineText = `剩余 ${diffDays} 天`
        if (diffDays < 0) deadlineText = `已逾期 ${Math.abs(diffDays)} 天`
        else if (diffDays === 0) deadlineText = '今天截止'

        return {
          id: `jira-${i.key}`,
          title: `${i.key} ${i.summary}`,
          description: `${i.status} · ${isDevDue ? '开发交付' : '截止'}${deadlineText}`,
          url: i.url,
          urgency
        }
      })
      .sort((a, b) => {
        const order = { overdue: 0, today: 1, urgent: 2, warning: 3, normal: 4 }
        return order[a.urgency] - order[b.urgency]
      })
  })

  // ============================================
  // 测试连接
  // ============================================
  const testStatus = ref('')
  const testMessage = ref('')

  async function testConnection() {
    if (!config.value.domain || !config.value.email || !config.value.apiToken) {
      testStatus.value = 'error'
      testMessage.value = '请填写完整的配置信息'
      return
    }

    testStatus.value = 'testing'
    testMessage.value = ''

    try {
      const result = await invoke('jira_get_my_issues', {
        domain: config.value.domain,
        email: config.value.email,
        apiToken: config.value.apiToken,
        project: ''
      })

      if (result.status === 200) {
        const data = JSON.parse(result.body)
        testStatus.value = 'success'
        testMessage.value = `连接成功！找到 ${data.total || 0} 个任务`
        saveConfig()
      } else {
        testStatus.value = 'error'
        testMessage.value = `连接失败: HTTP ${result.status}`
      }
    } catch (e) {
      testStatus.value = 'error'
      testMessage.value = `连接失败: ${e}`
    }
  }

  async function testProjectConnection() {
    try {
      const result = await invoke('jira_get_projects', {
        domain: config.value.domain,
        email: config.value.email,
        apiToken: config.value.apiToken
      })
      return result.status === 200
        ? { success: true }
        : { success: false, error: `HTTP ${result.status}` }
    } catch (e) {
      return { success: false, error: e.message || String(e) }
    }
  }

  return {
    config,
    isConfigured,
    saveConfig,
    updateConfig,
    issues,
    loading,
    error,
    fetchIssues,
    groupedByStatus,
    groupedByType,
    stats,
    typeStats,
    upcomingDeadlines,
    testStatus,
    testMessage,
    testConnection,
    testProjectConnection
  }
})
