<script setup>
import { ref, computed } from 'vue'
import JiraPanel from '../components/dashboard/JiraPanel.vue'
import HotTopicsPanel from '../components/dashboard/HotTopicsPanel.vue'
import QuickNotesPanel from '../components/dashboard/QuickNotesPanel.vue'
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
</script>

<template>
  <div class="dashboard-view">
    <div class="dashboard-header">
      <div class="greeting">
        <h1>{{ greeting }}</h1>
        <p>准备开始新的一天吧</p>
      </div>
      <div class="header-meta">
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
        <QuickNotesPanel />
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
  gap: 4px;
}

.date {
  font-size: 13px;
  color: var(--text-tertiary);
}

.dashboard-grid {
  display: grid;
  /* Jira 和 热点 各占 2fr，Quick Notes 占 1fr */
  grid-template-columns: 2fr 2fr 1fr;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.grid-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Responsive adjustments */
@media (max-width: 1200px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .grid-col:nth-child(3) {
    grid-column: span 2;
  }
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .grid-col:nth-child(3) {
    grid-column: span 1;
  }
}
</style>
