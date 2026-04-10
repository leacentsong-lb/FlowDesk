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
import { agentLoop, TOOLS } from './index.js'
import { loadAgentMemories } from './memory.js'
import { defaultSkillLoader } from './skills.js'
import { createTraceSession, finalizeTrace, snapshotTrace } from './tracing.js'
import {
  formatCompactToolText,
  getActionPromptText,
  getToolLabel,
  normalizeChatMessage
} from '../components/release/chat-format.js'

/**
 * @param {object} options
 * @param {object} options.ctx
 * @param {() => object} options.getState
 * @param {(event: { toolName: string, args: object, runId: string }) => void} [options.onToolStart]
 * @param {(event: { toolName: string, result: unknown, toolStatus: string, runId: string }) => void} [options.onToolEnd]
 * @param {(trace: object) => void} [options.onTraceComplete]
 * @returns {object}
 */
export function createAgentRuntime(options) {
  const { ctx, getState, onToolStart, onToolEnd, onTraceComplete } = options

  const chatMessages = ref([])
  const agentMessages = ref([])
  const agentRunning = ref(false)
  const runAbortController = ref(null)
  const activeRunId = ref('')
  const suppressNextAgentTextMode = ref('')
  const typingTimer = ref(null)
  const typingMessageId = ref('')
  const typingFullText = ref('')
  const streamingMessageId = ref('')
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
   * @param {object} result
   * @returns {Array<object>}
   */
  function buildVersionActions(result) {
    return (result.versions || []).slice(0, 8).map(versionOption => ({
      id: `version-${versionOption.name}`,
      label: versionOption.name,
      variant: 'secondary'
    }))
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
   * @param {object} route
   * @returns {void}
   */
  function primeSkills(route) {
    const skillNames = new Set(route?.primeSkillNames || [])

    if (route?.shouldPrimeWorkspaceSkill) {
      skillNames.add('workspace-topology')
    }

    for (const skillName of skillNames) {
      if (!skillName || primedSkillContents.has(skillName)) continue

      const content = defaultSkillLoader.load(skillName)
      if (!content || content.startsWith('Error:')) continue

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
   * @returns {void}
   */
  function pushToolMessage(toolName, status, text, meta = {}, actions = null) {
    const toolDescription = TOOLS.find(tool => tool.function.name === toolName)?.function?.description || ''
    const toolLabel = getToolLabel(toolName, toolDescription)
    const activityKind = toolName === 'load_skill' ? 'skill' : 'tool'
    pushMessage('agent', text, actions, {
      kind: 'tool',
      status,
      meta: {
        activityKind,
        toolName,
        toolLabel,
        compactText: formatCompactToolText({
          toolName,
          status,
          toolLabel,
          summary: text,
          meta
        }),
        ...meta
      }
    })
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
    suppressNextAgentTextMode.value = ''
    stopTyping(true)

    pushMessage('user', userText)
    agentMessages.value.push({ role: 'user', content: userText })
    let traceSession = null
    let completedAssistantText = null

    try {
      primeSkills(runOptions.route)
      const currentState = getState()
      traceSession = createTraceSession({
        runId,
        mode: currentState.mode,
        workspacePath: currentState.workspacePath,
        userText
      })
      const memories = await loadAgentMemories({
        workspacePath: currentState.workspacePath
      })

      await agentLoop(agentMessages.value, {
        ctx,
        signal,
        state: {
          ...currentState,
          memorySummary: memories.summary,
          memorySources: memories.sources,
          primedSkillBundle: buildPrimedSkillBundle(),
          primedSkillNames: [...primedSkillContents.keys()],
          traceSession
        },
        onEvent(event) {
          if (signal.aborted || isRunStale(runId) || !event?.type) return

          if (event.type === 'assistant.delta') {
            if (suppressNextAgentTextMode.value === 'version-selection') return
            appendAssistantDelta(event.text)
            return
          }

          if (event.type === 'assistant.completed') {
            if (suppressNextAgentTextMode.value === 'version-selection') {
              suppressNextAgentTextMode.value = ''
              streamingMessageId.value = ''
              return
            }
            completedAssistantText = String(event.text || '')
            completeAssistantStream(event.text)
          }
        },
        onText(text) {
          if (signal.aborted || isRunStale(runId)) return
          if (suppressNextAgentTextMode.value === 'version-selection') {
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
          const toolLabel = TOOLS.find(tool => tool.function.name === toolName)?.function?.description || toolName
          pushToolMessage(toolName, 'running', `正在执行 ${getToolLabel(toolName, toolLabel)}`, {
            displayResult: buildToolDisplayPayload(toolName, args),
            skillName: toolName === 'load_skill' ? args?.name || '' : ''
          })
          onToolStart?.({ toolName, args, runId })
        },
        onToolEnd(toolName, result) {
          if (signal.aborted || isRunStale(runId)) return
          const toolStatus = result?.recoverable
            ? 'recovering'
            : result?.error || result?.ok === false ? 'error' : 'success'
          const summary = result?.summary || (toolStatus === 'success' ? '执行完成' : '执行失败')
          const followupActions = toolStatus === 'error' ? createRetryActions(toolName) : null

          pushToolMessage(toolName, toolStatus, summary, {
            displayResult: buildToolDisplayPayload(toolName, result)
          }, followupActions)

          if (toolName === 'fetch_jira_versions' && result?.versions?.length) {
            const versionActions = buildVersionActions(result)
            pushMessage('agent', getActionPromptText(versionActions), versionActions, {
              kind: 'notice',
              status: 'idle'
            })
            suppressNextAgentTextMode.value = 'version-selection'
          }

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
    suppressNextAgentTextMode.value = ''

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
    primedSkillContents.clear()
  }

  return {
    chatMessages,
    agentMessages,
    agentRunning,
    primedSkillNames,
    primedSkillBundle,
    pushMessage,
    runAgent,
    stopAgentChat,
    resetRuntime
  }
}
