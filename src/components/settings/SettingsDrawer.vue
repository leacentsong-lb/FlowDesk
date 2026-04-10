<script setup>
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useJiraStore } from '../../stores/jira'
import { aiClient } from '../../ai/client.js'
import PromptStudioPanel from '../prompt/PromptStudioPanel.vue'

const props = defineProps({
  open: Boolean,
  tab: { type: String, default: 'projects' }
})
const emit = defineEmits(['close', 'update:tab'])

const settings = useSettingsStore()
const jira = useJiraStore()
const aiTestStatus = ref('')
const aiTestMessage = ref('')
const jiraProjectKeys = ref(['CRMCN'])

/**
 * @param {string} value
 * @returns {string[]}
 */
const toProjectKeyList = (value) => {
  const items = (value || '')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)

  return items.length > 0 ? items : ['CRMCN']
}

const syncProjectKeysFromConfig = () => {
  jiraProjectKeys.value = toProjectKeyList(jira.config.project)
}

const addProjectKeyField = () => {
  jiraProjectKeys.value.push('')
}

const removeProjectKeyField = (index) => {
  if (jiraProjectKeys.value.length === 1) {
    jiraProjectKeys.value = ['CRMCN']
    return
  }

  jiraProjectKeys.value.splice(index, 1)
}

const handleSelectWorkspace = async () => {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath: settings.workspacePath || undefined,
    title: '选择 AI 工作区'
  })

  if (typeof selected === 'string' && selected.trim()) {
    settings.setWorkspacePath(selected)
  }
}

const handleSaveJiraConfig = () => {
  jira.config.project = jiraProjectKeys.value.join('\n')
  jira.saveConfig()
  jira.fetchIssues()
}

const handleTestJiraConnection = async () => {
  await jira.testConnection()
}

