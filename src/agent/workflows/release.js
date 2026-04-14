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
 * @param {object} options
 * @param {string} options.toolName
 * @param {object} options.result
 * @returns {object | null}
 */
export function handleReleaseToolEnd({ toolName, result }) {
  if (toolName !== 'fetch_jira_versions' || !result?.versions?.length) {
    return null
  }

  const versionActions = buildVersionActions(result)
  return {
    suppressNextAssistantText: true,
    interaction: {
      id: `interaction-version-selection-${Date.now()}`,
      type: 'action-list',
      title: '选择发布版本',
      description: '请选择要继续处理的版本。',
      actions: versionActions
    }
  }
}
