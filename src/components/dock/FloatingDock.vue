<script setup>
// defineProps and defineEmits are Vue compiler macros, no import needed
const props = defineProps({
  currentView: {
    type: String,
    default: 'dashboard'
  }
})

const emit = defineEmits(['navigate', 'openSettings', 'openSpotlight'])

const navItems = [
  { id: 'dashboard', icon: '🏠', label: 'Home', tooltip: '工作台' },
  { id: 'dev', icon: '👨‍💻', label: 'Dev', tooltip: '开发面板' }
]

const handleNavigate = (viewId) => {
  emit('navigate', viewId)
}

const handleSettings = () => {
  emit('openSettings')
}

const handleSpotlight = () => {
  emit('openSpotlight')
}
</script>

<template>
  <div class="floating-dock">
    <div class="dock-container">
      <!-- Navigation Items -->
      <div class="dock-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="dock-item"
          :class="{ active: currentView === item.id }"
          :title="item.tooltip"
          @click="handleNavigate(item.id)"
        >
          <span class="dock-icon">{{ item.icon }}</span>
          <span class="dock-label">{{ item.label }}</span>
        </button>
        
        <button
          class="dock-item"
          title="设置"
          @click="handleSettings"
        >
          <span class="dock-icon">⚙️</span>
          <span class="dock-label">设置</span>
        </button>
      </div>
      
      <!-- Divider -->
      <div class="dock-divider"></div>
      
      <!-- Spotlight Search -->
      <button
        class="dock-spotlight"
        title="快速搜索 (⌘K)"
        @click="handleSpotlight"
      >
        <span class="spotlight-icon">🔍</span>
        <span class="spotlight-text">搜索...</span>
        <span class="spotlight-shortcut">⌘K</span>
      </button>
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

.dock-icon {
  font-size: 20px;
  line-height: 1;
  transition: transform 0.2s ease;
}

.dock-item:hover .dock-icon {
  transform: scale(1.15);
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
