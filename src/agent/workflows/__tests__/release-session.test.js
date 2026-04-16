import { describe, expect, it } from 'vitest'
import {
  createReleaseSessionState,
  createStepApproval,
  decideStepApproval,
  getStepStatus,
  isReleaseSessionReadyForStep,
  syncReleaseSessionToolResult
} from '../release-session.js'

describe('release session workflow state', () => {
  it('creates a release session with ordered pending steps', () => {
    const session = createReleaseSessionState({
      environment: 'production'
    })

    expect(session.status).toBe('draft')
    expect(session.environment).toBe('production')
    expect(session.currentStepId).toBe('credentials')
    expect(session.steps.credentials.status).toBe('pending')
    expect(session.steps.mergeLatest.status).toBe('pending')
    expect(session.approvals).toEqual([])
    expect(session.artifacts).toEqual([])
  })

  it('marks preflight blockers and keeps the session blocked', () => {
    const session = createReleaseSessionState({
      sessionId: 'session-1',
      version: '3.8.2',
      environment: 'production'
    })

    const nextSession = syncReleaseSessionToolResult(session, {
      toolName: 'run_preflight',
      result: {
        ok: false,
        summary: '预检未通过：admin',
        results: [
          {
            repoKey: 'admin',
            ok: false,
            checks: {
              packageVersion: {
                ok: false,
                detail: '期望 3.8.2，实际 3.8.1'
              }
            }
          }
        ]
      }
    })

    expect(nextSession.status).toBe('blocked')
    expect(getStepStatus(nextSession, 'preflight')).toBe('blocked')
    expect(nextSession.blockedSteps).toContain('preflight')
  })

  it('creates an approval gate for merge and only unlocks the step after approval', () => {
    const session = createReleaseSessionState({
      sessionId: 'session-2',
      version: '3.8.2',
      environment: 'production'
    })

    const reportReady = syncReleaseSessionToolResult(session, {
      toolName: 'generate_release_readiness_report',
      result: {
        ok: true,
        summary: '发布检查全部通过，可以申请合并。',
        status: 'ready',
        pendingApprovals: [
          {
            stepId: 'mergeLatest',
            action: 'execute_release_merge',
            target: 'release/v3.8.2 -> latest'
          }
        ]
      }
    })

    expect(reportReady.status).toBe('ready')
    expect(isReleaseSessionReadyForStep(reportReady, 'mergeLatest')).toBe(false)

    const withApproval = createStepApproval(reportReady, {
      stepId: 'mergeLatest',
      action: 'execute_release_merge',
      target: 'release/v3.8.2 -> latest',
      summary: '确认执行 release/v3.8.2 -> latest 合并'
    })
    const approvalId = withApproval.currentGate.approvalId

    expect(withApproval.currentGate.stepId).toBe('mergeLatest')
    expect(withApproval.steps.mergeLatest.status).toBe('awaiting_approval')
    expect(isReleaseSessionReadyForStep(withApproval, 'mergeLatest')).toBe(false)

    const approved = decideStepApproval(withApproval, {
      approvalId,
      decision: 'approved',
      actor: 'tester'
    })

    expect(approved.currentGate).toBe(null)
    expect(approved.approvals[0].decision).toBe('approved')
    expect(isReleaseSessionReadyForStep(approved, 'mergeLatest')).toBe(true)
  })
})
