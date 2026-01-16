<script setup>
import { ref, computed, onMounted, watch, nextTick, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { downloadDir, join } from '@tauri-apps/api/path'

// State
const pngBase64 = ref('')
const tool = ref('pen') // select | pen | rect | arrow | text
const strokeWidth = ref(3)
const fontSize = ref(16)
const currentColor = ref('#22d3ee') // Default cyan
const busy = ref(false)
const error = ref('')
const showTextInput = ref(false)
const textInputValue = ref('')
const textInputPos = ref({ x: 0, y: 0 })
const editingTextIndex = ref(-1) // Index of text being edited, -1 for new text

// Selection and dragging state
const selectedShapeIndex = ref(-1)
const isDraggingShape = ref(false)
const dragStartPos = ref({ x: 0, y: 0 })
const shapeStartPos = ref({})

// Preset colors
const presetColors = [
  { color: '#22d3ee', name: '青色' },
  { color: '#ef4444', name: '红色' },
  { color: '#22c55e', name: '绿色' },
  { color: '#eab308', name: '黄色' },
  { color: '#ffffff', name: '白色' },
  { color: '#000000', name: '黑色' }
]

const canvasRef = ref(null)
const displayWidth = ref(0)
const displayHeight = ref(0)

const img = new Image()
const imgReady = ref(false)
const naturalSize = ref({ w: 0, h: 0 })

// Flag to prevent multiple window resize/center calls
const windowSized = ref(false)
// Flag to prevent receiving duplicate screenshot data
const dataReceived = ref(false)

// Shapes model
const shapes = ref([])
const drawing = ref(null)

const history = ref([])
const historyIdx = ref(-1)

const snapshot = () => JSON.parse(JSON.stringify(shapes.value))

const pushHistory = () => {
  history.value = history.value.slice(0, historyIdx.value + 1)
  history.value.push(snapshot())
  historyIdx.value = history.value.length - 1
}

const undo = () => {
  if (historyIdx.value <= 0) return
  historyIdx.value -= 1
  shapes.value = JSON.parse(JSON.stringify(history.value[historyIdx.value]))
  redraw()
}

const redo = () => {
  if (historyIdx.value >= history.value.length - 1) return
  historyIdx.value += 1
  shapes.value = JSON.parse(JSON.stringify(history.value[historyIdx.value]))
  redraw()
}

const canUndo = computed(() => historyIdx.value > 0)
const canRedo = computed(() => historyIdx.value >= 0 && historyIdx.value < history.value.length - 1)

// Tool selection handler
const selectTool = (newTool) => {
  tool.value = newTool
}

const getCtx = () => {
  const c = canvasRef.value
  if (!c) return null
  return c.getContext('2d')
}

const resizeCanvas = (isInitial = false) => {
  const c = canvasRef.value
  if (!c || !imgReady.value) return

  const iw = naturalSize.value.w
  const ih = naturalSize.value.h
  
  // Get screen size for max bounds (use 80% of screen as max)
  const screenW = window.screen.availWidth * 0.8
  const screenH = window.screen.availHeight * 0.8
  
  // Calculate scale to fit within screen bounds while preserving aspect ratio
  // Compact toolbar = less UI overhead
  const uiPadding = { width: 24, height: 100 } // margins + compact toolbar + status bar
  const maxImageW = screenW - uiPadding.width
  const maxImageH = screenH - uiPadding.height
  
  // Scale down if image is larger than available space
  const scale = Math.min(1, maxImageW / iw, maxImageH / ih)
  displayWidth.value = Math.floor(iw * scale)
  displayHeight.value = Math.floor(ih * scale)

  const dpr = window.devicePixelRatio || 1
  c.style.width = `${displayWidth.value}px`
  c.style.height = `${displayHeight.value}px`
  c.width = Math.floor(displayWidth.value * dpr)
  c.height = Math.floor(displayHeight.value * dpr)
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  
  // Only resize window on initial load
  if (isInitial) {
    resizeWindowToFit()
  }
  redraw()
}

const resizeWindowToFit = async () => {
  // Only resize once to prevent jitter
  if (windowSized.value) return
  windowSized.value = true
  
  try {
    const win = getCurrentWindow()
    
    // Window size = image display size + UI padding (compact toolbar)
    const dragHandleHeight = 12  // thin drag handle
    const toolbarHeight = 48     // compact single-row toolbar
    const statusBarHeight = 24   // minimal status bar
    const canvasPadding = 16     // canvas area padding
    
    const newWidth = Math.max(400, displayWidth.value + canvasPadding + 4)
    const newHeight = Math.max(280, displayHeight.value + dragHandleHeight + toolbarHeight + statusBarHeight + canvasPadding + 4)
    
    // Resize and center
    await win.setSize({ 
      type: 'Logical', 
      width: newWidth, 
      height: newHeight 
    })
    await win.center()
  } catch (e) {
    console.warn('Failed to resize window:', e)
  }
}

const redraw = () => {
  const ctx = getCtx()
  if (!ctx || !imgReady.value) return
  ctx.clearRect(0, 0, displayWidth.value, displayHeight.value)
  ctx.drawImage(img, 0, 0, displayWidth.value, displayHeight.value)
  const all = drawing.value ? shapes.value.concat([drawing.value]) : shapes.value
  all.forEach((s, idx) => drawShape(ctx, s, idx === selectedShapeIndex.value))
}

const drawShape = (ctx, s, isSelected = false) => {
  const c = s.color || currentColor.value
  ctx.save()
  ctx.strokeStyle = c
  ctx.fillStyle = c
  ctx.lineWidth = s.width || 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.type === 'pen') {
    const pts = s.points || []
    if (pts.length < 2) { ctx.restore(); return }
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  } else if (s.type === 'rect') {
    ctx.strokeRect(s.x, s.y, s.w, s.h)
    // Draw selection box
    if (isSelected) {
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1
      ctx.strokeRect(s.x - 4, s.y - 4, s.w + 8, s.h + 8)
      ctx.setLineDash([])
    }
  } else if (s.type === 'arrow') {
    drawArrow(ctx, s.x1, s.y1, s.x2, s.y2)
  } else if (s.type === 'text') {
    const textSize = s.fontSize || 16
    ctx.font = `${textSize}px system-ui, -apple-system, Segoe UI, Roboto`
    ctx.fillText(s.text || '', s.x, s.y)
    
    // Draw selection box around text
    if (isSelected) {
      const metrics = ctx.measureText(s.text || '')
      const textWidth = metrics.width
      const textHeight = textSize
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 1
      ctx.strokeRect(s.x - 4, s.y - textHeight - 2, textWidth + 8, textHeight + 8)
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}

const drawArrow = (ctx, x1, y1, x2, y2) => {
  const headlen = 10 + ctx.lineWidth
  const dx = x2 - x1
  const dy = y2 - y1
  const angle = Math.atan2(dy, dx)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

const toLocalPoint = (evt) => {
  const c = canvasRef.value
  const rect = c.getBoundingClientRect()
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top }
}

// Hit test for shapes (text, rect)
const hitTestShape = (p) => {
  const ctx = getCtx()
  if (!ctx) return -1
  
  // Test in reverse order (top-most first)
  for (let i = shapes.value.length - 1; i >= 0; i--) {
    const s = shapes.value[i]
    
    if (s.type === 'text') {
      const textSize = s.fontSize || 16
      ctx.font = `${textSize}px system-ui, -apple-system, Segoe UI, Roboto`
      const metrics = ctx.measureText(s.text || '')
      const textWidth = metrics.width
      const textHeight = textSize
      
      // Text is drawn with baseline at y, so bounding box is above
      if (p.x >= s.x - 4 && p.x <= s.x + textWidth + 4 &&
          p.y >= s.y - textHeight - 4 && p.y <= s.y + 8) {
        return i
      }
    } else if (s.type === 'rect') {
      // Normalize rectangle (handle negative width/height)
      const x = s.w < 0 ? s.x + s.w : s.x
      const y = s.h < 0 ? s.y + s.h : s.y
      const w = Math.abs(s.w)
      const h = Math.abs(s.h)
      
      // Hit test on the border (within 8px)
      const margin = 8
      const onLeft = p.x >= x - margin && p.x <= x + margin && p.y >= y - margin && p.y <= y + h + margin
      const onRight = p.x >= x + w - margin && p.x <= x + w + margin && p.y >= y - margin && p.y <= y + h + margin
      const onTop = p.y >= y - margin && p.y <= y + margin && p.x >= x - margin && p.x <= x + w + margin
      const onBottom = p.y >= y + h - margin && p.y <= y + h + margin && p.x >= x - margin && p.x <= x + w + margin
      
      if (onLeft || onRight || onTop || onBottom) {
        return i
      }
    }
  }
  return -1
}

// Legacy hit test for text (for editing)
const hitTestText = (p) => {
  const ctx = getCtx()
  if (!ctx) return -1
  
  for (let i = shapes.value.length - 1; i >= 0; i--) {
    const s = shapes.value[i]
    if (s.type !== 'text') continue
    
    const textSize = s.fontSize || 16
    ctx.font = `${textSize}px system-ui, -apple-system, Segoe UI, Roboto`
    const metrics = ctx.measureText(s.text || '')
    const textWidth = metrics.width
    const textHeight = textSize
    
    if (p.x >= s.x - 4 && p.x <= s.x + textWidth + 4 &&
        p.y >= s.y - textHeight - 4 && p.y <= s.y + 8) {
      return i
    }
  }
  return -1
}

const isDrawing = ref(false)

const onPointerDown = (evt) => {
  if (!imgReady.value) return
  error.value = ''
  
  const p = toLocalPoint(evt)
  const base = { color: currentColor.value, width: strokeWidth.value }
  
  // Select tool - for moving shapes
  if (tool.value === 'select') {
    const hitIndex = hitTestShape(p)
    if (hitIndex >= 0) {
      selectedShapeIndex.value = hitIndex
      isDraggingShape.value = true
      dragStartPos.value = { x: p.x, y: p.y }
      // Store original shape position
      const s = shapes.value[hitIndex]
      if (s.type === 'text' || s.type === 'rect') {
        shapeStartPos.value = { x: s.x, y: s.y }
      } else if (s.type === 'arrow') {
        shapeStartPos.value = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }
      }
    } else {
      selectedShapeIndex.value = -1
    }
    redraw()
    return
  }
  
  // Clear selection when using other tools
  selectedShapeIndex.value = -1
  
  if (tool.value === 'text') {
    // Check if clicking on existing text (for editing)
    const hitIndex = hitTestText(p)
    if (hitIndex >= 0) {
      // Edit existing text
      const existingText = shapes.value[hitIndex]
      editingTextIndex.value = hitIndex
      textInputValue.value = existingText.text
      // Position will be set to center in template
      textInputPos.value = { 
        canvasX: existingText.x,
        canvasY: existingText.y
      }
      showTextInput.value = true
      return
    }
    
    // New text
    editingTextIndex.value = -1
    textInputPos.value = { canvasX: p.x, canvasY: p.y }
    textInputValue.value = ''
    showTextInput.value = true
    return
  }
  
  isDrawing.value = true

  if (tool.value === 'pen') {
    drawing.value = { type: 'pen', points: [p], ...base }
  } else if (tool.value === 'rect') {
    drawing.value = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, ...base }
  } else if (tool.value === 'arrow') {
    drawing.value = { type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...base }
  }
  redraw()
}

