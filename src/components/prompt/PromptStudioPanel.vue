<script setup>
import { computed } from 'vue'
import { buildSystemPrompt } from '../../agent/context.js'
import { useReleaseStore } from '../../stores/release'
import { useSettingsStore } from '../../stores/settings'
import { usePromptStore } from '../../stores/prompt'

const release = useReleaseStore()
const settings = useSettingsStore()
const prompt = usePromptStore()

const specialRulesText = computed({
  get: () => prompt.config.specialRules.join('\n'),
  set: (value) => {
    prompt.config.specialRules = String(value || '')
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  }
})

const responseRulesText = computed({
  get: () => prompt.config.responseRules.join('\n'),
  set: (value) => {
    prompt.config.responseRules = String(value || '')
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  }
})

const previewPrompt = computed(() => buildSystemPrompt({
  mode: release.mode || 'general',
  version: release.version || '',
  environment: release.environment || 'production',
  workspacePath: settings.workspacePath,
  completedTools: release.completedTools || [],
  primedSkillBundle: release.primedSkillBundle || '',
  promptConfig: prompt.config
}))

function savePrompt() {
  prompt.savePromptConfig()
}

function resetPrompt() {
  prompt.resetPromptConfig()
}
</script>

<template>
  <div class="prompt-studio">
    <div class="prompt-header">
      <div>
        <h4>提示词工程调试台</h4>
        <p class="prompt-desc">按 section 编辑 Prompt，右侧实时预览最终 system prompt。</p>
      </div>
      <div class="prompt-actions">
        <button data-testid="prompt-reset-btn" class="prompt-btn ghost" @click="resetPrompt">恢复默认</button>
        <button class="prompt-btn primary" @click="savePrompt">保存配置</button>
      </div>
    </div>

    <div class="prompt-grid">
      <section class="prompt-editor">
        <div class="form-group">
          <label>通用角色</label>
          <textarea
            data-testid="prompt-general-role-input"
            v-model="prompt.config.role.generalIntro"
            class="prompt-textarea"
            rows="3"
          ></textarea>
        </div>

        <div class="form-group">
          <label>发布角色</label>
          <textarea
            v-model="prompt.config.role.releaseIntro"
            class="prompt-textarea"
            rows="3"
          ></textarea>
        </div>

        <div class="form-group">
          <label>通用工作流</label>
          <textarea
            v-model="prompt.config.workflow.general"
            class="prompt-textarea prompt-textarea-lg"
            rows="8"
          ></textarea>
        </div>

        <div class="form-group">
          <label>发布工作流</label>
          <textarea
            v-model="prompt.config.workflow.release"
            class="prompt-textarea prompt-textarea-lg"
            rows="8"
          ></textarea>
        </div>

        <div class="form-group">
          <label>Skill 使用说明</label>
          <textarea
            v-model="prompt.config.skillPolicyIntro"
            class="prompt-textarea"
            rows="3"
          ></textarea>
        </div>

        <div class="form-group">
          <label>特别规则（每行一条）</label>
          <textarea
            v-model="specialRulesText"
            class="prompt-textarea prompt-textarea-lg"
            rows="8"
          ></textarea>
        </div>

        <div class="form-group">
          <label>回复规则（每行一条）</label>
          <textarea
            v-model="responseRulesText"
            class="prompt-textarea"
            rows="6"
          ></textarea>
        </div>
      </section>

      <section class="prompt-preview-panel">
        <div class="preview-meta">
          <span class="preview-badge">Mode: {{ release.mode || 'general' }}</span>
          <span class="preview-badge">Env: {{ release.environment || 'production' }}</span>
          <span class="preview-badge">Skills: {{ (release.primedSkillNames || []).join(', ') || 'none' }}</span>
        </div>
        <pre data-testid="prompt-preview" class="prompt-preview">{{ previewPrompt }}</pre>
      </section>
    </div>
  </div>
</template>

<style scoped>
.prompt-studio {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.prompt-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.prompt-header h4 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--text-primary);
}

.prompt-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.prompt-actions {
  display: flex;
  gap: 8px;
}

.prompt-btn {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  cursor: pointer;
}

.prompt-btn.primary {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.prompt-btn.ghost {
  background: var(--glass-bg);
  color: var(--text-secondary);
}

.prompt-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.prompt-editor,
.prompt-preview-panel {
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--glass-bg);
  padding: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  font-size: 12px;
  color: var(--text-secondary);
}

.prompt-textarea {
  width: 100%;
  min-height: 88px;
  resize: vertical;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 10px 12px;
  font: inherit;
}

.prompt-textarea-lg {
  min-height: 160px;
}

.preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--accent-primary-bg);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 600;
}

.prompt-preview {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
}
</style>
