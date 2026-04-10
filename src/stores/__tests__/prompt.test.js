import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePromptStore } from '../prompt'

describe('prompt store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('loads defaults when no prompt config is saved', () => {
    const prompt = usePromptStore()

    expect(prompt.config.role.generalIntro).toContain('你是开发助手')
    expect(prompt.config.workflow.general).toContain('默认优先处理通用工程任务')
    expect(prompt.config.responseRules).toContain('用中文回复')
  })

  it('persists updates and can reset back to defaults', () => {
    const prompt = usePromptStore()

    prompt.config.role.generalIntro = '测试 Prompt'
    prompt.savePromptConfig()

    const saved = JSON.parse(localStorage.getItem('agent_prompt_config_v1'))
    expect(saved.role.generalIntro).toBe('测试 Prompt')

    prompt.resetPromptConfig()

    expect(prompt.config.role.generalIntro).toContain('你是开发助手')
  })
})
