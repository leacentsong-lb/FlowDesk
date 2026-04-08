/**
 * Agent Loop — The core pattern from learn-claude-code:
 *
 *   while (finish_reason === 'tool_calls') {
 *     response = LLM(messages, tools)
 *     dispatch each tool_call
 *     append results
 *   }
 *
 * The LLM decides which tool to call. The loop just dispatches.
 *
 *    +----------+      +-------+      +------------------+
 *    |   User   | ---> |  LLM  | ---> | Tool Dispatch    |
 *    |  prompt  |      |       |      | {                |
 *    +----------+      +---+---+      |   credentials    |
 *                          ^          |   jira_versions  |
 *                          |          |   pr_status      |
 *                          +----------+   preflight      |
 *                          tool_result|   build          |
 *                                     | }                |
 *                                     +------------------+
 */

import { TOOL_HANDLERS, TOOLS } from './tools/index.js'
import { buildSystemPrompt, microcompact, estimateTokens } from './context.js'
import { aiClient } from '../ai/client.js'
import { finalizeTrace, recordTraceEvent } from './tracing.js'

const MAX_ROUNDS = 20
const MAX_CONSECUTIVE_TOOL_FAILURES = 2
const TOKEN_THRESHOLD = 80000

/**
 * Run the agent loop.
 *
 * @param {Array} messages - OpenAI-format conversation history (mutated in-place).
 * @param {object} options
 * @param {object} options.ctx - Context: { settings, jira } stores for tool handlers.
 * @param {object} options.state - Session state for system prompt: { version, environment, completedTools }.
 * @param {function} options.onText - Called when LLM returns final text (no more tool calls).
 * @param {function} options.onToolStart - Called before each tool dispatch: (toolName, args).
 * @param {function} options.onToolEnd - Called after each tool dispatch: (toolName, result).
 * @param {function} [options.onEvent] - Streaming agent events for runtime/UI.
 * @param {AbortSignal} [options.signal] - Optional abort signal to cancel the loop.
 * @returns {Promise<void>}
 */
