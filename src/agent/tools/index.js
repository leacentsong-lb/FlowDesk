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
import { schema as commandSchema, handler as commandHandler } from './command.js'
import { readFileSchema, readFileHandler, listDirSchema, listDirHandler } from './filesystem.js'
import { schema as skillSchema, handler as skillHandler } from './skill.js'
import { scanWorkspaceReposSchema, scanWorkspaceReposHandler } from './workspace.js'

// -- Domain tools (release pipeline) --
import { schema as credentialsSchema, handler as credentialsHandler } from './credentials.js'
import { versionsSchema, versionsHandler, issuesSchema, issuesHandler } from './jira.js'
import { schema as prSchema, handler as prHandler } from './github.js'
import { schema as preflightSchema, handler as preflightHandler } from './preflight.js'
import { schema as buildSchema, handler as buildHandler } from './build.js'

/**
 * Dispatch map: { tool_name: async (args, ctx) => result }
 * The Agent Loop calls `TOOL_HANDLERS[name](args, ctx)`.
 */
export const TOOL_HANDLERS = {
  // Base
  run_command:           commandHandler,
  read_file:             readFileHandler,
  list_directory:        listDirHandler,
  scan_workspace_repos:  scanWorkspaceReposHandler,
  load_skill:            skillHandler,

  // Domain
  check_credentials:     credentialsHandler,
  fetch_jira_versions:   versionsHandler,
  fetch_version_issues:  issuesHandler,
  scan_pr_status:        prHandler,
  run_preflight:         preflightHandler,
  run_build:             buildHandler,
}

/**
 * Schema array for the LLM's `tools` parameter.
 * The LLM reads these and decides which tool to call.
 *
 * Order matters: base tools first, then domain tools.
 */
export const TOOLS = [
  // Base
  commandSchema,
  readFileSchema,
  listDirSchema,
  scanWorkspaceReposSchema,
  skillSchema,

  // Domain
  credentialsSchema,
  versionsSchema,
  issuesSchema,
  prSchema,
  preflightSchema,
  buildSchema,
]
