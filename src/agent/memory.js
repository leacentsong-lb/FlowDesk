import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

const MEMORY_FILENAME = 'AGENT.md'
const MEMORY_DIR = '.flow-desk'
const SUMMARY_LIMIT = 160

export function getProjectMemoryPath(workspacePath = '') {
  const root = String(workspacePath || '').trim()
  if (!root) return ''
  return `${root}/${MEMORY_DIR}/${MEMORY_FILENAME}`
}

export async function getUserMemoryPath() {
  const home = await homeDir().catch(() => '')
  const root = String(home || '').trim()
  if (!root) return ''
  return `${root}/${MEMORY_DIR}/${MEMORY_FILENAME}`
}

export async function loadAgentMemories({ workspacePath } = {}) {
  const projectPath = getProjectMemoryPath(workspacePath)
  const userPath = await getUserMemoryPath()

  const [projectMemory, userMemory] = await Promise.all([
    readMemoryFile(projectPath),
    readMemoryFile(userPath)
  ])

  const summaryParts = []
  if (projectMemory) summaryParts.push(`Project memory: ${summarizeMemory(projectMemory)}`)
  if (userMemory) summaryParts.push(`User memory: ${summarizeMemory(userMemory)}`)

  return {
    projectMemory,
    userMemory,
    summary: summaryParts.join('\n'),
    sources: {
      project: projectPath,
      user: userPath
    }
  }
}

async function readMemoryFile(path) {
  if (!path) return ''

  try {
    const result = await invoke('agent_read_file', { path })
    if (result?.ok === false) return ''
    return String(result?.content || '').trim()
  } catch {
    return ''
  }
}

function summarizeMemory(content) {
  const lines = String(content || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const preview = lines.slice(0, 2).join('; ')
  if (!preview) return ''

  return preview.length > SUMMARY_LIMIT
    ? `${preview.slice(0, SUMMARY_LIMIT)}…`
    : preview
}
