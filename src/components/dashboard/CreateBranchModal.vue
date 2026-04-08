<script setup>
import { computed } from 'vue'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps({
  visible: Boolean,
  issue: Object
})

const emit = defineEmits(['close', 'success'])

const settings = useSettingsStore()

const workspacePath = computed(() => settings.workspacePath)

const newBranchName = computed(() => {
  if (!props.issue?.key) return ''
  return `feat/${props.issue.key}`
})

const canContinue = computed(() => !!workspacePath.value)

const openWorkspaceSettings = () => {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'projects' } }))
}

const handleConfirm = () => {
  if (!canContinue.value) return

  emit('success', {
    issueKey: props.issue?.key,
    branch: newBranchName.value,
    workspacePath: workspacePath.value
  })
  emit('close')
}

const handleClose = () => {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <div class="modal-header">
            <h3>🤖 交给 AI 创建分支</h3>
            <button class="close-btn" @click="handleClose">✕</button>
          </div>

          <div class="issue-info">
            <span class="issue-key">{{ issue?.key }}</span>
            <span class="issue-summary">{{ issue?.summary }}</span>
          </div>

          <div class="modal-content">
            <div class="form-section">
              <label>工作区</label>
              <div class="workspace-preview">
                <span class="workspace-icon">📁</span>
                <code>{{ workspacePath || '未设置工作区' }}</code>
              </div>
              <p class="section-hint">AI 会基于这个工作区目录自行判断应该操作哪个仓库。</p>
            </div>

            <div class="form-section">
              <label>推荐分支名</label>
              <div class="branch-preview">
                <span class="branch-icon">🌿</span>
                <code>{{ newBranchName }}</code>
              </div>
            </div>

            <div class="handoff-note">
              <div class="note-title">接下来会发生什么</div>
              <ul>
                <li>不再要求手动指定具体项目</li>
                <li>不再直接在本地执行 git 创建/推送</li>
                <li>后续由 AI 根据 issue 与工作区自行处理</li>
              </ul>
            </div>

            <div v-if="!canContinue" class="warning-card">
              <span>⚠️ 还没有设置工作区，请先到设置页选择本地工作区。</span>
              <button class="link-btn" @click="openWorkspaceSettings">去设置</button>
            </div>
          </div>

          <div class="modal-actions">
            <button class="cancel-btn" @click="handleClose">取消</button>
            <button class="confirm-btn" :disabled="!canContinue" @click="handleConfirm">交给 AI</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-container {
  width: min(560px, calc(100vw - 32px));
  background: var(--bg-primary);
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  box-shadow: var(--shadow-glass);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-primary);
}

.close-btn {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
}

.issue-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 0;
}

.issue-key {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--accent-primary-bg);
  color: var(--accent-primary);
  font-size: 12px;
  font-weight: 700;
}

.issue-summary {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.modal-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-section label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.workspace-preview,
.branch-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}

.workspace-preview code,
.branch-preview code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.section-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.handoff-note {
  padding: 14px;
  border-radius: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.note-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.handoff-note ul {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.warning-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  color: var(--warning);
  font-size: 12px;
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 20px 20px;
}

.cancel-btn,
.confirm-btn {
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.confirm-btn {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
}

.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
