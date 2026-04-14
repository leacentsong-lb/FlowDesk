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
  promptFragment: '当前运行在 release workflow。优先推进版本、PR、预检和构建等发布步骤，但仍可在需要时使用通用基础工具。',
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
