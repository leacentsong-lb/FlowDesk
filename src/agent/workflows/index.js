import { getToolsByTags } from '../tools/index.js'
import { handleReleaseToolEnd } from './release.js'

export const GENERAL_WORKFLOW = {
  id: 'general',
  mode: 'general',
  toolTags: ['base'],
  promptFragment: '默认运行在通用 harness 模式。优先基于当前可用工具自行决定读取文件、查看目录、加载 skill 或直接回答。'
}

export const RELEASE_WORKFLOW = {
  id: 'release',
  mode: 'release',
  toolTags: ['base', 'release'],
  promptFragment: [
    '当前运行在 release workflow。',
    '如果当前已经存在 Release Session，用户输入“继续/下一步/好的”等中性消息时，视为继续当前发布会话。',
    '先围绕当前 Release Session 推进步骤，不要跳过检查顺序。',
    '推荐顺序：check_credentials -> fetch_jira_versions -> fetch_version_issues -> scan_pr_status -> run_preflight -> collect_config_changes -> collect_i18n_changes -> generate_i18n_artifacts -> generate_release_readiness_report。',
    '只有在就绪报告通过且用户已在 Chat 中明确授权后，才允许继续执行 apply_config_changes / execute_release_merge / create_release_tag / publish_confluence_release_doc。',
    '如遇 blocked 或 awaiting approval，优先解释状态、等待用户操作，不要擅自继续危险步骤。',
    '不要把“当前步骤被闸门拦截”或“当前会话仍在发布流程中”错误表述成“工具无法调用”。'
  ].join(' '),
  afterTool: handleReleaseToolEnd
}

const WORKFLOW_MAP = {
  general: GENERAL_WORKFLOW,
  release: RELEASE_WORKFLOW
}

/**
 * @param {string} workflowId
 * @returns {object}
 */
export function resolveAgentWorkflow(workflowId = 'general') {
  return WORKFLOW_MAP[workflowId] || GENERAL_WORKFLOW
}

/**
 * @param {string} workflowId
 * @returns {Array<object>}
 */
export function getWorkflowTools(workflowId = 'general') {
  const workflow = resolveAgentWorkflow(workflowId)
  return getToolsByTags(workflow.toolTags)
}
