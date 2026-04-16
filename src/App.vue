<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import DashboardView from './views/DashboardView.vue'
import DevView from './views/DevView.vue'
import ToolsView from './views/ToolsView.vue'
import FloatingDock from './components/dock/FloatingDock.vue'
import SettingsDrawer from './components/settings/SettingsDrawer.vue'
import { initTheme } from './config'

const currentView = ref('dashboard')
const settingsOpen = ref(false)
const settingsTab = ref('projects')

const handleOpenSettings = (tab = 'projects') => {
  settingsTab.value = tab
  settingsOpen.value = true
}

const handleOpenSettingsEvent = (event) => {
  handleOpenSettings(event.detail?.tab || 'projects')
}

const handleKeydown = (event) => {
  if (event.key === 'Escape') {
    settingsOpen.value = false
  }
}

onMounted(() => {
  initTheme()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('open-settings', handleOpenSettingsEvent)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('open-settings', handleOpenSettingsEvent)
})
</script>

<template>
  <div class="app-container">
    <!-- 背景效果 -->
    <div class="background-effects">
      <div class="bg-gradient"></div>
      <div class="bg-glow bg-glow-1"></div>
      <div class="bg-glow bg-glow-2"></div>
    </div>
    
    <!-- 主内容 -->
    <div class="app-content">
      <!-- 视图切换 -->
      <DashboardView v-if="currentView === 'dashboard'" />
      <DevView v-else-if="currentView === 'dev'" @navigate-home="currentView = 'dashboard'" />
      <ToolsView v-else-if="currentView === 'tools'" />
    </div>
    
    <!-- 浮动 Dock (Dev 视图下隐藏) -->
    <FloatingDock
      v-if="currentView !== 'dev'"
      :current-view="currentView"
      @navigate="currentView = $event"
      @open-settings="handleOpenSettings"
    />

    <!-- 全局设置抽屉 -->
    <SettingsDrawer
      :open="settingsOpen"
      :tab="settingsTab"
      @close="settingsOpen = false"
      @update:tab="settingsTab = $event"
    />
    
  </div>
</template>

<style>
/* 全局样式导入 */
@import './style.css';

/* App 容器 */
.app-container {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-gradient-start, #0a0e1a);
}

/* 背景效果 */
.background-effects {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.bg-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    var(--bg-gradient-start, #0a0e1a) 0%,
    var(--bg-gradient-mid, #131a2e) 50%,
    var(--bg-gradient-end, #1a1f35) 100%
  );
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.3;
  transition: background 0.5s ease, opacity 0.5s ease;
}

.bg-glow-1 {
  width: 600px;
  height: 600px;
  top: -200px;
  right: -100px;
  background: radial-gradient(circle, var(--accent-glow-strong) 0%, transparent 70%);
}

.bg-glow-2 {
  width: 500px;
  height: 500px;
  bottom: -150px;
  left: -100px;
  background: radial-gradient(circle, var(--accent-secondary-glow) 0%, transparent 70%);
}

/* Light theme: reduce glow intensity */
[data-theme="lemon-fresh"] .bg-glow {
  opacity: 0.15;
}

/* App 内容 */
.app-content {
  position: relative;
  z-index: 1;
  height: 100%;
  overflow: hidden;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
