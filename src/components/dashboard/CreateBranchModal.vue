<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const props = defineProps({
  visible: Boolean,
  issue: Object // { key: 'CRMCN-1002', summary: '...', type: 'Bug' }
})

const emit = defineEmits(['close', 'success'])

// Broker 和项目路径映射 - 从 localStorage 获取或使用默认值
const DEFAULT_PROJECT_BASE_PATH = '/Users/leacentsong/Documents/LifeByteCodes'

const DEFAULT_BROKER_PROJECT_MAP = {
  'tmgm': `${DEFAULT_PROJECT_BASE_PATH}/TMGM-CRM-Member-Frontend`,
  'oqtima': `${DEFAULT_PROJECT_BASE_PATH}/OQTIMA-CRM-Member-Frontend`,
  'anzo': `${DEFAULT_PROJECT_BASE_PATH}/ANZO-CRM-Member-Frontend`,
  'dls': `${DEFAULT_PROJECT_BASE_PATH}/DLS-CRM-Member-Frontend`,
  'ttg': `${DEFAULT_PROJECT_BASE_PATH}/TTG-CRM-Member-Frontend`,
  'admin': `${DEFAULT_PROJECT_BASE_PATH}/TMGM-CRM-Staff-Front-End`
}

// 从 localStorage 获取用户自定义的项目路径配置
const getStoredBrokerPaths = () => {
  try {
    const stored = localStorage.getItem('broker_project_paths')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

const BROKER_PROJECT_MAP = ref(getStoredBrokerPaths() || DEFAULT_BROKER_PROJECT_MAP)

const BROKERS = computed(() => Object.keys(BROKER_PROJECT_MAP.value))

// 状态
const selectedBroker = ref(BROKERS[0])
const selectedBase = ref('latest')
const branches = ref([])
const loading = ref(false)
const loadingBranches = ref(false)
const error = ref('')
const step = ref(1) // 1: 选择, 2: 执行中, 3: 完成
const logs = ref([])

// 分支搜索
const branchSearchQuery = ref('')
const showBranchDropdown = ref(false)

// 工作区状态（安全检查）
const workingTreeStatus = ref(null)
const checkingWorkingTree = ref(false)
const branchExists = ref(false)

// GitHub Token (从 localStorage 读取，监听全局更新)
const githubToken = ref(localStorage.getItem('github_token') || '')

// 打开全局设置
const openGlobalSettings = () => {
  window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'github' } }))
}

// 监听 GitHub Token 更新
const handleGithubTokenUpdated = (event) => {
  githubToken.value = event.detail || ''
}

// 计算属性
const projectPath = computed(() => BROKER_PROJECT_MAP.value[selectedBroker.value])

const newBranchName = computed(() => {
  if (!props.issue?.key) return ''
  return `feat/${props.issue.key}`
})

const baseBranches = computed(() => {
  return branches.value
    .filter(b => !b.includes('feat/') && !b.includes('fix/') && !b.includes('bugfix/'))
    .map(b => b.replace('remotes/origin/', '').replace('origin/', ''))
    .filter((v, i, a) => a.indexOf(v) === i) // 去重
    .sort((a, b) => {
      // 优先级排序: latest > develop > main > 其他
      const priority = { 'latest': 0, 'develop': 1, 'main': 2, 'master': 3 }
      const pa = priority[a] ?? 99
      const pb = priority[b] ?? 99
      return pa - pb
    })
})

// 过滤后的分支列表（用于搜索）
const filteredBranches = computed(() => {
  if (!branchSearchQuery.value) return baseBranches.value
  const query = branchSearchQuery.value.toLowerCase()
  return baseBranches.value.filter(b => b.toLowerCase().includes(query))
})

// 选择分支
const selectBranch = (branch) => {
  selectedBase.value = branch
  branchSearchQuery.value = ''
  showBranchDropdown.value = false
}

