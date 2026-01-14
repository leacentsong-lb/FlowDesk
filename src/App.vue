<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import DashboardView from './views/DashboardView.vue'
import DevPanelView from './views/DevPanelView.vue'
import FloatingDock from './components/dock/FloatingDock.vue'
import ThemeSwitcher from './components/ThemeSwitcher.vue'
import { initTheme } from './config'

// 当前视图
const currentView = ref('dashboard')

// 设置抽屉状态（全局）
const settingsOpen = ref(false)
const settingsTab = ref('projects') // projects | jira | github

// Spotlight 搜索状态
const spotlightOpen = ref(false)

// ============================================
// 项目路径设置
// ============================================
const DEFAULT_PROJECT_BASE_PATH = '/Users/leacentsong/Documents/LifeByteCodes'

const DEFAULT_BROKER_PATHS = {
  'tmgm': `${DEFAULT_PROJECT_BASE_PATH}/TMGM-CRM-Member-Frontend`,
  'oqtima': `${DEFAULT_PROJECT_BASE_PATH}/OQTIMA-CRM-Member-Frontend`,
  'anzo': `${DEFAULT_PROJECT_BASE_PATH}/ANZO-CRM-Member-Frontend`,
  'dls': `${DEFAULT_PROJECT_BASE_PATH}/DLS-CRM-Member-Frontend`,
  'ttg': `${DEFAULT_PROJECT_BASE_PATH}/TTG-CRM-Member-Frontend`,
  'admin': `${DEFAULT_PROJECT_BASE_PATH}/TMGM-CRM-Staff-Front-End`
}

// 从 localStorage 加载配置
const loadBrokerPaths = () => {
  try {
    const stored = localStorage.getItem('broker_project_paths')
    // 第一次启动：如果没有保存过，就写入默认值，确保其他模块能读到
    if (!stored) {
      localStorage.setItem('broker_project_paths', JSON.stringify(DEFAULT_BROKER_PATHS))
      return { ...DEFAULT_BROKER_PATHS }
    }

    const parsed = JSON.parse(stored)
    // 防御：如果解析结果为空对象，回退到默认值（避免 Git 模块误判未配置）
    if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) {
      localStorage.setItem('broker_project_paths', JSON.stringify(DEFAULT_BROKER_PATHS))
      return { ...DEFAULT_BROKER_PATHS }
    }

    return parsed
  } catch {
    localStorage.setItem('broker_project_paths', JSON.stringify(DEFAULT_BROKER_PATHS))
    return { ...DEFAULT_BROKER_PATHS }
  }
}

const brokerPaths = reactive(loadBrokerPaths())
const newBrokerName = ref('')
const newBrokerPath = ref('')

// 保存配置到 localStorage
const saveBrokerPaths = () => {
  localStorage.setItem('broker_project_paths', JSON.stringify(brokerPaths))
  // 触发自定义事件通知其他组件
  window.dispatchEvent(new CustomEvent('broker-paths-updated', { detail: brokerPaths }))
}

// 添加新的 broker
const addBroker = () => {
  if (!newBrokerName.value.trim() || !newBrokerPath.value.trim()) return
  const key = newBrokerName.value.toLowerCase().trim()
  brokerPaths[key] = newBrokerPath.value.trim()
  saveBrokerPaths()
  newBrokerName.value = ''
  newBrokerPath.value = ''
}

// 删除 broker
const removeBroker = (key) => {
  delete brokerPaths[key]
  saveBrokerPaths()
}

// 更新 broker 路径
const updateBrokerPath = (key, path) => {
  brokerPaths[key] = path
  saveBrokerPaths()
}

// 重置为默认配置
const resetBrokerPaths = () => {
  Object.keys(brokerPaths).forEach(key => delete brokerPaths[key])
  Object.assign(brokerPaths, DEFAULT_BROKER_PATHS)
  saveBrokerPaths()
}

// ============================================
// GitHub Token 设置
// ============================================
const githubToken = ref(localStorage.getItem('github_token') || '')
const githubTokenSaved = ref(!!localStorage.getItem('github_token'))

const saveGithubToken = () => {
  if (githubToken.value.trim()) {
    localStorage.setItem('github_token', githubToken.value.trim())
    githubTokenSaved.value = true
    window.dispatchEvent(new CustomEvent('github-token-updated', { detail: githubToken.value.trim() }))
  }
}

const clearGithubToken = () => {
  githubToken.value = ''
  localStorage.removeItem('github_token')
  githubTokenSaved.value = false
  window.dispatchEvent(new CustomEvent('github-token-updated', { detail: '' }))
}

