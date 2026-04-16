/**
 * SkillLoader — Mirrors learn-claude-code s05.
 *
 * Loads specialized knowledge from .md files with frontmatter.
 * The agent calls `load_skill` to inject domain knowledge into context.
 *
 * Skill format:
 *   ---
 *   name: release-flow
 *   description: ...
 *   ---
 *   # Markdown body
 */

import gitBranchingRaw from './skills/git-branching.md?raw'
import releaseFlowRaw from './skills/release-flow.md?raw'
import troubleshootingRaw from './skills/troubleshooting.md?raw'
import workspaceTopologyRaw from './skills/workspace-topology.md?raw'
import {
  loadAppSkillOverrides,
  resetAppSkillOverride,
  saveAppSkillOverride
} from './customization.js'

const BUILTIN_SKILLS = {}

const skillFiles = {
  './skills/git-branching.md': gitBranchingRaw,
  './skills/release-flow.md': releaseFlowRaw,
  './skills/troubleshooting.md': troubleshootingRaw,
  './skills/workspace-topology.md': workspaceTopologyRaw
}

for (const [path, raw] of Object.entries(skillFiles)) {
  const { meta, body } = parseFrontmatter(raw)
  const fallbackName = path.split('/').pop().replace('.md', '')
  const name = meta.name || fallbackName
  BUILTIN_SKILLS[name] = { name, meta, body, raw, path }
}

const DEFAULT_CUSTOM_SKILL_BASENAME = 'custom-debug-skill'

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
  if (!match) return { meta: {}, body: text.trim() }

  const meta = {}
  for (const line of match[1].trim().split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return { meta, body: match[2].trim() }
}

function summarizeLine(value, maxLength = 120) {
  const normalized = String(value || '')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function extractFirstMeaningfulSnippet(body = '') {
  const lines = String(body || '').split('\n')
  let inCodeBlock = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock || !line) continue
    if (line.startsWith('#')) continue

    const normalized = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim()
    if (!normalized) continue
    return summarizeLine(normalized)
  }

  return ''
}

function buildSkillSummary(skill) {
  const description = summarizeLine(skill?.meta?.description || '')
  const synopsis = extractFirstMeaningfulSnippet(skill?.body || '')
  const title = summarizeLine(skill?.meta?.title || skill?.name || '')

  return {
    name: skill?.name || '',
    title,
    description,
    synopsis
  }
}

export class SkillLoader {
  /**
   * Get a one-line description of each available skill.
   */
  descriptions() {
    const entries = Object.entries(resolveSkillCatalog())
    if (entries.length === 0) return '(no skills)'
    return entries
      .map(([name, s]) => `  - ${name}: ${s.meta.description || '-'}`)
      .join('\n')
  }

  /**
   * Build concise summaries for routing/prompt use.
   */
  summaries() {
    return Object.values(resolveSkillCatalog()).map(skill => buildSkillSummary(skill))
  }

  /**
   * Build a prompt-friendly skill directory without inlining full skill bodies.
   */
  promptIndex() {
    const summaries = this.summaries()
    if (summaries.length === 0) return '- (no skills available)'

    return summaries
      .map(summary => {
        const parts = [
          `- \`${summary.name}\``,
          summary.description || null,
          summary.synopsis && summary.synopsis !== summary.description ? `摘要：${summary.synopsis}` : null
        ].filter(Boolean)

        return parts.join(' — ')
      })
      .join('\n')
  }

  /**
   * Load a skill by name. Returns the full markdown body wrapped in <skill> tags.
   */
  load(name) {
    const skill = resolveSkillCatalog()[name]
    if (!skill) {
      return `Error: Unknown skill "${name}". Available: ${Object.keys(resolveSkillCatalog()).join(', ')}`
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`
  }

  /**
   * List all skill names.
   */
  list() {
    return Object.keys(resolveSkillCatalog())
  }
}

export const defaultSkillLoader = new SkillLoader()

function createCustomSkillTemplate(name) {
  return [
    '---',
    `name: ${name}`,
    'description: 请填写这个自定义技能的用途',
    '---',
    '',
    '# 自定义技能',
    '',
    '## 适用场景',
    '',
    '- 什么时候应该使用这个技能？',
    '- 它主要帮助 AI 解决什么问题？',
    '',
    '## 操作步骤',
    '',
    '1. 在这里写第 1 步。',
    '2. 在这里写第 2 步。',
    '',
    '## 注意事项',
    '',
    '- 是否有不要使用它的场景？',
    '- 是否有风险、前置条件或限制？'
  ].join('\n')
}

function createUniqueSkillName(baseName = DEFAULT_CUSTOM_SKILL_BASENAME) {
  const catalog = resolveMergedSkillCatalog()
  if (!catalog[baseName]) return baseName

  let index = 2
  while (catalog[`${baseName}-${index}`]) {
    index += 1
  }
  return `${baseName}-${index}`
}

export function getEditableAppSkills() {
  return Object.values(resolveMergedSkillCatalog()).map(skill => {
    const summary = buildSkillSummary(skill)

    return {
      name: skill.name,
      title: skill.meta.title || skill.name,
      description: skill.meta.description || '',
      summary: summary.description || '',
      synopsis: summary.synopsis || '',
      path: skill.path,
      builtIn: skill.builtIn === true,
      enabled: skill.enabled !== false,
      customized: skill.customized === true,
      defaultContent: skill.defaultRaw,
      content: skill.raw
    }
  })
}

export function createEditableAppSkill(baseName = DEFAULT_CUSTOM_SKILL_BASENAME) {
  const name = createUniqueSkillName(baseName)
  const content = createCustomSkillTemplate(name)
  saveEditableAppSkill(name, {
    content,
    enabled: true
  })
  return {
    name,
    content
  }
}

export function saveEditableAppSkill(name, override) {
  saveAppSkillOverride(name, override)
}

export function resetEditableAppSkill(name) {
  resetAppSkillOverride(name)
}

function resolveMergedSkillCatalog() {
  const overrides = loadAppSkillOverrides()
  const builtInEntries = Object.entries(BUILTIN_SKILLS).map(([name, skill]) => {
    const override = overrides?.[name] || {}
    const raw = typeof override.content === 'string' ? override.content : skill.raw
    const parsed = parseFrontmatter(raw)

    return [name, {
      ...skill,
      meta: parsed.meta,
      body: parsed.body,
      raw,
      defaultRaw: skill.raw,
      enabled: override.enabled !== false,
      customized: typeof override.content === 'string' || typeof override.enabled === 'boolean',
      builtIn: true
    }]
  })

  const customEntries = Object.entries(overrides)
    .filter(([name]) => !BUILTIN_SKILLS[name])
    .map(([name, override]) => {
      const raw = typeof override?.content === 'string' ? override.content : ''
      if (!raw.trim()) return null
      const parsed = parseFrontmatter(raw)

      return [name, {
        name,
        meta: parsed.meta,
        body: parsed.body,
        raw,
        defaultRaw: raw,
        path: `app://skills/${name}`,
        enabled: override.enabled !== false,
        customized: true,
        builtIn: false
      }]
    })
    .filter(Boolean)

  return Object.fromEntries([...builtInEntries, ...customEntries])
}

function resolveSkillCatalog() {
  return Object.fromEntries(
    Object.entries(resolveMergedSkillCatalog())
      .filter(([, skill]) => skill.enabled !== false)
      .map(([name, skill]) => [name, skill])
  )
}