// 加载分支列表
const loadBranches = async () => {
  if (!projectPath.value) return
  
  loadingBranches.value = true
  error.value = ''
  
  try {
    const result = await invoke('git_list_branches', {
      projectPath: projectPath.value
    })
    branches.value = result
    
    // 默认选择 latest > develop > main
    const cleanBranches = result.map(b => b.replace('remotes/origin/', '').replace('origin/', ''))
    if (cleanBranches.includes('latest') || cleanBranches.some(b => b === 'latest')) {
      selectedBase.value = 'latest'
    } else if (cleanBranches.includes('develop') || cleanBranches.some(b => b === 'develop')) {
      selectedBase.value = 'develop'
    } else if (cleanBranches.includes('main') || cleanBranches.some(b => b === 'main')) {
      selectedBase.value = 'main'
    } else if (cleanBranches.length > 0) {
      selectedBase.value = cleanBranches[0]
    }
  } catch (e) {
    error.value = `获取分支失败: ${e}`
  } finally {
    loadingBranches.value = false
  }
}

// 检查工作区状态（安全检查）
const checkWorkingTree = async () => {
  if (!projectPath.value) return
  
  checkingWorkingTree.value = true
  workingTreeStatus.value = null
  
  try {
    const status = await invoke('git_check_working_tree', {
      projectPath: projectPath.value
    })
    workingTreeStatus.value = status
  } catch (e) {
    console.error('检查工作区状态失败:', e)
    workingTreeStatus.value = { clean: true, error: e.toString() }
  } finally {
    checkingWorkingTree.value = false
  }
}

// 检查分支是否已存在
const checkBranchExists = async () => {
  if (!projectPath.value || !newBranchName.value) {
    branchExists.value = false
    return
  }
  
  try {
    branchExists.value = await invoke('git_branch_exists', {
      projectPath: projectPath.value,
      branchName: newBranchName.value
    })
  } catch (e) {
    console.error('检查分支是否存在失败:', e)
    branchExists.value = false
  }
}

// 是否可以安全创建分支
// GitHub Token 是否已配置
const isGithubConfigured = computed(() => !!githubToken.value)

const canCreateBranch = computed(() => {
  // 正在检查中
  if (checkingWorkingTree.value || loadingBranches.value) return false
  // 有错误
  if (error.value) return false
  // 没有选择分支
  if (!selectedBase.value) return false
  // GitHub Token 未配置
  if (!isGithubConfigured.value) return false
  // 工作区有未提交的更改（不包括未跟踪文件）
  if (workingTreeStatus.value && !workingTreeStatus.value.clean) {
    const hasTrackedChanges = 
      (workingTreeStatus.value.stagedFiles?.length > 0) || 
      (workingTreeStatus.value.unstagedFiles?.length > 0)
    if (hasTrackedChanges) return false
  }
  // 分支已存在
  if (branchExists.value) return false
  
  return true
})

// 获取安全警告信息
const safetyWarnings = computed(() => {
  const warnings = []
  
  if (workingTreeStatus.value && !workingTreeStatus.value.clean) {
    if (workingTreeStatus.value.stagedFiles?.length > 0) {
      warnings.push({
        type: 'error',
        icon: '🚫',
        title: '有已暂存的更改',
        message: `${workingTreeStatus.value.stagedFiles.length} 个文件已暂存`,
        files: workingTreeStatus.value.stagedFiles.slice(0, 3),
        suggestion: '请先 commit 或 unstage 这些更改'
      })
    }
    if (workingTreeStatus.value.unstagedFiles?.length > 0) {
      warnings.push({
        type: 'error',
        icon: '⚠️',
        title: '有未暂存的修改',
        message: `${workingTreeStatus.value.unstagedFiles.length} 个文件被修改`,
        files: workingTreeStatus.value.unstagedFiles.slice(0, 3),
        suggestion: '请先 commit、stash 或放弃这些更改'
      })
    }
    if (workingTreeStatus.value.untrackedFiles?.length > 0) {
      warnings.push({
        type: 'warning',
        icon: '📄',
        title: '有未跟踪的文件',
        message: `${workingTreeStatus.value.untrackedFiles.length} 个新文件`,
        files: workingTreeStatus.value.untrackedFiles.slice(0, 3),
        suggestion: '这些文件不会影响分支创建'
      })
    }
    if (workingTreeStatus.value.hasUnpushedCommits) {
      warnings.push({
        type: 'info',
        icon: '📤',
        title: '有未推送的提交',
        message: '当前分支有未推送到远程的提交',
        suggestion: '建议先 push 当前分支'
      })
    }
  }
  
  if (branchExists.value) {
    warnings.push({
      type: 'error',
      icon: '🔀',
      title: '分支已存在',
      message: `分支 ${newBranchName.value} 已经存在`,
      suggestion: '请直接切换到该分支，或使用其他 Jira 任务'
    })
  }
  
  return warnings
})

