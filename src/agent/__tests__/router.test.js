import { describe, expect, it } from 'vitest'
import { routeAgentIntent } from '../router.js'

describe('routeAgentIntent', () => {
  it('routes workspace inventory questions to general mode', () => {
    const route = routeAgentIntent('分析当前工作区有哪些仓库，列出名称')

    expect(route).toMatchObject({
      mode: 'general',
      intent: 'workspace_inventory',
      shouldPrimeWorkspaceSkill: true,
      shouldScanWorkspaceFirst: true
    })
  })

  it('routes admin repo mapping questions to general mode', () => {
    const route = routeAgentIntent('admin 对应哪个仓库')

    expect(route).toMatchObject({
      mode: 'general',
      intent: 'workspace_mapping',
      shouldPrimeWorkspaceSkill: true,
      shouldScanWorkspaceFirst: false
    })
  })

  it('routes commit message questions to general mode and primes git-branching', () => {
    const route = routeAgentIntent('请根据当前本地分支帮我生成 commit message')

    expect(route).toMatchObject({
      mode: 'general',
      intent: 'git_commit_message',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false,
      primeSkillNames: ['git-branching']
    })
  })

  it('routes release questions to release mode', () => {
    const route = routeAgentIntent('发布生产环境，请开始检查')

    expect(route).toMatchObject({
      mode: 'release',
      intent: 'release_flow',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false
    })
  })

  it('routes file reading questions to general mode', () => {
    const route = routeAgentIntent('请读一下 src/agent/context.js')

    expect(route).toMatchObject({
      mode: 'general',
      intent: 'file_explain',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false
    })
  })

  it('does not mistake generic english words containing "pr" for release flow', () => {
    const route = routeAgentIntent('please explain the project structure')

    expect(route).toMatchObject({
      mode: 'general',
      intent: 'general_chat',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false
    })
  })
})
