/**
 * @returns {Array<object>}
 */
function buildVersionActions(result) {
  return (result?.versions || []).slice(0, 8).map(versionOption => ({
    id: `version-${versionOption.name}`,
    label: versionOption.name,
    variant: 'secondary'
  }))
}

/**
 * @returns {Array<object>}
 */
function buildVersionScopeActions() {
  return [
    {
      id: 'fetch-jira-versions-unreleased',
      label: '查看未发布版本',
      variant: 'primary'
    },
    {
      id: 'fetch-jira-versions-released',
      label: '查看已发布版本',
      variant: 'secondary'
    },
    {
      id: 'fetch-jira-versions-all',
      label: '查看全部版本',
      variant: 'ghost'
    }
  ]
}

/**
 * @param {string} stepId
 * @param {string} confirmLabel
 * @returns {Array<object>}
 */
function buildApprovalActions(stepId, confirmLabel) {
  return [
    {
      id: `approve-${stepId}`,
      label: confirmLabel,
      variant: 'danger'
    },
    {
      id: `reject-${stepId}`,
      label: '取消',
      variant: 'secondary'
    }
  ]
}

/**
 * @param {string} stepId
 * @returns {Array<object>}
 */
function buildResumeActions(stepId) {
  return [
    {
      id: `resume-step-${stepId}`,
      label: '重试当前步骤',
      variant: 'secondary'
    }
  ]
}

/**
 * @param {object} options
 * @param {string} options.toolName
 * @param {object} options.result
 * @returns {object | null}
 */
export function handleReleaseToolEnd({ toolName, result }) {
  if (toolName === 'check_credentials' && result?.ok) {
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-version-scope-${Date.now()}`,
        type: 'selection-card',
        title: '凭证已就绪',
        description: '请选择接下来要查看的 Jira 版本范围。',
        actions: buildVersionScopeActions()
      }
    }
  }

  if (toolName === 'fetch_jira_versions' && result?.versions?.length) {
    const versionActions = buildVersionActions(result)
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-version-selection-${Date.now()}`,
        type: 'selection-card',
        title: '选择发布版本',
        description: '请选择要继续处理的版本。',
        actions: versionActions
      }
    }
  }

  if (toolName === 'generate_release_readiness_report' && result?.ok) {
    const nextApproval = result?.pendingApprovals?.[0]
    if (!nextApproval?.stepId) {
      return null
    }

    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-approval-${nextApproval.stepId}-${Date.now()}`,
        type: 'approval-card',
        title: '确认执行危险操作',
        description: result.summary || '所有预检已经通过，请确认是否继续执行危险步骤。',
        actions: buildApprovalActions(nextApproval.stepId, '确认继续'),
        meta: {
          severity: 'high',
          approvalLabel: '需要人工授权',
          stepId: nextApproval.stepId
        }
      }
    }
  }

  if (toolName === 'generate_confluence_draft' && result?.ok) {
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-publish-confluence-${Date.now()}`,
        type: 'approval-card',
        title: '确认发布运维文档',
        description: result.summary || 'Confluence 草稿已生成，请确认是否正式发布。',
        actions: buildApprovalActions('confluencePublish', '确认发布'),
        meta: {
          severity: 'high',
          approvalLabel: '需要人工授权'
        }
      }
    }
  }

  if (toolName === 'apply_config_changes' && result?.ok) {
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-approval-mergeLatest-${Date.now()}`,
        type: 'approval-card',
        title: '确认继续合并',
        description: result.summary || '配置变更已处理完成，请确认是否继续执行 release -> latest 合并。',
        actions: buildApprovalActions('mergeLatest', '确认合并'),
        meta: {
          severity: 'high',
          approvalLabel: '需要人工授权'
        }
      }
    }
  }

  if (toolName === 'execute_release_merge' && result?.ok) {
    return {
      messages: [
        {
          text: result.summary || 'release -> latest 合并完成，建议继续做构建验证。',
          kind: 'notice',
          status: 'success'
        }
      ]
    }
  }

  if (toolName === 'execute_post_merge_build' && result?.ok) {
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-approval-tagRelease-${Date.now()}`,
        type: 'approval-card',
        title: '确认创建 Tag',
        description: result.summary || '构建验证通过，请确认是否继续创建 release tag。',
        actions: buildApprovalActions('tagRelease', '确认创建 Tag'),
        meta: {
          severity: 'high',
          approvalLabel: '需要人工授权'
        }
      }
    }
  }

  if (toolName === 'create_release_tag' && result?.ok) {
    return {
      messages: [
        {
          text: result.summary || 'Tag 创建完成，建议继续生成发布文档草稿。',
          kind: 'notice',
          status: 'success'
        }
      ]
    }
  }

  const stepId = result?.stepId
  if (result?.ok === false && stepId) {
    return {
      suppressNextAssistantText: true,
      interaction: {
        id: `interaction-resume-${stepId}-${Date.now()}`,
        type: 'resume-card',
        title: '步骤执行失败',
        description: result.summary || '当前步骤执行失败，可在确认后重试。',
        actions: buildResumeActions(stepId),
        meta: {
          severity: result.blocked ? 'high' : 'default'
        }
      }
    }
  }

  return null
}
