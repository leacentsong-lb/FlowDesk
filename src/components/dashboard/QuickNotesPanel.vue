<script setup>
import { ref, onMounted, watch } from 'vue'

// Notes stored in localStorage
const notes = ref([])
const editingNote = ref(null)
const newNoteContent = ref('')
const isAddingNote = ref(false)

const STORAGE_KEY = 'dev-helper-quick-notes'

// Load notes from localStorage
const loadNotes = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      notes.value = JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load notes:', e)
  }
}

// Save notes to localStorage
const saveNotes = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.value))
  } catch (e) {
    console.error('Failed to save notes:', e)
  }
}

// Watch for changes and auto-save
watch(notes, saveNotes, { deep: true })

onMounted(() => {
  loadNotes()
  
  // Add some default notes if empty
  if (notes.value.length === 0) {
    notes.value = [
      { id: 1, content: '欢迎使用 Dev Helper! 🎉', createdAt: new Date().toISOString(), color: 'cyan' },
      { id: 2, content: '点击 + 添加新笔记', createdAt: new Date().toISOString(), color: 'emerald' },
    ]
  }
})

const addNote = () => {
  if (!newNoteContent.value.trim()) return
  
  const colors = ['cyan', 'amber', 'emerald', 'purple', 'rose']
  const randomColor = colors[Math.floor(Math.random() * colors.length)]
  
  notes.value.unshift({
    id: Date.now(),
    content: newNoteContent.value.trim(),
    createdAt: new Date().toISOString(),
    color: randomColor
  })
  
  newNoteContent.value = ''
  isAddingNote.value = false
}

const deleteNote = (noteId) => {
  notes.value = notes.value.filter(n => n.id !== noteId)
}

const startEditing = (note) => {
  editingNote.value = { ...note }
}

const saveEdit = () => {
  if (!editingNote.value) return
  
  const index = notes.value.findIndex(n => n.id === editingNote.value.id)
  if (index !== -1) {
    notes.value[index].content = editingNote.value.content
  }
  editingNote.value = null
}

const cancelEdit = () => {
  editingNote.value = null
}

const formatDate = (dateStr) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return date.toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="panel notes-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="panel-icon">📝</span>
        <span>Quick Notes</span>
      </div>
      <button 
        class="panel-action add-btn" 
        title="添加笔记"
        @click="isAddingNote = !isAddingNote"
      >
        {{ isAddingNote ? '✕' : '＋' }}
      </button>
    </div>
    
    <div class="panel-content">
      <!-- Add new note form -->
      <div v-if="isAddingNote" class="add-note-form">
        <textarea
          v-model="newNoteContent"
          placeholder="写点什么..."
          class="note-input"
          rows="3"
          @keydown.enter.meta="addNote"
          @keydown.enter.ctrl="addNote"
        ></textarea>
        <div class="form-actions">
          <span class="hint">⌘ + Enter 保存</span>
          <button class="save-btn" @click="addNote">保存</button>
        </div>
      </div>
      
      <!-- Notes list -->
      <div class="notes-list">
        <div 
          v-for="note in notes" 
          :key="note.id" 
          class="note-card"
          :class="[`note-${note.color}`]"
        >
          <!-- Edit mode -->
          <template v-if="editingNote?.id === note.id">
            <textarea
              v-model="editingNote.content"
              class="edit-input"
              rows="3"
            ></textarea>
            <div class="edit-actions">
              <button class="action-btn cancel" @click="cancelEdit">取消</button>
              <button class="action-btn save" @click="saveEdit">保存</button>
            </div>
          </template>
          
          <!-- View mode -->
          <template v-else>
            <div class="note-content">{{ note.content }}</div>
            <div class="note-footer">
              <span class="note-time">{{ formatDate(note.createdAt) }}</span>
              <div class="note-actions">
                <button class="note-btn" @click="startEditing(note)" title="编辑">✏️</button>
                <button class="note-btn" @click="deleteNote(note.id)" title="删除">🗑️</button>
              </div>
            </div>
          </template>
        </div>
      </div>
      
      <div v-if="notes.length === 0" class="empty-state">
        <span class="empty-icon">📝</span>
        <p>暂无笔记</p>
        <p class="empty-hint">点击上方 + 添加第一条笔记</p>
      </div>
    </div>
    
    <div class="panel-footer">
      <span class="footer-text">{{ notes.length }} 条笔记</span>
      <span class="footer-hint">本地存储</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-glass);
  transition: background 0.3s ease, border-color 0.3s ease;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-icon {
  font-size: 18px;
}

.panel-action {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s ease;
}

.panel-action:hover {
  background: var(--success-glow);
  border-color: var(--success);
}

.add-btn {
  color: var(--success);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.add-note-form {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--success-glow);
  border: 1px solid var(--success);
  border-radius: 12px;
}

.note-input,
.edit-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  resize: none;
  outline: none;
  transition: border-color 0.2s ease;
}

.note-input:focus,
.edit-input:focus {
  border-color: var(--success);
}

.note-input::placeholder {
  color: var(--text-tertiary);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.save-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--success);
  background: var(--success-glow);
  border: 1px solid var(--success);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.save-btn:hover {
  filter: brightness(1.1);
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.note-card {
  padding: 12px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  border-left: 3px solid transparent;
  transition: all 0.2s ease;
}

.note-card:hover {
  background: var(--glass-bg-hover);
}

.note-cyan { border-left-color: var(--accent-primary); }
.note-amber { border-left-color: var(--accent-warm); }
.note-emerald { border-left-color: var(--success); }
.note-purple { border-left-color: var(--accent-secondary-light); }
.note-rose { border-left-color: var(--error-light); }

.note-content {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.note-time {
  font-size: 10px;
  color: var(--text-tertiary);
}

.note-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.note-card:hover .note-actions {
  opacity: 1;
}

.note-btn {
  padding: 4px 6px;
  font-size: 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.note-btn:hover {
  opacity: 1;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.action-btn {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn.cancel {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.action-btn.save {
  color: var(--success);
  background: var(--success-glow);
  border: 1px solid var(--success);
}

.action-btn:hover {
  filter: brightness(1.1);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.empty-hint {
  font-size: 11px !important;
  margin-top: 4px !important;
  color: var(--text-tertiary) !important;
}

.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--glass-bg);
  border-top: 1px solid var(--glass-border);
}

.footer-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

.footer-hint {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--glass-bg);
  border-radius: 4px;
}
</style>