const onPointerMove = (evt) => {
  const p = toLocalPoint(evt)
  
  // Handle shape dragging
  if (isDraggingShape.value && selectedShapeIndex.value >= 0) {
    const dx = p.x - dragStartPos.value.x
    const dy = p.y - dragStartPos.value.y
    const s = shapes.value[selectedShapeIndex.value]
    
    if (s.type === 'text' || s.type === 'rect') {
      s.x = shapeStartPos.value.x + dx
      s.y = shapeStartPos.value.y + dy
    } else if (s.type === 'arrow') {
      s.x1 = shapeStartPos.value.x1 + dx
      s.y1 = shapeStartPos.value.y1 + dy
      s.x2 = shapeStartPos.value.x2 + dx
      s.y2 = shapeStartPos.value.y2 + dy
    }
    redraw()
    return
  }
  
  // Handle drawing
  if (!isDrawing.value || !drawing.value) return
  const d = drawing.value
  if (d.type === 'pen') {
    d.points.push(p)
  } else if (d.type === 'rect') {
    d.w = p.x - d.x
    d.h = p.y - d.y
  } else if (d.type === 'arrow') {
    d.x2 = p.x
    d.y2 = p.y
  }
  redraw()
}

const onPointerUp = () => {
  // Finish shape dragging
  if (isDraggingShape.value) {
    isDraggingShape.value = false
    pushHistory()
    redraw()
    return
  }
  
  // Finish drawing
  if (!isDrawing.value) return
  isDrawing.value = false
  if (drawing.value) {
    shapes.value.push(JSON.parse(JSON.stringify(drawing.value)))
    drawing.value = null
    pushHistory()
  }
  redraw()
}

