const RELEASE_KEYWORDS = ['发布', '构建', '版本']

const RELEASE_PATTERNS = [
  /\brelease\b/,
  /\bjira\b/,
  /\bpreflight\b/,
  /\bbuild\b/,
  /\bversion\b/,
  /\bpr\b/,
  /\bpull request\b/
]

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bdrop\s+database\b/,
  /\btruncate\s+table\b/,
  /删除.*(文件|目录|仓库|数据库)/,
  /清空.*(目录|数据库|表)/,
  /重置.*仓库/
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
    return createPolicyRoute()
  }

  if (containsAny(text, RELEASE_KEYWORDS) || matchesAny(text, RELEASE_PATTERNS)) {
    return createPolicyRoute({
      mode: 'release',
      workflowId: 'release',
      riskLevel: 'high',
      shouldVerify: true
    })
  }

  if (matchesAny(text, DANGEROUS_PATTERNS)) {
    return createPolicyRoute({
      riskLevel: 'high',
      requiresApproval: true
    })
  }

  return createPolicyRoute()
}

function createPolicyRoute(overrides = {}) {
  return {
    mode: 'general',
    workflowId: 'general',
    riskLevel: 'low',
    requiresApproval: false,
    shouldVerify: false,
    ...overrides
  }
}