// 添加日志
const addLog = (message, type = 'info') => {
  logs.value.push({ message, type, time: new Date().toLocaleTimeString() })
}

// 执行创建分支流程
const executeCreateBranch = async () => {
  step.value = 2
  loading.value = true
  error.value = ''
  logs.value = []
  
  try {
    // 1. 创建分支
    addLog(`正在创建分支: ${newBranchName.value}`)
    addLog(`基于分支: ${selectedBase.value}`)
    addLog(`项目路径: ${projectPath.value}`)
    
    const createResult = await invoke('git_create_branch', {
      projectPath: projectPath.value,
      baseBranch: selectedBase.value,
      newBranch: newBranchName.value
    })
    addLog(`✅ ${createResult}`, 'success')
    
    // 2. 推送分支
    addLog('正在推送分支到远程...')
    const pushResult = await invoke('git_push_branch', {
      projectPath: projectPath.value,
      branch: newBranchName.value
    })
    addLog(`✅ ${pushResult}`, 'success')
    
    // 3. 创建 Draft PR (如果有 GitHub Token)
    if (githubToken.value) {
      addLog('正在创建 Draft PR...')
      
      // 获取仓库信息
      const repoInfo = await invoke('git_get_remote_info', {
        projectPath: projectPath.value
      })
      
      const normalizedRepoInfo = (repoInfo || '').trim().replace(/\.git$/i, '')
      const parts = normalizedRepoInfo.split('/').filter(Boolean)
      const owner = parts[0]
      const repo = parts[1]

      if (!owner || !repo) {
        addLog(`⚠️ 无法解析 GitHub 仓库信息: ${repoInfo}`, 'warning')
      } else {
        const prResult = await invoke('github_create_draft_pr', {
          owner,
          repo,
          title: `[${props.issue.key}] ${props.issue.summary}`,
          head: newBranchName.value,
          base: selectedBase.value,
          body: `## Jira Issue\n\n[${props.issue.key}](https://thebidgroup.atlassian.net/browse/${props.issue.key})\n\n## Description\n\n${props.issue.summary}`,
          token: githubToken.value
        })
        
        if (prResult.status === 201 || prResult.status === 200) {
          const prData = JSON.parse(prResult.body)
          addLog(`✅ Draft PR 创建成功: #${prData.number}`, 'success')
          addLog(`🔗 ${prData.html_url}`, 'info')
        } else {
          // 解析错误详情
          let errorDetail = ''
          try {
            const errBody = JSON.parse(prResult.body)
            if (errBody.message) {
              errorDetail = errBody.message
            }
            if (errBody.errors && errBody.errors.length > 0) {
              errorDetail += ': ' + errBody.errors.map(e => e.message || JSON.stringify(e)).join(', ')
            }
          } catch {
            errorDetail = prResult.body
          }
          
          if (prResult.status === 422) {
            // 422 通常是因为 PR 已存在或验证失败
            addLog(`⚠️ PR 创建失败: ${errorDetail || '可能已存在相同的 PR'}`, 'warning')
          } else {
            addLog(`⚠️ PR 创建失败: HTTP ${prResult.status} - ${errorDetail}`, 'warning')
          }
        }
      }
    } else {
      addLog('⚠️ 未配置 GitHub Token，跳过 PR 创建', 'warning')
    }
    
    step.value = 3
    addLog('🎉 分支创建完成！', 'success')
    
    emit('success', {
      branch: newBranchName.value,
      broker: selectedBroker.value
    })
    
  } catch (e) {
    error.value = e.toString()
    addLog(`❌ 错误: ${e}`, 'error')
    step.value = 1
  } finally {
    loading.value = false
  }
}

// 关闭弹窗
const handleClose = () => {
  if (!loading.value) {
    step.value = 1
    logs.value = []
    error.value = ''
    showBranchDropdown.value = false
    branchSearchQuery.value = ''
    emit('close')
  }
}

// 点击外部关闭下拉框
const handleClickOutside = (event) => {
  if (!event.target.closest('.branch-search-container')) {
    showBranchDropdown.value = false
    branchSearchQuery.value = ''
  }
}

