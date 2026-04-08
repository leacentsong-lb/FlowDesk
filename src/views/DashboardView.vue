<script setup>
import { ref } from 'vue'
import JiraPanel from '../components/dashboard/JiraPanel.vue'
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
</script>

<template>
  <div class="dashboard-view">
    <div class="dashboard-grid">
      <div class="grid-col">
        <JiraPanel @create-branch="handleCreateBranch" />
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

.dashboard-grid {
  display: grid;
  grid-template-columns: 3fr 1fr;
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
.grid-col:nth-child(2) {
  max-width: 320px;
}

/* Responsive adjustments */
@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .grid-col:nth-child(2) {
    max-width: none;
  }
}
</style>
