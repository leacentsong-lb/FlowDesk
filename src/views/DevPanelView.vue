<script setup>
import { ref } from 'vue'
import MemberModule from '../components/dev/MemberModule.vue'
import GitModule from '../components/dev/GitModule.vue'

const activeTab = ref('git')

const tabs = [
  { id: 'git', label: 'Git', icon: '🔀' },
  { id: 'member', label: 'Member', icon: '👤' }
]
</script>

<template>
  <div class="dev-panel-view">
    <!-- Tab 切换 -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </div>
    
    <!-- 内容区域 -->
    <div class="tab-content">
      <MemberModule v-if="activeTab === 'member'" />
      <GitModule v-else-if="activeTab === 'git'" />
    </div>
  </div>
</template>

<style scoped>
.dev-panel-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-bar {
  display: flex;
  gap: 4px;
  padding: 16px 24px;
  background: var(--glass-bg);
  border-bottom: 1px solid var(--glass-border);
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--text-secondary);
  background: var(--glass-bg-hover);
}

.tab-btn.active {
  color: var(--accent-primary);
  background: var(--accent-glow);
  border-color: var(--accent-primary);
}

.tab-icon {
  font-size: 16px;
}

.tab-label {
  font-weight: 600;
}

.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