// 监听 Broker 变化 (使用 async 确保操作顺序)
watch(selectedBroker, async () => {
  // 立即重置状态，防止显示旧数据
  showBranchDropdown.value = false
  branchSearchQuery.value = ''
  workingTreeStatus.value = null
  branchExists.value = false
  error.value = ''
  
  // 按顺序执行异步操作
  await loadBranches()
  await checkWorkingTree()
  await checkBranchExists()
})

// 监听弹窗显示 (使用 async 确保操作顺序)
watch(() => props.visible, async (visible) => {
  if (visible) {
    // 重置所有状态
    step.value = 1
    logs.value = []
    error.value = ''
    showBranchDropdown.value = false
    branchSearchQuery.value = ''
    workingTreeStatus.value = null
    branchExists.value = false
    
    // 按顺序执行异步操作
    await loadBranches()
    await checkWorkingTree()
    await checkBranchExists()
    
    document.addEventListener('click', handleClickOutside)
  } else {
    document.removeEventListener('click', handleClickOutside)
  }
})

// 监听 issue 变化（检查分支是否存在）
watch(() => props.issue?.key, () => {
  checkBranchExists()
})

// 监听全局配置更新
const handleBrokerPathsUpdated = (event) => {
  BROKER_PROJECT_MAP.value = event.detail
  // 重新加载分支列表
  if (props.visible) {
    loadBranches()
    checkWorkingTree()
  }
}

onMounted(() => {
  if (props.visible) {
    loadBranches()
    checkWorkingTree()
    checkBranchExists()
  }
  // 监听全局配置更新事件
  window.addEventListener('broker-paths-updated', handleBrokerPathsUpdated)
  window.addEventListener('github-token-updated', handleGithubTokenUpdated)
})

