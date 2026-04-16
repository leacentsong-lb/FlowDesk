/**
 * Release session and approval tools.
 */
import { invoke } from '@tauri-apps/api/core'

export const createReleaseSessionSchema = {
  type: 'function',
  function: {
    name: 'create_release_session',
    description: '创建一个新的 Release Session，用于跟踪版本、步骤状态、审批记录与产物。',
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: '可选版本号，如 3.8.2。初始化时也可以为空。'
        },
        environment: {
          type: 'string',
          description: '发布环境，如 production、staging。'
        }
      },
      required: ['environment']
    }
  }
}

export async function createReleaseSessionHandler(args) {
  return invoke('release_session_create', {
    version: args.version || null,
    environment: args.environment
  })
}

export const resumeReleaseSessionSchema = {
  type: 'function',
  function: {
    name: 'resume_release_session',
    description: '按 session_id 读取一个已有的 Release Session，继续后续流程。',
    parameters: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Release Session 唯一标识。'
        }
      },
      required: ['session_id']
    }
  }
}

export async function resumeReleaseSessionHandler(args) {
  return invoke('release_session_read', {
    sessionId: args.session_id
  })
}

export const getReleaseSessionSchema = {
  type: 'function',
  function: {
    name: 'get_release_session',
    description: '读取当前 Release Session 的完整结构化状态。',
    parameters: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Release Session 唯一标识。'
        }
      },
      required: ['session_id']
    }
  }
}

export async function getReleaseSessionHandler(args) {
  return invoke('release_session_read', {
    sessionId: args.session_id
  })
}

export const listReleaseSessionsSchema = {
  type: 'function',
  function: {
    name: 'list_release_sessions',
    description: '列出已有的 Release Session，可按状态筛选，用于恢复被中断的发布。',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: '可选状态筛选，如 ready、blocked、completed。'
        }
      },
      required: []
    }
  }
}

export async function listReleaseSessionsHandler(args) {
  return invoke('release_session_list', {
    status: args.status || null
  })
}

export const requestStepApprovalSchema = {
  type: 'function',
  function: {
    name: 'request_step_approval',
    description: '为某个危险发布步骤创建审批记录，供 Chat 界面渲染确认卡片。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' },
        step_id: { type: 'string', description: '步骤 ID，例如 mergeLatest、tagRelease。' },
        action: { type: 'string', description: '审批对应的动作 ID。' },
        target: { type: 'string', description: '本次审批要作用的目标，例如 release/v3.8.2 -> latest。' },
        summary: { type: 'string', description: '给审批人看的摘要文案。' }
      },
      required: ['session_id', 'step_id', 'action']
    }
  }
}

export async function requestStepApprovalHandler(args) {
  return invoke('release_approval_create', {
    sessionId: args.session_id,
    stepId: args.step_id,
    action: args.action,
    target: args.target || '',
    summary: args.summary || ''
  })
}

export const recordStepDecisionSchema = {
  type: 'function',
  function: {
    name: 'record_step_decision',
    description: '记录审批结果。只有 approved 后，危险步骤才允许继续执行。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' },
        approval_id: { type: 'string', description: '审批记录 ID。' },
        decision: {
          type: 'string',
          enum: ['approved', 'rejected'],
          description: '审批结果。'
        },
        actor: {
          type: 'string',
          description: '审批人标识。'
        }
      },
      required: ['session_id', 'approval_id', 'decision']
    }
  }
}

export async function recordStepDecisionHandler(args) {
  return invoke('release_approval_decide', {
    sessionId: args.session_id,
    approvalId: args.approval_id,
    decision: args.decision,
    actor: args.actor || 'user'
  })
}
