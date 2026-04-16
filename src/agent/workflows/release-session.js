/**
 * Release session state helpers.
 */

export const RELEASE_STEP_ORDER = [
  {
    id: 'credentials',
    label: '凭证检查',
    toolName: 'check_credentials',
    phase: 'check'
  },
  {
    id: 'versionSelection',
    label: '版本选择',
    toolName: 'fetch_jira_versions',
    phase: 'input'
  },
  {
    id: 'jiraIssues',
    label: 'Jira 范围检查',
    toolName: 'fetch_version_issues',
    phase: 'check'
  },
  {
    id: 'prStatus',
    label: 'PR 检查',
    toolName: 'scan_pr_status',
    phase: 'check'
  },
  {
    id: 'preflight',
    label: '发布预检',
    toolName: 'run_preflight',
    phase: 'check'
  },
  {
    id: 'configChanges',
    label: '配置变更',
    toolName: 'collect_config_changes',
    phase: 'check'
  },
  {
    id: 'applyConfigChanges',
    label: '应用配置变更',
    toolName: 'apply_config_changes',
    phase: 'execute',
    requiresApproval: true,
    dangerous: true
  },
  {
    id: 'i18nChanges',
    label: 'i18n 差异收集',
    toolName: 'collect_i18n_changes',
    phase: 'check'
  },
  {
    id: 'i18nArtifacts',
    label: 'i18n 产物',
    toolName: 'generate_i18n_artifacts',
    phase: 'check'
  },
  {
    id: 'readinessReport',
    label: '发布就绪报告',
    toolName: 'generate_release_readiness_report',
    phase: 'check'
  },
  {
    id: 'mergeLatest',
    label: '合并到 latest',
    toolName: 'execute_release_merge',
    phase: 'execute',
    requiresApproval: true,
    dangerous: true
  },
  {
    id: 'buildVerification',
    label: '构建验证',
    toolName: 'execute_post_merge_build',
    phase: 'execute'
  },
  {
    id: 'tagRelease',
    label: '创建 Tag',
    toolName: 'create_release_tag',
    phase: 'execute',
    requiresApproval: true,
    dangerous: true
  },
  {
    id: 'confluenceDraft',
    label: '文档草稿',
    toolName: 'generate_confluence_draft',
    phase: 'doc'
  },
  {
    id: 'confluencePublish',
    label: '发布文档',
    toolName: 'publish_confluence_release_doc',
    phase: 'doc',
    requiresApproval: true,
    dangerous: true
  }
]

export const RELEASE_STEP_BY_ID = Object.fromEntries(
  RELEASE_STEP_ORDER.map(step => [step.id, step])
)

export const RELEASE_STEP_BY_TOOL = Object.fromEntries(
  RELEASE_STEP_ORDER
    .filter(step => step.toolName)
    .map(step => [step.toolName, step])
)

export const RELEASE_GUARDED_TOOL_NAMES = new Set(
  RELEASE_STEP_ORDER
    .filter(step => step.requiresApproval || step.dangerous)
    .map(step => step.toolName)
)

function createReleaseStepState(step) {
  return {
    id: step.id,
    label: step.label,
    toolName: step.toolName || '',
    phase: step.phase || 'check',
    requiresApproval: step.requiresApproval === true,
    dangerous: step.dangerous === true,
    status: 'pending',
    summary: '',
    detail: '',
    updatedAt: '',
    result: null,
    approvalId: ''
  }
}

function timestamp() {
  return new Date().toISOString()
}

function shallowClone(session) {
  return {
    ...session,
    steps: Object.fromEntries(
      Object.entries(session.steps || {}).map(([stepId, step]) => [stepId, { ...step }])
    ),
    approvals: (session.approvals || []).map(approval => ({ ...approval })),
    artifacts: (session.artifacts || []).map(artifact => ({ ...artifact })),
    repos: [...(session.repos || [])],
    blockedSteps: [...(session.blockedSteps || [])],
    pendingApprovals: [...(session.pendingApprovals || [])],
    currentGate: session.currentGate ? { ...session.currentGate } : null
  }
}