onUnmounted(() => {
  window.removeEventListener('broker-paths-updated', handleBrokerPathsUpdated)
  window.removeEventListener('github-token-updated', handleGithubTokenUpdated)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <!-- Header -->
          <div class="modal-header">
            <h3>🔀 创建 Bug Fix 分支</h3>
            <button class="close-btn" @click="handleClose" :disabled="loading">✕</button>
          </div>
          
          <!-- Issue Info -->
          <div class="issue-info">
            <span class="issue-key">{{ issue?.key }}</span>
            <span class="issue-summary">{{ issue?.summary }}</span>
          </div>
          
          <!-- Step 1: 配置 -->
          <div v-if="step === 1" class="modal-content">
            <div class="form-section">
              <label>选择 Broker</label>
              <div class="broker-selector">
                <button
                  v-for="broker in BROKERS"
                  :key="broker"
                  class="broker-btn"
                  :class="{ active: selectedBroker === broker }"
                  @click="selectedBroker = broker"
                >
                  {{ broker.toUpperCase() }}
                </button>
              </div>
            </div>
            
            <div class="form-section">
              <label>Base 分支</label>
              <div v-if="loadingBranches" class="loading-inline">
                <span class="spinner-small"></span>
                <span>加载分支...</span>
              </div>
              <div v-else class="branch-search-container">
                <div class="branch-input-wrapper">
                  <input
                    type="text"
                    class="branch-search-input"
                    :value="showBranchDropdown ? branchSearchQuery : selectedBase"
                    @input="branchSearchQuery = $event.target.value"
                    @focus="showBranchDropdown = true"
                    placeholder="搜索或选择分支..."
                  />
                  <span class="branch-dropdown-icon" @click="showBranchDropdown = !showBranchDropdown">
                    {{ showBranchDropdown ? '▲' : '▼' }}
                  </span>
                </div>
                <div v-if="showBranchDropdown" class="branch-dropdown">
                  <div
                    v-for="branch in filteredBranches"
                    :key="branch"
                    class="branch-option"
                    :class="{ active: selectedBase === branch }"
                    @click="selectBranch(branch)"
                  >
                    <span class="branch-name">{{ branch }}</span>
                    <span v-if="branch === 'latest'" class="branch-tag recommended">推荐</span>
                    <span v-if="selectedBase === branch" class="branch-check">✓</span>
                  </div>
                  <div v-if="filteredBranches.length === 0" class="branch-empty">
                    未找到匹配的分支
                  </div>
                </div>
              </div>
            </div>
            
            <div class="form-section">
              <label>新分支名称</label>
              <div class="branch-preview" :class="{ 'branch-exists': branchExists }">
                <span class="branch-icon">🌿</span>
                <code>{{ newBranchName }}</code>
                <span v-if="branchExists" class="branch-exists-tag">已存在</span>
              </div>
            </div>
            
            <!-- 安全检查状态 -->
            <div class="safety-check-section">
              <div class="safety-header">
                <span class="safety-icon">🛡️</span>
                <span class="safety-title">安全检查</span>
                <span v-if="checkingWorkingTree" class="checking-status">
                  <span class="spinner-small"></span>
                  检查中...
                </span>
                <span v-else-if="workingTreeStatus?.clean && !branchExists" class="safe-status">
                  ✅ 可以安全创建
                </span>
              </div>
              
              <!-- 当前分支信息 -->
              <div v-if="workingTreeStatus?.currentBranch" class="current-branch-info">
                <span class="info-label">当前分支:</span>
                <code>{{ workingTreeStatus.currentBranch }}</code>
              </div>
              
              <!-- 安全警告列表 -->
              <div v-if="safetyWarnings.length > 0" class="safety-warnings">
                <div 
                  v-for="(warning, index) in safetyWarnings" 
                  :key="index" 
                  class="warning-item"
                  :class="warning.type"
                >
                  <span class="warning-icon">{{ warning.icon }}</span>
                  <div class="warning-content">
                    <div class="warning-title">{{ warning.title }}</div>
                    <div class="warning-message">{{ warning.message }}</div>
                    <div v-if="warning.files?.length" class="warning-files">
                      <code v-for="file in warning.files" :key="file">{{ file }}</code>
                      <span v-if="warning.files.length < (workingTreeStatus?.[warning.type === 'error' ? 'stagedFiles' : 'untrackedFiles']?.length || 0)">...</span>
                    </div>
                    <div class="warning-suggestion">💡 {{ warning.suggestion }}</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="form-section github-section">
              <label>GitHub Token <span class="required">*必填</span></label>
              <p class="section-hint">用于自动创建 Draft PR，请在全局设置中配置</p>
              
              <div class="github-status" :class="{ configured: isGithubConfigured }">
                <div v-if="isGithubConfigured" class="status-configured">
                  <span class="status-icon">✅</span>
                  <span class="status-text">Token 已配置</span>
                  <button class="edit-btn" @click="openGlobalSettings">修改</button>
                </div>
                <div v-else class="status-not-configured">
                  <span class="status-icon">⚠️</span>
                  <span class="status-text">未配置 Token</span>
                  <button class="config-btn" @click="openGlobalSettings">去设置</button>
                </div>
              </div>
            </div>
            
            <div v-if="error" class="error-message">{{ error }}</div>
          </div>
          
          <!-- Step 2 & 3: 执行日志 -->
          <div v-else class="modal-content logs-content">
            <div class="logs-container">
              <div
                v-for="(log, index) in logs"
                :key="index"
                class="log-item"
                :class="log.type"
              >
                <span class="log-time">{{ log.time }}</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
              <div v-if="loading" class="log-item loading">
                <span class="spinner-small"></span>
                <span>执行中...</span>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="modal-footer">
            <template v-if="step === 1">
              <button class="btn-secondary" @click="handleClose">取消</button>
              <button
                class="btn-primary"
                @click="executeCreateBranch"
                :disabled="!canCreateBranch || loading"
              >
                {{ !canCreateBranch ? '无法创建' : '创建分支' }}
              </button>
            </template>
            <template v-else-if="step === 3">
              <button class="btn-primary" @click="handleClose">完成</button>
            </template>
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
  background: var(--overlay-bg);
  backdrop-filter: var(--overlay-blur);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-container {
  width: 90%;
  max-width: 480px;
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-header h3 {
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

.close-btn:hover:not(:disabled) {
  color: var(--text-primary);
}

.close-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.issue-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: var(--error-bg);
  border-bottom: 1px solid var(--glass-border);
}

.issue-key {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 6px;
  flex-shrink: 0;
}

.issue-summary {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modal-content {
  padding: 20px;
  background: var(--bg-secondary);
}

.form-section {
  margin-bottom: 20px;
}

.form-section label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.broker-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.broker-btn {
  flex: 0 0 auto;
  min-width: 70px;
  max-width: 90px;
  padding: 10px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
}

.broker-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.broker-btn.active {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success);
}

.branch-select {
  width: 100%;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  outline: none;
  cursor: pointer;
}

.branch-select:focus {
  border-color: var(--success);
  box-shadow: 0 0 0 2px var(--success-glow);
}

.branch-select option {
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Branch Search Styles */
.branch-search-container {
  position: relative;
}

.branch-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.branch-search-input {
  width: 100%;
  padding: 12px 36px 12px 14px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  outline: none;
}

.branch-search-input:focus {
  border-color: var(--success);
  box-shadow: 0 0 0 2px var(--success-glow);
}

.branch-dropdown-icon {
  position: absolute;
  right: 12px;
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}

.branch-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--glass-border-strong);
  border-radius: var(--radius-md);
  margin-top: 4px;
  z-index: 100;
  box-shadow: var(--shadow-glass);
}

.branch-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.branch-option:hover {
  background: var(--glass-bg-hover);
}

.branch-option.active {
  background: var(--success-bg);
}

.branch-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.branch-tag {
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
}

.branch-tag.recommended {
  background: var(--success-bg);
  color: var(--success);
  border: 1px solid var(--success-border);
}

.branch-check {
  color: var(--success);
  font-weight: 600;
}

.branch-empty {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}

.branch-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-md);
}

