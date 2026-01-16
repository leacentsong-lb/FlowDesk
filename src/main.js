import { createApp, h } from 'vue'
import App from './App.vue'
import ScreenshotFloatView from './views/ScreenshotFloatView.vue'
import './style.css'

// Simple hash-based routing for screenshot float windows
const getRoute = () => {
  const hash = window.location.hash
  if (hash === '#/screenshot-float') {
    return 'screenshot-float'
  }
  return 'main'
}

const route = getRoute()

if (route === 'screenshot-float') {
  // Mount screenshot float view for floating windows
  createApp(ScreenshotFloatView).mount('#app')
} else {
  // Mount main app
  createApp(App).mount('#app')
}
