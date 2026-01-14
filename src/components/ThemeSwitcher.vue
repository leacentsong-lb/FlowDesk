<script setup>
import { ref, computed, onMounted } from 'vue'
import { THEMES, getCurrentTheme, setTheme } from '../config'

// Current theme
const currentThemeId = ref(getCurrentTheme())

// Is dark mode (cyber-night)
const isDarkMode = computed(() => currentThemeId.value === 'cyber-night')

// Theme configs
const darkTheme = THEMES.find(t => t.id === 'cyber-night')
const lightTheme = THEMES.find(t => t.id === 'lemon-fresh')

// Toggle theme
const toggleTheme = () => {
  const newTheme = isDarkMode.value ? 'lemon-fresh' : 'cyber-night'
  currentThemeId.value = newTheme
  setTheme(newTheme)
}

onMounted(() => {
  currentThemeId.value = getCurrentTheme()
})
</script>

<template>
  <div class="theme-switcher">
    <button 
      class="theme-toggle" 
      :class="{ 'is-dark': isDarkMode }"
      @click="toggleTheme"
      :title="isDarkMode ? '切换到亮色模式' : '切换到暗色模式'"
    >
      <!-- Track background -->
      <span class="toggle-track">
        <!-- Icons on track -->
        <span class="track-icon track-icon-light">🍋</span>
        <span class="track-icon track-icon-dark">🌙</span>
      </span>
      
      <!-- Thumb -->
      <span class="toggle-thumb">
        <span class="thumb-icon">{{ isDarkMode ? '🌙' : '🍋' }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.theme-switcher {
  position: fixed;
  bottom: 24px;
  left: 20px;
  z-index: 1000;
  display: flex;
  align-items: center;
}

.theme-toggle {
  position: relative;
  width: 56px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  background: transparent;
  transition: all 0.3s ease;
}

.toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, #F0FFF4 0%, #D1FAE5 100%);
  border: 1px solid rgba(46, 139, 87, 0.25);
  box-shadow: 
    inset 0 2px 4px rgba(0, 0, 0, 0.06),
    0 1px 3px rgba(0, 0, 0, 0.08);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.is-dark .toggle-track {
  background: linear-gradient(135deg, #0a0e1a 0%, #1a1f35 100%);
  border-color: rgba(0, 212, 255, 0.25);
  box-shadow: 
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 0 12px rgba(0, 212, 255, 0.15);
}

.track-icon {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  transition: opacity 0.3s ease;
}

.track-icon-light {
  left: 6px;
  opacity: 1;
}

.track-icon-dark {
  right: 6px;
  opacity: 0.4;
}

.is-dark .track-icon-light {
  opacity: 0.4;
}

.is-dark .track-icon-dark {
  opacity: 1;
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 
    0 2px 6px rgba(0, 0, 0, 0.15),
    0 1px 2px rgba(0, 0, 0, 0.1);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.is-dark .toggle-thumb {
  left: calc(100% - 26px);
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.4),
    0 0 8px rgba(0, 212, 255, 0.3);
}

.thumb-icon {
  font-size: 14px;
  transition: transform 0.3s ease;
}

.theme-toggle:hover .thumb-icon {
  transform: scale(1.15);
}

.theme-toggle:active .toggle-thumb {
  width: 28px;
}

.is-dark.theme-toggle:active .toggle-thumb {
  left: calc(100% - 30px);
}

/* Hover effect */
.theme-toggle:hover .toggle-track {
  border-color: rgba(46, 139, 87, 0.4);
}

.is-dark:hover .toggle-track {
  border-color: rgba(0, 212, 255, 0.4);
  box-shadow: 
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 0 16px rgba(0, 212, 255, 0.25);
}

/* Focus state */
.theme-toggle:focus-visible {
  outline: none;
}

.theme-toggle:focus-visible .toggle-track {
  box-shadow: 
    0 0 0 3px var(--accent-glow),
    inset 0 2px 4px rgba(0, 0, 0, 0.06);
}
</style>
