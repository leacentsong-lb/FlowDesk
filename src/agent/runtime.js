/**
 * Agent Runtime — owns a single chat session lifecycle.
 *
 * This layer sits between the Pinia store and `agentLoop()`.
 * It manages:
 * - chat / agent message buffers
 * - tool event rendering
 * - typewriter effect
 * - soft cancellation via AbortController + runId
 */
import { computed, ref } from 'vue'
import { agentLoop, getAllTools } from './index.js'
import { loadAgentMemories } from './memory.js'
import { createTraceSession, finalizeTrace, snapshotTrace } from './tracing.js'
import {
  formatCompactToolText,
  getToolLabel,
  getActionPromptText,
  normalizeChatMessage
} from '../components/release/chat-format.js'

/**
 * @param {object} options
 * @param {object} options.ctx
 * @param {() => object} options.getState
 * @param {(event: { toolName: string, args: object, runId: string }) => void} [options.onToolStart]
 * @param {(event: { toolName: string, result: unknown, toolStatus: string, runId: string }) => void} [options.onToolEnd]
 * @param {(trace: object) => void} [options.onTraceUpdate]
 * @param {(trace: object) => void} [options.onTraceComplete]
 * @param {(event: { toolName: string, args: object, state: object, workflow: object | null }) => Promise<object | null> | object | null} [options.beforeToolCall]
 * @returns {object}
 */
