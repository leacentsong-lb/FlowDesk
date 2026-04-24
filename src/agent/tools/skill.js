/**
 * Tool: load_skill
 * Mirrors learn-claude-code s05's load_skill.
 * Injects specialized domain knowledge into the agent's context.
 */
import { invoke } from '@tauri-apps/api/core'
import { defaultSkillLoader } from '../skills.js'

export function createSkillSchema() {
  return {
    type: 'function',
    function: {
      name: 'load_skill',
      description: '按需加载专业技能或流程规范。仅在需要领域知识、检查清单或命名映射时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要加载的 skill 名称。'
          }
        },
        required: ['name']
      }
    }
  }
}

export const schema = createSkillSchema()

export async function handler(args, _ctx) {
  const skillName = String(args?.name || '').trim()
  const runtimeContent = await loadRuntimeSkillContent(skillName, _ctx?.state?.runtimeSkillCatalog || [])
  const content = runtimeContent || defaultSkillLoader.load(skillName)
  const ok = !content.startsWith('Error:')

  return {
    ok,
    skillName,
    summary: ok ? `已加载技能：${skillName}` : content,
    content
  }
}

async function loadRuntimeSkillContent(skillName, runtimeSkillCatalog = []) {
  const matchedSkill = Array.isArray(runtimeSkillCatalog)
    ? runtimeSkillCatalog.find(skill => skill?.name === skillName && skill?.skillPath)
    : null

  if (!matchedSkill?.skillPath) return ''

  try {
    const result = await invoke('agent_read_skill', {
      skillPath: matchedSkill.skillPath
    })
    const content = String(result?.content || '')
    const body = extractSkillBody(content)
    if (!body) return ''
    return `<skill name="${skillName}">\n${body}\n</skill>`
  } catch {
    return ''
  }
}

function extractSkillBody(content) {
  const raw = String(content || '')
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  return match ? match[1].trim() : raw.trim()
}