// ============================================
// Jira 配置设置
// ============================================
const jiraConfig = reactive({
  domain: localStorage.getItem('jira_domain') || 'thebidgroup.atlassian.net',
  email: localStorage.getItem('jira_email') || '',
  apiToken: localStorage.getItem('jira_token') || '',
  project: localStorage.getItem('jira_project') || ''
})
const jiraTestStatus = ref('') // 'testing' | 'success' | 'error'
const jiraTestMessage = ref('')

const saveJiraConfig = () => {
  localStorage.setItem('jira_domain', jiraConfig.domain)
  localStorage.setItem('jira_email', jiraConfig.email)
  localStorage.setItem('jira_token', jiraConfig.apiToken)
  localStorage.setItem('jira_project', jiraConfig.project)
  window.dispatchEvent(new CustomEvent('jira-config-updated', { detail: { ...jiraConfig } }))
}

const testJiraConnection = async () => {
  if (!jiraConfig.domain || !jiraConfig.email || !jiraConfig.apiToken) {
    jiraTestStatus.value = 'error'
    jiraTestMessage.value = '请填写完整的配置信息'
    return
  }
  
  jiraTestStatus.value = 'testing'
  jiraTestMessage.value = ''
  
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('jira_get_my_issues', {
      domain: jiraConfig.domain,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
      project: ''
    })
    
    if (result.status === 200) {
      const data = JSON.parse(result.body)
      jiraTestStatus.value = 'success'
      jiraTestMessage.value = `连接成功！找到 ${data.total || 0} 个任务`
      saveJiraConfig()
    } else {
      jiraTestStatus.value = 'error'
      jiraTestMessage.value = `连接失败: HTTP ${result.status}`
    }
  } catch (e) {
    jiraTestStatus.value = 'error'
    jiraTestMessage.value = `连接失败: ${e}`
  }
}

// ============================================
// 导航和其他处理
// ============================================

// 导航处理
const handleNavigate = (viewId) => {
  currentView.value = viewId
}

// 设置处理
const handleOpenSettings = (tab = 'projects') => {
  settingsTab.value = tab
  settingsOpen.value = true
}

// 监听来自其他组件的打开设置事件
const handleOpenSettingsEvent = (event) => {
  const tab = event.detail?.tab || 'projects'
  handleOpenSettings(tab)
}

// Spotlight 搜索处理
const handleOpenSpotlight = () => {
  spotlightOpen.value = true
}

// 键盘快捷键
const handleKeydown = (event) => {
  // Cmd/Ctrl + K 打开 Spotlight
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault()
    spotlightOpen.value = !spotlightOpen.value
  }
  // Escape 关闭 Spotlight
  if (event.key === 'Escape') {
    spotlightOpen.value = false
    settingsOpen.value = false
  }
}

