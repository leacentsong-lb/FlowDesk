import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { TOOL_HANDLERS, TOOLS } from './tools/index.js'
import { buildSystemPrompt, estimateTokens, microcompact } from './context.js'
import { aiClient } from '../ai/client.js'
import { recordTraceEvent } from './tracing.js'

const MAX_ROUNDS = 20
const MAX_CONSECUTIVE_TOOL_FAILURES = 2
const TOKEN_THRESHOLD = 80000

const replace = (prev, next) => (next === undefined ? prev : next)

const AgentGraphState = Annotation.Root({
  messages: Annotation({
    reducer: replace,
    default: () => []
  }),
  round: Annotation({
    reducer: replace,
    default: () => 0
  }),
  lastAssistantMessage: Annotation({
    reducer: replace,
    default: () => null
  }),
  toolFailureCounts: Annotation({
    reducer: replace,
    default: () => ({})
  }),
  finalText: Annotation({
    reducer: replace,
    default: () => ''
  }),
  stopReason: Annotation({
    reducer: replace,
    default: () => ''
  })
})

export function createAgentGraph(options) {
  return new StateGraph(AgentGraphState)
    .addNode('model', (state, runtimeConfig) => runModelNode(state, runtimeConfig, options))
    .addNode('tools', (state, runtimeConfig) => runToolsNode(state, runtimeConfig, options))
    .addEdge(START, 'model')
    .addConditionalEdges('model', routeAfterModel)
    .addConditionalEdges('tools', routeAfterTools)
    .compile()
}

export async function runAgentGraph(messages, options) {
  const graph = createAgentGraph(options)
  const initialState = {
    messages: cloneMessages(messages),
    round: 0,
    lastAssistantMessage: null,
    toolFailureCounts: {},
    finalText: '',
    stopReason: ''
  }

  let finalState = initialState
  const stream = await graph.stream(initialState, {
    streamMode: ['custom', 'values']
  })

  for await (const [mode, chunk] of stream) {
    if (options.signal?.aborted) {
      return null
    }

    if (mode === 'custom') {
      options.onGraphEvent?.(chunk)
      continue
    }

    if (mode === 'values') {
      finalState = chunk
    }
  }

  return finalState
}

async function runModelNode(graphState, runtimeConfig, options) {
  const { ctx, state, signal } = options
  if (signal?.aborted) return {}

  const round = Number(graphState.round || 0)
  if (round >= MAX_ROUNDS) {
    return {
      finalText: 'Agent 达到最大轮数限制，已停止。',
      stopReason: 'max_rounds'
    }
  }

  emitGraphEvent(runtimeConfig, { type: 'round.started', round })
  recordTraceEvent(state?.traceSession, { type: 'round.started', round })

  const workingMessages = cloneMessages(graphState.messages)
  microcompact(workingMessages)
  if (estimateTokens(workingMessages) > TOKEN_THRESHOLD) {
    truncateMessages(workingMessages, 24)
  }

  const fullMessages = [
    { role: 'system', content: buildSystemPrompt(state) },
    ...workingMessages
  ]

  recordTraceEvent(state?.traceSession, {
    type: 'model.call',
    round,
    messageCount: fullMessages.length,
    toolCount: TOOLS.length
  })

  const response = await streamAgentRound({
    apiKey: ctx.settings.aiConfig.apiKey,
    baseUrl: ctx.settings.aiConfig.baseURL || null,
    model: ctx.settings.aiConfig.model,
    provider: ctx.settings.aiConfig.provider || 'openai',
    messages: fullMessages,
    tools: TOOLS,
    signal,
    emit: event => emitGraphEvent(runtimeConfig, event)
  })

  const choice = response?.choices?.[0]
  if (!choice) {
    throw new Error('AI 返回了空响应')
  }

  const assistantMsg = {
    role: 'assistant',
    content: choice.message?.content || null,
    tool_calls: choice.message?.tool_calls || undefined
  }
  const resolvedText = choice.message?.content || choice.message?.reasoning_content || ''
  const toolCalls = assistantMsg.tool_calls || []

  recordTraceEvent(state?.traceSession, {
    type: 'assistant.completed',
    round,
    text: resolvedText,
    toolCalls: toolCalls.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.function?.name || '',
      arguments: toolCall.function?.arguments || '{}'
    })),
    finishReason: choice.finish_reason || 'stop'
  })

  return {
    messages: [...workingMessages, assistantMsg],
    round: round + 1,
    lastAssistantMessage: assistantMsg,
    finalText: toolCalls.length === 0 || choice.finish_reason === 'stop' ? resolvedText : '',
    stopReason: toolCalls.length === 0 || choice.finish_reason === 'stop' ? 'completed' : ''
  }
}

