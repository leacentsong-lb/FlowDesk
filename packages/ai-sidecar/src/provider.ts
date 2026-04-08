import { createOpenAI } from '@ai-sdk/openai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

type ProviderConfig = {
  provider?: string
  apiKey: string
  baseURL?: string
  model: string
  organization?: string
  project?: string
}

/**
 * Create a language model instance for the current provider.
 *
 * OpenAI is routed through the Responses API to avoid the repeated
 * `/chat/completions` + `reasoning_effort` incompatibilities on GPT-5.x.
 *
 * @param config - Provider connection settings.
 * @returns AI SDK language model instance.
 */
export function createLanguageModel(config: ProviderConfig) {
  const provider = (config.provider || 'openai').trim().toLowerCase()
  const baseURL = cleanBaseUrl(config.baseURL)

  if (provider === 'deepseek') {
    return createDeepSeek({
      apiKey: config.apiKey,
      baseURL
    })(config.model)
  }

  if (provider === 'openai') {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL,
      headers: buildOpenAIHeaders(config)
    })

    return openai.responses(config.model)
  }

  const compatible = createOpenAICompatible({
    name: provider || 'compatible',
    apiKey: config.apiKey,
    baseURL: baseURL || 'https://api.openai.com/v1',
    headers: buildOpenAIHeaders(config)
  })

  return compatible(config.model)
}

/**
 * @param config - Provider config.
 * @returns Optional OpenAI headers.
 */
function buildOpenAIHeaders(config: ProviderConfig) {
  const headers: Record<string, string> = {}

  if (config.organization?.trim()) {
    headers['OpenAI-Organization'] = config.organization.trim()
  }

  if (config.project?.trim()) {
    headers['OpenAI-Project'] = config.project.trim()
  }

  return headers
}

/**
 * @param value - Raw base URL value.
 * @returns Clean base URL or undefined.
 */
function cleanBaseUrl(value?: string) {
  const nextValue = value?.trim()
  return nextValue ? nextValue.replace(/\/+$/, '') : undefined
}
