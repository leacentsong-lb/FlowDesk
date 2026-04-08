import { invoke } from '@tauri-apps/api/core'

export const scanWorkspaceReposSchema = {
  type: 'function',
  function: {
    name: 'scan_workspace_repos',
    description: '扫描当前工作区中的 Git 代码仓库。适用于回答“当前工作区有哪些仓库”“列出 repo 名称”“分析本地代码仓库”等问题。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要扫描的工作区根目录。可选；未传时默认使用 App 设置中的当前工作区。'
        }
      }
    }
  }
}

export async function scanWorkspaceReposHandler(args, ctx) {
  const path = args?.path || ctx?.settings?.workspacePath
  if (!path) {
    return {
      ok: false,
      error: '未设置工作区路径，无法扫描仓库',
      repos: []
    }
  }

  return invoke('agent_scan_workspace_repos', { path })
}
