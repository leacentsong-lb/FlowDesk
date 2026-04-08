/**
 * Tools: read_file, list_directory
 * Equivalent to learn-claude-code's "read_file" tool.
 * Gives the agent ability to inspect local files and directories.
 */
import { invoke } from '@tauri-apps/api/core'

// -- read_file -----------------------------------------------------------

export const readFileSchema = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取本地文件内容。可用于查看 package.json、配置文件、日志等。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件的绝对路径或相对路径' },
        limit: { type: 'integer', description: '最多读取的行数（可选，默认读取全部）' }
      },
      required: ['path']
    }
  }
}

export async function readFileHandler(args, _ctx) {
  const result = await invoke('agent_read_file', {
    path: args.path,
    limit: args.limit || null
  })
  return result
}

// -- list_directory ------------------------------------------------------

export const listDirSchema = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: '列出目录下的文件和子目录。可用于了解项目结构。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' }
      },
      required: ['path']
    }
  }
}

export async function listDirHandler(args, _ctx) {
  const result = await invoke('agent_list_dir', {
    path: args.path
  })
  return result
}
