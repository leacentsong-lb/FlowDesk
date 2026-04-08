/**
 * Release Store — keeps release domain state and delegates chat runtime.
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useSettingsStore } from './settings'
import { useJiraStore } from './jira'
import { TOOLS } from '../agent/index.js'
import { routeAgentIntent } from '../agent/router.js'
import { createAgentRuntime } from '../agent/runtime.js'
import { pushTraceEntry } from '../agent/tracing.js'

export const useReleaseStore = defineStore('release', () => {
  const settings = useSettingsStore()
  const jira = useJiraStore()
  const RELEASE_TOOL_NAMES = new Set([
    'check_credentials',
    'fetch_jira_versions',
    'fetch_version_issues',
    'scan_pr_status',
    'run_preflight',
    'run_build'
  ])

  const mode = ref('general')
  const version = ref('')
  const environment = ref('production')
  const sessionActive = ref(false)
  const toolResults = reactive({})
  const traces = ref([])

  function clearReleaseState() {
    version.value = ''
    sessionActive.value = false
    Object.keys(toolResults).forEach(key => delete toolResults[key])
  }

  function setMode(nextMode) {
    mode.value = nextMode
    if (nextMode !== 'release') {
      clearReleaseState()
    }
  }

  const isReleaseMode = computed(() => mode.value === 'release')
  const TOOL_ORDER = TOOLS.map(tool => tool.function.name)
  const completedTools = computed(() =>
    TOOL_ORDER.filter(name => toolResults[name])
  )

  const runtime = createAgentRuntime({
    ctx: { settings, jira },
    getState: () => ({
      mode: mode.value,
      version: version.value,
      environment: environment.value,
      workspacePath: settings.workspacePath,
      completedTools: completedTools.value
    }),
    onToolStart({ toolName, args }) {
      if (RELEASE_TOOL_NAMES.has(toolName)) {
        mode.value = 'release'
        sessionActive.value = true
      }

      if (toolName === 'fetch_version_issues' && args?.version_name) {
        version.value = args.version_name
        sessionActive.value = true
      }
    },
    onToolEnd({ toolName, result }) {
      toolResults[toolName] = result
    },
    onTraceComplete(trace) {
      traces.value = pushTraceEntry(traces.value, trace, 20)
    }
  })

  const pipelineStatus = computed(() => {
    if (!sessionActive.value) return 'idle'
    const results = Object.values(toolResults)
    if (results.some(result => result && !result.ok && !result.error)) return 'blocked'
    if (results.length >= TOOL_ORDER.length && results.every(result => result?.ok)) return 'pass'
    return 'running'
  })

  const currentStep = computed(() => {
    for (let i = 0; i < TOOL_ORDER.length; i++) {
      if (!toolResults[TOOL_ORDER[i]]) return i
    }
    return TOOL_ORDER.length
  })

  const currentToolName = computed(() =>
    TOOL_ORDER.find(name => !toolResults[name]) || null
  )

  const credentials = computed(() => toolResults.check_credentials || { jira: false, github: false, ai: false })
  const allCredentialsReady = computed(() => credentials.value.jira && credentials.value.github)
  const versionIssues = computed(() => toolResults.fetch_version_issues?.issues || [])
  const issueStats = computed(() => {
    const issues = versionIssues.value
    const total = issues.length
    const done = issues.filter(issue => issue.statusCategory === 'done').length
    const inProgress = issues.filter(issue => issue.statusCategory === 'indeterminate').length
    return { total, done, inProgress, todo: total - done - inProgress }
  })
  const prCheckResults = computed(() => toolResults.scan_pr_status?.prs || [])
  const prCheckStatus = computed(() => {
    const result = toolResults.scan_pr_status
    if (!result) return 'idle'
    return result.ok ? 'pass' : 'blocked'
  })
  const unmergedPrs = computed(() => prCheckResults.value.filter(result => !result.merged))
  const identifiedRepos = computed(() => toolResults.scan_pr_status?.repos || [])
  const preflightResults = computed(() => toolResults.run_preflight?.results || [])
  const preflightStatus = computed(() => {
    const result = toolResults.run_preflight
    if (!result) return 'idle'
    return result.ok ? 'pass' : 'blocked'
  })
  const buildResults = computed(() => toolResults.run_build?.results || [])
  const buildStatus = computed(() => {
    const result = toolResults.run_build
    if (!result) return 'idle'
    return result.ok ? 'pass' : 'blocked'
  })

  async function agentStart() {
    runtime.resetRuntime()
    setMode('general')
    runtime.pushMessage('agent', '你好，我是开发助手。我可以帮你查看工作区、分析代码、执行工程任务，也可以进入发布流程。', [
      { id: 'mode-general-workspace', label: '查看工作区', variant: 'primary' },
      { id: 'mode-general-files', label: '查看目录结构', variant: 'secondary' },
      { id: 'mode-release-production', label: '开始发布流程', variant: 'ghost' },
      { id: 'open-settings', label: '前往设置', variant: 'ghost' }
    ], {
      kind: 'notice',
      status: 'idle'
    })
  }

  async function agentSelectEnv() {
    mode.value = 'release'
    environment.value = 'production'
    sessionActive.value = true
    await runtime.runAgent('发布生产环境，请开始检查凭证并获取版本列表。', {
      route: {
        mode: 'release',
        intent: 'release_flow',
        shouldPrimeWorkspaceSkill: false,
        shouldScanWorkspaceFirst: false
      }
    })
  }

  async function runRoutedAgent(userText) {
    const route = routeAgentIntent(userText)

    setMode(route.mode)
    if (route.mode === 'release') {
      sessionActive.value = true
    }

    return runtime.runAgent(userText, { route })
  }

  async function agentChat(userText) {
    if (settings.aiConfigured) {
      return runRoutedAgent(userText)
    }

    runtime.pushMessage('user', userText)
    runtime.pushMessage('agent', '当前未配置 AI，无法回复。请先在 Settings 中配置 AI Provider。', [
      { id: 'open-settings', label: '前往设置', variant: 'primary' }
    ], {
      kind: 'notice',
      status: 'warning'
    })
  }

  async function handleChatAction(actionId) {
    if (actionId === 'open-settings') {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'ai' } }))
      return
    }
    if (actionId === 'mode-general-workspace') {
      setMode('general')
      return runRoutedAgent('请先分析当前工作区，告诉我你能帮我做什么。')
    }
    if (actionId === 'mode-general-files') {
      setMode('general')
      return runRoutedAgent('请查看当前项目目录结构，并总结主要模块和可能的工作入口。')
    }
    if (actionId === 'mode-release-production') return agentSelectEnv()
    if (actionId.startsWith('version-')) {
      const selectedVersion = actionId.replace('version-', '')
      mode.value = 'release'
      version.value = selectedVersion
      sessionActive.value = true
      return runRoutedAgent(`选择版本 ${selectedVersion}，请获取该版本的 issue 列表并继续后续检查。`)
    }
    if (actionId.startsWith('retry-')) {
      const toolName = actionId.replace('retry-', '')
      delete toolResults[toolName]
      return runtime.runAgent(`请重新执行 ${toolName}。`, {
        route: {
          mode: 'release',
          intent: 'release_flow',
          shouldPrimeWorkspaceSkill: false,
          shouldScanWorkspaceFirst: false
        }
      })
    }
  }

  function resetSession() {
    runtime.resetRuntime()
    mode.value = 'general'
    clearReleaseState()
  }

  return {
    TOOL_ORDER,
    mode,
    isReleaseMode,
    environment,
    version,
    sessionActive,
    agentRunning: runtime.agentRunning,
    toolResults,
    pipelineStatus,
    currentStep,
    completedTools,
    currentToolName,
    credentials,
    allCredentialsReady,
    versionIssues,
    issueStats,
    prCheckResults,
    prCheckStatus,
    unmergedPrs,
    identifiedRepos,
    preflightResults,
    preflightStatus,
    buildResults,
    buildStatus,
    traces,
    chatMessages: runtime.chatMessages,
    pushMessage: runtime.pushMessage,
    agentStart,
    agentChat,
    stopAgentChat: runtime.stopAgentChat,
    handleChatAction,
    resetSession
  }
})
