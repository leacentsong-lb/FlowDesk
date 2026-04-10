import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { createDefaultPromptConfig, normalizePromptConfig } from '../agent/prompt-config.js'

const PROMPT_CONFIG_STORAGE_KEY = 'agent_prompt_config_v1'

function loadPromptConfig() {
  try {
    const raw = localStorage.getItem(PROMPT_CONFIG_STORAGE_KEY)
    if (!raw) return createDefaultPromptConfig()
    return normalizePromptConfig(JSON.parse(raw))
  } catch {
    return createDefaultPromptConfig()
  }
}

export const usePromptStore = defineStore('prompt', () => {
  const config = reactive(loadPromptConfig())

  function savePromptConfig() {
    localStorage.setItem(PROMPT_CONFIG_STORAGE_KEY, JSON.stringify(config))
  }

  function resetPromptConfig() {
    const defaults = createDefaultPromptConfig()
    Object.keys(config).forEach(key => delete config[key])
    Object.assign(config, defaults)
    savePromptConfig()
  }

  return {
    config,
    savePromptConfig,
    resetPromptConfig
  }
})
