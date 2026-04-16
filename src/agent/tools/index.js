/**
 * Tool Registry — The dispatch map + schema array.
 *
 * Follows the learn-claude-code pattern:
 *   TOOL_HANDLERS = { name: handler }   // dispatch
 *   TOOLS         = [{ schema }]        // for LLM
 *
 * Adding a new tool = add one import + one entry in each map.
 *
 * Tools are organized in two tiers:
 *   1. Base tools  — run_command, read_file, list_directory, load_skill
 *   2. Domain tools — credentials, jira, github, preflight, build
 */

// -- Base tools (s02 pattern: bash, read_file, etc.) --
import { schema as commandSchema, handler as commandHandler, bashSchema, bashHandler } from './command.js'
import {
  readFileSchema,
  readFileHandler,
  readSchema,
  readHandler,
  listDirSchema,
  listDirHandler,
  lsSchema,
  lsHandler,
  writeSchema,
  writeHandler,
  editSchema,
  editHandler,
  multieditSchema,
  multieditHandler,
  globSchema,
  globHandler,
  grepSchema,
  grepHandler
} from './filesystem.js'
import { createSkillSchema, schema as skillSchema, handler as skillHandler } from './skill.js'
import {
  loadAppToolOverrides,
  resetAppToolOverride,
  saveAppToolOverride
} from '../customization.js'
import { scanWorkspaceReposSchema, scanWorkspaceReposHandler } from './workspace.js'
import { schema as todoSchema, handler as todoHandler } from './todo.js'
import { schema as webSchema, handler as webHandler } from './web.js'

// -- Domain tools (release pipeline) --
import { schema as credentialsSchema, handler as credentialsHandler } from './credentials.js'
import { versionsSchema, versionsHandler, issuesSchema, issuesHandler } from './jira.js'
import { schema as prSchema, handler as prHandler } from './github.js'
import { schema as preflightSchema, handler as preflightHandler } from './preflight.js'
import { schema as buildSchema, handler as buildHandler } from './build.js'
import {
  createReleaseSessionSchema,
  createReleaseSessionHandler,
  resumeReleaseSessionSchema,
  resumeReleaseSessionHandler,
  getReleaseSessionSchema,
  getReleaseSessionHandler,
  listReleaseSessionsSchema,
  listReleaseSessionsHandler,
  requestStepApprovalSchema,
  requestStepApprovalHandler,
  recordStepDecisionSchema,
  recordStepDecisionHandler
} from './release-session.js'
import {
  collectConfigChangesSchema,
  collectConfigChangesHandler,
  previewConfigChangesSchema,
  previewConfigChangesHandler,
  applyConfigChangesSchema,
  applyConfigChangesHandler,
  collectI18nChangesSchema,
  collectI18nChangesHandler,
  generateI18nArtifactsSchema,
  generateI18nArtifactsHandler,
  generateReleaseReadinessReportSchema,
  generateReleaseReadinessReportHandler,
  executeReleaseMergeSchema,
  executeReleaseMergeHandler,
  executePostMergeBuildSchema,
  executePostMergeBuildHandler,
  createReleaseTagSchema,
  createReleaseTagHandler,
  generateConfluenceDraftSchema,
  generateConfluenceDraftHandler,
  publishConfluenceReleaseDocSchema,
  publishConfluenceReleaseDocHandler
} from './release-ops.js'

