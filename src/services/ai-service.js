/**
 * AI 服务封装
 * 提供统一的 AI 模型调用接口
 */
import { invoke } from '@tauri-apps/api/core'

// ============================================
// AI 配置管理
// ============================================

/**
 * AI 配置管理器
 * 负责存储和读取 AI 配置
 */
export class AIConfigManager {
  static STORAGE_KEY = 'ai_config'
  
  /**
   * 获取默认配置
   * @returns {Object} 默认配置对象
   */
  static getDefaultConfig() {
    return {
      provider: 'deepseek',  // 默认使用 DeepSeek，性价比高
      apiKey: '',
      model: 'deepseek-chat',
      baseUrl: '',
      temperature: 0.7,
      maxTokens: 4000
    }
  }
  
  /**
   * 获取提供商的默认模型
   * @param {string} provider 提供商名称
   * @returns {string} 默认模型名称
   */
  static getDefaultModel(provider) {
    const models = this.getProviderModels(provider)
    return models.length > 0 ? models[0].value : ''
  }
  
  /**
   * 获取提供商的可用模型列表
   * @param {string} provider 提供商名称
   * @returns {Array<{value: string, label: string, desc?: string}>} 模型列表
   */
  static getProviderModels(provider) {
    const modelLists = {
      openai: [
        { value: 'gpt-4o', label: 'GPT-4o', desc: '最新旗舰模型' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: '快速经济' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: '128K 上下文' },
        { value: 'gpt-4', label: 'GPT-4', desc: '原版 GPT-4' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', desc: '经济实惠' },
        { value: 'o1-preview', label: 'o1-preview', desc: '推理模型' },
        { value: 'o1-mini', label: 'o1-mini', desc: '推理模型-轻量' }
      ],
      anthropic: [
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', desc: '最新最强' },
        { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', desc: '最智能' },
        { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet', desc: '平衡之选' },
        { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', desc: '快速经济' }
      ],
      deepseek: [
        { value: 'deepseek-chat', label: 'DeepSeek Chat', desc: '通用对话' },
        { value: 'deepseek-coder', label: 'DeepSeek Coder', desc: '代码专精' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', desc: '深度推理' }
      ],
      zhipu: [
        { value: 'glm-4.7', label: 'GLM-4.7', desc: '最新旗舰' },
        { value: 'glm-4.6', label: 'GLM-4.6', desc: '高性能' },
        { value: 'glm-4.5-air', label: 'GLM-4.5 Air', desc: '高性价比' },
        { value: 'glm-4.5-airx', label: 'GLM-4.5 AirX', desc: '超快推理' },
        { value: 'glm-4.5-flash', label: 'GLM-4.5 Flash', desc: '快速响应' },
        { value: 'glm-4-flash-250414', label: 'GLM-4 Flash', desc: '稳定版' },
        { value: 'glm-4-flashx-250414', label: 'GLM-4 FlashX', desc: '增强版' }
      ],
      moonshot: [
        { value: 'moonshot-v1-8k', label: 'Moonshot v1 8K', desc: '8K 上下文' },
        { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K', desc: '32K 上下文' },
        { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K', desc: '128K 长文本' }
      ],
      qwen: [
        { value: 'qwen-turbo', label: 'Qwen Turbo', desc: '快速响应' },
        { value: 'qwen-plus', label: 'Qwen Plus', desc: '增强版本' },
        { value: 'qwen-max', label: 'Qwen Max', desc: '旗舰版本' },
        { value: 'qwen-max-longcontext', label: 'Qwen Max 长文本', desc: '长上下文' },
        { value: 'qwen-coder-turbo', label: 'Qwen Coder', desc: '代码专精' }
      ],
      groq: [
        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', desc: '最新 Llama' },
        { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B', desc: '高性能' },
        { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', desc: '超快推理' },
        { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', desc: 'MoE 架构' },
        { value: 'gemma2-9b-it', label: 'Gemma 2 9B', desc: 'Google Gemma' }
      ],
      ollama: [
        { value: 'llama3.2', label: 'Llama 3.2', desc: '最新 Llama' },
        { value: 'llama3.1', label: 'Llama 3.1', desc: '高性能' },
        { value: 'codellama', label: 'Code Llama', desc: '代码专精' },
        { value: 'mistral', label: 'Mistral', desc: '轻量高效' },
        { value: 'qwen2.5', label: 'Qwen 2.5', desc: '通义千问' },
        { value: 'deepseek-coder-v2', label: 'DeepSeek Coder', desc: '代码模型' },
        { value: 'phi3', label: 'Phi-3', desc: '微软小模型' }
      ]
    }
    return modelLists[provider] || []
  }

  /**
   * 规范化模型名称（兼容旧命名）
   * @param {string} provider
   * @param {string} model
   * @returns {string}
   */
  static normalizeModel(provider, model) {
    if (provider !== 'zhipu') return model

    const mapping = {
      'glm-4-flash': 'glm-4.5-flash',
      'glm-4': 'glm-4.7',
      'glm-4-plus': 'glm-4.7'
    }
    const mapped = mapping[model] || model
    const allowed = this.getProviderModels('zhipu').map(m => m.value)

    if (allowed.includes(mapped)) return mapped
    // 如果不在白名单，兜底用列表第一个（当前为 glm-4.7）
    return allowed[0] || mapped
  }
  
  /**
   * 获取当前配置
   * @returns {Object} 配置对象
   */
  static getConfig() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // 合并默认配置，确保新增字段有默认值
        return { ...this.getDefaultConfig(), ...parsed }
      }
    } catch (e) {
      console.error('Failed to parse AI config:', e)
    }
    return this.getDefaultConfig()
  }
  
  /**
   * 保存配置
   * @param {Object} config 配置对象
   */
  static saveConfig(config) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config))
    // 触发配置更新事件
    window.dispatchEvent(new CustomEvent('ai-config-updated', { detail: config }))
  }
  
  /**
   * 检查是否已配置
   * @returns {boolean} 是否已配置 API Key
   */
  static isConfigured() {
    const config = this.getConfig()
    // Ollama 不需要 API Key
    if (config.provider === 'ollama') {
      return true
    }
    return Boolean(config.apiKey)
  }
  
  /**
   * 测试 AI 连接
   * @returns {Promise<{success: boolean, error?: string}>} 测试结果
   */
  static async testConnection() {
    const config = this.getConfig()
    
    if (!this.isConfigured()) {
      return { success: false, error: '请先配置 API Key' }
    }
    
    // 验证并规范化模型名称
    if (!config.model || config.model === '__custom__') {
      return { success: false, error: '请选择或输入有效的模型名称' }
    }
    const normalizedModel = this.normalizeModel(config.provider, config.model)
    
    try {
      const response = await invoke('ai_chat_completion', {
        config: {
          provider: config.provider,
          api_key: config.apiKey,
          model: normalizedModel,
          base_url: config.baseUrl || null
        },
        request: {
          messages: [{ role: 'user', content: 'Hello, respond with just "OK"' }],
          system_prompt: null,
          temperature: 0.1,
          max_tokens: 10
        }
      })
      
      if (response.status === 200) {
        return { success: true, response }
      } else {
        const errorBody = JSON.parse(response.body)
        return { 
          success: false, 
          error: errorBody.error?.message || `HTTP ${response.status}` 
        }
      }
    } catch (error) {
      return { success: false, error: error.message || String(error) }
    }
  }
}

// ============================================
// AI 聊天服务
// ============================================

/**
 * AI 聊天服务
 * 提供各种 AI 功能的封装
 */
export class AIChatService {
  /**
   * 发送聊天消息
   * @param {Array<{role: string, content: string}>} messages 消息数组
   * @param {Object} options 可选参数
   * @param {string} options.systemPrompt 系统提示词
   * @param {number} options.temperature 温度参数
   * @param {number} options.maxTokens 最大 token 数
   * @returns {Promise<{content: string, raw: Object}>} AI 响应
   */
  static async chat(messages, options = {}) {
    const config = AIConfigManager.getConfig()
    
    if (!AIConfigManager.isConfigured()) {
      throw new Error('AI 未配置，请先在设置中配置 API Key')
    }
    
    const response = await invoke('ai_chat_completion', {
      config: {
        provider: config.provider,
        api_key: config.apiKey,
        model: config.model,
        base_url: config.baseUrl || null
      },
      request: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        system_prompt: options.systemPrompt || null,
        temperature: options.temperature ?? config.temperature,
        max_tokens: options.maxTokens ?? config.maxTokens
      }
    })
    
    if (response.status !== 200) {
      let errorMsg = `AI 请求失败: HTTP ${response.status}`
      try {
        const errorBody = JSON.parse(response.body)
        if (errorBody.error?.message) {
          errorMsg = errorBody.error.message
        }
      } catch {}
      throw new Error(errorMsg)
    }
    
    try {
      const data = JSON.parse(response.body)
      return {
        content: data.content || '',
        raw: data.raw || data
      }
    } catch (e) {
      throw new Error('解析 AI 响应失败')
    }
  }
  
  /**
   * 代码审查
   * @param {string} code 待审查的代码
   * @param {string} language 编程语言
   * @returns {Promise<string>} 审查结果
   */
  static async codeReview(code, language = 'javascript') {
    const systemPrompt = `你是一个专业的代码审查专家。请审查以下 ${language} 代码，指出：
1. 潜在的 Bug 和错误
2. 性能问题
3. 代码风格和可读性问题
4. 安全隐患
5. 改进建议

请用中文回复，格式清晰，使用 Markdown 格式。`
    
    const result = await this.chat([
      { role: 'user', content: `请审查以下代码：\n\n\`\`\`${language}\n${code}\n\`\`\`` }
    ], { systemPrompt, maxTokens: 3000 })
    
    return result.content
  }
  
  /**
   * 生成 Git Commit 消息
   * @param {string} diff Git diff 内容
   * @returns {Promise<string>} 生成的 commit 消息
   */
  static async generateCommitMessage(diff) {
    const systemPrompt = `你是一个 Git 提交消息生成助手。根据 git diff 生成简洁、符合 Conventional Commits 规范的提交消息。

规范格式：
<type>(<scope>): <description>

类型包括：
- feat: 新功能
- fix: 修复 Bug
- docs: 文档更新
- style: 代码格式调整
- refactor: 重构
- perf: 性能优化
- test: 测试相关
- chore: 构建/工具相关

请只返回 commit 消息，不要有其他解释。使用英文。`
    
    const result = await this.chat([
      { role: 'user', content: `请为以下代码变更生成 commit 消息：\n\n${diff}` }
    ], { systemPrompt, temperature: 0.3, maxTokens: 200 })
    
    return result.content.trim()
  }
  
  /**
   * Jira 任务分析
   * @param {Object} issue Jira 任务对象
   * @returns {Promise<string>} 分析结果
   */
  static async analyzeJiraIssue(issue) {
    const systemPrompt = `你是一个项目管理助手。请分析以下 Jira 任务，提供：
1. 任务复杂度评估
2. 潜在风险
3. 建议的实现步骤
4. 预估工作量

请用中文回复，格式清晰。`
    
    const issueInfo = `
任务编号: ${issue.key}
标题: ${issue.summary}
类型: ${issue.type}
状态: ${issue.status}
优先级: ${issue.priority}
${issue.description ? `描述: ${issue.description}` : ''}
`
    
    const result = await this.chat([
      { role: 'user', content: `请分析这个 Jira 任务：\n${issueInfo}` }
    ], { systemPrompt, maxTokens: 1500 })
    
    return result.content
  }
  
  /**
   * 生成文档
   * @param {string} code 代码内容
   * @param {string} type 文档类型：'jsdoc' | 'readme' | 'api'
   * @returns {Promise<string>} 生成的文档
   */
  static async generateDocumentation(code, type = 'jsdoc') {
    const prompts = {
      jsdoc: '请为以下代码生成 JSDoc 注释，包括参数说明、返回值说明和示例用法。',
      readme: '请为以下代码生成 README.md 文档，包括功能说明、安装步骤、使用示例和 API 文档。',
      api: '请为以下代码生成 API 文档，使用 Markdown 格式，包括接口说明、参数、返回值和示例。'
    }
    
    const systemPrompt = `你是一个技术文档专家。${prompts[type] || prompts.jsdoc}`
    
    const result = await this.chat([
      { role: 'user', content: `请为以下代码生成文档：\n\n\`\`\`\n${code}\n\`\`\`` }
    ], { systemPrompt, maxTokens: 2000 })
    
    return result.content
  }
}

export default {
  AIConfigManager,
  AIChatService
}