onMounted(() => {
  // 初始化主题
  initTheme()
  // 确保 broker paths 已持久化后，广播一次给其他模块（例如 Git Tab）
  try {
    const stored = localStorage.getItem('broker_project_paths')
    if (stored) {
      window.dispatchEvent(new CustomEvent('broker-paths-updated', { detail: JSON.parse(stored) }))
    }
  } catch {}
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
    <!-- 主题切换器 -->
    <ThemeSwitcher />
    
    <!-- 背景效果 -->
    <div class="background-effects">
      <div class="bg-gradient"></div>
      <div class="bg-glow bg-glow-1"></div>
      <div class="bg-glow bg-glow-2"></div>
    </div>
    
    <!-- 主内容 -->
    <div class="app-content">
      <!-- 视图切换 -->
      <Transition name="view" mode="out-in">
        <DashboardView v-if="currentView === 'dashboard'" key="dashboard" />
        <DevPanelView v-else-if="currentView === 'dev'" key="dev" />
      </Transition>
    </div>
    
    <!-- 浮动 Dock -->
    <FloatingDock
      :current-view="currentView"
      @navigate="handleNavigate"
      @open-settings="handleOpenSettings"
      @open-spotlight="handleOpenSpotlight"
    />
    
    <!-- Spotlight 搜索 (占位) -->
    <Transition name="fade">
      <div v-if="spotlightOpen" class="spotlight-overlay" @click.self="spotlightOpen = false">
        <div class="spotlight-modal">
          <div class="spotlight-input-wrapper">
            <span class="spotlight-search-icon">🔍</span>
            <input 
              type="text" 
              class="spotlight-input" 
              placeholder="搜索用户、任务、命令..."
              autofocus
            />
            <span class="spotlight-shortcut">ESC</span>
          </div>
          <div class="spotlight-hint">
            输入关键词进行全局搜索
          </div>
        </div>
      </div>
    </Transition>
    
    <!-- 全局设置抽屉 -->
    <Transition name="drawer">
      <div v-if="settingsOpen" class="settings-overlay" @click.self="settingsOpen = false">
        <aside class="global-settings-drawer">
          <div class="drawer-header">
            <h3>⚙️ 设置</h3>
            <button class="close-btn" @click="settingsOpen = false">✕</button>
          </div>
          
          <!-- 设置标签页 -->
          <div class="settings-tabs">
            <button 
              class="settings-tab" 
              :class="{ active: settingsTab === 'projects' }"
              @click="settingsTab = 'projects'"
            >
              📁 项目路径
            </button>
            <button 
              class="settings-tab" 
              :class="{ active: settingsTab === 'jira' }"
              @click="settingsTab = 'jira'"
            >
              🎫 Jira
            </button>
            <button 
              class="settings-tab" 
              :class="{ active: settingsTab === 'github' }"
              @click="settingsTab = 'github'"
            >
              🐙 GitHub
            </button>
          </div>
          
          <div class="drawer-content">
            <!-- 项目路径设置 -->
            <div v-if="settingsTab === 'projects'" class="settings-section">
              <div class="section-header">
                <h4>Broker 项目路径配置</h4>
                <button class="reset-btn" @click="resetBrokerPaths" title="重置为默认值">
                  🔄 重置
                </button>
              </div>
              <p class="section-desc">配置每个 Broker 对应的本地代码仓库路径</p>
              
              <!-- 现有配置列表 -->
              <div class="broker-list">
                <div v-for="(path, key) in brokerPaths" :key="key" class="broker-item">
                  <div class="broker-key">{{ key.toUpperCase() }}</div>
                  <input 
                    type="text" 
                    class="broker-path-input"
                    :value="path"
                    @change="updateBrokerPath(key, $event.target.value)"
                    placeholder="输入项目路径..."
                  />
                  <button class="remove-broker-btn" @click="removeBroker(key)" title="删除">
                    🗑️
                  </button>
                </div>
              </div>
              
              <!-- 添加新 Broker -->
              <div class="add-broker-section">
                <h5>添加新 Broker</h5>
                <div class="add-broker-form">
                  <input 
                    v-model="newBrokerName"
                    type="text" 
                    class="add-input"
                    placeholder="Broker 名称 (如: tmgm)"
                  />
                  <input 
                    v-model="newBrokerPath"
                    type="text" 
                    class="add-input path-input"
                    placeholder="项目路径 (如: /Users/xxx/TMGM-CRM-Member-Frontend)"
                  />
                  <button 
                    class="add-broker-btn" 
                    @click="addBroker"
                    :disabled="!newBrokerName.trim() || !newBrokerPath.trim()"
                  >
                    ➕ 添加
                  </button>
                </div>
              </div>
            </div>
            
            <!-- Jira 设置 -->
            <div v-if="settingsTab === 'jira'" class="settings-section">
              <h4>Jira 配置</h4>
              <p class="section-desc">配置 Jira Cloud API 连接信息</p>
              
              <div class="config-form">
                <div class="form-group">
                  <label>Jira 域名</label>
                  <input 
                    v-model="jiraConfig.domain"
                    type="text" 
                    class="config-input"
                    placeholder="例如: yourcompany.atlassian.net"
                  />
                </div>
                
                <div class="form-group">
                  <label>邮箱</label>
                  <input 
                    v-model="jiraConfig.email"
                    type="email" 
                    class="config-input"
                    placeholder="your.email@company.com"
                  />
                </div>
                
                <div class="form-group">
                  <label>
                    API Token
                    <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" class="help-link">获取 Token</a>
                  </label>
                  <input 
                    v-model="jiraConfig.apiToken"
                    type="password" 
                    class="config-input"
                    placeholder="ATATT3xFfGF0..."
                  />
                </div>
                
                <div class="form-group">
                  <label>项目 Key <span class="optional">(可选)</span></label>
                  <input 
                    v-model="jiraConfig.project"
                    type="text" 
                    class="config-input"
                    placeholder="例如: CRMCN (留空获取所有项目)"
                  />
                </div>
                
                <div class="form-actions">
                  <button 
                    class="test-btn" 
                    @click="testJiraConnection"
                    :disabled="jiraTestStatus === 'testing'"
                  >
                    <span v-if="jiraTestStatus === 'testing'" class="mini-spinner"></span>
                    {{ jiraTestStatus === 'testing' ? '测试中...' : '测试连接' }}
                  </button>
                  <button class="save-config-btn" @click="saveJiraConfig">
                    保存配置
                  </button>
                </div>
                
                <div v-if="jiraTestMessage" class="test-result" :class="jiraTestStatus">
                  {{ jiraTestMessage }}
                </div>
              </div>
            </div>
            
            <!-- GitHub 设置 -->
            <div v-if="settingsTab === 'github'" class="settings-section">
              <h4>GitHub Token</h4>
              <p class="section-desc">配置 GitHub Personal Access Token 用于自动创建 Draft PR</p>
              
              <div class="config-form">
                <div class="form-group">
                  <label>
                    Personal Access Token
                    <a href="https://github.com/settings/tokens/new" target="_blank" class="help-link">创建 Token</a>
                  </label>
                  <input 
                    v-model="githubToken"
                    type="password" 
                    class="config-input"
                    placeholder="ghp_xxxxxxxxxxxx"
                  />
                  <p class="input-hint">需要 repo 权限用于创建 Pull Request</p>
                </div>
                
                <div class="token-status" :class="{ configured: githubTokenSaved }">
                  <span v-if="githubTokenSaved" class="status-indicator success">
                    ✅ Token 已配置
                  </span>
                  <span v-else class="status-indicator warning">
                    ⚠️ 未配置 Token
                  </span>
                </div>
                
                <div class="form-actions">
                  <button 
                    class="save-config-btn" 
                    @click="saveGithubToken"
                    :disabled="!githubToken.trim()"
                  >
                    保存 Token
                  </button>
                  <button 
                    v-if="githubTokenSaved"
                    class="clear-btn" 
                    @click="clearGithubToken"
                  >
                    清除 Token
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
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

/* 视图切换动画 */
.view-enter-active,
.view-leave-active {
  transition: all 0.3s ease;
}

.view-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.view-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

/* Spotlight 搜索 */
.spotlight-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  z-index: 2000;
}

.spotlight-modal {
  width: 560px;
  background: rgba(20, 25, 40, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 
    0 24px 48px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  overflow: hidden;
}

.spotlight-input-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.spotlight-search-icon {
  font-size: 20px;
  opacity: 0.6;
}

.spotlight-input {
  flex: 1;
  padding: 8px 0;
  font-size: 16px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.95);
  background: transparent;
  border: none;
  outline: none;
}

.spotlight-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.spotlight-shortcut {
  padding: 4px 8px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
}

.spotlight-hint {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

/* 全局设置抽屉 */
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

.global-settings-drawer .drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid var(--glass-border);
}

.global-settings-drawer .drawer-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.global-settings-drawer .close-btn {
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

.global-settings-drawer .close-btn:hover {
  color: var(--text-primary);
}

/* Settings Tabs */
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

.settings-tab:hover {
  color: var(--text-primary);
  background: var(--glass-bg-hover);
}

.settings-tab.active {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
}

.global-settings-drawer .drawer-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

/* Settings Section */
.settings-section h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 16px 0;
}

.hint-text {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 12px;
  background: var(--glass-bg);
  border-radius: var(--radius-sm);
}

.reset-btn {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  color: var(--accent-warm);
  border-color: var(--accent-warm);
  background: var(--warning-bg);
}

/* Broker List */
.broker-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.broker-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.broker-key {
  min-width: 60px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border-radius: 4px;
  text-align: center;
}

.broker-path-input {
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--glass-bg-hover);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
}

