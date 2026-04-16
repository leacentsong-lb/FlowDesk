/**
 * Tools: fetch_jira_versions, fetch_version_issues
 */
import { invoke } from '@tauri-apps/api/core'

// -- fetch_jira_versions -------------------------------------------------

export const versionsSchema = {
  type: 'function',
  function: {
    name: 'fetch_jira_versions',
    description: '从 Jira 获取当前项目的版本列表。可按已发布、未发布或全部版本进行筛选，返回版本名称供选择。',
    parameters: {
      type: 'object',
      properties: {
        release_state: {
          type: 'string',
          enum: ['unreleased', 'released', 'all'],
          description: '版本筛选条件。unreleased 表示未发布，released 表示已发布，all 表示全部。默认 unreleased。'
        }
      },
      required: []
    }
  }
}

export async function versionsHandler(args, ctx) {
  const jira = ctx.jira
  const projects = (jira.config.project || 'CRMCN').split('\n').map(p => p.trim()).filter(Boolean)
  const project = projects[0] || 'CRMCN'
  const releaseState = ['unreleased', 'released', 'all'].includes(args?.release_state)
    ? args.release_state
    : 'unreleased'

  const result = await invoke('jira_get_versions', {
    domain: jira.config.domain,
    email: jira.config.email,
    apiToken: jira.config.apiToken,
    project
  })

  if (result.status !== 200) {
    return { ok: false, versions: [], error: `HTTP ${result.status}` }
  }

  const data = JSON.parse(result.body)
  const versions = (Array.isArray(data) ? data : [])
    .filter(version => !version.archived)
    .filter(version => {
      if (releaseState === 'released') return version.released === true
      if (releaseState === 'all') return true
      return version.released !== true
    })
    .sort((a, b) => (b.name || '').localeCompare(a.name || ''))
    .map(version => ({
      name: version.name,
      description: version.description || '',
      released: Boolean(version.released)
    }))

  const summaryPrefix = releaseState === 'released'
    ? '已发布版本'
    : releaseState === 'all'
      ? '全部版本'
      : '待发布版本'

  return {
    ok: versions.length > 0,
    versions,
    summary: versions.length > 0
      ? `找到 ${versions.length} 个${summaryPrefix}：${versions.slice(0, 5).map(version => version.name).join(', ')}`
      : `未找到${summaryPrefix}`
  }
}

// -- fetch_version_issues ------------------------------------------------

export const issuesSchema = {
  type: 'function',
  function: {
    name: 'fetch_version_issues',
    description: '获取指定 Jira 版本下的所有 issue，包括类型、状态、优先级、责任人。用于了解发布范围。',
    parameters: {
      type: 'object',
      properties: {
        version_name: {
          type: 'string',
          description: '要查询的 Jira 版本名称，如 3.8.2'
        }
      },
      required: ['version_name']
    }
  }
}

export async function issuesHandler(args, ctx) {
  const jira = ctx.jira
  const projects = (jira.config.project || 'CRMCN').split('\n').map(p => p.trim()).filter(Boolean)
  const project = projects[0] || 'CRMCN'
  const versionName = args.version_name

  const result = await invoke('jira_get_version_issues', {
    domain: jira.config.domain,
    email: jira.config.email,
    apiToken: jira.config.apiToken,
    project,
    versionName
  })

  if (result.status !== 200) {
    return { ok: false, issues: [], error: `HTTP ${result.status}` }
  }

  const data = JSON.parse(result.body)
  const issues = (data.issues || []).map(issue => {
    const f = issue.fields || {}
    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || 'Unknown',
      statusCategory: f.status?.statusCategory?.key || '',
      type: f.issuetype?.name || 'Task',
      priority: f.priority?.name || 'Medium',
      assignee: f.assignee?.displayName || ''
    }
  })

  const done = issues.filter(i => i.statusCategory === 'done').length
  const inProgress = issues.filter(i => i.statusCategory === 'indeterminate').length

  return {
    ok: true,
    issues,
    stats: { total: issues.length, done, inProgress, todo: issues.length - done - inProgress },
    summary: `版本 ${versionName} 共 ${issues.length} 个 issue：${done} 已完成，${inProgress} 进行中，${issues.length - done - inProgress} 待处理`
  }
}
