/**
 * Release Agent — Public API.
 *
 * Architecture (from learn-claude-code):
 *
 *   agent/
 *   ├── index.js          ← you are here (public API)
 *   ├── loop.js           ← while(true) agent loop
 *   ├── context.js        ← system prompt + compression
 *   ├── skills.js         ← SkillLoader (s05)
 *   ├── skills/           ← .md skill files
 *   │   ├── release-flow.md
 *   │   ├── git-branching.md
 *   │   └── troubleshooting.md
 *   └── tools/
 *       ├── index.js      ← TOOL_HANDLERS + TOOLS (dispatch map + schemas)
 *       ├── command.js     ← run_command (bash equivalent)
 *       ├── filesystem.js  ← read_file, list_directory
 *       ├── skill.js       ← load_skill
 *       ├── credentials.js ← check_credentials
 *       ├── jira.js        ← fetch_jira_versions, fetch_version_issues
 *       ├── github.js      ← scan_pr_status
 *       ├── preflight.js   ← run_preflight
 *       └── build.js       ← run_build
 *
 * Usage from the store:
 *
 *   import { agentLoop } from '@/agent'
 *   await agentLoop(messages, { ctx, state, onText, onToolStart, onToolEnd })
 */

export { agentLoop } from './loop.js'
export { TOOL_HANDLERS, TOOLS, getAllTools, getToolsByTags, getToolCatalogEntry } from './tools/index.js'
export { buildSystemPrompt, estimateTokens, microcompact } from './context.js'
export { SkillLoader, defaultSkillLoader, getEditableAppSkills } from './skills.js'
