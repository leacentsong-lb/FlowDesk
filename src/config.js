// 业务配置 - 支持自定义 API URL

// ============================================
// 自定义 API 配置管理
// ============================================

/**
 * 获取自定义配置的存储 Key
 * @param {string} broker 
 * @param {string} env 
 * @returns {string}
 */
export const getApiConfigKey = (broker, env) => `api-config-${broker}-${env}`

/**
 * 获取自定义 API 配置
 * @param {string} broker 
 * @param {string} env 
 * @returns {Object|null} { adminApi, memberPortal, staffPortal }
 */
export const getCustomApiConfig = (broker, env) => {
  try {
    const key = getApiConfigKey(broker, env)
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

/**
 * 保存自定义 API 配置
 * @param {string} broker 
 * @param {string} env 
 * @param {Object} config { adminApi, memberPortal, staffPortal }
 */
export const saveCustomApiConfig = (broker, env, config) => {
  const key = getApiConfigKey(broker, env)
  localStorage.setItem(key, JSON.stringify(config))
}

/**
 * 删除自定义 API 配置（重置为默认）
 * @param {string} broker 
 * @param {string} env 
 */
export const resetCustomApiConfig = (broker, env) => {
  const key = getApiConfigKey(broker, env)
  localStorage.removeItem(key)
}

// ============================================
// 默认 URL 生成函数（内部使用）
// ============================================

/**
 * 生成默认的 Admin API 域名
 */
const getDefaultAdminHost = (broker, env) => {
  if (env === 'uat') {
    return `https://crm-api-${broker}-uat.lbcrmpet.com`
  }
  const match = env.match(/^(\w+)-(\d+)$/)
  if (match) {
    const [, base, num] = match
    return `https://crm-api-${broker}-cn-${num}-${base}.lbcrmsit.com`
  }
  return `https://crm-api-${broker}-cn-${env}.lbcrmsit.com`
}

/**
 * 生成默认的 Member Portal 域名
 */
const getDefaultMemberPortalHost = (broker, env) => {
  if (env === 'uat') {
    return `https://portal-${broker}-uat.lbcrmpet.com`
  }
  const match = env.match(/^(\w+)-(\d+)$/)
  if (match) {
    const [, base, num] = match
    return `https://portal-${broker}-cn-${num}-${base}.lbcrmsit.com`
  }
  return `https://portal-${broker}-cn-${env}.lbcrmsit.com`
}

/**
 * 生成默认的 Staff Portal 域名
 */
const getDefaultStaffPortalHost = (broker, env) => {
  if (env === 'uat') {
    return `https://staff-${broker}-uat.lbcrmpet.com`
  }
  const match = env.match(/^(\w+)-(\d+)$/)
  if (match) {
    const [, base, num] = match
    return `https://staff-${broker}-cn-${num}-${base}.lbcrmsit.com`
  }
  return `https://staff-${broker}-cn-${env}.lbcrmsit.com`
}

/**
 * 获取默认 API 配置（用于重置和显示）
 * @param {string} broker 
 * @param {string} env 
 * @returns {Object} { adminApi, memberPortal, staffPortal }
 */
export const getDefaultApiConfig = (broker, env) => ({
  adminApi: getDefaultAdminHost(broker, env),
  memberPortal: getDefaultMemberPortalHost(broker, env),
  staffPortal: getDefaultStaffPortalHost(broker, env)
})

// ============================================
// 基础配置
// ============================================

// Broker 列表
export const BROKERS = ['tmgm', 'oqtima', 'anzo', 'dls', 'ttg']

// 环境列表
export const ENVIRONMENTS = ['dev', 'dev-1', 'dev-2', 'qa', 'qa-1', 'qa-2', 'qa-3', 'uat']

// Broker 名称映射 (小写 -> 大写项目名)
export const BROKER_NAME_MAP = {
  'tmgm': 'TMGM',
  'oqtima': 'OQTIMA',
  'anzo': 'ANZO',
  'dls': 'DLS',
  'ttg': 'TTG'
}

// Member 项目基础路径
export const MEMBER_PROJECT_BASE_PATH = '/Users/leacentsong/Documents/LifeByteCodes'

// Admin 固定登录凭证
export const ADMIN_CREDENTIALS = {
  username: 'supergod',
  password: '@Lb%8888'
}

// Member 本地固定地址
export const MEMBER_LOCAL_URL = 'http://localhost:5173'

// 生成 Member Portal 在线地址（优先使用自定义配置）
export const getMemberPortalHost = (broker, env) => {
  const customConfig = getCustomApiConfig(broker, env)
  if (customConfig?.memberPortal) {
    return customConfig.memberPortal
  }
  return getDefaultMemberPortalHost(broker, env)
}

// 生成 Admin Portal 在线地址（Staff 系统，优先使用自定义配置）
export const getAdminPortalUrl = (broker, env) => {
  const customConfig = getCustomApiConfig(broker, env)
  if (customConfig?.staffPortal) {
    return customConfig.staffPortal
  }
  return getDefaultStaffPortalHost(broker, env)
}

// 请求头配置
export const REQUEST_HEADERS = {
  'accept': 'application/prs.CRM-Back-End.v2+json',
  'cache-control': 'max-age=0'
}

// 生成 Admin 接口域名（优先使用自定义配置）
export const getAdminHost = (broker, env) => {
  const customConfig = getCustomApiConfig(broker, env)
  if (customConfig?.adminApi) {
    return customConfig.adminApi
  }
  return getDefaultAdminHost(broker, env)
}

// 生成 Admin 登录接口地址
export const getAdminLoginApi = (broker, env) => 
  `${getAdminHost(broker, env)}/api/authorizations/admin`

// 分页配置
export const PAGINATION = {
  perPage: 20
}

// 收藏用户列表接口（isPinnedDataOnly=1）
export const getPinnedUserListApi = (broker, env, perPage = PAGINATION.perPage) => 
  `${getAdminHost(broker, env)}/api/member/users/index?lang=en&per_page=${perPage}&isPinnedDataOnly=1`

// 普通用户列表接口
export const getUserListApi = (broker, env, perPage = PAGINATION.perPage) => 
  `${getAdminHost(broker, env)}/api/member/users/index?lang=en&per_page=${perPage}`

// 用户搜索接口（普通用户）
export const getSearchUserApi = (broker, env, keyword, perPage = PAGINATION.perPage) => 
  `${getAdminHost(broker, env)}/api/member/users/index?member_info=${keyword}&lang=en&per_page=${perPage}`

// 用户搜索接口（收藏用户）
export const getSearchPinnedUserApi = (broker, env, keyword, perPage = PAGINATION.perPage) => 
  `${getAdminHost(broker, env)}/api/member/users/index?member_info=${keyword}&lang=en&per_page=${perPage}&isPinnedDataOnly=1`

// 生成 Member Token 获取接口地址
export const getMemberTokenApi = (broker, env, userId) => 
  `${getAdminHost(broker, env)}/api/authorizations/login?user_id=${userId}&provider=member`

// 生成 Member 登录链接参数
const buildMemberParams = (tokenData, loginUser = '') => {
  const params = []
  if (tokenData.access_token) params.push(`access_token=${tokenData.access_token}`)
  if (tokenData.expires_in) params.push(`expires_in=${tokenData.expires_in}`)
  if (tokenData.refresh_token) params.push(`refresh_token=${tokenData.refresh_token}`)
  if (loginUser) params.push(`loginUser=${loginUser}`)
  return params.join('&')
}

// 生成 Member 最终登录链接（本地开发）
export const getMemberUrl = (tokenData, loginUser = '') => {
  return `${MEMBER_LOCAL_URL}/?${buildMemberParams(tokenData, loginUser)}`
}

// 生成 Member 线上登录链接（使用 API 返回的 domain）
export const getMemberOnlineUrl = (domain, tokenData, loginUser = '') => {
  // domain 可能带或不带协议和斜杠，统一处理
  let baseUrl = domain
  if (!baseUrl.startsWith('http')) {
    baseUrl = `https://${baseUrl}`
  }
  baseUrl = baseUrl.replace(/\/$/, '') // 移除尾部斜杠
  return `${baseUrl}/?${buildMemberParams(tokenData, loginUser)}`
}

// Token 缓存 Key 生成
export const getTokenCacheKey = (broker, env) => 
  `${broker}-${env}-admin-token`

// 生成 Member 项目路径
export const getMemberProjectPath = (broker) => {
  const brokerName = BROKER_NAME_MAP[broker] || broker.toUpperCase()
  return `${MEMBER_PROJECT_BASE_PATH}/${brokerName}-CRM-Member-Frontend`
}

// 生成 Member 配置文件路径（本地开发使用 local.config.js）
export const getMemberConfigPath = (broker) => 
  `${getMemberProjectPath(broker)}/public/local.config.js`

// 生成 VUE_APP_API 的值
export const getVueAppApi = (broker, env) => 
  `${getAdminHost(broker, env)}/api`

// ============================================
// 主题配置
// ============================================
export const THEME_STORAGE_KEY = 'dev_helper_theme'
export const DEFAULT_THEME = 'lemon-fresh'

// 获取当前主题
export const getCurrentTheme = () => DEFAULT_THEME

// 设置主题
export const setTheme = () => {
  localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME)
  document.documentElement.setAttribute('data-theme', DEFAULT_THEME)
}

// 初始化主题（在应用启动时调用）
export const initTheme = () => {
  setTheme()
}
