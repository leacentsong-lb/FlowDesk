<script setup>
const props = defineProps({
  currentView: { type: String, default: 'dashboard' }
})
const emit = defineEmits(['openSettings', 'navigate'])
</script>

<template>
  <div class="floating-dock">
    <div class="dock-container">
      <div class="dock-nav">
        <button
          class="dock-item"
          :class="{ active: currentView === 'dashboard' }"
          title="工作台"
          @click="emit('navigate', 'dashboard')"
        >
          <svg class="dock-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span class="dock-label">Home</span>
        </button>

        <button
          class="dock-item"
          :class="{ active: currentView === 'dev' }"
          title="Dev"
          @click="emit('navigate', 'dev')"
        >
          <svg class="dock-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          <span class="dock-label">Dev</span>
        </button>

        <button
          class="dock-item"
          :class="{ active: currentView === 'tools' }"
          title="工具"
          @click="emit('navigate', 'tools')"
        >
          <svg class="dock-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.6 7.6l-6.9 6.9a2 2 0 1 1-2.8-2.8l6.9-6.9a6 6 0 0 1 7.6-7.6z"/></svg>
          <span class="dock-label">Tools</span>
        </button>
        
        <button
          class="dock-item"
          title="设置"
          @click="emit('openSettings')"
        >
          <svg class="dock-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span class="dock-label">Settings</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.floating-dock {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
}

.dock-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-glass);
  transition: all 0.3s ease;
}

.dock-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.dock-item:hover {
  background: var(--glass-bg-hover);
  transform: translateY(-2px) scale(1.05);
}

.dock-item.active {
  background: var(--accent-glow);
}

.dock-item.active::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  background: var(--accent-primary, #00d4ff);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--accent-primary, #00d4ff);
}

.dock-svg-icon {
  width: 20px;
  height: 20px;
  transition: transform 0.15s ease;
  color: var(--text-secondary);
}

.dock-item:hover .dock-svg-icon,
.dock-item.active .dock-svg-icon {
  color: var(--text-primary);
}

.dock-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: color 0.2s ease;
}

.dock-item:hover .dock-label,
.dock-item.active .dock-label {
  color: var(--text-primary);
}

.dock-divider {
  width: 1px;
  height: 32px;
  background: var(--glass-border);
  margin: 0 4px;
}

.dock-spotlight {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 140px;
}

.dock-spotlight:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-strong);
}

.spotlight-icon {
  font-size: 14px;
  opacity: 0.7;
}

.spotlight-text {
  font-size: 12px;
  color: var(--text-tertiary);
  flex: 1;
}

.spotlight-shortcut {
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--glass-bg);
  border-radius: 4px;
}
</style>