async function runToolsNode(graphState, runtimeConfig, options) {
  const { ctx, state, signal } = options
  if (signal?.aborted) return {}

  const toolCalls = graphState.lastAssistantMessage?.tool_calls || []
  if (toolCalls.length === 0) {
    return {}
  }

  const nextMessages = cloneMessages(graphState.messages)
  const failureCounts = { ...(graphState.toolFailureCounts || {}) }
  const round = Math.max(0, Number(graphState.round || 1) - 1)

  for (const toolCall of toolCalls) {
    if (signal?.aborted) return {}

    const fnName = toolCall.function?.name
    const fnArgs = safeParseArgs(toolCall.function?.arguments)
    const handler = TOOL_HANDLERS[fnName]

    recordTraceEvent(state?.traceSession, {
      type: 'tool.start',
      round,
      toolName: fnName,
      args: fnArgs
    })
    emitGraphEvent(runtimeConfig, {
      type: 'tool.start',
      toolName: fnName,
      args: fnArgs
    })

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
    } catch (error) {
      output = { error: `Tool "${fnName}" 执行出错: ${error?.message || error}` }
    }

    const toolStatus = output?.error || output?.ok === false ? 'error' : 'success'

    recordTraceEvent(state?.traceSession, {
      type: 'tool.end',
      round,
      toolName: fnName,
      result: output,
      toolStatus
    })
    emitGraphEvent(runtimeConfig, {
      type: 'tool.end',
      toolName: fnName,
      result: output,
      toolStatus
    })

    nextMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(output)
    })

    const failureInfo = trackToolFailure(failureCounts, fnName, fnArgs, toolStatus)
    if (failureInfo.shouldStop) {
      return {
        messages: nextMessages,
        toolFailureCounts: failureCounts,
        finalText: `工具 ${fnName} 连续失败 ${failureInfo.count} 次，已停止自动重试。请调整参数后再试，或使用手动重试。`,
        stopReason: 'tool_failure'
      }
    }
  }

  return {
    messages: nextMessages,
    toolFailureCounts: failureCounts
  }
}

function routeAfterModel(state) {
  if (state.stopReason) {
    return END
  }

  const toolCalls = state.lastAssistantMessage?.tool_calls || []
  return toolCalls.length > 0 ? 'tools' : END
}

function routeAfterTools(state) {
  return state.stopReason ? END : 'model'
}

function emitGraphEvent(runtimeConfig, event) {
  runtimeConfig.writer?.(event)
}

async function streamAgentRound(options) {
  const { apiKey, baseUrl, model, provider, messages, tools, signal, emit } = options
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
      emit?.({
        type: 'assistant.delta',
        text
      })
      return
    }

    if (payload.kind === 'reasoning-delta') {
      const text = String(payload.text || '')
      if (!text) return
      reasoningContent += text
      emit?.({
        type: 'assistant.reasoning_delta',
        text
      })
      return
    }

    if (payload.kind === 'tool-call-delta') {
      mergeToolCallDelta(toolCallDrafts, payload)
      emit?.({
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

  emit?.({
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
    delete state[key]
    return { count: 0, shouldStop: false }
  }

  const count = (state[key] || 0) + 1
  state[key] = count

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

function truncateMessages(messages, keepCount) {
  if (messages.length <= keepCount) return

  let cutIndex = messages.length - keepCount
  while (cutIndex < messages.length) {
    const msg = messages[cutIndex]
    if (msg.role === 'tool') {
      cutIndex -= 1
      continue
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      break
    }
    break
  }
  if (cutIndex <= 0) return

  const removed = messages.splice(0, cutIndex)
  const toolNames = removed
    .filter(message => message.role === 'assistant' && message.tool_calls?.length)
    .flatMap(message => message.tool_calls.map(toolCall => toolCall.function?.name))
    .filter(Boolean)

  if (toolNames.length > 0) {
    messages.unshift({
      role: 'user',
      content: `[系统提示：较早的对话已被压缩。已执行过的工具：${[...new Set(toolNames)].join(', ')}。请基于剩余上下文继续回答。]`
    })
  }
}

function cloneMessages(messages = []) {
  return messages.map(message => ({
    ...message,
    tool_calls: message.tool_calls
      ? message.tool_calls.map(toolCall => ({
        ...toolCall,
        function: toolCall.function ? { ...toolCall.function } : toolCall.function
      }))
      : message.tool_calls
  }))
}
