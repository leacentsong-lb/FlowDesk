const APP_AGENT_SKILL_OVERRIDES_KEY = 'app_agent_skill_overrides_v1'
const APP_AGENT_TOOL_OVERRIDES_KEY = 'app_agent_tool_overrides_v1'

function getStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function readJson(key) {
  const storage = getStorage()
  if (!storage) return {}

  try {
    const raw = storage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson(key, value) {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(key, JSON.stringify(value))
}

function normalizeName(name) {
  return String(name || '').trim()
}

function normalizeSkillOverride(override = {}) {
  const normalized = {}
  if (typeof override.content === 'string') normalized.content = override.content
  if (typeof override.enabled === 'boolean') normalized.enabled = override.enabled
  return normalized
}

function normalizeToolOverride(override = {}) {
  const normalized = {}
  if (typeof override.label === 'string') normalized.label = override.label.trim()
  if (typeof override.description === 'string') normalized.description = override.description.trim()
  if (typeof override.enabled === 'boolean') normalized.enabled = override.enabled
  return normalized
}

function updateRecord(key, name, override, normalizer) {
  const normalizedName = normalizeName(name)
  if (!normalizedName) return

  const registry = readJson(key)
  const normalized = normalizer(override)

  if (Object.keys(normalized).length === 0) {
    delete registry[normalizedName]
  } else {
    registry[normalizedName] = normalized
  }

  writeJson(key, registry)
}

export function loadAppSkillOverrides() {
  return readJson(APP_AGENT_SKILL_OVERRIDES_KEY)
}

export function saveAppSkillOverride(name, override) {
  updateRecord(APP_AGENT_SKILL_OVERRIDES_KEY, name, override, normalizeSkillOverride)
}

export function resetAppSkillOverride(name) {
  updateRecord(APP_AGENT_SKILL_OVERRIDES_KEY, name, {}, normalizeSkillOverride)
}

export function loadAppToolOverrides() {
  return readJson(APP_AGENT_TOOL_OVERRIDES_KEY)
}

export function saveAppToolOverride(name, override) {
  updateRecord(APP_AGENT_TOOL_OVERRIDES_KEY, name, override, normalizeToolOverride)
}

export function resetAppToolOverride(name) {
  updateRecord(APP_AGENT_TOOL_OVERRIDES_KEY, name, {}, normalizeToolOverride)
}