export async function agentLoop(messages, options) {
  const { ctx, state, onText, onToolStart, onToolEnd, onEvent, signal } = options
  const traceSession = state?.traceSession || null
  const consecutiveToolFailures = new Map()

  const aiConfig = ctx.settings.aiConfig
  if (!aiConfig?.apiKey) {
    recordTraceEvent(traceSession, {
      type: 'run.error',
      message: 'AI 未配置，无法运行 Agent Loop。请先在 Settings 中配置 AI Provider。'
    })
    finalizeTrace(traceSession, {
      status: 'error',
      error: 'AI 未配置，无法运行 Agent Loop。请先在 Settings 中配置 AI Provider。'
    })
    onEvent?.({ type: 'run.error', message: 'AI 未配置，无法运行 Agent Loop。请先在 Settings 中配置 AI Provider。' })
    onText?.('AI 未配置，无法运行 Agent Loop。请先在 Settings 中配置 AI Provider。')
    return
  }

  const systemPrompt = buildSystemPrompt(state)
  recordTraceEvent(traceSession, { type: 'run.started' })
  onEvent?.({ type: 'run.started' })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) return
    recordTraceEvent(traceSession, { type: 'round.started', round })
    onEvent?.({ type: 'round.started', round })

    // Context compression before each LLM call (s06 pattern)
    microcompact(messages)
    if (estimateTokens(messages) > TOKEN_THRESHOLD) {
      // Smart truncation: keep recent messages but respect assistant/tool pairing
      truncateMessages(messages, 24)
    }

    // Build the full messages array with system prompt
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ]
    recordTraceEvent(traceSession, {
      type: 'model.call',
      round,
      messageCount: fullMessages.length,
      toolCount: TOOLS.length
    })

    // -- LLM call: the "response = LLM(messages, tools)" step --
    let response
    try {
      response = await streamAgentRound({
        apiKey: aiConfig.apiKey,
        baseUrl: aiConfig.baseURL || null,
        model: aiConfig.model,
        provider: aiConfig.provider || 'openai',
        messages: fullMessages,
        tools: TOOLS,
        signal,
        onEvent
      })
    } catch (e) {
      if (signal?.aborted) return
      recordTraceEvent(traceSession, {
        type: 'run.error',
        message: `Agent 调用 AI 失败: ${e?.message || e}`
      })
      finalizeTrace(traceSession, {
        status: 'error',
        error: `Agent 调用 AI 失败: ${e?.message || e}`
      })
      onEvent?.({ type: 'run.error', message: `Agent 调用 AI 失败: ${e?.message || e}` })
      onText?.(`Agent 调用 AI 失败: ${e?.message || e}`)
      return
    }

    if (signal?.aborted) return

    const choice = response?.choices?.[0]
    if (!choice) {
      recordTraceEvent(traceSession, {
        type: 'run.error',
        message: 'AI 返回了空响应'
      })
      finalizeTrace(traceSession, {
        status: 'error',
        error: 'AI 返回了空响应'
      })
      onEvent?.({ type: 'run.error', message: 'AI 返回了空响应' })
      onText?.('AI 返回了空响应')
      return
    }

    // Append assistant message to history
    const assistantMsg = choice.message
    if (signal?.aborted) return
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: assistantMsg.tool_calls || undefined
    })

    // -- If no tool calls → done, return text --
    const toolCalls = assistantMsg.tool_calls
    const resolvedText = assistantMsg.content
      || assistantMsg.reasoning_content
      || ''
    recordTraceEvent(traceSession, {
      type: 'assistant.completed',
      round,
      text: resolvedText,
      toolCalls: (toolCalls || []).map(toolCall => ({
        id: toolCall.id,
        name: toolCall.function?.name || '',
        arguments: toolCall.function?.arguments || '{}'
      })),
      finishReason: choice.finish_reason || 'stop'
    })
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === 'stop') {
      if (signal?.aborted) return
      // DeepSeek reasoner puts thinking in reasoning_content, content may be empty
      const text = resolvedText
      recordTraceEvent(traceSession, {
        type: 'run.final_answer',
        text
      })
      finalizeTrace(traceSession, {
        status: 'completed',
        finalAnswer: text
      })
      onEvent?.({ type: 'run.finished' })
      onText?.(text)
      return
    }

    // -- Dispatch each tool call (the "execute tools" step) --
    for (const toolCall of toolCalls) {
      if (signal?.aborted) return

      const fnName = toolCall.function?.name
      const fnArgs = safeParseArgs(toolCall.function?.arguments)

      recordTraceEvent(traceSession, {
        type: 'tool.start',
        round,
        toolName: fnName,
        args: fnArgs
      })
      onEvent?.({ type: 'tool.start', toolName: fnName, args: fnArgs })
      onToolStart?.(fnName, fnArgs)

      const handler = TOOL_HANDLERS[fnName]
      let output
      try {
        const validationError = validateToolCall(fnName, fnArgs)
        if (validationError) {
          output = { error: validationError }
        } else if (!handler) {
          output = { error: `Unknown tool: ${fnName}` }
        } else {
          output = await handler(fnArgs, ctx)
        }
      } catch (e) {
        output = { error: `Tool "${fnName}" 执行出错: ${e?.message || e}` }
      }
      const toolStatus = output?.error || output?.ok === false ? 'error' : 'success'

      if (signal?.aborted) return
      recordTraceEvent(traceSession, {
        type: 'tool.end',
        round,
        toolName: fnName,
        result: output,
        toolStatus
      })
      onEvent?.({
        type: 'tool.end',
        toolName: fnName,
        result: output,
        toolStatus
      })
      onToolEnd?.(fnName, output)

      // Append tool result to messages (the "append results" step)
      if (signal?.aborted) return
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(output)
      })

      const failureInfo = trackToolFailure(consecutiveToolFailures, fnName, fnArgs, toolStatus)
      if (failureInfo.shouldStop) {
        const text = `工具 ${fnName} 连续失败 ${failureInfo.count} 次，已停止自动重试。请调整参数后再试，或使用手动重试。`
        recordTraceEvent(traceSession, {
          type: 'run.final_answer',
          text
        })
        finalizeTrace(traceSession, {
          status: 'completed',
          finalAnswer: text
        })
        onEvent?.({ type: 'run.finished' })
        onText?.(text)
        return
      }
    }

    // Loop continues → next LLM call with tool results
  }

  recordTraceEvent(traceSession, {
    type: 'run.final_answer',
    text: 'Agent 达到最大轮数限制，已停止。'
  })
  finalizeTrace(traceSession, {
    status: 'max_rounds',
    finalAnswer: 'Agent 达到最大轮数限制，已停止。'
  })
  onEvent?.({ type: 'run.finished' })
  onText?.('Agent 达到最大轮数限制，已停止。')
}

