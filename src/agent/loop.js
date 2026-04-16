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

import { finalizeTrace, recordTraceEvent } from './tracing.js'
import { runAgentGraph } from './graph.js'

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
 * @param {(event: { toolName: string, args: object, state: object }) => Promise<object | null> | object | null} [options.beforeToolCall]
 * @returns {Promise<void>}
 */
export async function agentLoop(messages, options) {
  const { ctx, state, onText, onToolStart, onToolEnd, onEvent, signal, tools, toolHandlers, beforeToolCall } = options
  const traceSession = state?.traceSession || null

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

  recordTraceEvent(traceSession, { type: 'run.started' })
  onEvent?.({ type: 'run.started' })

  try {
    const result = await runAgentGraph(messages, {
      ctx,
      state,
      tools,
      toolHandlers,
      beforeToolCall,
      signal,
      onGraphEvent(event) {
        if (signal?.aborted || !event?.type) return

        onEvent?.(event)

        if (event.type === 'tool.start') {
          onToolStart?.(event.toolName, event.args)
          return
        }

        if (event.type === 'tool.end') {
          onToolEnd?.(event.toolName, event.result)
        }
      }
    })

    if (signal?.aborted || !result) return

    messages.splice(0, messages.length, ...(result.messages || []))

    const text = String(result.finalText || '')
    recordTraceEvent(traceSession, {
      type: 'run.final_answer',
      text
    })
    finalizeTrace(traceSession, {
      status: result.stopReason === 'max_rounds' ? 'max_rounds' : 'completed',
      finalAnswer: text
    })
    onEvent?.({ type: 'run.finished' })
    onText?.(text)
  } catch (e) {
    if (signal?.aborted) return
    const message = `Agent 调用 AI 失败: ${e?.message || e}`
    recordTraceEvent(traceSession, {
      type: 'run.error',
      message
    })
    finalizeTrace(traceSession, {
      status: 'error',
      error: message
    })
    onEvent?.({ type: 'run.error', message })
    onText?.(message)
  }
}
