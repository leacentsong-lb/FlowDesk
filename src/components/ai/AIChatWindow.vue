<script setup>
/**
 * AI 聊天窗口组件
 * 全局 AI 对话助手
 */
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { AIChatService, AIConfigManager } from '../../services/ai-service'

const props = defineProps({
  visible: Boolean
})

const emit = defineEmits(['close'])

// 状态
const messages = ref([])
const inputMessage = ref('')
const isLoading = ref(false)
const chatContainer = ref(null)
const inputRef = ref(null)

// 监听可见性变化，自动聚焦
watch(() => props.visible, (newVal) => {
  if (newVal) {
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})

// 键盘事件处理
const handleKeydown = (e) => {
  if (!props.visible) return
  
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// 发送消息
const sendMessage = async () => {
  if (!inputMessage.value.trim() || isLoading.value) return
  
  // 检查配置
  if (!AIConfigManager.isConfigured()) {
    messages.value.push({
      role: 'system',
      content: '⚠️ AI 未配置，请先在设置中配置 API Key',
      timestamp: new Date()
    })
    return
  }
  
  const userMessage = inputMessage.value.trim()
  messages.value.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date()
  })
  
  inputMessage.value = ''
  isLoading.value = true
  
  await nextTick()
  scrollToBottom()
  
  try {
    const response = await AIChatService.chat(
      messages.value.filter(m => m.role !== 'system').map(m => ({ 
        role: m.role, 
        content: m.content 
      }))
    )
    
    messages.value.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date()
    })
    
    await nextTick()
    scrollToBottom()
  } catch (error) {
    messages.value.push({
      role: 'system',
      content: `❌ 错误: ${error.message}`,
      timestamp: new Date()
    })
  } finally {
    isLoading.value = false
  }
}

// 滚动到底部
const scrollToBottom = () => {
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

// 清空对话
const clearChat = () => {
  messages.value = []
}

// 格式化时间
const formatTime = (date) => {
  return date.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

// 处理回车发送
const handleInputKeydown = (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <Transition name="chat-window">
    <div v-if="visible" class="chat-window-overlay" @click.self="emit('close')">
      <div class="chat-window">
        <!-- 头部 -->
        <div class="chat-header">
          <div class="header-info">
            <div class="header-title">
              <span class="ai-icon">🤖</span>
              <h3>AI 助手</h3>
            </div>
            <span class="subtitle">按 Esc 关闭 · ⌘+Enter 发送</span>
          </div>
          <div class="header-actions">
            <button class="icon-btn" @click="clearChat" title="清空对话">
              🗑️
            </button>
            <button class="icon-btn close-btn" @click="emit('close')" title="关闭">
              ✕
            </button>
          </div>
        </div>
        
        <!-- 消息列表 -->
        <div ref="chatContainer" class="chat-messages">
          <!-- 空状态 -->
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">💬</div>
            <p class="empty-title">开始与 AI 对话</p>
            <p class="empty-desc">可以询问代码问题、获取建议或进行任何对话</p>
            <div class="quick-actions">
              <button @click="inputMessage = '帮我审查一下代码'">
                🔍 代码审查
              </button>
              <button @click="inputMessage = '生成 commit message'">
                📝 生成 Commit
              </button>
              <button @click="inputMessage = '解释这段代码'">
                💡 代码解释
              </button>
            </div>
          </div>
          
          <!-- 消息列表 -->
          <div 
            v-for="(msg, idx) in messages" 
            :key="idx" 
            class="message"
            :class="msg.role"
          >
            <div class="message-avatar">
              {{ msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '⚠️' }}
            </div>
            <div class="message-content">
              <div class="message-text" v-html="formatMessageContent(msg.content)"></div>
              <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
            </div>
          </div>
          
          <!-- 加载状态 -->
          <div v-if="isLoading" class="message assistant">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 输入区域 -->
        <div class="chat-input-area">
          <textarea
            ref="inputRef"
            v-model="inputMessage"
            class="chat-input"
            placeholder="输入消息... (⌘+Enter 发送)"
            @keydown="handleInputKeydown"
            rows="3"
          ></textarea>
          <button 
            class="send-btn" 
            @click="sendMessage"
            :disabled="!inputMessage.trim() || isLoading"
          >
            <span v-if="isLoading">发送中...</span>
            <span v-else>发送</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
// 格式化消息内容（处理代码块等）
function formatMessageContent(content) {
  if (!content) return ''
  
  // 简单的代码块处理
  let formatted = content
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 处理代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // 处理行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 处理换行
    .replace(/\n/g, '<br>')
    // 处理加粗
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 处理链接
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  
  return formatted
}

export default {
  methods: {
    formatMessageContent
  }
}
</script>

<style scoped>
/* 遮罩层 */
.chat-window-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

/* 聊天窗口 */
.chat-window {
  width: 90%;
  max-width: 800px;
  height: 80vh;
  max-height: 700px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border-strong);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

/* 头部 */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg-hover);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-icon {
  font-size: 24px;
}

.header-title h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--glass-bg);
  border-color: var(--glass-border-strong);
  color: var(--text-primary);
}