async function streamAgentRound(options) {
  const { apiKey, baseUrl, model, provider, messages, tools, signal, onEvent } = options
  const toolCallDrafts = []
  let content = ''
  let reasoningContent = ''
  let finishReason = 'stop'
  let done = false

  await aiClient.streamAgent({
    apiKey,
    baseURL: baseUrl,
    model,
    provider,
    messages,
    tools
  }, payload => {
    if (signal?.aborted) return

    if (payload.kind === 'text-delta') {
      const text = String(payload.text || '')
      if (!text) return
      content += text
      onEvent?.({
        type: 'assistant.delta',
        text
      })
      return
    }

    if (payload.kind === 'reasoning-delta') {
      const text = String(payload.text || '')
      if (!text) return
      reasoningContent += text
      onEvent?.({
        type: 'assistant.reasoning_delta',
        text
      })
      return
    }

    if (payload.kind === 'tool-call-delta') {
      mergeToolCallDelta(toolCallDrafts, payload)
      onEvent?.({
        type: 'assistant.tool_call_delta',
        toolCall: payload
      })
      return
    }

    if (payload.kind === 'error') {
      throw new Error(String(payload.message || 'AI stream failed'))
    }

    if (payload.kind === 'done') {
      finishReason = String(payload.finishReason || finishReason || 'stop')
      done = true
    }
  }, signal)

  if (!done) {
    throw new Error('AI stream ended unexpectedly')
  }

  const toolCalls = buildToolCalls(toolCallDrafts)
  const text = content || reasoningContent || ''

  onEvent?.({
    type: 'assistant.completed',
    text,
    reasoning: reasoningContent,
    toolCalls,
    finishReason
  })

  return {
    choices: [
      {
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
        message: {
          role: 'assistant',
          content: content || null,
          reasoning_content: reasoningContent || undefined,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        }
      }
    ]
  }
}

function mergeToolCallDelta(toolCallDrafts, payload) {
  const index = Number.isInteger(payload.index) ? payload.index : 0
  if (!toolCallDrafts[index]) {
    toolCallDrafts[index] = {
      id: '',
      name: '',
      arguments: ''
    }
  }

  const draft = toolCallDrafts[index]
  if (payload.id) draft.id = payload.id
  if (payload.name) draft.name = payload.name
  if (payload.argumentsFragment) draft.arguments += payload.argumentsFragment
}

function buildToolCalls(toolCallDrafts) {
  return toolCallDrafts
    .filter(Boolean)
    .map((draft, index) => ({
      id: draft.id || `call_${index}`,
      type: 'function',
      function: {
        name: draft.name || '',
        arguments: draft.arguments || '{}'
      }
    }))
}

function safeParseArgs(argsStr) {
  if (!argsStr) return {}
  try {
    return JSON.parse(argsStr)
  } catch {
    return {}
  }
}

function validateToolCall(toolName, args) {
  if (!toolName) {
    return '工具参数无效：缺少 tool name'
  }

  const toolSchema = TOOLS.find(tool => tool.function?.name === toolName)?.function?.parameters
  if (!toolSchema) return null

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `工具参数无效：${toolName} 需要 object 参数`
  }

  const requiredFields = Array.isArray(toolSchema.required) ? toolSchema.required : []
  const missingFields = requiredFields.filter(field => !(field in args) || args[field] == null)
  if (missingFields.length === 0) return null

  return `工具参数无效：${toolName} 缺少必填参数 ${missingFields.join(', ')}`
}

function trackToolFailure(state, toolName, args, toolStatus) {
  const key = `${toolName}:${stableStringify(args)}`

  if (toolStatus !== 'error') {
    state.delete(key)
    return { count: 0, shouldStop: false }
  }

  const count = (state.get(key) || 0) + 1
  state.set(key, count)

  return {
    count,
    shouldStop: count >= MAX_CONSECUTIVE_TOOL_FAILURES
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }

  return JSON.stringify(value)
}

/**
 * Truncate messages while preserving assistant/tool pairing integrity.
 * A `tool` message must always be preceded by its matching `assistant` with tool_calls.
 */
function truncateMessages(messages, keepCount) {
  if (messages.length <= keepCount) return

  let cutIndex = messages.length - keepCount
  // Walk forward to find a safe cut point: never cut between an assistant with
  // tool_calls and its tool responses.
  while (cutIndex < messages.length) {
    const msg = messages[cutIndex]
    if (msg.role === 'tool') {
      cutIndex--
      continue
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Keep this assistant + its tool responses together
      break
    }
    break
  }
  if (cutIndex <= 0) return

  // Insert a summary of what was removed
  const removed = messages.splice(0, cutIndex)
  const toolNames = removed
    .filter(m => m.role === 'assistant' && m.tool_calls?.length)
    .flatMap(m => m.tool_calls.map(tc => tc.function?.name))
    .filter(Boolean)

  if (toolNames.length > 0) {
    messages.unshift({
      role: 'user',
      content: `[系统提示：较早的对话已被压缩。已执行过的工具：${[...new Set(toolNames)].join(', ')}。请基于剩余上下文继续回答。]`
    })
  }
}