.branch-icon {
  font-size: 16px;
}

.branch-preview code {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--success);
}

.branch-preview.branch-exists {
  background: var(--error-bg);
  border-color: var(--error-border);
}

.branch-preview.branch-exists code {
  color: var(--error);
}

.branch-exists-tag {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 4px;
}

/* Safety Check Section */
.safety-check-section {
  margin-bottom: 20px;
  padding: 10px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.safety-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.safety-icon {
  font-size: 16px;
}

.safety-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.checking-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
}

.safe-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--success);
}

.current-branch-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: var(--glass-bg-hover);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.current-branch-info .info-label {
  color: var(--text-tertiary);
}

.current-branch-info code {
  font-family: var(--font-mono);
  color: var(--accent-primary);
}

.safety-warnings {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.warning-item {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

.warning-item.error {
  background: var(--error-bg);
  border-color: var(--error-border);
}

.warning-item.warning {
  background: var(--warning-bg);
  border-color: var(--warning-border);
}

.warning-item.info {
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary-border);
}

.warning-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.warning-content {
  flex: 1;
  min-width: 0;
}

.warning-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.warning-item.error .warning-title {
  color: var(--error);
}

.warning-item.warning .warning-title {
  color: var(--warning);
}

.warning-message {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.warning-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.warning-files code {
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border-radius: 4px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warning-suggestion {
  font-size: 10px;
  color: var(--text-tertiary);
}

.loading-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--success);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.github-section label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  font-size: 10px;
  font-weight: 500;
  color: var(--error);
}

.github-status {
  padding: 12px;
  border-radius: var(--radius-md);
  margin-top: 8px;
}

.github-status.configured {
  background: var(--success-bg);
  border: 1px solid var(--success-border);
}

.github-status:not(.configured) {
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
}

.status-configured,
.status-not-configured {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  font-size: 16px;
}

.status-text {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
}

.edit-btn,
.config-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.edit-btn {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.edit-btn:hover {
  background: var(--glass-bg-hover);
}

.config-btn {
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
}

.config-btn:hover {
  background: var(--accent-primary-glow);
}

.section-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0 0 10px 0;
}

.error-message {
  padding: 12px 14px;
  font-size: 12px;
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-sm);
}

/* Logs */
.logs-content {
  height: 300px;
  background: var(--bg-secondary);
}

.logs-container {
  height: 100%;
  overflow-y: auto;
  padding: 4px;
}

.log-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  font-size: 12px;
  border-radius: 6px;
  margin-bottom: 4px;
}

.log-item.info {
  color: var(--text-secondary);
  background: var(--glass-bg);
}

.log-item.success {
  color: var(--success);
  background: var(--success-bg);
}

.log-item.warning {
  color: var(--warning);
  background: var(--warning-bg);
}

.log-item.error {
  color: var(--error);
  background: var(--error-bg);
}

.log-item.loading {
  color: var(--text-tertiary);
}

.log-time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.log-message {
  flex: 1;
  word-break: break-word;
}

/* Footer */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
  background: var(--bg-primary);
}

.btn-primary,
.btn-secondary {
  flex: 1;
  padding: 12px;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  color: var(--bg-primary);
  background: linear-gradient(135deg, var(--success) 0%, var(--success-dark) 100%);
  border: none;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.btn-secondary:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

/* Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(20px);
}
</style>
