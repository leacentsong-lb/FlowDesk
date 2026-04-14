import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../context.js'
import { defaultSkillLoader } from '../skills.js'

describe('agent context', () => {
  it('describes the assistant as a generic development assistant in general mode', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      workspacePath: '/Users/demo/workspace',
      environment: 'production',
      completedTools: []
    })

    expect(prompt).toContain('你是开发助手')
    expect(prompt).toContain('默认运行在通用 coding harness 模式')
    expect(prompt).toContain('当前工作区：/Users/demo/workspace')
    expect(prompt).not.toContain('fetch_jira_versions')
    expect(prompt).not.toContain('run_preflight')
    expect(prompt).not.toContain('你是 Workspace Agent')
  })

  it('injects current workspace path into the system prompt', () => {
    const prompt = buildSystemPrompt({
      environment: 'production',
      workspacePath: '/Users/demo/workspace',
      completedTools: []
    })

    expect(prompt).toContain('当前工作区：/Users/demo/workspace')
  })

  it('shows only the provided general tool surface by default', () => {
    const prompt = buildSystemPrompt({
      workspacePath: '/Users/demo/workspace',
      availableTools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: '读取本地文件内容'
          }
        },
        {
          type: 'function',
          function: {
            name: 'list_directory',
            description: '列出目录结构'
          }
        }
      ]
    })

    expect(prompt).toContain('read_file')
    expect(prompt).toContain('list_directory')
    expect(prompt).not.toContain('fetch_jira_versions')
  })

  it('shows release tools only when the release workflow is active', () => {
    const prompt = buildSystemPrompt({
      mode: 'release',
      workspacePath: '/Users/demo/workspace',
      availableTools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: '读取本地文件内容'
          }
        },
        {
          type: 'function',
          function: {
            name: 'fetch_jira_versions',
            description: '获取 Jira 未发布版本列表'
          }
        }
      ]
    })

    expect(prompt).toContain('获取 Jira 未发布版本列表')
    expect(prompt).toContain('发布协作模式')
  })

  it('tells the release agent to keep replies short when actions are available', () => {
    const prompt = buildSystemPrompt({
      mode: 'release',
      workspacePath: '/Users/demo/workspace'
    })

    expect(prompt).toContain('如果你已经给出了按钮')
    expect(prompt).toContain('不要再输出大段总结')
  })

  it('tells the agent to use background mode for local dev servers', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      workspacePath: '/Users/demo/workspace'
    })

    expect(prompt).toContain('mode: "background"')
    expect(prompt).toContain('dev 服务')
  })

  it('registers the workspace-topology built-in skill', () => {
    expect(defaultSkillLoader.list()).toContain('workspace-topology')
  })

  it('shows loaded skill bundles when available', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      workspacePath: '/Users/demo/workspace',
      primedSkillBundle: '<skill name="git-branching">branch rules</skill>'
    })

    expect(prompt).toContain('## Primed Skills')
    expect(prompt).toContain('branch rules')
  })

  it('injects memory summary into the system prompt when available', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      workspacePath: '/Users/demo/workspace',
      memorySummary: 'Project memory: repo mapping already confirmed',
      completedTools: []
    })

    expect(prompt).toContain('## Memory')
    expect(prompt).toContain('Project memory: repo mapping already confirmed')
  })

  it('supports prompt config overrides for role, workflow and response rules', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      workspacePath: '/Users/demo/workspace',
      promptConfig: {
        role: {
          generalIntro: '你是一个可调试的 Prompt Agent。'
        },
        workflow: {
          general: '- 回答前先输出当前 Prompt Profile。'
        },
        responseRules: [
          '先给结论，再给细节',
          '输出末尾追加 [PromptDebug]'
        ]
      }
    })

    expect(prompt).toContain('你是一个可调试的 Prompt Agent。')
    expect(prompt).toContain('回答前先输出当前 Prompt Profile')
    expect(prompt).toContain('先给结论，再给细节')
    expect(prompt).toContain('输出末尾追加 [PromptDebug]')
  })
})
