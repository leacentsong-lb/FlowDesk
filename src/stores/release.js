/**
 * Release Store — keeps release domain state and delegates chat runtime.
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useSettingsStore } from './settings'
import { useJiraStore } from './jira'
import { usePromptStore } from './prompt'
import { routeAgentIntent } from '../agent/router.js'
import { createAgentRuntime } from '../agent/runtime.js'
import { pushTraceEntry } from '../agent/tracing.js'
import { getWorkflowTools, resolveAgentWorkflow } from '../agent/workflows/index.js'

export const useReleaseStore = defineStore('release', () => {
  const settings = useSettingsStore()
  const jira = useJiraStore()
  const prompt = usePromptStore()
  const RELEASE_PIPELINE_TOOLS = [
    'check_credentials',
    'fetch_jira_versions',
    'fetch_version_issues',
    'scan_pr_status',
    'run_preflight',
    'run_build'
  ]
  const RELEASE_TOOL_NAMES = new Set(RELEASE_PIPELINE_TOOLS)

  const mode = ref('general')
  const currentWorkflowId = ref('general')
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

  function setWorkflow(nextWorkflowId) {
    const workflow = resolveAgentWorkflow(nextWorkflowId)
    currentWorkflowId.value = workflow.id
    setMode(workflow.mode)
  }

  const isReleaseMode = computed(() => mode.value === 'release')
  const TOOL_ORDER = RELEASE_PIPELINE_TOOLS
  const completedTools = computed(() =>
    TOOL_ORDER.filter(name => toolResults[name])
  )

  const runtime = createAgentRuntime({
    ctx: { settings, jira },
    getState: () => ({
      mode: mode.value,
      workflowId: currentWorkflowId.value,
      version: version.value,
      environment: environment.value,
      workspacePath: settings.workspacePath,
      completedTools: completedTools.value,
      promptConfig: prompt.config
    }),
    onToolStart({ toolName, args }) {
      if (toolName === 'fetch_version_issues' && args?.version_name) {
        version.value = args.version_name
        sessionActive.value = true
      }
    },
    onToolEnd({ toolName, result }) {
      if (RELEASE_TOOL_NAMES.has(toolName)) {
        toolResults[toolName] = result
      }
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
    runtime.pushMessage('agent', '你好，我是开发助手。我可以帮你查看工作区、分析代码、执行工程任务，也可以进入发布流程。', null, {
      kind: 'notice',
      status: 'idle'
    })
    runtime.presentInteraction({
      id: 'interaction-agent-start',
      type: 'action-list',
      title: '选择开始方式',
      description: '请选择下一步操作。',
      actions: [
        { id: 'mode-general-workspace', label: '查看工作区', variant: 'primary' },
        { id: 'mode-general-files', label: '查看目录结构', variant: 'secondary' },
        { id: 'mode-release-production', label: '开始发布流程', variant: 'ghost' },
        { id: 'open-settings', label: '前往设置', variant: 'ghost' }
      ]
    })
  }

  async function agentSelectEnv() {
    setWorkflow('release')
    environment.value = 'production'
    sessionActive.value = true
    const workflow = resolveAgentWorkflow('release')
    await runtime.runAgent('发布生产环境，请开始检查凭证并获取版本列表。', {
      route: {
        mode: 'release',
        workflowId: 'release',
        riskLevel: 'high',
        requiresApproval: false,
        shouldVerify: true
      },
      workflow,
      tools: getWorkflowTools(workflow.id)
    })
  }

  async function runRoutedAgent(userText) {
    const route = routeAgentIntent(userText)
    const workflow = resolveAgentWorkflow(route.workflowId)

    setWorkflow(workflow.id)
    if (workflow.id === 'release') {
      sessionActive.value = true
    }

    return runtime.runAgent(userText, {
      route,
      workflow,
      tools: getWorkflowTools(workflow.id)
    })
  }

  async function agentChat(userText) {
    if (settings.aiConfigured) {
      return runRoutedAgent(userText)
    }

    runtime.pushMessage('user', userText)
    runtime.pushMessage('agent', '当前未配置 AI，无法回复。请先在 Settings 中配置 AI Provider。', null, {
      kind: 'notice',
      status: 'warning'
    })
    runtime.presentInteraction({
      id: 'interaction-open-settings',
      type: 'action-list',
      title: '完成必要配置',
      description: '请先完成必要配置。',
      actions: [
        { id: 'open-settings', label: '前往设置', variant: 'primary' }
      ]
    })
  }

  async function handleChatAction(actionId) {
    runtime.clearPendingInteraction()

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
      setWorkflow('release')
      version.value = selectedVersion
      sessionActive.value = true
      return runRoutedAgent(`选择版本 ${selectedVersion}，请获取该版本的 issue 列表并继续后续检查。`)
    }
    if (actionId.startsWith('retry-')) {
      const toolName = actionId.replace('retry-', '')
      delete toolResults[toolName]
      const workflow = resolveAgentWorkflow('release')
      return runtime.runAgent(`请重新执行 ${toolName}。`, {
        route: {
          mode: 'release',
          workflowId: 'release',
          riskLevel: 'high',
          requiresApproval: false,
          shouldVerify: true
        },
        workflow,
        tools: getWorkflowTools(workflow.id)
      })
    }
  }

  function resetSession() {
    runtime.resetRuntime()
    currentWorkflowId.value = 'general'
    mode.value = 'general'
    clearReleaseState()
  }

  return {
    TOOL_ORDER,
    mode,
    currentWorkflowId,
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
    pendingInteraction: runtime.pendingInteraction,
    primedSkillNames: runtime.primedSkillNames,
    primedSkillBundle: runtime.primedSkillBundle,
    pushMessage: runtime.pushMessage,
    agentStart,
    agentChat,
    stopAgentChat: runtime.stopAgentChat,
    handleChatAction,
    resetSession
  }
})