export const TOOL_CATALOG = [
  {
    schema: commandSchema,
    handler: commandHandler,
    tags: ['base', 'shell', 'dangerous']
  },
  {
    schema: bashSchema,
    handler: bashHandler,
    tags: ['base', 'shell', 'dangerous', 'claude']
  },
  {
    schema: readFileSchema,
    handler: readFileHandler,
    tags: ['base', 'filesystem']
  },
  {
    schema: readSchema,
    handler: readHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: listDirSchema,
    handler: listDirHandler,
    tags: ['base', 'filesystem']
  },
  {
    schema: lsSchema,
    handler: lsHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: writeSchema,
    handler: writeHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: editSchema,
    handler: editHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: multieditSchema,
    handler: multieditHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: globSchema,
    handler: globHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: grepSchema,
    handler: grepHandler,
    tags: ['base', 'filesystem', 'claude']
  },
  {
    schema: scanWorkspaceReposSchema,
    handler: scanWorkspaceReposHandler,
    tags: ['base', 'workspace']
  },
  {
    schema: skillSchema,
    handler: skillHandler,
    tags: ['base', 'skills']
  },
  {
    schema: todoSchema,
    handler: todoHandler,
    tags: ['base', 'planning', 'claude']
  },
  {
    schema: webSchema,
    handler: webHandler,
    tags: ['base', 'web', 'claude']
  },
  {
    schema: credentialsSchema,
    handler: credentialsHandler,
    tags: ['release']
  },
  {
    schema: versionsSchema,
    handler: versionsHandler,
    tags: ['release']
  },
  {
    schema: issuesSchema,
    handler: issuesHandler,
    tags: ['release']
  },
  {
    schema: prSchema,
    handler: prHandler,
    tags: ['release']
  },
  {
    schema: preflightSchema,
    handler: preflightHandler,
    tags: ['release']
  },
  {
    schema: buildSchema,
    handler: buildHandler,
    tags: ['release']
  },
  {
    schema: createReleaseSessionSchema,
    handler: createReleaseSessionHandler,
    tags: ['release']
  },
  {
    schema: resumeReleaseSessionSchema,
    handler: resumeReleaseSessionHandler,
    tags: ['release']
  },
  {
    schema: getReleaseSessionSchema,
    handler: getReleaseSessionHandler,
    tags: ['release']
  },
  {
    schema: listReleaseSessionsSchema,
    handler: listReleaseSessionsHandler,
    tags: ['release']
  },
  {
    schema: requestStepApprovalSchema,
    handler: requestStepApprovalHandler,
    tags: ['release']
  },
  {
    schema: recordStepDecisionSchema,
    handler: recordStepDecisionHandler,
    tags: ['release']
  },
  {
    schema: collectConfigChangesSchema,
    handler: collectConfigChangesHandler,
    tags: ['release']
  },
  {
    schema: previewConfigChangesSchema,
    handler: previewConfigChangesHandler,
    tags: ['release']
  },
  {
    schema: applyConfigChangesSchema,
    handler: applyConfigChangesHandler,
    tags: ['release', 'dangerous']
  },
  {
    schema: collectI18nChangesSchema,
    handler: collectI18nChangesHandler,
    tags: ['release']
  },
  {
    schema: generateI18nArtifactsSchema,
    handler: generateI18nArtifactsHandler,
    tags: ['release']
  },
  {
    schema: generateReleaseReadinessReportSchema,
    handler: generateReleaseReadinessReportHandler,
    tags: ['release']
  },
  {
    schema: executeReleaseMergeSchema,
    handler: executeReleaseMergeHandler,
    tags: ['release', 'dangerous']
  },
  {
    schema: executePostMergeBuildSchema,
    handler: executePostMergeBuildHandler,
    tags: ['release']
  },
  {
    schema: createReleaseTagSchema,
    handler: createReleaseTagHandler,
    tags: ['release', 'dangerous']
  },
  {
    schema: generateConfluenceDraftSchema,
    handler: generateConfluenceDraftHandler,
    tags: ['release']
  },
  {
    schema: publishConfluenceReleaseDocSchema,
    handler: publishConfluenceReleaseDocHandler,
    tags: ['release', 'dangerous']
  }
]

/**
 * Dispatch map: { tool_name: async (args, ctx) => result }
 * The Agent Loop calls `TOOL_HANDLERS[name](args, ctx)`.
 */
export const TOOL_HANDLERS = Object.fromEntries(
  TOOL_CATALOG.map(tool => [tool.schema.function.name, tool.handler])
)

/**
 * Schema array for the LLM's `tools` parameter.
 * The LLM reads these and decides which tool to call.
 */
export const TOOLS = TOOL_CATALOG.map(tool => tool.schema)

function cloneSchema(schema) {
  return JSON.parse(JSON.stringify(schema))
}

function materializeToolCatalogEntry(tool) {
  const schema = tool.schema.function?.name === 'load_skill'
    ? createSkillSchema()
    : cloneSchema(tool.schema)
  const toolName = schema.function?.name || ''
  const override = loadAppToolOverrides()?.[toolName] || {}

  if (override.description) {
    schema.function.description = override.description
  }

  return {
    ...tool,
    schema,
    displayLabel: override.label || '',
    enabled: override.enabled !== false,
    customized: Boolean(
      typeof override.enabled === 'boolean' ||
      (typeof override.label === 'string' && override.label.trim()) ||
      (typeof override.description === 'string' && override.description.trim())
    )
  }
}

export function getEditableAppTools() {
  return TOOL_CATALOG.map(tool => {
    const materialized = materializeToolCatalogEntry(tool)
    const name = materialized.schema.function?.name || ''
    return {
      name,
      label: materialized.displayLabel || '',
      description: materialized.schema.function?.description || '',
      defaultDescription: tool.schema.function?.description || '',
      enabled: materialized.enabled !== false,
      customized: materialized.customized === true,
      tags: [...(tool.tags || [])]
    }
  })
}

export function saveEditableAppTool(name, override) {
  saveAppToolOverride(name, override)
}

export function resetEditableAppTool(name) {
  resetAppToolOverride(name)
}

/**
 * @param {string} toolName
 * @returns {object | undefined}
 */
export function getToolCatalogEntry(toolName) {
  return TOOL_CATALOG
    .map(materializeToolCatalogEntry)
    .find(tool => tool.enabled !== false && tool.schema.function.name === toolName)
}

/**
 * @param {string[]} names
 * @returns {Array<object>}
 */
export function getToolsByNames(names = []) {
  const nameSet = new Set(names)
  return TOOL_CATALOG
    .map(materializeToolCatalogEntry)
    .filter(tool => tool.enabled !== false && nameSet.has(tool.schema.function.name))
    .map(tool => tool.schema)
}

/**
 * @param {string[]} tags
 * @returns {Array<object>}
 */
export function getToolsByTags(tags = []) {
  const tagSet = new Set(tags)
  return TOOL_CATALOG
    .map(materializeToolCatalogEntry)
    .filter(tool => tool.enabled !== false && tool.tags.some(tag => tagSet.has(tag)))
    .map(tool => tool.schema)
}

export function getAllTools() {
  return TOOL_CATALOG
    .map(materializeToolCatalogEntry)
    .filter(tool => tool.enabled !== false)
    .map(tool => tool.schema)
}
