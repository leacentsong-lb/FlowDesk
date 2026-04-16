import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import { getEditableAppTools } from '../../agent/tools/index.js'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    const normalizedLanguage = language && hljs.getLanguage(language) ? language : 'plaintext'
    const highlighted = normalizedLanguage === 'plaintext'
      ? escapeHtml(code)
      : hljs.highlight(code, { language: normalizedLanguage }).value

    return `<pre class="hljs"><code>${highlighted}</code></pre>`
  }
})

const DEFAULT_TOOL_LABELS = {
  load_skill: '加载技能',
  run_command: '执行命令',
  bash: '执行命令',
  read_file: '读取文件',
  read: '读取文件',
  list_directory: '查看目录',
  ls: '查看目录',
  write: '写入文件',
  edit: '编辑文件',
  multiedit: '批量编辑文件',
  glob: '查找文件',
  grep: '搜索内容',
  scan_workspace_repos: '扫描仓库',
  todo_write: '更新待办',
  web_search: '联网搜索',
  check_credentials: '检查凭证',
  fetch_jira_versions: '获取 Jira 版本',
  fetch_version_issues: '获取版本 Issue',
  scan_pr_status: '扫描 PR 状态',
  run_preflight: '执行预检',
  run_build: '执行构建'
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isJsonLike(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}

/**
 * @param {string} value
 * @returns {{ ok: true, value: unknown } | { ok: false }}
 */
function tryParseJson(value) {
  if (!isJsonLike(value)) return { ok: false }

  try {
    return {
      ok: true,
      value: JSON.parse(value)
    }
  } catch {
    return { ok: false }
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatJson(value) {
  if (typeof value === 'string') {
    const parsed = tryParseJson(value)
    if (parsed.ok) {
      return JSON.stringify(parsed.value, null, 2)
    }
    return value
  }

  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value ?? '')
  }
}

/**
 * @param {string} text
 * @param {number} [maxLength]
 * @returns {string}
 */
export function summarizeReasoning(text, maxLength = 42) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；：、,.!?！？])\s*/g, '$1')
    .trim()

  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/**
 * @param {string} text
 * @returns {Array<object>}
 */
