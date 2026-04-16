/**
 * Release Store — keeps release domain state and delegates chat runtime.
 */

import { invoke } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useSettingsStore } from './settings'
import { useJiraStore } from './jira'
import { usePromptStore } from './prompt'
import { routeAgentIntent } from '../agent/router.js'
import { createAgentRuntime } from '../agent/runtime.js'
import { pushTraceEntry } from '../agent/tracing.js'
import { TOOL_HANDLERS } from '../agent/tools/index.js'
import { getWorkflowTools, resolveAgentWorkflow } from '../agent/workflows/index.js'
import {
  RELEASE_GUARDED_TOOL_NAMES,
  RELEASE_STEP_BY_ID,
  RELEASE_STEP_BY_TOOL,
  RELEASE_STEP_ORDER,
  createReleaseSessionState,
  createStepApproval,
  decideStepApproval,
  getCompletedReleaseSteps,
  isReleaseSessionReadyForStep,
  syncReleaseSessionToolResult
} from '../agent/workflows/release-session.js'

export const useReleaseStore = defineStore('release', () => {
  const RELEASE_EXIT_PATTERNS = [
    /退出发布/,
    /退出流程/,
    /结束发布/,
    /离开发布/,
    /切回.*(通用|普通|开发助手)/,
    /回到.*(通用|普通|开发助手)/
  ]
  const RELEASE_CONTINUE_PATTERNS = [
    /^继续$/,
    /^继续吧$/,
    /^下一步$/,
    /^下一步吧$/,
    /^下一项$/,
    /^继续发布$/,
    /^继续流程$/,
    /^继续检查$/,
    /^继续执行$/,
    /^往下$/,
    /^好的$/,
    /^好$/,
    /^ok$/i,
    /^okay$/i
  ]
  const settings = useSettingsStore()
  const jira = useJiraStore()
  const prompt = usePromptStore()
  const RELEASE_PIPELINE_TOOLS = [
    'check_credentials',
    'fetch_jira_versions',
    'fetch_version_issues',
    'scan_pr_status',
    'run_preflight',
    'run_build',
    'collect_config_changes',
    'collect_i18n_changes',
    'generate_i18n_artifacts',
    'generate_release_readiness_report',
    'apply_config_changes',
    'execute_release_merge',
    'execute_post_merge_build',
    'create_release_tag',
    'generate_confluence_draft',
    'publish_confluence_release_doc'
  ]
  const RELEASE_TOOL_NAMES = new Set(RELEASE_PIPELINE_TOOLS)

  const mode = ref('general')
  const currentWorkflowId = ref('general')
  const version = ref('')
  const environment = ref('production')
  const sessionActive = ref(false)
  const toolResults = reactive({})
  const lastToolArgs = reactive({})
  const traces = ref([])
  const activeTrace = ref(null)
  const releaseSession = ref(createReleaseSessionState({
    environment: environment.value
  }))

  function getRuntimeState() {
    return {
      mode: mode.value,
      workflowId: currentWorkflowId.value,
      version: version.value,
      environment: environment.value,
      workspacePath: settings.workspacePath,
      completedTools: completedTools.value,
      promptConfig: prompt.config,
      releaseSession: releaseSession.value,
      currentGate: releaseSession.value.currentGate,
      releaseStatus: releaseSession.value.status
    }
  }

  function normalizeReleaseSession(session) {
    const baseSession = createReleaseSessionState({
      sessionId: session?.sessionId || '',
      version: session?.version || version.value,
      environment: session?.environment || environment.value
    })

    if (!session || !session.steps) return baseSession

    return {
      ...baseSession,
      ...session,
      steps: {
        ...baseSession.steps,
        ...(session.steps || {})
      },
      approvals: Array.isArray(session.approvals) ? session.approvals : baseSession.approvals,
      artifacts: Array.isArray(session.artifacts) ? session.artifacts : baseSession.artifacts,
      repos: Array.isArray(session.repos) ? session.repos : baseSession.repos,
      blockedSteps: Array.isArray(session.blockedSteps) ? session.blockedSteps : baseSession.blockedSteps,
      pendingApprovals: Array.isArray(session.pendingApprovals) ? session.pendingApprovals : baseSession.pendingApprovals
    }
  }

  async function persistReleaseSession() {
    if (!releaseSession.value?.sessionId) return
    try {
      await invoke('release_session_update', {
        session: releaseSession.value
      })
    } catch {
      // Keep the front-end session authoritative when the persistence layer is unavailable.
    }
  }

  function applyReleaseSession(nextSession, options = {}) {
    const { persist = true } = options
    releaseSession.value = normalizeReleaseSession(nextSession)
    version.value = releaseSession.value.version || version.value
    sessionActive.value = mode.value === 'release' || Boolean(releaseSession.value.sessionId)
    if (persist) {
      void persistReleaseSession()
    }
  }

  async function ensureReleaseSession(options = {}) {
    if (releaseSession.value?.sessionId) {
      return releaseSession.value
    }

    try {
      const result = await invoke('release_session_create', {
        version: options.version || null,
        environment: options.environment || environment.value
      })
      applyReleaseSession(result?.session || result, { persist: false })
      return releaseSession.value
    } catch {
      const localSession = createReleaseSessionState({
        version: options.version || version.value,
        environment: options.environment || environment.value
      })
      applyReleaseSession(localSession, { persist: false })
      return localSession
    }
  }

  function syncSessionFromTool(toolName, result) {
    const nextSession = syncReleaseSessionToolResult(releaseSession.value, {
      toolName,
      result,
      args: lastToolArgs[toolName]
    })
    applyReleaseSession(nextSession)
  }

  function clearReleaseState() {
    version.value = ''
    sessionActive.value = false
    Object.keys(toolResults).forEach(key => delete toolResults[key])
    Object.keys(lastToolArgs).forEach(key => delete lastToolArgs[key])
    releaseSession.value = createReleaseSessionState({
      environment: environment.value
    })
  }

  function setMode(nextMode, options = {}) {
    const preserveReleaseSession = options.preserveReleaseSession === true
    mode.value = nextMode
    if (nextMode !== 'release' && !preserveReleaseSession) {
      clearReleaseState()
    }
  }

  function setWorkflow(nextWorkflowId, options = {}) {
    const workflow = resolveAgentWorkflow(nextWorkflowId)
    currentWorkflowId.value = workflow.id
    setMode(workflow.mode, options)
  }

  const isReleaseMode = computed(() => mode.value === 'release')
  const TOOL_ORDER = RELEASE_STEP_ORDER.map(step => step.toolName || step.id)
  const completedTools = computed(() =>
    getCompletedReleaseSteps(releaseSession.value)
      .map(stepId => RELEASE_STEP_BY_ID[stepId]?.toolName || stepId)
  )

  const runtime = createAgentRuntime({
    ctx: { settings, jira },
    getState: () => getRuntimeState(),
    beforeToolCall({ toolName }) {
      if (!isReleaseMode.value || !RELEASE_GUARDED_TOOL_NAMES.has(toolName)) {
        return null
      }
      const stepId = RELEASE_STEP_BY_TOOL[toolName]?.id
      if (!stepId) return null
      if (isReleaseSessionReadyForStep(releaseSession.value, stepId)) {
        return null
      }
      const stepLabel = RELEASE_STEP_BY_ID[stepId]?.label || stepId
      return {
        result: {
          ok: false,
          blocked: true,
          requiresApproval: true,
          stepId,
          summary: `${stepLabel} 仍在等待人工授权。`,
          detail: releaseSession.value.currentGate?.summary || ''
        }
      }
    },
    onToolStart({ toolName, args }) {
      lastToolArgs[toolName] = args || {}
      if (toolName === 'fetch_version_issues' && args?.version_name) {
        version.value = args.version_name
        sessionActive.value = true
      }
    },
    onToolEnd({ toolName, result }) {
      if (RELEASE_TOOL_NAMES.has(toolName)) {
        toolResults[toolName] = result
        syncSessionFromTool(toolName, result)
      }
    },
    onTraceUpdate(trace) {
      activeTrace.value = trace
    },
    onTraceComplete(trace) {
      activeTrace.value = trace
      traces.value = pushTraceEntry(traces.value, trace, 20)
    }
  })

  const pipelineStatus = computed(() => {
    if (!sessionActive.value) return 'idle'
    if (['blocked', 'failed'].includes(releaseSession.value.status)) return 'blocked'
    if (['ready', 'completed'].includes(releaseSession.value.status)) return 'pass'
    return 'running'
  })

  const currentStep = computed(() => {
    return Math.max(0, RELEASE_STEP_ORDER.findIndex(step => step.id === releaseSession.value.currentStepId))
  })

  const currentToolName = computed(() =>
    RELEASE_STEP_BY_ID[releaseSession.value.currentStepId]?.toolName || null
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
  const configChanges = computed(() => toolResults.collect_config_changes?.changes || [])
  const i18nArtifacts = computed(() =>
    toolResults.generate_i18n_artifacts?.artifacts || releaseSession.value.artifacts.filter(artifact => artifact.kind === 'i18n-csv')
  )
  const releaseArtifacts = computed(() => releaseSession.value.artifacts || [])
  const approvals = computed(() => releaseSession.value.approvals || [])
  const currentGate = computed(() => releaseSession.value.currentGate || null)

  function buildReleaseRoute(overrides = {}) {
    return {
      mode: 'release',
      workflowId: 'release',
      riskLevel: 'high',
      requiresApproval: false,
      shouldVerify: true,
      ...overrides
    }
  }

  function isExplicitReleaseExit(userText) {
    const text = String(userText || '').trim()
    if (!text) return false
    return RELEASE_EXIT_PATTERNS.some(pattern => pattern.test(text))
  }

  function hasActiveReleaseWorkflow() {
    if (currentWorkflowId.value === 'release' || mode.value === 'release' || sessionActive.value) {
      return true
    }

    const status = String(releaseSession.value?.status || '')
    return Boolean(releaseSession.value?.sessionId) && !['completed', 'cancelled'].includes(status)
  }

  function isReleaseContinuationMessage(userText) {
    const text = String(userText || '').trim()
    if (!text) return false
    return RELEASE_CONTINUE_PATTERNS.some(pattern => pattern.test(text))
  }

  function resolveStickyRoute(userText) {
    const route = routeAgentIntent(userText)
    const explicitExit = isExplicitReleaseExit(userText)

    if (explicitExit) {
      return {
        route: {
          mode: 'general',
          workflowId: 'general',
          riskLevel: route.requiresApproval ? 'high' : 'low',
          requiresApproval: route.requiresApproval,
          shouldVerify: route.shouldVerify
        },
        workflow: resolveAgentWorkflow('general'),
        effectiveUserText: userText,
        preserveReleaseSession: false
      }
    }

    if (hasActiveReleaseWorkflow() && route.workflowId !== 'release' && isReleaseContinuationMessage(userText)) {
      return {
        route: buildReleaseRoute({
          requiresApproval: route.requiresApproval,
          riskLevel: 'high'
        }),
        workflow: resolveAgentWorkflow('release'),
        effectiveUserText: `继续当前发布会话。用户追加消息：${userText}`,
        preserveReleaseSession: true
      }
    }

    if (hasActiveReleaseWorkflow() && route.workflowId !== 'release') {
      return {
        route,
        workflow: resolveAgentWorkflow('general'),
        effectiveUserText: userText,
        preserveReleaseSession: true
      }
    }

    return {
      route,
      workflow: resolveAgentWorkflow(route.workflowId),
      effectiveUserText: userText,
      preserveReleaseSession: false
    }
  }

  async function runReleaseAgent(userText) {
    const workflow = resolveAgentWorkflow('release')
    await ensureReleaseSession()
    return runtime.runAgent(userText, {
      displayUserText: userText,
      route: buildReleaseRoute(),
      workflow,
      tools: getWorkflowTools(workflow.id)
    })
  }

  async function executeReleaseStep(stepId, argOverrides = {}) {
    const step = RELEASE_STEP_BY_ID[stepId]
    if (!step?.toolName) return null
    const handler = TOOL_HANDLERS[step.toolName]
    if (typeof handler !== 'function') {
      runtime.pushMessage('agent', `步骤 ${step.label} 暂未接入执行器。`, null, {
        kind: 'notice',
        status: 'warning'
      })
      return null
    }

    await ensureReleaseSession()
    const toolArgs = {
      ...buildReleaseToolArgs(stepId),
      ...argOverrides
    }
    runtime.pushMessage('agent', `正在执行 ${step.label}。`, null, {
      kind: 'notice',
      status: 'idle'
    })

    const result = await handler(toolArgs, { settings, jira })
    toolResults[step.toolName] = result
    lastToolArgs[step.toolName] = toolArgs
    syncSessionFromTool(step.toolName, result)

    runtime.pushMessage('agent', result?.summary || `${step.label} 已完成。`, null, {
      kind: 'notice',
      status: result?.ok ? 'success' : result?.blocked ? 'warning' : 'error'
    })

    const workflow = resolveAgentWorkflow('release')
    runtime.applyWorkflowEffect?.(workflow.afterTool?.({
      toolName: step.toolName,
      result,
      toolStatus: result?.blocked ? 'error' : result?.ok ? 'success' : 'error',
      state: getRuntimeState()
    }))
    return result
  }

  function buildReleaseToolArgs(stepId) {
    const sessionId = releaseSession.value.sessionId
    const repos = identifiedRepos.value
    const common = {
      session_id: sessionId,
      version: version.value
    }

    if (stepId === 'configChanges') {
      return { ...common, repos }
    }
    if (stepId === 'applyConfigChanges') {
      return { session_id: sessionId }
    }
    if (stepId === 'i18nChanges') {
      return { ...common, repos }
    }
    if (stepId === 'i18nArtifacts') {
      return { session_id: sessionId }
    }
    if (stepId === 'mergeLatest' || stepId === 'buildVerification' || stepId === 'tagRelease' || stepId === 'confluenceDraft' || stepId === 'confluencePublish') {
      return { session_id: sessionId }
    }
    if (stepId === 'readinessReport') {
      return { session_id: sessionId }
    }
    return { ...common, repos }
  }

  async function handleApprovalAction(actionId) {
    const isApprove = actionId.startsWith('approve-')
    const stepId = actionId.replace(isApprove ? 'approve-' : 'reject-', '')
    const pendingApproval = approvals.value.find(approval =>
      approval.stepId === stepId && approval.decision === 'pending'
    )

    let nextSession = releaseSession.value
    if (pendingApproval?.approvalId) {
      try {
        await invoke('release_approval_decide', {
          sessionId: releaseSession.value.sessionId,
          approvalId: pendingApproval.approvalId,
          decision: isApprove ? 'approved' : 'rejected',
          actor: 'chat-user'
        })
      } catch {
        // Keep local session flowing even if persistence is temporarily unavailable.
      }
      nextSession = decideStepApproval(releaseSession.value, {
        approvalId: pendingApproval.approvalId,
        decision: isApprove ? 'approved' : 'rejected',
        actor: 'chat-user'
      })
    } else if (isApprove) {
      nextSession = createStepApproval(releaseSession.value, {
        stepId,
        action: RELEASE_STEP_BY_ID[stepId]?.toolName || stepId,
        target: releaseSession.value.version ? `release/v${releaseSession.value.version}` : '',
        summary: `等待人工确认 ${RELEASE_STEP_BY_ID[stepId]?.label || stepId}`
      })
    }

    applyReleaseSession(nextSession)

    if (!isApprove) {
      runtime.pushMessage('agent', `已取消 ${RELEASE_STEP_BY_ID[stepId]?.label || stepId}。当前会话保持暂停。`, null, {
        kind: 'notice',
        status: 'warning'
      })
      return
    }

    const result = await executeReleaseStep(stepId)

    if (result?.ok && stepId === 'mergeLatest') {
      await executeReleaseStep('buildVerification')
    }

    if (result?.ok && stepId === 'tagRelease') {
      await executeReleaseStep('confluenceDraft')
    }
  }

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
    await ensureReleaseSession({
      environment: 'production'
    })
    await runReleaseAgent('发布生产环境，请开始检查凭证、获取版本列表，并在完成基础检查后继续生成完整发布会话。')
  }

  async function runRoutedAgent(userText) {
    const { route, workflow, effectiveUserText, preserveReleaseSession } = resolveStickyRoute(userText)

    setWorkflow(workflow.id, { preserveReleaseSession })
    if (workflow.id === 'release') {
      sessionActive.value = true
      await ensureReleaseSession({
        environment: environment.value
      })
    }

    return runtime.runAgent(effectiveUserText, {
      displayUserText: userText,
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
    if (actionId === 'fetch-jira-versions-unreleased') {
      return executeReleaseStep('versionSelection', { release_state: 'unreleased' })
    }
    if (actionId === 'fetch-jira-versions-released') {
      return executeReleaseStep('versionSelection', { release_state: 'released' })
    }
    if (actionId === 'fetch-jira-versions-all') {
      return executeReleaseStep('versionSelection', { release_state: 'all' })
    }
    if (actionId.startsWith('approve-') || actionId.startsWith('reject-')) {
      return handleApprovalAction(actionId)
    }
    if (actionId.startsWith('version-')) {
      const selectedVersion = actionId.replace('version-', '')
      setWorkflow('release')
      version.value = selectedVersion
      sessionActive.value = true
      await ensureReleaseSession({
        version: selectedVersion,
        environment: environment.value
      })
      return runRoutedAgent(`选择版本 ${selectedVersion}，请获取该版本的 issue 列表并继续后续检查。`)
    }
    if (actionId.startsWith('retry-')) {
      const toolName = actionId.replace('retry-', '')
      delete toolResults[toolName]
      return runReleaseAgent(`请重新执行 ${toolName}。`)
    }
    if (actionId.startsWith('resume-step-')) {
      const stepId = actionId.replace('resume-step-', '')
      return executeReleaseStep(stepId)
    }
  }

  function resetSession() {
    runtime.resetRuntime()
    currentWorkflowId.value = 'general'
    mode.value = 'general'
    activeTrace.value = null
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
    releaseSession,
    approvals,
    currentGate,
    releaseArtifacts,
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
    configChanges,
    i18nArtifacts,
    activeTrace,
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
