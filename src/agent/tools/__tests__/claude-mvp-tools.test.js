import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  readSchema,
  readHandler,
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
} from '../filesystem.js'
import { schema as todoWriteSchema, handler as todoWriteHandler } from '../todo.js'
import { schema as webSearchSchema, handler as webSearchHandler } from '../web.js'
import { TOOLS, TOOL_HANDLERS } from '../index.js'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('Claude-style MVP tool surface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('registers Claude-style MVP tools in the tool catalog', () => {
    const toolNames = TOOLS.map(tool => tool.function.name)

    expect(toolNames).toEqual(expect.arrayContaining([
      'bash',
      'read',
      'ls',
      'write',
      'edit',
      'multiedit',
      'glob',
      'grep',
      'todo_write',
      'web_search',
      'create_release_session',
      'generate_release_readiness_report',
      'execute_release_merge',
      'create_release_tag',
      'generate_confluence_draft',
      'publish_confluence_release_doc'
    ]))

    expect(typeof TOOL_HANDLERS.bash).toBe('function')
    expect(typeof TOOL_HANDLERS.todo_write).toBe('function')
    expect(typeof TOOL_HANDLERS.web_search).toBe('function')
  })

  it('maps read/ls aliases to existing filesystem tauri commands', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, content: 'demo', path: 'README.md' })
      .mockResolvedValueOnce({ ok: true, items: [], path: '.' })

    expect(readSchema.function.name).toBe('read')
    expect(lsSchema.function.name).toBe('ls')

    await readHandler({ path: 'README.md', limit: 20 }, {})
    await lsHandler({ path: '.' }, {})

    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_read_file', {
      path: 'README.md',
      limit: 20
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_list_dir', {
      path: '.'
    })
  })

  it('routes write/edit/multiedit through dedicated file mutation commands', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, path: 'notes.txt', bytes: 12 })
      .mockResolvedValueOnce({ ok: true, path: 'notes.txt', replacements: 1 })
      .mockResolvedValueOnce({ ok: true, path: 'notes.txt', replacements: 2 })

    const ctx = { settings: { workspacePath: '/tmp/workspace' } }

    expect(writeSchema.function.name).toBe('write')
    expect(editSchema.function.name).toBe('edit')
    expect(multieditSchema.function.name).toBe('multiedit')

    await writeHandler({ path: 'notes.txt', content: 'hello world\n' }, ctx)
    await editHandler({ path: 'notes.txt', old_string: 'hello', new_string: 'hi' }, ctx)
    await multieditHandler({
      path: 'notes.txt',
      edits: [
        { old_string: 'hi', new_string: 'hey' },
        { old_string: 'world', new_string: 'team' }
      ]
    }, ctx)

    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_write_file', {
      path: 'notes.txt',
      content: 'hello world\n',
      workspacePath: '/tmp/workspace'
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_edit_file', {
      path: 'notes.txt',
      oldString: 'hello',
      newString: 'hi',
      replaceAll: false,
      workspacePath: '/tmp/workspace'
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'agent_multiedit_file', {
      path: 'notes.txt',
      edits: [
        { oldString: 'hi', newString: 'hey', replaceAll: false },
        { oldString: 'world', newString: 'team', replaceAll: false }
      ],
      workspacePath: '/tmp/workspace'
    })
  })

  it('implements glob/grep by scoping shell search to the workspace', async () => {
    invoke
      .mockResolvedValueOnce({
        ok: true,
        stdout: './src/agent/graph.js\n./src/agent/tools/index.js\n',
        stderr: '',
        exitCode: 0
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: './src/agent/graph.js:12:const MAX_ROUNDS = 20\n',
        stderr: '',
        exitCode: 0
      })

    const ctx = { settings: { workspacePath: '/tmp/workspace' } }

    const globResult = await globHandler({ pattern: 'src/agent/**/*.js', path: '.' }, ctx)
    const grepResult = await grepHandler({ pattern: 'MAX_ROUNDS', path: '.' }, ctx)

    expect(globSchema.function.name).toBe('glob')
    expect(grepSchema.function.name).toBe('grep')
    expect(globResult.matches).toEqual([
      'src/agent/graph.js',
      'src/agent/tools/index.js'
    ])
    expect(grepResult.matches[0]).toEqual({
      path: 'src/agent/graph.js',
      line: 12,
      content: 'const MAX_ROUNDS = 20'
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_run_command', expect.objectContaining({
      cwd: '.',
      workspacePath: '/tmp/workspace'
    }))
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_run_command', expect.objectContaining({
      cwd: '.',
      workspacePath: '/tmp/workspace'
    }))
  })

  it('persists TodoWrite payloads while enforcing a single in-progress item', async () => {
    expect(todoWriteSchema.function.name).toBe('todo_write')

    const result = await todoWriteHandler({
      todos: [
        { content: 'Inspect repo', status: 'completed', activeForm: 'Inspected repo' },
        { content: 'Implement MVP tools', status: 'in_progress', activeForm: 'Implementing MVP tools' }
      ]
    }, {})

    expect(result.ok).toBe(true)
    expect(result.todos).toHaveLength(2)
    expect(result.summary).toContain('2 个')
    expect(JSON.parse(localStorage.getItem('flow-desk-agent-todos'))).toHaveLength(2)

    const invalid = await todoWriteHandler({
      todos: [
        { content: 'A', status: 'in_progress', activeForm: 'Doing A' },
        { content: 'B', status: 'in_progress', activeForm: 'Doing B' }
      ]
    }, {})

    expect(invalid.ok).toBe(false)
    expect(invalid.error).toContain('最多只能有一个')
  })

  it('delegates web_search to a dedicated backend command', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      query: 'langgraph',
      results: [
        { title: 'LangGraph docs', url: 'https://langchain-ai.github.io/langgraph/', snippet: 'Build stateful agents' }
      ]
    })

    expect(webSearchSchema.function.name).toBe('web_search')

    await webSearchHandler({ query: 'langgraph', limit: 5 }, {
      settings: {
        searchConfig: {
          provider: 'tavily',
          apiKey: 'tvly-test'
        }
      }
    })

    expect(invoke).toHaveBeenCalledWith('agent_web_search', {
      query: 'langgraph',
      limit: 5,
      provider: 'tavily',
      apiKey: 'tvly-test'
    })
  })
})
