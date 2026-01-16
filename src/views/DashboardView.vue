<script setup>
import { ref, computed } from 'vue'
import JiraPanel from '../components/dashboard/JiraPanel.vue'
import HotTopicsPanel from '../components/dashboard/HotTopicsPanel.vue'
import TodoListPanel from '../components/dashboard/TodoListPanel.vue'
import CreateBranchModal from '../components/dashboard/CreateBranchModal.vue'

// 分支创建弹窗
const showBranchModal = ref(false)
const selectedIssue = ref(null)

const handleCreateBranch = (issue) => {
  selectedIssue.value = issue
  showBranchModal.value = true
}

const handleBranchSuccess = (result) => {
  console.log('Branch created:', result)
}

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning! ☀️'
  if (hour < 18) return 'Good Afternoon! 🌤'
  return 'Good Evening! 🌙'
})

// 打开 AI 聊天
const openAIChat = () => {
  window.dispatchEvent(new CustomEvent('open-ai-chat'))
}
</script>

<template>
  <div class="dashboard-view">
    <div class="dashboard-header">
      <div class="greeting">
        <h1>{{ greeting }}</h1>
        <p>准备开始新的一天吧</p>
      </div>
      <div class="header-meta">
        <button class="ai-chat-btn" @click="openAIChat" title="AI 助手 (⌘+K)">
          🤖 AI 助手
        </button>
        <span class="date">{{ new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }) }}</span>
      </div>
    </div>
    
    <div class="dashboard-grid">
      <div class="grid-col">
        <JiraPanel @create-branch="handleCreateBranch" />
      </div>
      <div class="grid-col">
        <HotTopicsPanel />
      </div>
      <div class="grid-col">
        <TodoListPanel />
      </div>
    </div>
    
    <!-- 分支创建弹窗 -->
    <CreateBranchModal
      :visible="showBranchModal"
      :issue="selectedIssue"
      @close="showBranchModal = false"
      @success="handleBranchSuccess"
    />
  </div>
</template>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  padding-bottom: 80px; /* Space for dock */
}

.dashboard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.greeting h1 {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px 0;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary-light) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.greeting p {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0;
}

.header-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.ai-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent-secondary);
  background: var(--accent-secondary-glow);
  border: 1px solid var(--accent-secondary);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.ai-chat-btn:hover {
  background: var(--accent-secondary);
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px var(--accent-secondary-glow);
}

.date {
  font-size: 13px;
  color: var(--text-tertiary);
}

.dashboard-grid {
  display: grid;
  /* Jira : 热点 : Todo = 4:4:2 */
  grid-template-columns: 4fr 4fr 2fr;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.grid-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Todo 列限制最大宽度 */
.grid-col:nth-child(3) {
  max-width: 320px;
}

/* Responsive adjustments */
@media (max-width: 1200px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .grid-col:nth-child(3) {
    grid-column: span 2;
    max-width: none;
  }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .grid-col:nth-child(3) {
    grid-column: span 1;
    max-width: none;
  }
}
</style>
