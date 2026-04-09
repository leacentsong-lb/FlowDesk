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
  BUILTIN_SKILLS[name] = { meta, body, path }
}

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

export class SkillLoader {
  constructor() {
    this.skills = { ...BUILTIN_SKILLS }
  }

  /**
   * Get a one-line description of each available skill.
   */
  descriptions() {
    const entries = Object.entries(this.skills)
    if (entries.length === 0) return '(no skills)'
    return entries
      .map(([name, s]) => `  - ${name}: ${s.meta.description || '-'}`)
      .join('\n')
  }

  /**
   * Load a skill by name. Returns the full markdown body wrapped in <skill> tags.
   */
  load(name) {
    const skill = this.skills[name]
    if (!skill) {
      return `Error: Unknown skill "${name}". Available: ${Object.keys(this.skills).join(', ')}`
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`
  }

  /**
   * List all skill names.
   */
  list() {
    return Object.keys(this.skills)
  }
}

export const defaultSkillLoader = new SkillLoader()
