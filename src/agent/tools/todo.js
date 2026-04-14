const TODO_STORAGE_KEY = 'flow-desk-agent-todos'

let memoryTodos = []

export const schema = {
  type: 'function',
  function: {
    name: 'todo_write',
    description: '更新当前任务清单。必须传入完整 todos 列表，且最多只能有一个 in_progress。',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '完整 todo 列表',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '任务内容' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '任务状态' },
              activeForm: { type: 'string', description: '进行中的动词形式，如 Implementing tests' }
            },
            required: ['content', 'status', 'activeForm']
          }
        }
      },
      required: ['todos']
    }
  }
}

export async function handler(args) {
  const todos = normalizeTodos(args?.todos)
  const inProgressCount = todos.filter(todo => todo.status === 'in_progress').length

  if (inProgressCount > 1) {
    return {
      ok: false,
      error: 'todo_write 最多只能有一个 in_progress 任务',
      todos: readTodos()
    }
  }

  writeTodos(todos)

  return {
    ok: true,
    todos,
    summary: todos.length > 0
      ? `已记录 ${todos.length} 个 todo，其中 ${todos.filter(todo => todo.status === 'completed').length} 个已完成。`
      : 'todo 已清空。'
  }
}

function normalizeTodos(input) {
  if (!Array.isArray(input)) return []

  return input
    .map(todo => ({
      content: String(todo?.content || '').trim(),
      status: normalizeStatus(todo?.status),
      activeForm: String(todo?.activeForm || '').trim()
    }))
    .filter(todo => todo.content && todo.activeForm)
}

function normalizeStatus(status) {
  return ['pending', 'in_progress', 'completed'].includes(status)
    ? status
    : 'pending'
}

function readTodos() {
  try {
    const raw = globalThis?.localStorage?.getItem(TODO_STORAGE_KEY)
    if (!raw) return memoryTodos
    return JSON.parse(raw)
  } catch {
    return memoryTodos
  }
}

function writeTodos(todos) {
  memoryTodos = todos

  try {
    globalThis?.localStorage?.setItem(TODO_STORAGE_KEY, JSON.stringify(todos))
  } catch {
    // ignore and keep memory fallback
  }
}
