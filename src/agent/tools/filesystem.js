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
    description: '读取本地文件内容。必须提供明确 path；如果还不知道文件路径，先用 list_directory、glob 或 scan_workspace_repos 定位后再调用。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件的绝对路径或相对路径，例如 ./package.json；不能为空' },
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

export const readSchema = {
  ...readFileSchema,
  function: {
    ...readFileSchema.function,
    name: 'read',
    description: '读取本地文件内容。适用于查看代码、配置、日志和文档。'
  }
}

export async function readHandler(args, ctx) {
  return readFileHandler(args, ctx)
}

// -- list_directory ------------------------------------------------------

export const listDirSchema = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: '列出目录下的文件和子目录。传入明确 path，可用于先定位文件再读取。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，例如 .、src、/abs/path' }
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

export const lsSchema = {
  ...listDirSchema,
  function: {
    ...listDirSchema.function,
    name: 'ls',
    description: '列出目录内容。适用于快速了解当前目录结构。'
  }
}

export async function lsHandler(args, ctx) {
  return listDirHandler(args, ctx)
}

export const writeSchema = {
  type: 'function',
  function: {
    name: 'write',
    description: '写入整个文件内容；文件不存在则创建。会覆盖原内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '要写入的完整内容' }
      },
      required: ['path', 'content']
    }
  }
}

export async function writeHandler(args, ctx) {
  return invoke('agent_write_file', {
    path: args.path,
    content: args.content,
    workspacePath: ctx?.settings?.workspacePath || null
  })
}

export const editSchema = {
  type: 'function',
  function: {
    name: 'edit',
    description: '在文件中做单次精确替换。默认要求 old_string 只匹配一次。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '待替换的原始文本' },
        new_string: { type: 'string', description: '替换后的文本' },
        replace_all: { type: 'boolean', description: '是否替换所有匹配，默认 false' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  }
}

export async function editHandler(args, ctx) {
  return invoke('agent_edit_file', {
    path: args.path,
    oldString: args.old_string,
    newString: args.new_string,
    replaceAll: Boolean(args.replace_all),
    workspacePath: ctx?.settings?.workspacePath || null
  })
}

export const multieditSchema = {
  type: 'function',
  function: {
    name: 'multiedit',
    description: '按顺序对同一个文件执行多次精确替换。适合一轮完成多个小修改。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        edits: {
          type: 'array',
          description: '按顺序执行的编辑列表',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: '待替换的原始文本' },
              new_string: { type: 'string', description: '替换后的文本' },
              replace_all: { type: 'boolean', description: '是否替换所有匹配，默认 false' }
            },
            required: ['old_string', 'new_string']
          }
        }
      },
      required: ['path', 'edits']
    }
  }
}

export async function multieditHandler(args, ctx) {
  return invoke('agent_multiedit_file', {
    path: args.path,
    edits: (args.edits || []).map(edit => ({
      oldString: edit.old_string,
      newString: edit.new_string,
      replaceAll: Boolean(edit.replace_all)
    })),
    workspacePath: ctx?.settings?.workspacePath || null
  })
}

export const globSchema = {
  type: 'function',
  function: {
    name: 'glob',
    description: '在目录内按 glob pattern 查找文件，例如 src/**/*.js。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式，如 src/**/*.js' },
        path: { type: 'string', description: '起始目录，默认 .' }
      },
      required: ['pattern']
    }
  }
}

export async function globHandler(args, ctx) {
  const cwd = args.path || '.'
  const commandResult = await invoke('agent_run_command', {
    command: `find . -type f -not -path '*/.git/*'`,
    cwd,
    mode: 'wait',
    workspacePath: ctx?.settings?.workspacePath || null
  })

  if (!commandResult?.ok) {
    return {
      ok: false,
      matches: [],
      error: commandResult?.stderr || 'glob search failed'
    }
  }

  const matcher = globToRegExp(args.pattern)
  const matches = String(commandResult.stdout || '')
    .split('\n')
    .map(normalizeMatchedPath)
    .filter(Boolean)
    .filter(path => matcher.test(path))

  return {
    ok: true,
    matches,
    count: matches.length,
    summary: matches.length > 0
      ? `找到 ${matches.length} 个匹配文件`
      : '未找到匹配文件'
  }
}

export const grepSchema = {
  type: 'function',
  function: {
    name: 'grep',
    description: '在目录内递归搜索文本，返回匹配文件、行号和内容。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要搜索的文本或正则片段' },
        path: { type: 'string', description: '起始目录，默认 .' },
        case_sensitive: { type: 'boolean', description: '是否区分大小写，默认 true' }
      },
      required: ['pattern']
    }
  }
}

export async function grepHandler(args, ctx) {
  const cwd = args.path || '.'
  const flag = args.case_sensitive === false ? '-Rin' : '-RIn'
  const commandResult = await invoke('agent_run_command', {
    command: `grep ${flag} --binary-files=without-match --exclude-dir=.git -- ${shellEscape(args.pattern)} . || true`,
    cwd,
    mode: 'wait',
    workspacePath: ctx?.settings?.workspacePath || null
  })

  if (!commandResult?.ok && !String(commandResult?.stdout || '').trim()) {
    return {
      ok: false,
      matches: [],
      error: commandResult?.stderr || 'grep search failed'
    }
  }

  const matches = String(commandResult.stdout || '')
    .split('\n')
    .map(parseGrepLine)
    .filter(Boolean)

  return {
    ok: true,
    matches,
    count: matches.length,
    summary: matches.length > 0
      ? `找到 ${matches.length} 处匹配`
      : '未找到匹配内容'
  }
}

function normalizeMatchedPath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  if (!normalized) return ''
  return normalized.replace(/^\.\//, '')
}

function parseGrepLine(line) {
  const match = String(line || '').match(/^(.*?):(\d+):(.*)$/)
  if (!match) return null

  return {
    path: normalizeMatchedPath(match[1]),
    line: Number(match[2]),
    content: match[3]
  }
}

function globToRegExp(pattern) {
  const input = normalizeMatchedPath(pattern)
  let regex = '^'

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]
    const nextTwo = input.slice(i, i + 3)

    if (nextTwo === '**/') {
      regex += '(?:.*\\/)?'
      i += 2
      continue
    }

    if (char === '*' && next === '*') {
      regex += '.*'
      i += 1
      continue
    }

    if (char === '*') {
      regex += '[^/]*'
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      continue
    }

    regex += escapeRegExp(char)
  }

  regex += '$'
  return new RegExp(regex)
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function shellEscape(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`
}
