/**
 * Release workflow domain tools.
 */
import { invoke } from '@tauri-apps/api/core'

export const collectConfigChangesSchema = {
  type: 'function',
  function: {
    name: 'collect_config_changes',
    description: '扫描本次发布涉及仓库中的配置差异，输出结构化配置变更列表。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' },
        version: { type: 'string', description: '版本号，如 3.8.2。' },
        repos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              path: { type: 'string' }
            }
          },
          description: '参与发布的仓库列表。'
        }
      },
      required: ['session_id', 'version', 'repos']
    }
  }
}

export async function collectConfigChangesHandler(args) {
  return invoke('release_collect_config_changes', {
    sessionId: args.session_id,
    version: args.version,
    repos: args.repos || []
  })
}

export const previewConfigChangesSchema = {
  type: 'function',
  function: {
    name: 'preview_config_changes',
    description: '读取当前 Release Session 的配置变更预览和 diff，用于审批前展示。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function previewConfigChangesHandler(args) {
  return invoke('release_preview_config_changes', {
    sessionId: args.session_id
  })
}

export const applyConfigChangesSchema = {
  type: 'function',
  function: {
    name: 'apply_config_changes',
    description: '在审批通过后，将结构化配置变更正式写入目标仓库文件。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function applyConfigChangesHandler(args) {
  return invoke('release_apply_config_changes', {
    sessionId: args.session_id
  })
}

export const collectI18nChangesSchema = {
  type: 'function',
  function: {
    name: 'collect_i18n_changes',
    description: '扫描 release 分支与 latest 的 i18n 差异，返回变更的 key 列表。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' },
        version: { type: 'string', description: '版本号，如 3.8.2。' },
        repos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              path: { type: 'string' }
            }
          },
          description: '参与发布的仓库列表。'
        }
      },
      required: ['session_id', 'version', 'repos']
    }
  }
}

export async function collectI18nChangesHandler(args) {
  return invoke('release_collect_i18n_changes', {
    sessionId: args.session_id,
    version: args.version,
    repos: args.repos || []
  })
}

export const generateI18nArtifactsSchema = {
  type: 'function',
  function: {
    name: 'generate_i18n_artifacts',
    description: '基于已收集的 i18n 变更为本次发布生成 CSV 产物，并挂到 Release Session。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function generateI18nArtifactsHandler(args) {
  return invoke('release_generate_i18n_artifacts', {
    sessionId: args.session_id
  })
}

export const generateReleaseReadinessReportSchema = {
  type: 'function',
  function: {
    name: 'generate_release_readiness_report',
    description: '汇总所有发布检查结果，给出 ready 或 blocked 结论，并列出后续待审批步骤。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function generateReleaseReadinessReportHandler(args) {
  return invoke('release_generate_readiness_report', {
    sessionId: args.session_id
  })
}

export const executeReleaseMergeSchema = {
  type: 'function',
  function: {
    name: 'execute_release_merge',
    description: '在审批通过后，把 release 分支合并到 latest，并把 merge 结果写回 Release Session。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function executeReleaseMergeHandler(args) {
  return invoke('release_execute_merge', {
    sessionId: args.session_id
  })
}

export const executePostMergeBuildSchema = {
  type: 'function',
  function: {
    name: 'execute_post_merge_build',
    description: '在 merge 成功后，对相关仓库执行构建验证，并把结果写回 Release Session。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function executePostMergeBuildHandler(args) {
  return invoke('release_execute_post_merge_build', {
    sessionId: args.session_id
  })
}

export const createReleaseTagSchema = {
  type: 'function',
  function: {
    name: 'create_release_tag',
    description: '在审批通过后，为本次发布创建 release tag，并记录 commit sha。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function createReleaseTagHandler(args) {
  return invoke('release_create_tag', {
    sessionId: args.session_id
  })
}

export const generateConfluenceDraftSchema = {
  type: 'function',
  function: {
    name: 'generate_confluence_draft',
    description: '根据 Release Session 当前结果生成发布文档草稿，并附带 i18n/config 产物信息。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' }
      },
      required: ['session_id']
    }
  }
}

export async function generateConfluenceDraftHandler(args) {
  return invoke('release_generate_confluence_draft', {
    sessionId: args.session_id
  })
}

export const publishConfluenceReleaseDocSchema = {
  type: 'function',
  function: {
    name: 'publish_confluence_release_doc',
    description: '在审批通过后，正式发布 Confluence 运维发布文档，并回写页面链接。',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Release Session 唯一标识。' },
        draft_id: {
          type: 'string',
          description: '可选草稿 ID；为空时默认发布当前 session 的最新草稿。'
        }
      },
      required: ['session_id']
    }
  }
}

export async function publishConfluenceReleaseDocHandler(args) {
  return invoke('release_publish_confluence_doc', {
    sessionId: args.session_id,
    draftId: args.draft_id || null
  })
}
