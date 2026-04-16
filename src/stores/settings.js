import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

const DEFAULT_WORKSPACE_PATH = '/Users/leacentsong/Documents/LifeByteCodes'
const WORKSPACE_STORAGE_KEY = 'ai_workspace_path'
const DEFAULT_AI_CONFIG = {
  provider: 'openai',
  apiKey: '',
  baseURL: '',
  model: 'gpt-5.2',
  organization: '',
  project: ''
}
const DEFAULT_SEARCH_CONFIG = {
  provider: 'tavily',
  apiKey: ''
}

const BROKER_REPO_NAMES = {
  tmgm: 'TMGM-CRM-Member-Frontend',
  oqtima: 'OQTIMA-CRM-Member-Frontend',
  anzo: 'ANZO-CRM-Member-Frontend',
  dls: 'DLS-CRM-Member-Frontend',
  ttg: 'TTG-CRM-Member-Frontend',
  admin: 'TMGM-CRM-Staff-Front-End'
}

const loadWorkspacePath = () => {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY) || DEFAULT_WORKSPACE_PATH
  } catch {
    return DEFAULT_WORKSPACE_PATH
  }
}

const loadAiConfig = () => ({
  provider: localStorage.getItem('ai_provider') || DEFAULT_AI_CONFIG.provider,
  apiKey: localStorage.getItem('ai_api_key') || DEFAULT_AI_CONFIG.apiKey,
  baseURL: localStorage.getItem('ai_base_url') || DEFAULT_AI_CONFIG.baseURL,
  model: localStorage.getItem('ai_model') || DEFAULT_AI_CONFIG.model,
  organization: localStorage.getItem('ai_organization') || DEFAULT_AI_CONFIG.organization,
  project: localStorage.getItem('ai_project') || DEFAULT_AI_CONFIG.project
})

const loadSearchConfig = () => ({
  provider: localStorage.getItem('search_provider') || DEFAULT_SEARCH_CONFIG.provider,
  apiKey: localStorage.getItem('search_api_key') || DEFAULT_SEARCH_CONFIG.apiKey
})

export const useSettingsStore = defineStore('settings', () => {
  const workspacePath = ref(loadWorkspacePath())
  const aiConfig = reactive(loadAiConfig())
  const searchConfig = reactive(loadSearchConfig())

  const brokerPaths = computed(() => {
    const base = workspacePath.value || DEFAULT_WORKSPACE_PATH
    return Object.fromEntries(
      Object.entries(BROKER_REPO_NAMES).map(([key, repoName]) => [key, `${base}/${repoName}`])
    )
  })

  function setWorkspacePath(path) {
    const trimmed = (path || '').trim()
    if (!trimmed) return
    workspacePath.value = trimmed
    localStorage.setItem(WORKSPACE_STORAGE_KEY, trimmed)
  }

  function resetWorkspacePath() {
    workspacePath.value = DEFAULT_WORKSPACE_PATH
    localStorage.setItem(WORKSPACE_STORAGE_KEY, DEFAULT_WORKSPACE_PATH)
  }

  function saveAiConfig() {
    localStorage.setItem('ai_provider', aiConfig.provider || DEFAULT_AI_CONFIG.provider)
    localStorage.setItem('ai_api_key', (aiConfig.apiKey || '').trim())
    localStorage.setItem('ai_base_url', (aiConfig.baseURL || '').trim())
    localStorage.setItem('ai_model', (aiConfig.model || DEFAULT_AI_CONFIG.model).trim())
    localStorage.setItem('ai_organization', (aiConfig.organization || '').trim())
    localStorage.setItem('ai_project', (aiConfig.project || '').trim())
  }

  function updateAiConfig(newConfig) {
    Object.assign(aiConfig, newConfig)
    saveAiConfig()
  }

  function resetAiConfig() {
    Object.assign(aiConfig, DEFAULT_AI_CONFIG)
    saveAiConfig()
  }

  const aiConfigured = computed(() => !!(aiConfig.apiKey || '').trim())

  function saveSearchConfig() {
    localStorage.setItem('search_provider', searchConfig.provider || DEFAULT_SEARCH_CONFIG.provider)
    localStorage.setItem('search_api_key', (searchConfig.apiKey || '').trim())
  }

  function updateSearchConfig(newConfig) {
    Object.assign(searchConfig, newConfig)
    saveSearchConfig()
  }

  function resetSearchConfig() {
    Object.assign(searchConfig, DEFAULT_SEARCH_CONFIG)
    saveSearchConfig()
  }

  const searchConfigured = computed(() => !!(searchConfig.apiKey || '').trim())

  // ============================================
  // GitHub Token
  // ============================================
  const githubToken = ref(localStorage.getItem('github_token') || '')
  const githubTokenSaved = ref(!!localStorage.getItem('github_token'))

  function saveGithubToken() {
    const trimmed = githubToken.value.trim()
    if (trimmed) {
      localStorage.setItem('github_token', trimmed)
      githubTokenSaved.value = true
    }
  }

  function clearGithubToken() {
    githubToken.value = ''
    localStorage.removeItem('github_token')
    githubTokenSaved.value = false
  }

  return {
    workspacePath,
    brokerPaths,
    setWorkspacePath,
    resetWorkspacePath,
    aiConfig,
    aiConfigured,
    saveAiConfig,
    updateAiConfig,
    resetAiConfig,
    searchConfig,
    searchConfigured,
    saveSearchConfig,
    updateSearchConfig,
    resetSearchConfig,
    githubToken,
    githubTokenSaved,
    saveGithubToken,
    clearGithubToken
  }
})