.broker-path-input:focus {
  border-color: var(--accent-primary);
}

.remove-broker-btn {
  padding: 4px 8px;
  font-size: 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.remove-broker-btn:hover {
  opacity: 1;
}

/* Add Broker Section */
.add-broker-section {
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
}

.add-broker-section h5 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 12px 0;
}

.add-broker-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-input {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
}

.add-input:focus {
  border-color: var(--accent-primary);
}

.add-input.path-input {
  font-family: var(--font-mono);
}

.add-broker-btn {
  padding: 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--success);
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.add-broker-btn:hover:not(:disabled) {
  background: var(--success-glow);
}

.add-broker-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Config Form Styles */
.config-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group .optional {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 400;
}

.help-link {
  font-size: 11px;
  color: var(--accent-primary);
  text-decoration: none;
  margin-left: auto;
}

.help-link:hover {
  text-decoration: underline;
}

.config-input {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.2s;
}

.config-input:focus {
  border-color: var(--accent-primary);
}

.config-input::placeholder {
  color: var(--text-tertiary);
}

.input-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.test-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid transparent;
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.save-config-btn {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--success);
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.save-config-btn:hover:not(:disabled) {
  background: var(--success-glow);
}

.save-config-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-btn {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: var(--error-glow);
}

.test-result {
  padding: 10px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
}

.test-result.success {
  color: var(--success);
  background: var(--success-bg);
  border: 1px solid var(--success-border);
}

.test-result.error {
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
}

.test-result.testing {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.token-status {
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.token-status.configured {
  background: var(--success-bg);
  border-color: var(--success-border);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.status-indicator.success {
  color: var(--success);
}

.status-indicator.warning {
  color: var(--warning);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.coming-soon-text {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
  padding: 40px 0;
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Drawer transition */
.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.3s ease;
}

.drawer-enter-from .global-settings-drawer,
.drawer-leave-to .global-settings-drawer {
  transform: translateX(100%);
}
</style>
