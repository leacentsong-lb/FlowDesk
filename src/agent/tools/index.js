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
import { schema as skillSchema, handler as skillHandler } from './skill.js'
import { scanWorkspaceReposSchema, scanWorkspaceReposHandler } from './workspace.js'
import { schema as todoSchema, handler as todoHandler } from './todo.js'
import { schema as webSchema, handler as webHandler } from './web.js'

// -- Domain tools (release pipeline) --
import { schema as credentialsSchema, handler as credentialsHandler } from './credentials.js'
import { versionsSchema, versionsHandler, issuesSchema, issuesHandler } from './jira.js'
import { schema as prSchema, handler as prHandler } from './github.js'
import { schema as preflightSchema, handler as preflightHandler } from './preflight.js'
import { schema as buildSchema, handler as buildHandler } from './build.js'

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

/**
 * @param {string} toolName
 * @returns {object | undefined}
 */
export function getToolCatalogEntry(toolName) {
  return TOOL_CATALOG.find(tool => tool.schema.function.name === toolName)
}

/**
 * @param {string[]} names
 * @returns {Array<object>}
 */
export function getToolsByNames(names = []) {
  const nameSet = new Set(names)
  return TOOL_CATALOG
    .filter(tool => nameSet.has(tool.schema.function.name))
    .map(tool => tool.schema)
}

/**
 * @param {string[]} tags
 * @returns {Array<object>}
 */
export function getToolsByTags(tags = []) {
  const tagSet = new Set(tags)
  return TOOL_CATALOG
    .filter(tool => tool.tags.some(tag => tagSet.has(tag)))
    .map(tool => tool.schema)
}