function recomputeCurrentStepId(session) {
  const nextStep = RELEASE_STEP_ORDER.find(step => {
    const status = session.steps[step.id]?.status
    return !['done', 'skipped'].includes(status)
  })
  session.currentStepId = nextStep?.id || RELEASE_STEP_ORDER.at(-1)?.id || ''
}

function upsertArtifact(session, artifact) {
  const key = `${artifact.stepId}:${artifact.kind}:${artifact.path || artifact.title || ''}`
  const nextArtifacts = (session.artifacts || []).filter(existing => {
    const existingKey = `${existing.stepId}:${existing.kind}:${existing.path || existing.title || ''}`
    return existingKey !== key
  })
  nextArtifacts.push({
    ...artifact,
    createdAt: artifact.createdAt || timestamp()
  })
  session.artifacts = nextArtifacts
}

function markStep(session, stepId, patch) {
  const current = session.steps[stepId] || createReleaseStepState(RELEASE_STEP_BY_ID[stepId])
  session.steps[stepId] = {
    ...current,
    ...patch,
    updatedAt: timestamp()
  }
}

function setSessionStatus(session, status) {
  session.status = status
  session.updatedAt = timestamp()
}

function clearBlockedStep(session, stepId) {
  session.blockedSteps = (session.blockedSteps || []).filter(item => item !== stepId)
}

function addBlockedStep(session, stepId) {
  if (!session.blockedSteps.includes(stepId)) {
    session.blockedSteps.push(stepId)
  }
}

export function createReleaseSessionState(options = {}) {
  const steps = Object.fromEntries(
    RELEASE_STEP_ORDER.map(step => [step.id, createReleaseStepState(step)])
  )

  return {
    sessionId: options.sessionId || '',
    version: options.version || '',
    environment: options.environment || 'production',
    status: 'draft',
    currentStepId: RELEASE_STEP_ORDER[0]?.id || '',
    steps,
    approvals: [],
    artifacts: [],
    repos: [],
    blockedSteps: [],
    pendingApprovals: [],
    currentGate: null,
    createdAt: options.createdAt || timestamp(),
    updatedAt: options.updatedAt || timestamp()
  }
}

export function getStepStatus(session, stepId) {
  return session?.steps?.[stepId]?.status || 'pending'
}

export function getCompletedReleaseSteps(session) {
  return RELEASE_STEP_ORDER
    .filter(step => session?.steps?.[step.id]?.status === 'done')
    .map(step => step.id)
}

export function isReleaseSessionReadyForStep(session, stepId) {
  const step = session?.steps?.[stepId]
  if (!step) return false
  if (!step.requiresApproval) return true
  return (session.approvals || []).some(approval =>
    approval.stepId === stepId && approval.decision === 'approved'
  )
}

export function createStepApproval(session, options = {}) {
  const nextSession = shallowClone(session)
  const stepId = options.stepId
  if (!RELEASE_STEP_BY_ID[stepId]) return nextSession

  const approvalId = options.approvalId || `${stepId}-${Date.now()}`
  nextSession.approvals.push({
    approvalId,
    sessionId: nextSession.sessionId || '',
    stepId,
    action: options.action || RELEASE_STEP_BY_ID[stepId].toolName,
    target: options.target || '',
    summary: options.summary || '',
    requestedBy: options.requestedBy || 'system',
    approvedBy: '',
    decision: 'pending',
    ts: timestamp()
  })
  nextSession.pendingApprovals = (nextSession.pendingApprovals || []).filter(item => item.stepId !== stepId)
  nextSession.currentGate = {
    approvalId,
    stepId,
    action: options.action || RELEASE_STEP_BY_ID[stepId].toolName,
    target: options.target || '',
    summary: options.summary || ''
  }
  markStep(nextSession, stepId, {
    status: 'awaiting_approval',
    summary: options.summary || '等待人工审批',
    approvalId
  })
  setSessionStatus(nextSession, 'awaitingApproval')
  recomputeCurrentStepId(nextSession)
  return nextSession
}

