import { describe, expect, it } from 'vitest'
import { routeAgentIntent } from '../router.js'

describe('routeAgentIntent', () => {
  it('keeps ordinary workspace questions in the general harness', () => {
    const route = routeAgentIntent('分析当前工作区有哪些仓库，列出名称')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'low',
      requiresApproval: false
    })
  })

  it('keeps repo mapping questions in the general harness', () => {
    const route = routeAgentIntent('admin 对应哪个仓库')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'low',
      requiresApproval: false
    })
  })

  it('keeps commit message questions in the general harness', () => {
    const route = routeAgentIntent('请根据当前本地分支帮我生成 commit message')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'low',
      requiresApproval: false
    })
  })

  it('routes release questions to the release workflow', () => {
    const route = routeAgentIntent('发布生产环境，请开始检查')

    expect(route).toMatchObject({
      mode: 'release',
      workflowId: 'release',
      riskLevel: 'high',
      requiresApproval: false
    })
  })

  it('keeps file reading questions in the general harness', () => {
    const route = routeAgentIntent('请读一下 src/agent/context.js')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'low',
      requiresApproval: false
    })
  })

  it('does not mistake generic english words containing "pr" for release flow', () => {
    const route = routeAgentIntent('please explain the project structure')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'low',
      requiresApproval: false
    })
  })

  it('marks dangerous destructive requests as approval-required', () => {
    const route = routeAgentIntent('帮我执行 rm -rf dist 并重新初始化')

    expect(route).toMatchObject({
      mode: 'general',
      workflowId: 'general',
      riskLevel: 'high',
      requiresApproval: true
    })
  })
})