.close-btn:hover {
  background: var(--error-bg);
  border-color: var(--error);
  color: var(--error);
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 40px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.8;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.empty-desc {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0 0 24px 0;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.quick-actions button {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-actions button:hover {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

/* 消息 */
.message {
  display: flex;
  gap: 12px;
  animation: slideIn 0.3s ease;
}

.message-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  font-size: 18px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 12px 16px;
}

.message.user .message-content {
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
}

.message.system .message-content {
  background: var(--warning-bg);
  border-color: var(--warning);
}

.message-text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  word-wrap: break-word;
}

.message-text :deep(pre) {
  margin: 12px 0;
  padding: 12px;
  background: var(--bg-gradient-start);
  border-radius: 8px;
  overflow-x: auto;
}

.message-text :deep(code) {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 2px 6px;
  background: var(--glass-bg-hover);
  border-radius: 4px;
}

.message-text :deep(pre code) {
  padding: 0;
  background: transparent;
}

.message-text :deep(strong) {
  font-weight: 600;
  color: var(--accent-primary);
}

.message-text :deep(a) {
  color: var(--accent-secondary);
  text-decoration: underline;
}

.message-time {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 打字指示器 */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: var(--text-tertiary);
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% { 
    opacity: 0.3;
    transform: scale(0.8);
  }
  30% { 
    opacity: 1;
    transform: scale(1);
  }
}

/* 输入区域 */
.chat-input-area {
  padding: 16px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  gap: 12px;
  background: var(--glass-bg-hover);
}

.chat-input {
  flex: 1;
  padding: 12px 16px;
  background: var(--bg-gradient-start);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  resize: none;
  outline: none;
  transition: border-color 0.2s;
}

.chat-input:focus {
  border-color: var(--accent-primary);
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.send-btn {
  padding: 12px 24px;
  background: linear-gradient(135deg, var(--accent-secondary), var(--accent-primary));
  border: none;
  border-radius: 12px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--accent-primary-glow);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 动画 */
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 过渡动画 */
.chat-window-enter-active,
.chat-window-leave-active {
  transition: all 0.3s ease;
}

.chat-window-enter-active .chat-window,
.chat-window-leave-active .chat-window {
  transition: all 0.3s ease;
}

.chat-window-enter-from,
.chat-window-leave-to {
  opacity: 0;
}

.chat-window-enter-from .chat-window,
.chat-window-leave-to .chat-window {
  opacity: 0;
  transform: scale(0.95) translateY(20px);
}

/* 响应式 */
@media (max-width: 600px) {
  .chat-window {
    width: 95%;
    height: 90vh;
    max-height: none;
    border-radius: 12px;
  }
  
  .quick-actions {
    flex-direction: column;
  }
  
  .chat-input-area {
    flex-direction: column;
  }
  
  .send-btn {
    width: 100%;
  }
}
</style>