const confirmTextInput = () => {
  const text = textInputValue.value.trim()
  if (!text) {
    cancelTextInput()
    return
  }
  
  if (editingTextIndex.value >= 0) {
    // Update existing text
    shapes.value[editingTextIndex.value].text = text
    shapes.value[editingTextIndex.value].color = currentColor.value
    shapes.value[editingTextIndex.value].fontSize = fontSize.value
  } else {
    // Add new text
    shapes.value.push({
      type: 'text',
      x: textInputPos.value.canvasX,
      y: textInputPos.value.canvasY,
      text: text,
      color: currentColor.value,
      fontSize: fontSize.value,
      width: strokeWidth.value
    })
  }
  
  pushHistory()
  redraw()
  showTextInput.value = false
  textInputValue.value = ''
  editingTextIndex.value = -1
}

const cancelTextInput = () => {
  showTextInput.value = false
  textInputValue.value = ''
  editingTextIndex.value = -1
}

const exportPngBase64 = async () => {
  const c = canvasRef.value
  if (!c) return ''
  const dataUrl = c.toDataURL('image/png')
  return dataUrl.replace('data:image/png;base64,', '')
}

const copyToClipboard = async () => {
  busy.value = true
  error.value = ''
  try {
    const b64 = await exportPngBase64()
    if (!b64) throw new Error('导出图片失败')
    await invoke('clipboard_write_image_png', { pngBase64: b64 })
  } catch (e) {
    error.value = `复制失败: ${e?.message || e}`
  } finally {
    busy.value = false
  }
}

