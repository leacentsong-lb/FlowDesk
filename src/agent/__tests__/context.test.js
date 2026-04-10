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
    expect(prompt).toContain('默认优先处理通用工程任务')
    expect(prompt).toContain('只有在用户明确提到发布')
    expect(prompt).toContain('当前工作区：/Users/demo/workspace')
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

  it('tells the agent to load workspace-topology for workspace and repo questions', () => {
    const prompt = buildSystemPrompt({
      workspacePath: '/Users/demo/workspace'
    })

    expect(prompt).toContain('load_skill')
    expect(prompt).toContain('workspace-topology')
    expect(prompt).toContain('仓库')
    expect(prompt).toContain('工作区')
  })

  it('tells the agent to load git-branching for commit message questions', () => {
    const prompt = buildSystemPrompt({
      workspacePath: '/Users/demo/workspace'
    })

    expect(prompt).toContain('git-branching')
    expect(prompt).toContain('commit message')
    expect(prompt).toContain('本地分支')
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
