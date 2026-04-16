/**
 * Tool: load_skill
 * Mirrors learn-claude-code s05's load_skill.
 * Injects specialized domain knowledge into the agent's context.
 */
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
            description: '要加载的 skill 名称。',
            enum: defaultSkillLoader.list()
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
  const content = defaultSkillLoader.load(skillName)
  const ok = !content.startsWith('Error:')

  return {
    ok,
    skillName,
    summary: ok ? `已加载技能：${skillName}` : content,
    content
  }
}