const PROVIDER_DEFAULTS = {
  openai: { baseURL: '', model: 'gpt-5.2', placeholder: 'sk-...' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', placeholder: 'sk-...' }
}

const handleProviderChange = () => {
  const defaults = PROVIDER_DEFAULTS[settings.aiConfig.provider]
  if (defaults) {
    settings.aiConfig.baseURL = defaults.baseURL
    settings.aiConfig.model = defaults.model
    settings.aiConfig.apiKey = ''
  }
}

const handleSaveAiConfig = () => {
  settings.saveAiConfig()
}

const formatAiErrorBody = (body) => {
  if (!body) return ''

  try {
    const parsed = JSON.parse(body)
    return parsed?.error?.message || body
  } catch {
    return body
  }
}

const handleTestAiConnection = async () => {
  aiTestStatus.value = 'testing'
  aiTestMessage.value = ''
  settings.saveAiConfig()

  try {
    const result = await aiClient.testConnection({
      provider: settings.aiConfig.provider,
      apiKey: settings.aiConfig.apiKey,
      baseURL: settings.aiConfig.baseURL,
      model: settings.aiConfig.model,
      organization: settings.aiConfig.organization,
      project: settings.aiConfig.project
    })

    if (result.ok) {
      aiTestStatus.value = 'success'
      aiTestMessage.value = result.message || '连接成功'
    } else {
      aiTestStatus.value = 'error'
      aiTestMessage.value = result.message || '连接失败'
    }
  } catch (e) {
    aiTestStatus.value = 'error'
    aiTestMessage.value = `连接失败: ${e?.message || e}`
  }
}

watch(
  () => [props.open, props.tab, jira.config.project],
  ([open, tab]) => {
    if (open && tab === 'jira') {
      syncProjectKeysFromConfig()
    }
  },
  { immediate: true }
)
</script>

<template>
  <Transition name="drawer">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <aside class="global-settings-drawer">
        <div class="drawer-header">
          <h3>⚙️ 设置</h3>
          <button class="close-btn" @click="emit('close')">✕</button>
        </div>

        <div class="settings-tabs">
          <button
            class="settings-tab"
            :class="{ active: tab === 'projects' }"
            @click="emit('update:tab', 'projects')"
          >
            📁 工作区
          </button>
          <button
            class="settings-tab"
            :class="{ active: tab === 'jira' }"
            @click="emit('update:tab', 'jira')"
          >
            🎫 Jira
          </button>
          <button
            class="settings-tab"
            :class="{ active: tab === 'ai' }"
            @click="emit('update:tab', 'ai')"
          >
            🤖 AI
          </button>
          <button
            class="settings-tab"
            :class="{ active: tab === 'github' }"
            @click="emit('update:tab', 'github')"
          >
            🐙 GitHub
          </button>
          <button
            class="settings-tab"
            :class="{ active: tab === 'prompt' }"
            @click="emit('update:tab', 'prompt')"
          >
            🧠 提示词
          </button>
        </div>

        <div class="drawer-content">
          <div v-if="tab === 'projects'" class="settings-section">
            <div class="section-header">
              <h4>AI 工作区配置</h4>
              <button class="reset-btn" @click="settings.resetWorkspacePath" title="重置为默认值">🔄 重置</button>
            </div>
            <p class="section-desc">选择一个本地工作区目录，后续由 AI 基于这个目录自行判断项目与仓库。</p>

            <div class="workspace-card">
              <label class="workspace-label">当前工作区</label>
              <input
                data-testid="workspace-path-input"
                type="text"
                class="workspace-path-input"
                :value="settings.workspacePath"
                readonly
              />
              <div class="workspace-actions">
                <button
                  data-testid="select-workspace-btn"
                  class="select-workspace-btn"
                  @click="handleSelectWorkspace"
                >
                  选择本地工作区
                </button>
              </div>
              <p class="input-hint">建议选择包含多个代码仓库的上级目录，例如：LifeByteCodes。</p>
            </div>
          </div>

          <div v-if="tab === 'jira'" class="settings-section">
            <h4>Jira 配置</h4>
            <p class="section-desc">配置 Jira Cloud API 连接信息</p>

            <div class="config-form">
              <div class="form-group">
                <label>Jira 域名</label>
                <input v-model="jira.config.domain" type="text" class="config-input" placeholder="例如: yourcompany.atlassian.net" />
              </div>
              <div class="form-group">
                <label>邮箱</label>
                <input v-model="jira.config.email" type="email" class="config-input" placeholder="your.email@company.com" />
              </div>
              <div class="form-group">
                <label>
                  API Token
                  <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" class="help-link">获取 Token</a>
                </label>
                <input v-model="jira.config.apiToken" type="password" class="config-input" placeholder="ATATT3xFfGF0..." />
              </div>
              <div class="form-group">
                <label>项目 Key <span class="optional">(每行一个)</span></label>
                <div class="project-key-list">
                  <div
                    v-for="(projectKey, index) in jiraProjectKeys"
                    :key="`jira-project-${index}`"
                    class="project-key-row"
                  >
                    <input
                      data-testid="jira-project-input"
                      v-model="jiraProjectKeys[index]"
                      type="text"
                      class="config-input project-key-input"
                      :placeholder="index === 0 ? 'CRMCN' : '输入项目 Key'"
                    />
                    <button
                      v-if="jiraProjectKeys.length > 1"
                      :data-testid="`jira-project-remove-btn-${index}`"
                      type="button"
                      class="project-key-remove-btn"
                      @click="removeProjectKeyField(index)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div class="project-key-actions">
                  <button
                    data-testid="jira-project-add-btn"
                    type="button"
                    class="project-key-add-btn"
                    @click="addProjectKeyField"
                  >
                    + 新增项目 Key
                  </button>
                </div>
                <p class="input-hint">每个输入框对应一个项目 Key；默认第一项为 CRMCN。</p>
              </div>
              <div class="form-actions">
                <button
                  class="test-btn"
                  @click="handleTestJiraConnection"
                  :disabled="jira.testStatus === 'testing'"
                >
                  <span v-if="jira.testStatus === 'testing'" class="mini-spinner"></span>
                  {{ jira.testStatus === 'testing' ? '测试中...' : '测试连接' }}
                </button>
                <button class="save-config-btn" @click="handleSaveJiraConfig">保存配置</button>
              </div>
              <div v-if="jira.testMessage" class="test-result" :class="jira.testStatus">
                {{ jira.testMessage }}
              </div>
            </div>

            <div class="webhook-section">
              <h4>🚀 Teams 提测通知</h4>
              <p class="section-desc">配置 Power Automate Webhook 用于发送提测通知到 Teams</p>
              <div class="config-form">
                <div class="form-group">
                  <label>
                    Webhook URL
                    <a href="https://make.powerautomate.com/" target="_blank" class="help-link">创建 Webhook</a>
                  </label>
                  <input v-model="jira.config.teamsWebhook" type="text" class="config-input webhook-url-input" placeholder="https://xxx.webhook.office.com/webhookb2/..." />
                  <p class="input-hint">用于 Story 提测时自动通知 Teams 群组</p>
                </div>
                <div class="token-status" :class="{ configured: jira.config.teamsWebhook }">
                  <span v-if="jira.config.teamsWebhook" class="status-indicator success">✅ Webhook 已配置</span>
                  <span v-else class="status-indicator warning">⚠️ 未配置 Webhook（提测通知功能不可用）</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="tab === 'ai'" class="settings-section">
            <div class="section-header">
              <h4>AI Provider 配置</h4>
              <button class="reset-btn" @click="settings.resetAiConfig" title="重置为默认值">🔄 重置</button>
            </div>
            <p class="section-desc">按 AI SDK 常见 Provider 配置方式组织字段。默认使用 OpenAI，优先填写 API Key 与 Model；官方 OpenAI 场景下 Base URL 可留空。</p>

            <div class="config-form">
              <div class="form-group">
                <label>Provider</label>
                <select data-testid="ai-provider-select" v-model="settings.aiConfig.provider" class="config-input" @change="handleProviderChange">
                  <option value="openai">OpenAI</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>

              <div class="form-group">
                <label>API Key</label>
                <input
                  data-testid="ai-api-key-input"
                  v-model="settings.aiConfig.apiKey"
                  type="password"
                  class="config-input"
                  placeholder="sk-..."
                />
                <p class="input-hint">推荐使用 OpenAI API Key。若后续接入实际请求链路，优先走服务端或安全存储，不要暴露到公开前端。</p>
              </div>

              <div class="form-group">
                <label>Base URL <span class="optional">(可选)</span></label>
                <input
                  data-testid="ai-base-url-input"
                  v-model="settings.aiConfig.baseURL"
                  type="text"
                  class="config-input"
                  placeholder="留空则使用 OpenAI 官方默认地址"
                />
              </div>

              <div class="form-group">
                <label>Model</label>
                <select v-if="settings.aiConfig.provider === 'deepseek'" v-model="settings.aiConfig.model" class="config-input">
                  <option value="deepseek-chat">deepseek-chat</option>
                  <option value="deepseek-reasoner">deepseek-reasoner (思考模式)</option>
                </select>
                <input
                  v-else
                  data-testid="ai-model-input"
                  v-model="settings.aiConfig.model"
                  type="text"
                  class="config-input"
                  placeholder="例如: gpt-5.2, o4-mini"
                />
              </div>

              <div class="form-group">
                <label>Organization <span class="optional">(可选)</span></label>
                <input
                  data-testid="ai-organization-input"
                  v-model="settings.aiConfig.organization"
                  type="text"
                  class="config-input"
                  placeholder="org_..."
                />
              </div>

              <div class="form-group">
                <label>Project <span class="optional">(可选)</span></label>
                <input
                  data-testid="ai-project-input"
                  v-model="settings.aiConfig.project"
                  type="text"
                  class="config-input"
                  placeholder="proj_..."
                />
              </div>

              <div class="token-status" :class="{ configured: settings.aiConfigured }">
                <span v-if="settings.aiConfigured" class="status-indicator success">✅ AI Provider 已配置</span>
                <span v-else class="status-indicator warning">⚠️ 尚未配置 API Key</span>
              </div>

              <div class="form-actions">
                <button
                  data-testid="ai-test-btn"
                  class="test-btn"
                  @click="handleTestAiConnection"
                  :disabled="!settings.aiConfig.apiKey.trim() || !settings.aiConfig.model.trim() || aiTestStatus === 'testing'"
                >
                  <span v-if="aiTestStatus === 'testing'" class="mini-spinner"></span>
                  {{ aiTestStatus === 'testing' ? '测试中...' : '测试连接' }}
                </button>
                <button class="save-config-btn" @click="handleSaveAiConfig" :disabled="!settings.aiConfig.model.trim()">保存配置</button>
              </div>

              <div v-if="aiTestMessage" class="test-result" :class="aiTestStatus">
                {{ aiTestMessage }}
              </div>
            </div>
          </div>

          <div v-if="tab === 'github'" class="settings-section">
            <h4>GitHub Token</h4>
            <p class="section-desc">配置 GitHub Personal Access Token 用于自动创建 Draft PR</p>

            <div class="config-form">
              <div class="form-group">
                <label>
                  Personal Access Token
                  <a href="https://github.com/settings/tokens/new" target="_blank" class="help-link">创建 Token</a>
                </label>
                <input v-model="settings.githubToken" type="password" class="config-input" placeholder="ghp_xxxxxxxxxxxx" />
                <p class="input-hint">需要 repo 权限用于创建 Pull Request</p>
              </div>
              <div class="token-status" :class="{ configured: settings.githubTokenSaved }">
                <span v-if="settings.githubTokenSaved" class="status-indicator success">✅ Token 已配置</span>
                <span v-else class="status-indicator warning">⚠️ 未配置 Token</span>
              </div>
              <div class="form-actions">
                <button class="save-config-btn" @click="settings.saveGithubToken" :disabled="!settings.githubToken.trim()">保存 Token</button>
                <button v-if="settings.githubTokenSaved" class="clear-btn" @click="settings.clearGithubToken">清除 Token</button>
              </div>
            </div>
          </div>

          <div v-if="tab === 'prompt'" class="settings-section">
            <PromptStudioPanel />
          </div>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1500;
  display: flex;
  justify-content: flex-end;
}

