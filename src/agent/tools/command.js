/**
 * Tool: run_command
 * Equivalent to learn-claude-code's "bash" tool.
 * Runs a shell command in a specified directory.
 */
import { invoke } from '@tauri-apps/api/core'

export const schema = {
  type: 'function',
  function: {
    name: 'run_command',
    description: '在当前 workspace 内执行 shell 命令的兜底工具。优先使用专用 typed tools；只有在没有合适工具时才使用。启动 dev 服务时优先使用 background 模式。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '工作目录路径（可选，默认为当前目录）' },
        mode: {
          type: 'string',
          description: '执行模式。wait 表示等待命令结束；background 表示后台启动后尽快返回，适用于 dev 服务。',
          enum: ['wait', 'background']
        }
      },
      required: ['command']
    }
  }
}

export async function handler(args, _ctx) {
  const result = await invoke('agent_run_command', {
    command: args.command,
    cwd: args.cwd || null,
    mode: args.mode || 'wait',
    workspacePath: _ctx?.settings?.workspacePath || null
  })
  return result
}