const saveToDownloads = async () => {
  busy.value = true
  error.value = ''
  try {
    const b64 = await exportPngBase64()
    if (!b64) throw new Error('导出图片失败')
    const dir = await downloadDir()
    const filename = `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    const path = await join(dir, filename)
    await invoke('screenshot_save_png', { pngBase64: b64, path })
  } catch (e) {
    error.value = `保存失败: ${e?.message || e}`
  } finally {
    busy.value = false
  }
}

const closeWindow = async () => {
  if (busy.value) return
  try {
    const win = getCurrentWindow()
    await win.close()
  } catch (e) {
    console.error('Failed to close window:', e)
  }
}

// Window dragging state for multi-monitor support
const isWindowDragging = ref(false)
const windowDragStart = ref({ mouseX: 0, mouseY: 0, winX: 0, winY: 0 })

const startDrag = async (evt) => {
  // Use manual dragging for better multi-monitor support
  try {
    const win = getCurrentWindow()
    const pos = await win.outerPosition()
    windowDragStart.value = {
      mouseX: evt.screenX,
      mouseY: evt.screenY,
      winX: pos.x,
      winY: pos.y
    }
    isWindowDragging.value = true
    
    // Add global mouse listeners
    document.addEventListener('mousemove', onWindowDrag)
    document.addEventListener('mouseup', stopWindowDrag)
  } catch (e) {
    // Fallback to Tauri's built-in dragging
    try {
      const win = getCurrentWindow()
      await win.startDragging()
    } catch {}
  }
}

const onWindowDrag = async (evt) => {
  if (!isWindowDragging.value) return
  
  const dx = evt.screenX - windowDragStart.value.mouseX
  const dy = evt.screenY - windowDragStart.value.mouseY
  
  try {
    const win = getCurrentWindow()
    await win.setPosition({
      type: 'Physical',
      x: Math.round(windowDragStart.value.winX + dx),
      y: Math.round(windowDragStart.value.winY + dy)
    })
  } catch (e) {
    console.warn('Failed to move window:', e)
  }
}

const stopWindowDrag = () => {
  isWindowDragging.value = false
  document.removeEventListener('mousemove', onWindowDrag)
  document.removeEventListener('mouseup', stopWindowDrag)
}

const openScreenRecordingSettings = async () => {
  try {
    await invoke('open_url_raw', {
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    })
  } catch {
    try {
      await invoke('open_url_raw', { url: 'x-apple.systempreferences:' })
    } catch {}
  }
}

const onKeydown = (e) => {
  if (e.key === 'Escape') {
    if (showTextInput.value) {
      cancelTextInput()
    } else {
      closeWindow()
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
    e.preventDefault()
    copyToClipboard()
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveToDownloads()
  }
}

const loadImage = (base64) => {
  imgReady.value = false
  shapes.value = []
  drawing.value = null
  history.value = []
  historyIdx.value = -1
  error.value = ''

  img.onload = async () => {
    imgReady.value = true
    naturalSize.value = { w: img.naturalWidth, h: img.naturalHeight }
    await nextTick()
    resizeCanvas(true) // Initial load - resize window to fit
    pushHistory()
  }
  img.onerror = () => {
    error.value = '图片加载失败'
  }
  img.src = `data:image/png;base64,${base64}`
}

// Window resize handler (doesn't resize the window, just redraws)
const handleWindowResize = () => resizeCanvas(false)

onMounted(async () => {
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', onKeydown)
  
  // Listen for screenshot data from main window - use once to prevent duplicates
  // Each window only needs to receive its own data once
  const unlisten = await listen('screenshot-data', (event) => {
    // Only process if we haven't received data yet
    if (dataReceived.value) return
    
    const { base64 } = event.payload
    if (base64) {
      dataReceived.value = true
      pngBase64.value = base64
      loadImage(base64)
      // Unlisten after receiving data to prevent overlap bug
      unlisten()
    }
  })
  
  // Also check URL params (fallback)
  const params = new URLSearchParams(window.location.search)
  const urlBase64 = params.get('data')
  if (urlBase64 && !dataReceived.value) {
    dataReceived.value = true
    pngBase64.value = urlBase64
    loadImage(urlBase64)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', onKeydown)
  // Clean up window drag listeners
  document.removeEventListener('mousemove', onWindowDrag)
  document.removeEventListener('mouseup', stopWindowDrag)
})
</script>

<template>
  <div class="float-container">
    <!-- Drag handle -->
    <div class="drag-handle" @mousedown="startDrag">
      <div class="drag-indicator"></div>
    </div>

    <!-- Compact Toolbar (WeChat Style) -->
    <div class="toolbar-container">
      <!-- Main Toolbar -->
      <div class="toolbar">
        <!-- Drawing Tools -->
        <button class="tool-btn" :class="{ active: tool === 'select' }" @click="selectTool('select')" title="选择移动">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
        </button>
        <button class="tool-btn" :class="{ active: tool === 'rect' }" @click="selectTool('rect')" title="矩形">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        </button>
        <button class="tool-btn" :class="{ active: tool === 'arrow' }" @click="selectTool('arrow')" title="箭头">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
        <button class="tool-btn" :class="{ active: tool === 'pen' }" @click="selectTool('pen')" title="画笔">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>
        </button>
        <button class="tool-btn" :class="{ active: tool === 'text' }" @click="selectTool('text')" title="文字">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
        </button>

        <div class="toolbar-divider"></div>

        <!-- Color Dots (inline, always visible) -->
        <div class="color-row">
          <button 
            v-for="preset in presetColors" 
            :key="preset.color"
            class="color-dot"
            :class="{ active: currentColor === preset.color }"
            :style="{ backgroundColor: preset.color }"
            :title="preset.name"
            @click="currentColor = preset.color"
          />
        </div>

        <div class="toolbar-divider"></div>

        <!-- Size Slider (inline) -->
        <div class="size-control">
          <span class="size-label">{{ tool === 'text' ? 'Aa' : '─' }}</span>
          <input 
            v-if="tool === 'text'"
            v-model.number="fontSize" 
            type="range" 
            min="12" 
            max="48"
            class="size-slider"
            :title="`字号: ${fontSize}px`"
          />
          <input 
            v-else
            v-model.number="strokeWidth" 
            type="range" 
            min="1" 
            max="12"
            class="size-slider"
            :title="`线宽: ${strokeWidth}px`"
          />
          <span class="size-value">{{ tool === 'text' ? fontSize : strokeWidth }}</span>
        </div>

        <div class="toolbar-divider"></div>

        <!-- Undo/Redo -->
        <button class="tool-btn" :disabled="!canUndo" @click="undo" title="撤销 ⌘Z">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
        <button class="tool-btn" :disabled="!canRedo" @click="redo" title="重做 ⌘⇧Z">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>

        <div class="toolbar-divider"></div>

        <!-- Actions -->
        <button class="tool-btn action-copy" @click="copyToClipboard" :disabled="busy || !imgReady" title="复制 ⌘C">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="tool-btn action-save" @click="saveToDownloads" :disabled="busy || !imgReady" title="保存 ⌘S">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="tool-btn close" @click="closeWindow" :disabled="busy" title="关闭 ESC">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Canvas -->
    <div class="canvas-area">
      <div v-if="!imgReady && !error" class="loading">
        <div class="spinner"></div>
        <span>加载截图...</span>
      </div>
      <canvas
        v-show="imgReady"
        ref="canvasRef"
        class="canvas"
        :class="'tool-' + tool"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
    </div>

    <!-- Text Input Popup (centered) -->
    <div v-if="showTextInput" class="text-input-overlay" @click.self="cancelTextInput">
      <div class="text-input-popup centered">
        <div class="text-input-header">
          {{ editingTextIndex >= 0 ? '编辑文字' : '添加文字' }}
        </div>
        <input 
          ref="textInputRef"
          v-model="textInputValue" 
          type="text" 
          placeholder="输入文字..." 
          @keydown.enter="confirmTextInput"
          @keydown.escape="cancelTextInput"
          autofocus
        />
        <div class="text-input-preview">
          预览颜色: <span class="color-preview" :style="{ backgroundColor: currentColor }"></span>
          字号: {{ fontSize }}px
        </div>
        <div class="text-input-actions">
          <button @click="cancelTextInput">取消</button>
          <button class="primary" @click="confirmTextInput">确定</button>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="error">{{ error }}</div>

    <!-- Status bar -->
    <div class="status-bar">
      <span class="size-info" v-if="imgReady">{{ naturalSize.w }} × {{ naturalSize.h }}</span>
      <button class="perm-link" @click="openScreenRecordingSettings">权限设置</button>
    </div>
  </div>
</template>

<style scoped>
/* ========================================
   Compact Screenshot Editor - Dark OLED Style
   Clean, minimal, professional
   ======================================== */

.float-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0d0d0d;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}

/* Drag Handle - Minimal */
.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 0;
  cursor: grab;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-indicator {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s;
}

.drag-handle:hover .drag-indicator {
  background: rgba(255, 255, 255, 0.3);
}

/* ========================================
   Toolbar Container
   ======================================== */
.toolbar-container {
  display: flex;
  justify-content: center;
  padding: 4px 8px 8px;
}

/* ========================================
   Main Toolbar - Compact Single Row
   ======================================== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: rgba(30, 30, 32, 0.95);
  backdrop-filter: blur(16px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 3px;
}

/* Tool Buttons */
.tool-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}

.tool-btn svg {
  width: 16px;
  height: 16px;
}

.tool-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.tool-btn.active {
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
}

.tool-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.tool-btn.close:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.tool-btn.action-copy:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
}

.tool-btn.action-save:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

/* Inline Color Row */
.color-row {
  display: flex;
  align-items: center;
  gap: 3px;
}

/* Color Dots */
.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: all 0.12s ease;
  padding: 0;
  flex-shrink: 0;
}

.color-dot:hover {
  transform: scale(1.15);
}

.color-dot.active {
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
}

/* Inline Size Control */
.size-control {
  display: flex;
  align-items: center;
  gap: 4px;
}

.size-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
  width: 16px;
  text-align: center;
}

.size-slider {
  width: 50px;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  cursor: pointer;
}

.size-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22d3ee;
  cursor: pointer;
  transition: transform 0.1s;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.size-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.size-value {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 16px;
  text-align: right;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ========================================
   Canvas Area
   ======================================== */
.canvas-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  overflow: hidden;
}

.canvas {
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  touch-action: none;
}

.canvas.tool-select {
  cursor: default;
}

.canvas.tool-pen,
.canvas.tool-rect,
.canvas.tool-arrow {
  cursor: crosshair;
}

.canvas.tool-text {
  cursor: text;
}

/* Loading State */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #22d3ee;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ========================================
   Text Input Popup
   ======================================== */
.text-input-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px);
}

.text-input-popup {
  position: absolute;
  background: rgba(40, 40, 42, 0.98);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-width: 260px;
}

.text-input-popup.centered {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.text-input-header {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.text-input-popup input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: white;
  font-size: 14px;
  font-weight: 500;
  outline: none;
  box-sizing: border-box;
}

.text-input-popup input:focus {
  border-color: #22d3ee;
}

.text-input-popup input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.text-input-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 10px;
}

.color-preview {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.text-input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.text-input-actions button {
  padding: 7px 16px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.text-input-actions button:hover {
  background: rgba(255, 255, 255, 0.15);
}

.text-input-actions button.primary {
  background: #22d3ee;
  color: white;
}

.text-input-actions button.primary:hover {
  background: #06b6d4;
}

/* ========================================
   Error Message
   ======================================== */
.error {
  margin: 0 12px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  font-size: 11px;
}

/* ========================================
   Status Bar - Minimal
   ======================================== */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.size-info {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.perm-link {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
}

.perm-link:hover {
  color: #22d3ee;
}
</style>