.global-settings-drawer {
  width: 420px;
  height: 100%;
  background: var(--bg-primary);
  backdrop-filter: blur(20px);
  border-left: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid var(--glass-border);
}

.drawer-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  transition: color 0.2s;
}

.close-btn:hover { color: var(--text-primary); }

.settings-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  background: var(--glass-bg);
  border-bottom: 1px solid var(--glass-border);
}

.settings-tab {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.settings-tab:hover { color: var(--text-primary); background: var(--glass-bg-hover); }
.settings-tab.active { color: var(--accent-primary); background: var(--accent-primary-bg); }

.drawer-content { flex: 1; padding: 20px; overflow-y: auto; }

.settings-section h4 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0 0 8px 0; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-desc { font-size: 12px; color: var(--text-secondary); margin: 0 0 16px 0; }

.reset-btn { padding: 4px 10px; font-size: 11px; color: var(--text-tertiary); background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
.reset-btn:hover { color: var(--accent-warm); border-color: var(--accent-warm); background: var(--warning-bg); }

.workspace-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.workspace-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.workspace-path-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--glass-bg-hover);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
}

.workspace-actions {
  display: flex;
  gap: 10px;
}

.select-workspace-btn {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.select-workspace-btn:hover {
  filter: brightness(1.08);
}

.config-form { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
.form-group .optional { font-size: 10px; color: var(--text-tertiary); font-weight: 400; }
.help-link { font-size: 11px; color: var(--accent-primary); text-decoration: none; margin-left: auto; }
.help-link:hover { text-decoration: underline; }
.config-input { padding: 10px 12px; font-size: 13px; color: var(--text-primary); background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); outline: none; transition: border-color 0.2s; }
.config-input:focus { border-color: var(--accent-primary); }
.config-input::placeholder { color: var(--text-tertiary); }
.config-textarea { resize: vertical; min-height: 88px; font-family: var(--font-mono); line-height: 1.5; }
.input-hint { font-size: 11px; color: var(--text-tertiary); margin: 0; }
.project-key-list { display: flex; flex-direction: column; gap: 8px; }
.project-key-row { display: flex; align-items: center; gap: 8px; }
.project-key-input { flex: 1; font-family: var(--font-mono); }
.project-key-actions { display: flex; }
.project-key-add-btn,
.project-key-remove-btn {
  padding: 8px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}
.project-key-add-btn {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
}
.project-key-add-btn:hover { filter: brightness(1.08); }
.project-key-remove-btn {
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  white-space: nowrap;
}
.project-key-remove-btn:hover { background: var(--error-glow); }

.form-actions { display: flex; gap: 10px; margin-top: 8px; }
.test-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; font-size: 12px; font-weight: 500; color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
.test-btn:hover:not(:disabled) { background: var(--glass-bg-hover); color: var(--text-primary); }
.test-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.mini-spinner { width: 12px; height: 12px; border: 2px solid transparent; border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
.save-config-btn { padding: 10px 16px; font-size: 12px; font-weight: 500; color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
.save-config-btn:hover:not(:disabled) { background: var(--success-glow); }
.save-config-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.clear-btn { padding: 10px 16px; font-size: 12px; font-weight: 500; color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
.clear-btn:hover { background: var(--error-glow); }

.test-result { padding: 10px 12px; font-size: 12px; border-radius: var(--radius-sm); }
.test-result.success { color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); }
.test-result.error { color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); }
.test-result.testing { color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }

.token-status { padding: 12px; border-radius: var(--radius-sm); background: var(--glass-bg); border: 1px solid var(--glass-border); }
.token-status.configured { background: var(--success-bg); border-color: var(--success-border); }
.status-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.status-indicator.success { color: var(--success); }
.status-indicator.warning { color: var(--warning); }

.webhook-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--glass-border); }
.webhook-section h4 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0 0 8px 0; }
.webhook-url-input { font-family: var(--font-mono); font-size: 12px; }

@keyframes spin { to { transform: rotate(360deg); } }

.drawer-enter-active,
.drawer-leave-active { transition: all 0.3s ease; }
.drawer-enter-from .global-settings-drawer,
.drawer-leave-to .global-settings-drawer { transform: translateX(100%); }
</style>
