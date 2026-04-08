const RELEASE_KEYWORDS = [
  '发布',
  '构建',
  '版本',
]

const RELEASE_PATTERNS = [
  /\brelease\b/,
  /\bjira\b/,
  /\bpreflight\b/,
  /\bbuild\b/,
  /\bversion\b/,
  /\bpr\b/,
  /\bpull request\b/
]

const WORKSPACE_MAPPING_KEYWORDS = [
  'admin',
  'staff',
  '后台配置系统',
  '后台系统',
  'admin后台',
  'admin系统',
  'staff后台',
  'staff系统',
  '后端',
  'member',
  'ai系统',
  'ai服务系统',
  'ai服务'
]

const WORKSPACE_INVENTORY_PATTERNS = [
  /分析.*工作区.*仓库/,
  /列出.*工作区.*仓库/,
  /查看.*工作区.*仓库/,
  /当前工作区.*仓库/,
  /workspace.*repo/,
  /workspace.*仓库/,
  /仓库.*工作区/,
  /repo.*工作区/,
]

const FILE_EXPLAIN_PATTERNS = [
  /请读一下\s+.+/,
  /读一下\s+.+/,
  /读取\s+.+/,
  /看看\s+.+/,
  /解释\s+.+/,
  /总结\s+.+/
]

const GIT_COMMIT_PATTERNS = [
  /commit message/,
  /提交信息/,
  /提交说明/,
  /生成.*commit/,
  /生成.*提交/,
  /git commit/,
  /commit.*分支/,
  /分支.*commit/
]

function normalizeText(userText) {
  return String(userText || '')
    .trim()
    .toLowerCase()
}

function containsAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword))
}

function matchesAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text))
}

export function routeAgentIntent(userText) {
  const text = normalizeText(userText)

  if (!text) {
    return {
      mode: 'general',
      intent: 'general_chat',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false
    }
  }

  const isFileExplain = matchesAny(text, FILE_EXPLAIN_PATTERNS) && (
    text.includes('/') ||
    text.includes('.') ||
    text.includes('src') ||
    text.includes('agent') ||
    text.includes('js') ||
    text.includes('ts')
  )

  if (containsAny(text, RELEASE_KEYWORDS) || matchesAny(text, RELEASE_PATTERNS)) {
    return {
      mode: 'release',
      intent: 'release_flow',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false
    }
  }

  if (/workspace|工作区|仓库|repo|文件夹|目录/.test(text) && matchesAny(text, WORKSPACE_INVENTORY_PATTERNS)) {
    return {
      mode: 'general',
      intent: 'workspace_inventory',
      shouldPrimeWorkspaceSkill: true,
      shouldScanWorkspaceFirst: true
    }
  }

  if (containsAny(text, WORKSPACE_MAPPING_KEYWORDS)) {
    return {
      mode: 'general',
      intent: 'workspace_mapping',
      shouldPrimeWorkspaceSkill: true,
      shouldScanWorkspaceFirst: false
    }
  }

  if (isFileExplain) {
    return {
      mode: 'general',
      intent: 'file_explain',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false,
      primeSkillNames: []
    }
  }

  if (matchesAny(text, GIT_COMMIT_PATTERNS)) {
    return {
      mode: 'general',
      intent: 'git_commit_message',
      shouldPrimeWorkspaceSkill: false,
      shouldScanWorkspaceFirst: false,
      primeSkillNames: ['git-branching']
    }
  }

  return {
    mode: 'general',
    intent: 'general_chat',
    shouldPrimeWorkspaceSkill: false,
    shouldScanWorkspaceFirst: false,
    primeSkillNames: []
  }
}