export function decideStepApproval(session, options = {}) {
  const nextSession = shallowClone(session)
  const approvalId = options.approvalId || ''
  const approval = nextSession.approvals.find(item => item.approvalId === approvalId)
  if (!approval) return nextSession

  approval.decision = options.decision || 'rejected'
  approval.approvedBy = options.actor || 'unknown'
  approval.ts = timestamp()

  if (nextSession.currentGate?.approvalId === approvalId) {
    nextSession.currentGate = null
  }

  if (approval.decision === 'approved') {
    clearBlockedStep(nextSession, approval.stepId)
    markStep(nextSession, approval.stepId, {
      status: 'pending',
      summary: '审批已通过',
      detail: approval.target || ''
    })
    setSessionStatus(nextSession, 'ready')
  } else {
    addBlockedStep(nextSession, approval.stepId)
    markStep(nextSession, approval.stepId, {
      status: 'blocked',
      summary: '人工拒绝执行该步骤',
      detail: approval.target || ''
    })
    setSessionStatus(nextSession, 'blocked')
  }

  recomputeCurrentStepId(nextSession)
  return nextSession
}

export function syncReleaseSessionToolResult(session, payload = {}) {
  const nextSession = shallowClone(session)
  const { toolName, result, args } = payload
  const step = RELEASE_STEP_BY_TOOL[toolName]
  if (!step) {
    return nextSession
  }

  const status = result?.blocked || result?.ok === false || result?.error
    ? 'blocked'
    : 'done'
  const summary = result?.summary || ''
  const detail = result?.error || result?.detail || ''

  markStep(nextSession, step.id, {
    status,
    summary,
    detail,
    result: result || null
  })

  if (status === 'blocked') {
    addBlockedStep(nextSession, step.id)
    setSessionStatus(nextSession, result?.requiresApproval ? 'awaitingApproval' : 'blocked')
  } else {
    clearBlockedStep(nextSession, step.id)
    if (nextSession.status === 'draft') {
      setSessionStatus(nextSession, 'checking')
    }
  }

  if (toolName === 'fetch_jira_versions') {
    markStep(nextSession, 'versionSelection', {
      status: nextSession.version ? 'done' : 'waiting_input',
      summary: summary || '请选择发布版本',
      result: result || null
    })
  }

  if (toolName === 'fetch_version_issues') {
    nextSession.version = args?.version_name || result?.version || nextSession.version
    markStep(nextSession, 'versionSelection', {
      status: 'done',
      summary: `已选择版本 ${nextSession.version || '未命名版本'}`,
      detail: nextSession.version
    })
    setSessionStatus(nextSession, 'checking')
  }

  if (toolName === 'scan_pr_status') {
    nextSession.repos = Array.isArray(result?.repos) ? result.repos : nextSession.repos
  }

  if (toolName === 'generate_release_readiness_report') {
    nextSession.pendingApprovals = Array.isArray(result?.pendingApprovals) ? result.pendingApprovals : []
    setSessionStatus(nextSession, result?.ok ? 'ready' : 'blocked')
  }

  if (toolName === 'execute_release_merge' && status === 'done') {
    setSessionStatus(nextSession, 'executing')
  }

  if (toolName === 'publish_confluence_release_doc' && status === 'done') {
    setSessionStatus(nextSession, 'completed')
  }

  for (const artifact of result?.artifacts || []) {
    upsertArtifact(nextSession, {
      stepId: step.id,
      ...artifact
    })
  }

  recomputeCurrentStepId(nextSession)
  return nextSession
}

export function summarizeReleaseSession(session) {
  const completed = getCompletedReleaseSteps(session)
  const blocked = session?.blockedSteps || []
  return {
    completed,
    blocked,
    currentStepId: session?.currentStepId || '',
    status: session?.status || 'draft'
  }
}
