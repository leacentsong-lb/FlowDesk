/**
 * Tool: check_credentials
 * Verifies Jira / GitHub / AI credentials are configured.
 */
import { invoke } from '@tauri-apps/api/core'

export const schema = {
  type: 'function',
  function: {
    name: 'check_credentials',
    description: '检查 Jira 和 GitHub 凭证是否已配置。这是所有发布操作的前提条件。',
    parameters: { type: 'object', properties: {}, required: [] }
  }
}

export async function handler(_args, ctx) {
  const creds = {
    jira: !!ctx.jira.isConfigured,
    github: !!ctx.settings.githubToken?.trim(),
    ai: !!ctx.settings.aiConfigured
  }
  const ok = creds.jira && creds.github
  return {
    ok,
    jira: creds.jira,
    github: creds.github,
    ai: creds.ai,
    summary: ok
      ? `凭证就绪：Jira ✓, GitHub ✓${creds.ai ? ', AI ✓' : ', AI 未配置（可选）'}`
      : `凭证缺失：${!creds.jira ? 'Jira ✗ ' : ''}${!creds.github ? 'GitHub ✗' : ''}`
  }
}