export function createAgentRuntime(options) {
  const { ctx, getState, onToolStart, onToolEnd, onTraceUpdate, onTraceComplete, beforeToolCall } = options

  const chatMessages = ref([])
  const agentMessages = ref([])
  const agentRunning = ref(false)
  const runAbortController = ref(null)
  const activeRunId = ref('')
  const pendingInteraction = ref(null)
  const suppressNextAgentTextMode = ref('')
  const suppressPendingOnText = ref(false)
  const typingTimer = ref(null)
  const typingMessageId = ref('')
  const typingFullText = ref('')
  const streamingMessageId = ref('')
  const toolMessageIds = ref({})
  const primedSkillContents = new Map()
  const primedSkillNames = computed(() => [...primedSkillContents.keys()])
  const primedSkillBundle = computed(() => buildPrimedSkillBundle())

  /**
   * @param {string} role
   * @param {string} text
   * @param {Array<object> | null} [actions]
   * @param {object} [options]
   * @returns {void}
   */
  function pushMessage(role, text, actions = null, options = {}) {
    chatMessages.value.push(normalizeChatMessage({
      id: options.id || `${Date.now()}-${Math.random()}`,
      role,
      text,
      actions,
      kind: options.kind,
      status: options.status,
      meta: options.meta,
      blocks: options.blocks,
      ts: options.ts || new Date(),
      _streaming: options._streaming,
      _reasoning: options._reasoning
    }))
  }

  /**
   * @param {object | null} interaction
   * @param {object} [options]
   * @param {boolean} [options.suppressNextAssistantText]
   * @returns {void}
   */
  function presentInteraction(interaction, options = {}) {
    const actions = Array.isArray(interaction?.actions) ? interaction.actions : []
    if (!interaction || actions.length === 0) {
      pendingInteraction.value = null
      return
    }

    pendingInteraction.value = {
      id: interaction.id || `${Date.now()}-${Math.random()}`,
      type: interaction.type || 'action-list',
      title: interaction.title || getActionPromptText(actions),
      description: interaction.description || '',
      actions,
      meta: interaction.meta || {}
    }

    if (options.suppressNextAssistantText) {
      suppressNextAgentTextMode.value = 'interaction'
      suppressPendingOnText.value = true
      stopTyping(false)
      streamingMessageId.value = ''
    }
  }

  /**
   * @returns {void}
   */
  function clearPendingInteraction() {
    pendingInteraction.value = null
  }

  /**
   * @param {string} messageId
   * @param {object} patch
   * @returns {void}
   */
  function updateMessage(messageId, patch) {
    const index = chatMessages.value.findIndex(message => message.id === messageId)
    if (index < 0) return

    const current = chatMessages.value[index]
    const merged = {
      ...current,
      ...patch,
      id: current.id,
      meta: patch.meta ?? current.meta,
      ts: patch.ts ?? current.ts
    }

    // When text changes, discard stale blocks so normalizeChatMessage
    // rebuilds them from the new text.
    if ('text' in patch) {
      delete merged.blocks
    }

    chatMessages.value[index] = normalizeChatMessage(merged)
  }

  /**
   * @param {boolean} [flush]
   * @returns {void}
   */
  function stopTyping(flush = true) {
    if (typingTimer.value) {
      clearInterval(typingTimer.value)
      typingTimer.value = null
    }

    if (flush && typingMessageId.value && typingFullText.value) {
      updateMessage(typingMessageId.value, {
        text: typingFullText.value,
        _streaming: false
      })
    }

    typingMessageId.value = ''
    typingFullText.value = ''
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function typeAgentMessage(text) {
    const fullText = String(text || '')
    if (!fullText) return

    stopTyping(true)

    const messageId = `${Date.now()}-${Math.random()}`
    let cursor = 0

    typingMessageId.value = messageId
    typingFullText.value = fullText

    pushMessage('agent', '', null, {
      id: messageId,
      _streaming: true
    })

    const tick = () => {
      cursor = Math.min(fullText.length, cursor + 3)
      updateMessage(messageId, {
        text: fullText.slice(0, cursor),
        _streaming: cursor < fullText.length
      })

      if (cursor >= fullText.length) {
        stopTyping(false)
      }
    }

    tick()
    typingTimer.value = setInterval(tick, 24)
  }

  /**
   * @returns {string}
   */
  function ensureStreamingMessage() {
    if (streamingMessageId.value) {
      return streamingMessageId.value
    }

    const messageId = `${Date.now()}-${Math.random()}`
    streamingMessageId.value = messageId
    pushMessage('agent', '', null, {
      id: messageId,
      _streaming: true
    })
    return messageId
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function appendAssistantDelta(text) {
    const delta = String(text || '')
    if (!delta) return
    stopTyping(false)
    const messageId = ensureStreamingMessage()
    const current = chatMessages.value.find(message => message.id === messageId)
    updateMessage(messageId, {
      text: `${current?.text || ''}${delta}`,
      _streaming: true
    })
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function completeAssistantStream(text) {
    const finalText = String(text || '')

    if (!streamingMessageId.value) {
      if (finalText) {
        pushMessage('agent', finalText, null, {
          _streaming: false
        })
      }
      return
    }

    updateMessage(streamingMessageId.value, {
      text: finalText || chatMessages.value.find(message => message.id === streamingMessageId.value)?.text || '',
      _streaming: false
    })
    streamingMessageId.value = ''
  }

  /**
   * @param {string} toolName
   * @returns {Array<object>}
   */
  function createRetryActions(toolName) {
    return [
      {
        id: `retry-${toolName}`,
        label: '重新执行',
        variant: 'secondary'
      }
    ]
  }

  /**
   * @param {string} toolName
   * @param {unknown} payload
   * @returns {unknown}
   */
  function buildToolDisplayPayload(toolName, payload) {
    if (!payload || typeof payload !== 'object') {
      return payload
    }

    if (toolName === 'load_skill') {
      return {
        ok: payload.ok === true,
        skillName: payload.skillName || '',
        summary: payload.summary || ''
      }
    }

    return payload
  }

  /**
   * @returns {string}
   */
  function buildPrimedSkillBundle() {
    if (primedSkillContents.size === 0) return ''

    return [...primedSkillContents.entries()]
      .map(([, content]) => content)
      .join('\n\n')
  }

  /**
   * @param {string} toolName
   * @param {string} status
   * @param {string} text
   * @param {object} [meta]
   * @param {Array<object> | null} [actions]
   * @param {Array<object>} [availableTools]
   * @returns {void}
   */
  function pushToolMessage(toolName, status, text, meta = {}, actions = null, availableTools = getAllTools()) {
    const toolDescription = availableTools.find(tool => tool.function.name === toolName)?.function?.description || ''
    const toolLabel = getToolLabel(toolName, toolDescription)
    const activityKind = toolName === 'load_skill' ? 'skill' : 'tool'
    const compactText = formatCompactToolText({
      toolName,
      status,
      toolLabel,
      summary: text,
      meta
    })
    const nextHistoryItem = {
      status,
      text,
      ts: new Date().toISOString()
    }
    const existingMessageId = toolMessageIds.value[toolName]
    const existingMessage = existingMessageId
      ? chatMessages.value.find(message => message.id === existingMessageId)
      : null

    if (existingMessage) {
      const previousHistory = Array.isArray(existingMessage.meta?.statusHistory)
        ? existingMessage.meta.statusHistory
        : []
      const shouldAppendHistory = previousHistory.length === 0 || (
        previousHistory[previousHistory.length - 1].status !== nextHistoryItem.status ||
        previousHistory[previousHistory.length - 1].text !== nextHistoryItem.text
      )
      const statusHistory = shouldAppendHistory
        ? [...previousHistory, nextHistoryItem]
        : previousHistory

      updateMessage(existingMessage.id, {
        text,
        actions,
        kind: 'tool',
        status,
        meta: {
          ...(existingMessage.meta || {}),
          activityKind,
          toolName,
          toolLabel,
          compactText,
          statusHistory,
          ...meta
        }
      })
      return
    }

    const messageId = `${Date.now()}-${Math.random()}`
    toolMessageIds.value = {
      ...toolMessageIds.value,
      [toolName]: messageId
    }
    pushMessage('agent', text, actions, {
      id: messageId,
      kind: 'tool',
      status,
      meta: {
        activityKind,
        toolName,
        toolLabel,
        compactText,
        statusHistory: [nextHistoryItem],
        ...meta
      }
    })
  }

  /**
   * @param {object} result
   * @returns {void}
   */
  function cacheLoadedSkill(result) {
    const skillName = String(result?.skillName || '').trim()
    const content = String(result?.content || '').trim()
    if (!result?.ok || !skillName || !content || primedSkillContents.has(skillName)) {
      return
    }

    primedSkillContents.set(skillName, content)
    pushMessage('agent', `Skill(${skillName}): 已注入到当前对话。`, null, {
      kind: 'skill',
      status: 'success',
      meta: {
        activityKind: 'skill',
        skillName,
        compactText: `Skill(${skillName}): 已注入到当前对话。`
      }
    })
  }

  /**
   * @param {object} effect
   * @returns {void}
   */
  function applyWorkflowEffect(effect) {
    if (!effect) return

    if (effect.suppressNextAssistantTextMode) {
      suppressNextAgentTextMode.value = effect.suppressNextAssistantTextMode
    }

    if (effect.clearInteraction) {
      clearPendingInteraction()
    }

    if (effect.interaction) {
      presentInteraction(effect.interaction, {
        suppressNextAssistantText: effect.suppressNextAssistantText === true
      })
    }

    for (const message of effect.messages || []) {
      pushMessage('agent', message.text || '', message.actions || null, {
        kind: message.kind,
        status: message.status,
        meta: message.meta
      })
    }
  }

  /**
   * @returns {string}
   */
  function createRunId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  /**
   * @param {string} runId
   * @returns {boolean}
   */
  function isRunStale(runId) {
    return activeRunId.value !== runId
  }

  /**
   * @param {string} userText
   * @returns {Promise<void>}
   */
  async function runAgent(userText, runOptions = {}) {
    if (agentRunning.value) return

    const runId = createRunId()
    const abortController = new AbortController()
    const signal = abortController.signal

    activeRunId.value = runId
    runAbortController.value = abortController
    agentRunning.value = true
    clearPendingInteraction()
    suppressNextAgentTextMode.value = ''
    suppressPendingOnText.value = false
    stopTyping(true)

    pushMessage('user', runOptions.displayUserText || userText)
    agentMessages.value.push({ role: 'user', content: userText })
    let traceSession = null
    let completedAssistantText = null
    const activeTools = Array.isArray(runOptions.tools) && runOptions.tools.length > 0
      ? runOptions.tools
      : getAllTools()
    const workflow = runOptions.workflow || null

    try {
      const workflowBeforeRunResult = await workflow?.beforeRun?.({
        userText,
        ctx,
        state: getState()
      })
      applyWorkflowEffect(workflowBeforeRunResult)

      const currentState = getState()
      traceSession = createTraceSession({
        runId,
        mode: currentState.mode,
        workspacePath: currentState.workspacePath,
        userText,
        workflowId: runOptions.route?.workflowId || workflow?.id || currentState.workflowId || currentState.mode || 'general',
        provider: ctx.settings.aiConfig.provider || 'openai',
        model: ctx.settings.aiConfig.model || '',
        notify: trace => onTraceUpdate?.(trace)
      })
      const memories = await loadAgentMemories({
        workspacePath: currentState.workspacePath
      })

      await agentLoop(agentMessages.value, {
        ctx,
        signal,
        state: {
          ...currentState,
          workflowId: runOptions.route?.workflowId || workflow?.id || currentState.mode || 'general',
          workflowPrompt: workflow?.promptFragment || '',
          policy: runOptions.route || null,
          availableTools: activeTools,
          memorySummary: memories.summary,
          memorySources: memories.sources,
          primedSkillBundle: buildPrimedSkillBundle(),
          primedSkillNames: [...primedSkillContents.keys()],
          traceSession
        },
        tools: activeTools,
        beforeToolCall(event) {
          if (signal.aborted || isRunStale(runId)) return null
          return beforeToolCall?.({
            ...event,
            state: getState(),
            workflow
          }) || null
        },
        onEvent(event) {
          if (signal.aborted || isRunStale(runId) || !event?.type) return

          if (event.type === 'assistant.delta') {
            if (suppressNextAgentTextMode.value === 'interaction') return
            appendAssistantDelta(event.text)
            return
          }

          if (event.type === 'assistant.completed') {
            if (suppressNextAgentTextMode.value === 'interaction') {
              streamingMessageId.value = ''
              return
            }
            completedAssistantText = String(event.text || '')
            completeAssistantStream(event.text)
          }
        },
        onText(text) {
          if (signal.aborted || isRunStale(runId)) return
          if (suppressPendingOnText.value || suppressNextAgentTextMode.value === 'interaction') {
            suppressPendingOnText.value = false
            suppressNextAgentTextMode.value = ''
            return
          }
          if (completedAssistantText !== null && String(text || '') === completedAssistantText) {
            return
          }
          if (!text) {
            pushMessage('agent', 'Agent 未返回有效回复，可能是上下文过长或模型异常。请重试或换个问法。', null, {
              kind: 'notice',
              status: 'warning'
            })
            return
          }
          typeAgentMessage(text)
        },
        onToolStart(toolName, args) {
          if (signal.aborted || isRunStale(runId)) return
          const toolLabel = activeTools.find(tool => tool.function.name === toolName)?.function?.description || toolName
          pushToolMessage(toolName, 'running', `正在执行 ${getToolLabel(toolName, toolLabel)}`, {
            displayResult: buildToolDisplayPayload(toolName, args),
            skillName: toolName === 'load_skill' ? args?.name || '' : ''
          }, null, activeTools)
          onToolStart?.({ toolName, args, runId })
        },
        onToolEnd(toolName, result) {
          if (signal.aborted || isRunStale(runId)) return
          const toolStatus = result?.recoverable
            ? 'recovering'
            : result?.error || result?.ok === false ? 'error' : 'success'
          const presentation = workflow?.presentToolResult?.({ toolName, result, toolStatus }) || {}
          const summary = presentation.summary || result?.summary || (toolStatus === 'success' ? '执行完成' : '执行失败')
          const followupActions = presentation.actions ?? (toolStatus === 'error' ? createRetryActions(toolName) : null)

          if (followupActions?.length) {
            presentInteraction({
              id: `interaction-${toolName}-${Date.now()}`,
              type: 'action-list',
              title: getActionPromptText(followupActions),
              description: summary,
              actions: followupActions,
              meta: {
                source: 'tool',
                toolName
              }
            }, {
              suppressNextAssistantText: true
            })
          }

          pushToolMessage(toolName, toolStatus, summary, {
            displayResult: buildToolDisplayPayload(toolName, result)
          }, null, activeTools)

          if (toolName === 'load_skill') {
            cacheLoadedSkill(result)
          }

          applyWorkflowEffect(workflow?.afterTool?.({
            toolName,
            result,
            toolStatus,
            state: getState()
          }))

          onToolEnd?.({ toolName, result, toolStatus, runId })
        }
      })
    } catch (error) {
      if (signal.aborted || isRunStale(runId)) return
      finalizeTrace(traceSession, {
        status: 'error',
        error: String(error?.message || error)
      })
      pushMessage('agent', `Agent 出错: ${error?.message || error}`)
    } finally {
      if (traceSession) {
        if (signal.aborted) {
          finalizeTrace(traceSession, {
            status: 'aborted',
            error: traceSession.error || 'Agent run aborted'
          })
        } else if (traceSession.status === 'running') {
          finalizeTrace(traceSession, {
            status: 'completed',
            finalAnswer: traceSession.finalAnswer
          })
        }
        onTraceComplete?.(snapshotTrace(traceSession))
      }

      if (activeRunId.value === runId && runAbortController.value === abortController) {
        runAbortController.value = null
        agentRunning.value = false
      }
    }
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.announce]
   * @returns {void}
   */
  function stopAgentChat(options = {}) {
    const { announce = true } = options

    if (runAbortController.value) {
      runAbortController.value.abort()
      runAbortController.value = null
    }

    activeRunId.value = ''
    stopTyping(false)
    streamingMessageId.value = ''
    agentRunning.value = false
    clearPendingInteraction()
    suppressNextAgentTextMode.value = ''
    suppressPendingOnText.value = false

    if (announce) {
      pushMessage('agent', '已终止当前对话。', null, {
        kind: 'notice',
        status: 'warning'
      })
    }
  }

  /**
   * @returns {void}
   */
  function resetRuntime() {
    stopAgentChat({ announce: false })
    activeRunId.value = ''
    agentMessages.value = []
    chatMessages.value = []
    toolMessageIds.value = {}
    primedSkillContents.clear()
    clearPendingInteraction()
    suppressPendingOnText.value = false
  }

  return {
    chatMessages,
    agentMessages,
    agentRunning,
    pendingInteraction,
    primedSkillNames,
    primedSkillBundle,
    presentInteraction,
    clearPendingInteraction,
    applyWorkflowEffect,
    pushMessage,
    runAgent,
    stopAgentChat,
    resetRuntime
  }
}
