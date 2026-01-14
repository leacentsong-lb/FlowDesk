<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// Emit events to parent (Vue compiler macro, no import needed)
const emit = defineEmits(['showMessage', 'showLoading', 'hideLoading'])

// SVG Icons (Lucide-style)
const icons = {
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  globe: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  searchEmpty: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="m8 8 6 6"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  save: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  undo: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`
}

import {
  BROKERS,
  ENVIRONMENTS,
  ADMIN_CREDENTIALS,
  BROKER_NAME_MAP,
  PAGINATION,
  getAdminLoginApi,
  getAdminPortalUrl,
  getPinnedUserListApi,
  getUserListApi,
  getSearchUserApi,
  getSearchPinnedUserApi,
  getMemberTokenApi,
  getMemberUrl,
  getMemberOnlineUrl,
  getTokenCacheKey,
  getMemberProjectPath,
  getMemberConfigPath,
  getVueAppApi,
  getCustomApiConfig,
  saveCustomApiConfig,
  resetCustomApiConfig,
  getDefaultApiConfig
} from '../../config.js'

// 选中状态
const selectedBroker = ref(BROKERS[0])
const selectedEnv = ref(ENVIRONMENTS[0])

// 运行模式
const runMode = ref('local')

// 登录状态
const loggedInKey = ref('')

// UserID 列表
const userList = ref([])

// 分页状态
const pagination = ref({
  currentPage: 1,
  totalPages: 1,
  totalUsers: 0,
  perPage: PAGINATION.perPage
})

// 搜索相关
const searchKeyword = ref('')
const searchResults = ref([])
const isSearchMode = ref(false)

// 当前选中的用户
const selectedUserId = ref(null)

// 设置抽屉状态
const settingsDrawer = ref({
  open: false,
  config: { adminApi: '', memberPortal: '', staffPortal: '' },
  hasChanges: false
})

// 提示消息
const message = ref({ text: '', type: '' })

// 全局 loading 状态
const globalLoading = ref({ show: false, text: '' })

// 局部 loading 状态
const inlineLoading = ref({ search: false, list: false })

// 显示全局 loading
const showLoading = (text = '加载中...') => {
  globalLoading.value = { show: true, text }
}

// 隐藏全局 loading
const hideLoading = () => {
  globalLoading.value = { show: false, text: '' }
}

// 局部 loading
const setInlineLoading = (key, value) => {
  inlineLoading.value[key] = value
}

// Member 服务状态
const memberService = ref({
  running: false,
  broker: '',
  env: '',
  host: 'localhost',
  port: 5173
})

let portCheckInterval = null

// 计算当前选中组合的缓存 key
const currentCacheKey = computed(() => getTokenCacheKey(selectedBroker.value, selectedEnv.value))

// 检查当前组合是否已登录
const isCurrentLoggedIn = computed(() => {
  const data = localStorage.getItem(currentCacheKey.value)
  return !!data
})

// 获取缓存的 Token
const getCachedToken = () => {
  const data = localStorage.getItem(currentCacheKey.value)
  if (!data) return null
  try {
    const parsed = JSON.parse(data)
    return parsed.access_token || data
  } catch {
    return data
  }
}

// 获取缓存的完整 Admin 登录数据
const getCachedAdminData = () => {
  const data = localStorage.getItem(currentCacheKey.value)
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return { access_token: data }
  }
}

// 显示提示消息
const showMessage = (text, type = 'info') => {
  message.value = { text, type }
  setTimeout(() => {
    if (message.value.text === text) {
      message.value = { text: '', type: '' }
    }
  }, 5000)
}

// 检查 Member 服务端口状态
const checkMemberServiceStatus = async () => {
  try {
    const inUse = await invoke('check_port_in_use', { port: 5173 })
    memberService.value.running = inUse
    if (!inUse) {
      memberService.value.broker = ''
      memberService.value.env = ''
    }
  } catch (error) {
    // Silently ignore
  }
}

// 等待端口可用
const waitForPortReady = async (port, maxWaitMs = 30000, intervalMs = 1000) => {
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const inUse = await invoke('check_port_in_use', { port })
      if (inUse) return true
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

// 停止 Member 服务
const stopMemberService = async () => {
  try {
    await invoke('stop_service_by_port', { port: 5173 })
    memberService.value.running = false
    memberService.value.broker = ''
    memberService.value.env = ''
    return true
  } catch (error) {
    showMessage(`❌ 停止服务失败: ${error}`, 'error')
    return false
  }
}

// 停止 Admin 登录
const handleLogoutAdmin = () => {
  localStorage.removeItem(currentCacheKey.value)
  loggedInKey.value = ''
  userList.value = []
  showMessage('已退出 Admin 登录', 'success')
}

// 打开 Admin Portal
const openAdminPortal = async () => {
  const adminData = getCachedAdminData()
  if (!adminData || !adminData.access_token) {
    showMessage('请先登录 Admin', 'error')
    return
  }
  
  const baseUrl = getAdminPortalUrl(selectedBroker.value, selectedEnv.value)
  const params = new URLSearchParams()
  params.set('access_token', adminData.access_token)
  if (adminData.refresh_token) params.set('refresh_token', adminData.refresh_token)
  if (adminData.expires_in) params.set('expires_in', adminData.expires_in)
  if (adminData.login_time) params.set('admin_refresh_time', adminData.login_time)
  params.set('loginUser', adminData.login_user || ADMIN_CREDENTIALS.username)
  
  const adminUrl = `${baseUrl}/?${params.toString()}`
  
  try {
    await invoke('open_url_raw', { url: adminUrl })
    showMessage(`✅ 已打开 Admin: ${selectedBroker.value.toUpperCase()} ${selectedEnv.value}`, 'success')
  } catch (error) {
    showMessage(`❌ 打开失败: ${error}`, 'error')
  }
}

// 自动登录 Admin 并获取用户列表
const autoLoginAndFetchUsers = async () => {
  if (!selectedBroker.value || !selectedEnv.value) return

  if (runMode.value === 'local' && memberService.value.running && memberService.value.broker) {
    const newBrokerName = BROKER_NAME_MAP[selectedBroker.value] || selectedBroker.value.toUpperCase()
    if (memberService.value.broker !== newBrokerName) {
      const shouldStop = confirm(`当前正在运行 ${memberService.value.broker}-Member 服务，切换 Broker 需要先停止。是否继续？`)
      if (!shouldStop) return
      await stopMemberService()
    }
  }

  userList.value = []
  const cachedToken = getCachedToken()
  
  if (cachedToken) {
    loggedInKey.value = currentCacheKey.value
    await fetchUserList(true)
    return
  }

  showLoading('正在登录 Admin...')

  try {
    const loginUrl = getAdminLoginApi(selectedBroker.value, selectedEnv.value)
    const result = await invoke('http_admin_login', {
      url: loginUrl,
      username: ADMIN_CREDENTIALS.username,
      password: ADMIN_CREDENTIALS.password
    })

    if (result.status !== 200) throw new Error(`HTTP ${result.status}`)

    const data = JSON.parse(result.body)
    
    if (data.access_token) {
      const adminData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        login_time: Date.now(),
        login_user: ADMIN_CREDENTIALS.username
      }
      localStorage.setItem(currentCacheKey.value, JSON.stringify(adminData))
      loggedInKey.value = currentCacheKey.value
      showMessage(`✅ 已登录 Admin`, 'success')
      await fetchUserList(true)
    } else {
      throw new Error('未返回 access_token')
    }
  } catch (error) {
    showMessage(`❌ 登录失败 (${error.message})`, 'error')
  } finally {
    hideLoading()
  }
}

// 解析用户数据
const parseUserData = (data, isPinned = false) => {
  let users = []
  if (data.data && Array.isArray(data.data)) {
    users = data.data
  } else if (Array.isArray(data)) {
    users = data
  }
  
  return users.map(user => ({
    id: user.id || user.user_id,
    displayname: user.displayname || user.display_name || user.name || user.username || '',
    email: user.email || user.login_user || '',
    isPinned: isPinned
  }))
}

// 获取用户列表
const fetchUserList = async (useFullLoading = true) => {
  const token = getCachedToken()
  if (!token) {
    showMessage('请先登录对应环境的Admin系统', 'error')
    return
  }

  if (useFullLoading) {
    showLoading('正在获取用户列表...')
  } else {
    setInlineLoading('list', true)
  }

  try {
    const [pinnedResult, normalResult] = await Promise.all([
      invoke('http_get_user_list', {
        url: getPinnedUserListApi(selectedBroker.value, selectedEnv.value),
        token: token
      }),
      invoke('http_get_user_list', {
        url: getUserListApi(selectedBroker.value, selectedEnv.value, pagination.value.perPage),
        token: token
      })
    ])

    let pinnedUsers = []
    if (pinnedResult.status === 200) {
      const pinnedData = JSON.parse(pinnedResult.body)
      pinnedUsers = parseUserData(pinnedData, true)
    }

    let normalUsers = []
    if (normalResult.status === 200) {
      const normalData = JSON.parse(normalResult.body)
      normalUsers = parseUserData(normalData, false)
    }

    const pinnedIds = new Set(pinnedUsers.map(u => u.id))
    const filteredNormalUsers = normalUsers.filter(u => !pinnedIds.has(u.id))
    
    userList.value = [...pinnedUsers, ...filteredNormalUsers]
    pagination.value.totalUsers = userList.value.length
    
    if (userList.value.length > 0) {
      const pinnedCount = pinnedUsers.length
      const msg = pinnedCount > 0 
        ? `✅ 共 ${userList.value.length} 个用户（${pinnedCount} 个收藏）`
        : `✅ 共 ${userList.value.length} 个用户`
      showMessage(msg, 'success')
    } else {
      showMessage('用户列表为空', 'info')
    }
  } catch (error) {
    showMessage(`❌ 获取用户列表失败 (${error.message})`, 'error')
  } finally {
    if (useFullLoading) {
      hideLoading()
    } else {
      setInlineLoading('list', false)
    }
  }
}

// 完整的登录流程
const performFullLogin = async (userId) => {
  if (!selectedBroker.value || !selectedEnv.value) {
    showMessage('请先选择 Broker 和 环境', 'error')
    return
  }

  const token = getCachedToken()
  if (!token) {
    showMessage('请先登录对应环境的Admin系统', 'error')
    return
  }

  const currentBrokerName = BROKER_NAME_MAP[selectedBroker.value] || selectedBroker.value.toUpperCase()
  const currentEnv = selectedEnv.value
  const isLocalMode = runMode.value === 'local'

  showLoading('正在登录...')

  try {
    if (isLocalMode) {
      const isRunning = await invoke('check_port_in_use', { port: 5173 })
      const needServiceSetup = !isRunning || 
        memberService.value.broker !== currentBrokerName || 
        memberService.value.env !== currentEnv

      if (needServiceSetup) {
        if (isRunning) {
          showLoading('正在切换环境...')
          await stopMemberService()
        }

        showLoading('正在更新配置...')
        const configPath = getMemberConfigPath(selectedBroker.value)
        const apiUrl = getVueAppApi(selectedBroker.value, selectedEnv.value)
        
        await invoke('update_member_config', {
          configPath: configPath,
          apiUrl: apiUrl
        })

        showLoading('正在启动服务...')
        const projectPath = getMemberProjectPath(selectedBroker.value)
        await invoke('start_member_dev', { projectPath })

        showLoading('等待服务就绪...')
        const ready = await waitForPortReady(5173, 30000, 500)
        
        if (!ready) throw new Error('服务启动超时')

        memberService.value.running = true
        memberService.value.broker = currentBrokerName
        memberService.value.env = currentEnv
      }
    }

    showLoading('正在获取 Token...')
    const memberTokenApiUrl = getMemberTokenApi(selectedBroker.value, selectedEnv.value, userId)
    
    const result = await invoke('http_get_member_token', {
      url: memberTokenApiUrl,
      token: token
    })

    if (result.status !== 200) throw new Error(`HTTP ${result.status}`)

    const data = JSON.parse(result.body)
    if (!data.access_token) throw new Error('未返回 access_token')
    
    const tokenData = {
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token
    }
    
    const user = userList.value.find(u => u.id == userId)
    const loginUser = user?.email || data.loginUser || data.login_user || ''
    
    let memberUrl
    if (isLocalMode) {
      memberUrl = getMemberUrl(tokenData, loginUser)
    } else {
      if (!data.domain) throw new Error('API 未返回 domain')
      memberUrl = getMemberOnlineUrl(data.domain, tokenData, loginUser)
    }
    
    await invoke('open_url_raw', { url: memberUrl })
    
    const modeLabel = isLocalMode ? '本地' : '线上'
    showMessage(`✅ 已打开 ${modeLabel} Member - UserID:${userId}`, 'success')
    
  } catch (error) {
    showMessage(`❌ 登录失败 (${error.message})`, 'error')
  } finally {
    hideLoading()
  }
}

// 点击用户
const handleUserClick = async (userId) => {
  selectedUserId.value = userId
  await performFullLogin(userId)
}

// 搜索用户
const handleSearch = async () => {
  const keyword = searchKeyword.value.trim()
  if (!keyword) {
    showMessage('请输入搜索关键词', 'info')
    return
  }

  const token = getCachedToken()
  if (!token) {
    showMessage('请先登录 Admin 系统', 'error')
    return
  }

  setInlineLoading('search', true)

  try {
    const regularUrl = getSearchUserApi(selectedBroker.value, selectedEnv.value, keyword)
    const pinnedUrl = getSearchPinnedUserApi(selectedBroker.value, selectedEnv.value, keyword)
    
    const [regularResult, pinnedResult] = await Promise.all([
      invoke('http_get_user_list', { url: regularUrl, token }),
      invoke('http_get_user_list', { url: pinnedUrl, token })
    ])

    let allResults = []
    const seenIds = new Set()

    if (pinnedResult.status === 200) {
      const pinnedData = JSON.parse(pinnedResult.body)
      const pinnedUsers = parseUserData(pinnedData, true)
      pinnedUsers.forEach(user => {
        if (!seenIds.has(user.id)) {
          seenIds.add(user.id)
          allResults.push(user)
        }
      })
    }

    if (regularResult.status === 200) {
      const regularData = JSON.parse(regularResult.body)
      const regularUsers = parseUserData(regularData, false)
      regularUsers.forEach(user => {
        if (!seenIds.has(user.id)) {
          seenIds.add(user.id)
          allResults.push(user)
        }
      })
    }
    
    searchResults.value = allResults
    isSearchMode.value = true
    
    if (allResults.length > 0) {
      showMessage(`✅ 找到 ${allResults.length} 个用户`, 'success')
    } else {
      showMessage('未找到匹配的用户', 'info')
    }
  } catch (error) {
    showMessage(`❌ 搜索失败 (${error.message})`, 'error')
  } finally {
    setInlineLoading('search', false)
  }
}

// 重置搜索
const handleReset = async () => {
  searchKeyword.value = ''
  searchResults.value = []
  isSearchMode.value = false
  await fetchUserList(false)
}

// 清除搜索
const clearSearch = () => {
  searchKeyword.value = ''
  searchResults.value = []
  isSearchMode.value = false
}

// 设置相关
const openSettings = () => {
  const customConfig = getCustomApiConfig(selectedBroker.value, selectedEnv.value)
  const defaultConfig = getDefaultApiConfig(selectedBroker.value, selectedEnv.value)
  settingsDrawer.value.config = customConfig || defaultConfig
  settingsDrawer.value.hasChanges = false
  settingsDrawer.value.open = true
}

const closeSettings = () => {
  settingsDrawer.value.open = false
}

const saveSettings = () => {
  saveCustomApiConfig(selectedBroker.value, selectedEnv.value, settingsDrawer.value.config)
  settingsDrawer.value.hasChanges = false
  showMessage('✅ API 配置已保存', 'success')
}

const resetSettings = () => {
  const defaultConfig = getDefaultApiConfig(selectedBroker.value, selectedEnv.value)
  settingsDrawer.value.config = { ...defaultConfig }
  resetCustomApiConfig(selectedBroker.value, selectedEnv.value)
  settingsDrawer.value.hasChanges = false
  showMessage('✅ 已重置为默认配置', 'success')
}

const onConfigChange = () => {
  const defaultConfig = getDefaultApiConfig(selectedBroker.value, selectedEnv.value)
  const customConfig = getCustomApiConfig(selectedBroker.value, selectedEnv.value)
  const currentConfig = settingsDrawer.value.config
  const compareWith = customConfig || defaultConfig
  settingsDrawer.value.hasChanges = 
    currentConfig.adminApi !== compareWith.adminApi ||
    currentConfig.memberPortal !== compareWith.memberPortal ||
    currentConfig.staffPortal !== compareWith.staffPortal
}

// 监听切换
watch([selectedBroker, selectedEnv], async ([newBroker, newEnv], [oldBroker, oldEnv]) => {
  if (newBroker !== oldBroker || newEnv !== oldEnv) {
    selectedUserId.value = null
    await autoLoginAndFetchUsers()
  }
})

// 刷新
const handleRefresh = async () => {
  localStorage.removeItem(currentCacheKey.value)
  loggedInKey.value = ''
  selectedUserId.value = null
  await autoLoginAndFetchUsers()
}

// 波纹效果
const createRipple = (event) => {
  const button = event.currentTarget
  const rect = button.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height)
  const x = event.clientX - rect.left - size / 2
  const y = event.clientY - rect.top - size / 2
  
  const ripple = document.createElement('span')
  ripple.className = 'ripple'
  ripple.style.width = ripple.style.height = `${size}px`
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  
  button.appendChild(ripple)
  setTimeout(() => ripple.remove(), 600)
}

onMounted(async () => {
  await checkMemberServiceStatus()
  await autoLoginAndFetchUsers()
  portCheckInterval = setInterval(checkMemberServiceStatus, 5000)
})

onUnmounted(() => {
  if (portCheckInterval) clearInterval(portCheckInterval)
})
</script>

<template>
  <div class="member-module">
    <!-- Toast 消息 -->
    <Teleport to="body">
      <Transition name="slide">
        <div v-if="message.text" class="toast-container">
          <div class="toast" :class="message.type">{{ message.text }}</div>
        </div>
      </Transition>
    </Teleport>

    <!-- 全局 Loading -->
    <Transition name="fade">
      <div v-if="globalLoading.show" class="loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">{{ globalLoading.text }}</div>
        </div>
      </div>
    </Transition>

    <!-- 顶部状态栏 -->
    <header class="module-header">
      <div class="header-left">
        <div class="env-indicator">
          <span class="env-broker">{{ selectedBroker.toUpperCase() }}</span>
          <span class="env-name">{{ selectedEnv }}</span>
        </div>
        <div class="status-badge" :class="isCurrentLoggedIn ? 'active' : 'inactive'">
          <span class="status-dot"></span>
          <span>{{ isCurrentLoggedIn ? 'Admin 已登录' : '未登录' }}</span>
        </div>
      </div>
      
      <div class="header-right">
        <div v-if="runMode === 'local' && memberService.running" class="service-indicator">
          <span class="status-dot running"></span>
          <span class="service-indicator-label">{{ memberService.broker }}-Member</span>
          <span class="service-indicator-port">:{{ memberService.port }}</span>
          <button class="service-stop-btn" :disabled="globalLoading.show" @click="stopMemberService" title="停止服务">✕</button>
        </div>
        
        <div class="mode-toggle">
          <button class="mode-toggle-btn" :class="{ active: runMode === 'local' }" :disabled="globalLoading.show" @click="runMode = 'local'">本地</button>
          <button class="mode-toggle-btn" :class="{ active: runMode === 'online' }" :disabled="globalLoading.show" @click="runMode = 'online'">线上</button>
        </div>
        
        <button class="settings-btn" @click="openSettings" title="API 设置">
          <span v-html="icons.settings"></span>
        </button>
      </div>
    </header>

    <!-- 设置抽屉 -->
    <Transition name="drawer">
      <div v-if="settingsDrawer.open" class="settings-drawer-overlay" @click.self="closeSettings">
        <aside class="settings-drawer">
          <div class="drawer-header">
            <h3>API 配置</h3>
            <span class="drawer-env-badge">{{ selectedBroker.toUpperCase() }} / {{ selectedEnv }}</span>
            <button class="drawer-close-btn" @click="closeSettings" v-html="icons.x"></button>
          </div>
          
          <div class="drawer-content">
            <div class="setting-group">
              <label>Admin API</label>
              <input type="text" v-model="settingsDrawer.config.adminApi" @input="onConfigChange" placeholder="https://crm-api-xxx.xxx.com" />
              <span class="setting-hint">用于登录和获取用户数据</span>
            </div>
            <div class="setting-group">
              <label>Member Portal</label>
              <input type="text" v-model="settingsDrawer.config.memberPortal" @input="onConfigChange" placeholder="https://portal-xxx.xxx.com" />
              <span class="setting-hint">用于线上模式打开 Member 系统</span>
            </div>
            <div class="setting-group">
              <label>Staff Portal</label>
              <input type="text" v-model="settingsDrawer.config.staffPortal" @input="onConfigChange" placeholder="https://staff-xxx.xxx.com" />
              <span class="setting-hint">用于打开 Admin 管理后台</span>
            </div>
          </div>
          
          <div class="drawer-footer">
            <button class="btn-secondary" @click="resetSettings">
              <span class="btn-content"><span class="btn-icon-svg" v-html="icons.undo"></span><span>重置默认</span></span>
            </button>
            <button class="btn-primary" :disabled="!settingsDrawer.hasChanges" @click="saveSettings">
              <span class="btn-content"><span class="btn-icon-svg" v-html="icons.save"></span><span>保存</span></span>
            </button>
          </div>
        </aside>
      </div>
    </Transition>

    <!-- 主内容区 -->
    <div class="module-content">
      <!-- 左侧面板 -->
      <aside class="left-panel">
        <div class="config-section">
          <div class="panel-section-header">Broker</div>
          <div class="select-group">
            <select v-model="selectedBroker" :disabled="globalLoading.show">
              <option v-for="broker in BROKERS" :key="broker" :value="broker">{{ broker.toUpperCase() }}</option>
            </select>
          </div>
        </div>
        
        <div class="config-section">
          <div class="panel-section-header">环境</div>
          <div class="select-group">
            <select v-model="selectedEnv" :disabled="globalLoading.show">
              <option v-for="env in ENVIRONMENTS" :key="env" :value="env">{{ env }}</option>
            </select>
          </div>
        </div>

        <div class="config-section">
          <div class="panel-section-header">操作</div>
          <div class="quick-actions">
            <button class="btn-action" :disabled="globalLoading.show" @click="handleRefresh" @mousedown="createRipple" title="刷新">
              <span class="btn-icon-svg" v-html="icons.refresh"></span>
              <span>刷新</span>
            </button>
            <button v-if="isCurrentLoggedIn" class="btn-action" :disabled="globalLoading.show" @click="openAdminPortal" @mousedown="createRipple" title="打开 Admin">
              <span class="btn-icon-svg" v-html="icons.globe"></span>
              <span>Admin</span>
            </button>
            <button v-if="isCurrentLoggedIn" class="btn-action danger" :disabled="globalLoading.show" @click="handleLogoutAdmin" @mousedown="createRipple">
              <span class="btn-icon-svg" v-html="icons.logout"></span>
              <span>退出</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- 右侧面板 -->
      <main class="right-panel">
        <div class="panel-header">
          <h2>{{ isSearchMode ? '搜索结果' : '用户列表' }}</h2>
          <span v-if="isSearchMode && searchResults.length" class="badge">{{ searchResults.length }} 个结果</span>
          <span v-else-if="pagination.totalUsers" class="badge">共 {{ pagination.totalUsers }} 人</span>
        </div>
        
        <!-- 搜索框 -->
        <div class="search-row">
          <div class="search-input-wrapper" :class="{ 'search-loading': inlineLoading.search }">
            <input v-model="searchKeyword" type="text" placeholder="搜索 UserID / 姓名 / 邮箱" class="search-input" :disabled="globalLoading.show || inlineLoading.search" @keyup.enter="handleSearch" />
            <span v-if="inlineLoading.search" class="search-loading-indicator">
              <span class="inline-spinner"></span>
              <span>搜索中</span>
            </span>
            <button v-else-if="isSearchMode" class="clear-btn" @click="clearSearch" title="清除搜索" v-html="icons.x"></button>
          </div>
          <button class="btn-primary" :class="{ 'btn-loading': inlineLoading.search }" :disabled="globalLoading.show || !isCurrentLoggedIn || inlineLoading.search" @click="handleSearch" @mousedown="createRipple">
            <span v-if="!inlineLoading.search" class="btn-content">
              <span class="btn-icon-svg" v-html="icons.search"></span>
              <span>搜索</span>
            </span>
          </button>
          <button class="btn-secondary" :disabled="globalLoading.show || !isCurrentLoggedIn || inlineLoading.list" @click="handleReset" @mousedown="createRipple" title="重置">
            <span class="btn-content">
              <span class="btn-icon-svg" v-html="icons.refresh"></span>
              <span>重置</span>
            </span>
          </button>
        </div>
        
        <!-- 搜索结果 -->
        <template v-if="isSearchMode">
          <div v-if="searchResults.length > 0" class="user-grid">
            <button v-for="user in searchResults" :key="user.id" class="user-card" :class="{ selected: selectedUserId === user.id }" :disabled="globalLoading.show" @click="handleUserClick(user.id)" @mousedown="createRipple">
              <span class="user-avatar">{{ user.displayname ? user.displayname[0].toUpperCase() : 'U' }}</span>
              <div class="user-info">
                <span class="user-name">{{ user.displayname || 'User ' + user.id }}</span>
                <span class="user-id">ID: {{ user.id }}</span>
                <span v-if="user.email" class="user-email">{{ user.email }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">
            <div class="empty-icon" v-html="icons.searchEmpty"></div>
            <div class="empty-text">未找到匹配的用户</div>
          </div>
        </template>
        
        <!-- 用户列表 -->
        <template v-else>
          <div class="list-hint">点击下方用户卡片登录对应 Member 系统</div>
          <div v-if="userList.length > 0" class="user-grid">
            <button v-for="user in userList" :key="user.id" class="user-card" :class="{ selected: selectedUserId === user.id, pinned: user.isPinned }" :disabled="globalLoading.show" @click="handleUserClick(user.id)" @mousedown="createRipple">
              <span v-if="user.isPinned" class="pinned-badge" title="收藏用户">⭐</span>
              <span class="user-avatar">{{ user.displayname ? user.displayname[0].toUpperCase() : 'U' }}</span>
              <div class="user-info">
                <span class="user-name">{{ user.displayname || 'User ' + user.id }}</span>
                <span class="user-id">ID: {{ user.id }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">
            <div class="empty-icon" v-html="icons.users"></div>
            <div class="empty-text">{{ isCurrentLoggedIn ? '暂无用户数据' : '请先登录 Admin 系统' }}</div>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.member-module {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-bottom: 80px; /* Space for dock */
}

.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.env-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--accent-glow);
  border: 1px solid var(--accent-primary);
  border-radius: 8px;
}

.env-broker {
  font-weight: 600;
  font-size: 13px;
  color: var(--accent-primary);
}

.env-name {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

.status-badge.active {
  background: var(--success-glow);
  color: var(--success);
}

.status-badge.inactive {
  background: var(--glass-bg);
  color: var(--text-tertiary);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-dot.running {
  background: var(--success);
  box-shadow: 0 0 8px var(--success-glow);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.service-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--success-glow);
  border: 1px solid var(--success);
  border-radius: 6px;
  font-size: 11px;
}

.service-indicator-label {
  color: var(--success);
  font-weight: 500;
}

.service-indicator-port {
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
}

.service-stop-btn {
  margin-left: 4px;
  padding: 2px 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 10px;
  transition: color 0.2s;
}

.service-stop-btn:hover {
  color: var(--error);
}

.mode-toggle {
  display: flex;
  padding: 3px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
}

.mode-toggle-btn {
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-toggle-btn:hover {
  color: var(--text-secondary);
}

.mode-toggle-btn.active {
  background: var(--accent-glow);
  color: var(--accent-primary);
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.settings-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.module-content {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 20px 24px;
  min-height: 0;
  overflow: hidden;
}

.left-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--shadow-glass);
}

.config-section {
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 16px;
}

.panel-section-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
}

.select-group select {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
}

.select-group select:hover {
  border-color: var(--glass-border-strong);
}

.select-group select:focus {
  border-color: var(--accent-primary);
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.btn-action:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-strong);
}

.btn-action.danger:hover {
  background: var(--error-glow);
  border-color: var(--error);
  color: var(--error);
}

.btn-icon-svg {
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.badge {
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent-primary);
  background: var(--accent-glow);
  border-radius: 4px;
}

.search-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.search-input-wrapper {
  flex: 1;
  position: relative;
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  padding-right: 40px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
  transition: all 0.2s;
}

.search-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.clear-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-btn:hover {
  color: var(--text-secondary);
}

.search-loading-indicator {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.inline-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn-primary,
.btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}

.btn-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-primary {
  color: #fff;
  background: var(--accent-primary);
  border: none;
  box-shadow: var(--shadow-button);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow: var(--shadow-button-hover);
  transform: translateY(-1px);
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

.btn-secondary:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border-strong);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.list-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  overflow-y: auto;
  flex: 1;
  padding-right: 4px;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
  text-align: left;
}

.user-card:hover {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
  transform: translateY(-2px);
}

.user-card.selected {
  background: var(--accent-glow);
  border-color: var(--accent-primary);
  box-shadow: 0 0 20px var(--accent-glow);
}

.user-card.pinned {
  border-left: 3px solid var(--accent-warm);
}

.pinned-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 12px;
}

.user-avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--accent-glow);
  border-radius: 10px;
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-id {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-tertiary);
}

.user-email {
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px;
  text-align: center;
}

.empty-icon {
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.empty-text {
  font-size: 14px;
  color: var(--text-tertiary);
}

/* Toast */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
}

.toast {
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 500;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  box-shadow: var(--shadow-glass);
}

.toast.success {
  border-left: 3px solid var(--success);
  color: var(--success);
}

.toast.error {
  border-left: 3px solid var(--error);
  color: var(--error);
}

.toast.info {
  border-left: 3px solid var(--accent-primary);
  color: var(--accent-primary);
}

/* Loading overlay */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  font-size: 14px;
  color: var(--text-secondary);
}

/* Settings drawer */
.settings-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.settings-drawer {
  width: 360px;
  height: 100%;
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur));
  border-left: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border-bottom: 1px solid var(--glass-border);
}

.drawer-header h3 {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.drawer-env-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent-primary);
  background: var(--accent-glow);
  border-radius: 4px;
}

.drawer-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.2s;
}

.drawer-close-btn:hover {
  color: var(--text-primary);
}

.drawer-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.setting-group {
  margin-bottom: 20px;
}

.setting-group label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.setting-group input {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s;
}

.setting-group input:focus {
  border-color: var(--accent-primary);
}

.setting-hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.drawer-footer {
  display: flex;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid var(--glass-border);
}

.drawer-footer .btn-secondary,
.drawer-footer .btn-primary {
  flex: 1;
}

/* Transitions */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.3s ease;
}

.drawer-enter-from .settings-drawer,
.drawer-leave-to .settings-drawer {
  transform: translateX(100%);
}

/* Ripple effect */
:deep(.ripple) {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transform: scale(0);
  animation: ripple-animation 0.6s ease-out;
  pointer-events: none;
}

@keyframes ripple-animation {
  to {
    transform: scale(4);
    opacity: 0;
  }
}
</style>