export function buildBlocksFromText(text) {
  const blocks = []
  const source = String(text ?? '')
  const fencePattern = /```([\w-]+)?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = fencePattern.exec(source))) {
    const leading = source.slice(lastIndex, match.index)
    blocks.push(...buildTextBlocks(leading))
    blocks.push({
      type: 'code',
      language: (match[1] || 'text').toLowerCase(),
      content: match[2].replace(/\n$/, '')
    })
    lastIndex = fencePattern.lastIndex
  }

  const trailing = source.slice(lastIndex)
  blocks.push(...buildTextBlocks(trailing))

  return blocks.length > 0
    ? blocks
    : [{ type: 'markdown', content: source }]
}

/**
 * @param {string} segment
 * @returns {Array<object>}
 */
function buildTextBlocks(segment) {
  if (!segment || !segment.trim()) return []

  const trimmed = segment.trim()
  const parsed = tryParseJson(trimmed)

  if (parsed.ok) {
    return [{
      type: 'json',
      raw: trimmed,
      content: parsed.value
    }]
  }

  return [{
    type: 'markdown',
    content: segment
  }]
}

/**
 * @param {Array<object> | null | undefined} actions
 * @returns {Array<object>}
 */
function normalizeActions(actions) {
  return Array.isArray(actions)
    ? actions.map(action => ({
      variant: 'secondary',
      disabled: false,
      ...action
    }))
    : []
}

/**
 * @param {Array<object>} actions
 * @returns {string}
 */
export function getActionPromptText(actions) {
  const actionIds = normalizeActions(actions).map(action => String(action.id || ''))

  if (actionIds.length === 0) return '请选择下一步操作。'
  if (actionIds.every(id => id.startsWith('version-'))) return '请选择要继续处理的版本。'
  if (actionIds.some(id => id.startsWith('retry-'))) return '执行失败，请选择下一步操作。'
  if (actionIds.includes('open-settings')) return '请先完成必要配置。'
  return '请选择下一步操作。'
}

/**
 * @param {object} options
 * @param {string} options.toolName
 * @param {string} options.status
 * @param {string} [options.toolLabel]
 * @param {string} [options.summary]
 * @param {object} [options.meta]
 * @returns {string}
 */
export function formatCompactToolText({ toolName, status, toolLabel = '', summary = '', meta = {} }) {
  const safeToolName = String(toolName || 'tool')
  const safeToolLabel = String(toolLabel || toolName || '工具').trim()
  const safeSummary = String(summary || '').trim()
  const skillName = String(meta?.skillName || '').trim()

  if (safeToolName === 'load_skill') {
    if (status === 'running') {
      return `Skill(${skillName || 'loading'}): 正在加载技能...`
    }
    if (status === 'error') {
      return `Skill(${skillName || 'unknown'}): ${safeSummary || '加载失败，请选择下一步操作。'}`
    }
    return `Skill(${skillName || 'unknown'}): 已加载技能。`
  }

  if (status === 'running') {
    return `Tool(${safeToolName}): 正在执行 ${safeToolLabel}...`
  }

  if (status === 'recovering') {
    return `Tool(${safeToolName}): ${safeSummary || '参数不完整，Agent 正在自动修复后重试。'}`
  }

  if (status === 'error') {
    return `Tool(${safeToolName}): ${safeSummary || '执行失败，请选择下一步操作。'}`
  }

  if (status === 'success') {
    return `Tool(${safeToolName}): ${safeSummary || '执行完成。'}`
  }

  return `Tool(${safeToolName}): ${safeSummary || '等待执行。'}`
}

/**
 * @param {string} text
 * @param {Array<object>} actions
 * @returns {string}
 */
export function compressActionMessageText(text, actions) {
  const source = String(text || '').trim()
  const normalizedActions = normalizeActions(actions)

  if (normalizedActions.length === 0) return source
  if (!source) return getActionPromptText(normalizedActions)
  if (source.length <= 32 && !source.includes('\n')) return source

  const looksVerbose = (
    source.length > 80 ||
    source.includes('\n') ||
    source.includes('当前状态') ||
    source.includes('请确认') ||
    source.includes('问题') ||
    source.includes('下一步')
  )

  return looksVerbose ? getActionPromptText(normalizedActions) : source
}

/**
 * @param {object} block
 * @returns {object}
 */
function normalizeBlock(block) {
  if (!block || !block.type) {
    return { type: 'markdown', content: '' }
  }

  if (block.type === 'json') {
    return {
      type: 'json',
      raw: block.raw || formatJson(block.content),
      content: block.content ?? {}
    }
  }

  if (block.type === 'actions') {
    return {
      type: 'actions',
      items: normalizeActions(block.items)
    }
  }

  if (block.type === 'code') {
    return {
      type: 'code',
      language: (block.language || 'text').toLowerCase(),
      content: String(block.content ?? '')
    }
  }

  return {
    type: 'markdown',
    content: String(block.content ?? '')
  }
}

/**
 * @param {object} message
 * @returns {object}
 */
export function normalizeChatMessage(message) {
  const normalizedActions = normalizeActions(message.actions)
  const normalizedText = compressActionMessageText(message.text || '', normalizedActions)
  const normalizedBlocks = Array.isArray(message.blocks) && message.blocks.length > 0
    ? message.blocks.map(normalizeBlock)
    : buildBlocksFromText(normalizedText)

  const hasActionBlock = normalizedBlocks.some(block => block.type === 'actions')
  if (!hasActionBlock && normalizedActions.length > 0) {
    normalizedBlocks.push({
      type: 'actions',
      items: normalizedActions
    })
  }

  return {
    id: message.id || `${Date.now()}-${Math.random()}`,
    role: message.role || 'agent',
    text: normalizedText,
    actions: normalizedActions,
    kind: message.kind || 'message',
    status: message.status || 'idle',
    meta: message.meta || {},
    ts: message.ts ? new Date(message.ts) : new Date(),
    _streaming: message._streaming === true,
    _reasoning: message._reasoning || '',
    blocks: normalizedBlocks
  }
}

/**
 * @param {string} content
 * @returns {string}
 */
export function renderMarkdown(content) {
  return DOMPurify.sanitize(markdown.render(content || ''))
}

/**
 * @param {string} content
 * @param {string} language
 * @returns {string}
 */
export function renderCode(content, language = 'text') {
  const safeLanguage = language && hljs.getLanguage(language) ? language : 'plaintext'
  if (safeLanguage === 'plaintext') {
    return escapeHtml(content)
  }

  return hljs.highlight(content, { language: safeLanguage }).value
}

/**
 * @param {string} toolName
 * @param {string} description
 * @returns {string}
 */
export function getToolLabel(toolName, description = '') {
  const customizedLabel = getEditableAppTools().find(tool => tool.name === toolName)?.label || ''
  if (customizedLabel) return customizedLabel
  if (DEFAULT_TOOL_LABELS[toolName]) return DEFAULT_TOOL_LABELS[toolName]

  const cleaned = String(description || '').replace(/^对/, '').trim()
  if (cleaned && !cleaned.includes('\n') && cleaned.length <= 24) {
    return cleaned
  }
  return toolName
}

/**
 * @param {string} status
 * @returns {string}
 */
export function getStatusLabel(status) {
  if (status === 'running') return '运行中'
  if (status === 'recovering') return '自动修复中'
  if (status === 'success') return '已完成'
  if (status === 'warning') return '需关注'
  if (status === 'error') return '失败'
  return '待处理'
}

/**
 * @param {string} status
 * @returns {string}
 */
export function getStatusTone(status) {
  if (status === 'running') return 'info'
  if (status === 'recovering') return 'warning'
  if (status === 'success') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'error'
  return 'muted'
}
