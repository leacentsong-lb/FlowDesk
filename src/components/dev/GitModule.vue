<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { AIChatService, AIConfigManager } from '../../services/ai-service'

// ============================================
// 状态定义
// ============================================

// Broker 项目路径
const brokerPaths = ref(JSON.parse(localStorage.getItem('broker_project_paths') || '{}'))
const githubToken = ref(localStorage.getItem('github_token') || '')
const currentGitHubUser = ref('')

// 仓库状态
const repoStatuses = reactive({})
// 分支切换 UI 状态（每仓库独立）
const branchUI = reactive({}) // key -> { open, query, branches, loading }
const loadingRepos = ref(new Set())
const repoErrors = ref({})
// 列表页 PR 摘要（轻量，仅与你相关）
const prSummary = reactive({}) // key -> { loading, mine, review }

// 聚合所有仓库的"关于我的 PR"（用于顶部汇总展示）
const allMyPRs = ref([])
const allMyPRsLoading = ref(false)
const allMyPRsLoaded = ref(false)

// Repo 详情页（按需加载：分支/同步/提交/PR）
const showRepoDetailsPage = ref(false)
const repoDetailTab = ref('overview') // overview | prs
const repoDetail = reactive({
  repoKey: '',
  repoPath: '',
  repoName: '',
  loading: false,
  error: '',
  // git status
  currentBranch: '',
  workingTree: null,
  // sync
  currentStatus: null,
  latestStatus: null,
  // commits
  recentCommits: [],
  // remote
  remoteInfo: '',
  // PRs (lazy)
  prsLoaded: false,
  prsLoading: false,
  prsError: '',
  prs: [],
  prSearch: '',
  prOnlyAssignedToMe: false
})

// Merge Modal
const showMergeModal = ref(false)
const mergeTarget = ref({
  repoKey: '',
  repoPath: '',
  repoName: '',
  sourceBranch: 'latest',
  targetBranch: '',
  branches: [],
  query: '',
  open: false
})
const merging = ref(false)
const mergeResult = ref(null)

// AI Code Review 状态
const showCodeReview = ref(false)
const codeReviewLoading = ref(false)
const codeReviewResult = ref('')
const codeReviewError = ref('')

const initReposLoading = ref(false)

// ============================================
// 计算属性
// ============================================

const brokerList = computed(() => Object.entries(brokerPaths.value))
const hasRepos = computed(() => brokerList.value.length > 0)

const normalize = (s) => (s || '').toString().trim().toLowerCase()

const isAssignedToMeFallback = (pr) => {
  // 主匹配：GitHub login
  const me = normalize(currentGitHubUser.value)
  if (me) {
    return pr.reviewers?.some(r => normalize(r.login) === me) || false
  }
  // 兜底：git config user.name 模糊匹配 reviewer login
  const gn = normalize(gitGlobalUser.value?.name)
  if (!gn) return false
  const tokens = gn.split(/\s+/).filter(Boolean)
  return pr.reviewers?.some(r => tokens.some(t => normalize(r.login).includes(t))) || false
}

const filteredRepoPRs = computed(() => {
  const q = normalize(repoDetail.prSearch)
  let list = repoDetail.prs || []
  if (repoDetail.prOnlyAssignedToMe) {
    list = list.filter(pr => pr.needsMyReview || isAssignedToMeFallback(pr))
  }
  if (q) {
    list = list.filter(pr => (
      normalize(pr.title).includes(q) ||
      normalize(pr.base).includes(q) ||
      normalize(pr.head).includes(q) ||
      normalize(pr.author).includes(q)
    ))
  }
  return list
})

// Broker 主题色：为不同仓库提供可区分的视觉标识（不依赖主题，仅做 accent）
const hashString = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const brokerStyle = (key) => {
  const k = (key || '').toString().toLowerCase()
  // TMGM 强化：固定更高对比度的青色系（与 Cyber Night 主色也一致）
  if (k === 'tmgm') {
    return {
      '--broker-color': 'hsl(188 100% 52%)',
      '--broker-color-bg': 'hsla(188, 100%, 52%, 0.18)',
      '--broker-color-glow': 'hsla(188, 100%, 52%, 0.35)'
    }
  }
  const hue = hashString(k) % 360
  return {
    '--broker-color': `hsl(${hue} 78% 52%)`,
    '--broker-color-bg': `hsla(${hue}, 78%, 52%, 0.16)`,
    '--broker-color-glow': `hsla(${hue}, 78%, 52%, 0.28)`
  }
}

// ============================================
// 方法
// ============================================

// 从路径提取仓库名
const getRepoName = (path) => {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// 获取单个仓库状态
const ensureBranchUI = (key) => {
  if (!branchUI[key]) {
    branchUI[key] = { open: false, query: '', branches: [], loading: false }
  }
}

const fetchRepoBranches = async (key, path) => {
  ensureBranchUI(key)
  if (branchUI[key].branches.length > 0 || branchUI[key].loading) return
  branchUI[key].loading = true
  try {
    const branches = await invoke('git_list_branches', { projectPath: path })
    // 仅保留本地分支（去掉 remotes/ 等）
    branchUI[key].branches = branches
      .map(b => b.replace('* ', '').trim())
      .filter(b => b && !b.includes('remotes/') && !b.includes('origin/') && !b.includes('HEAD'))
  } catch (e) {
    // 不阻断主流程
  } finally {
    branchUI[key].loading = false
  }
}

const fetchRepoStatus = async (key, path) => {
  loadingRepos.value.add(key)
  repoErrors.value[key] = ''
  
  try {
    // 首屏仅加载轻量状态：当前分支 + 工作区（避免同时跑分支/commit/sync 导致卡顿）
    const [currentBranch, workingTree] = await Promise.all([
      invoke('git_current_branch', { projectPath: path }),
      invoke('git_check_working_tree', { projectPath: path })
    ])
    
    repoStatuses[key] = {
      path,
      name: getRepoName(path),
      currentBranch,
      workingTree,
      lastUpdated: new Date()
    }
  } catch (e) {
    repoErrors.value[key] = e.toString()
    repoStatuses[key] = null
  } finally {
    loadingRepos.value.delete(key)
  }
}

// 列表页：按需加载“与你相关 PR”摘要（不拉全量详情）
const fetchRepoPRSummary = async (key, path) => {
  if (!githubToken.value) return
  if (prSummary[key]?.loading) return
  // 简单缓存：60s 内不重复请求，避免频繁刷新打爆 GitHub API
  const lastAt = prSummary[key]?.loadedAt ? new Date(prSummary[key].loadedAt).getTime() : 0
  if (lastAt && Date.now() - lastAt < 60_000) return

  prSummary[key] = { loading: true, mine: 0, review: 0, loadedAt: prSummary[key]?.loadedAt || null }
  try {
    // currentGitHubUser 可能尚未拿到，先尽力获取一次（不阻塞失败）
    if (!currentGitHubUser.value) {
      await fetchCurrentUser().catch(() => {})
    }

    const repoInfo = await invoke('git_get_remote_info', { projectPath: path }).catch(() => '')
    const normalized = (repoInfo || '').trim().replace(/\.git$/i, '')
    const [owner, repo] = normalized.split('/').filter(Boolean)
    if (!owner || !repo) {
      prSummary[key] = { loading: false, mine: 0, review: 0, loadedAt: new Date().toISOString() }
      return
    }
    const result = await invoke('github_list_open_prs', { owner, repo, token: githubToken.value })
    if (result.status !== 200) {
      prSummary[key] = { loading: false, mine: 0, review: 0, loadedAt: new Date().toISOString() }
      return
    }
    const prs = JSON.parse(result.body || '[]') || []
    const me = normalize(currentGitHubUser.value)
    const mine = prs.filter(pr => normalize(pr.user?.login) === me).length
    const review = prs.filter(pr => (pr.requested_reviewers || []).some(r => normalize(r.login) === me)).length
    prSummary[key] = { loading: false, mine, review, loadedAt: new Date().toISOString() }
  } catch {
    prSummary[key] = { loading: false, mine: 0, review: 0, loadedAt: new Date().toISOString() }
  }
}

const schedulePRSummaryPrefetch = () => {
  if (!githubToken.value) return
  // 并发预取（有限并发，避免 GitHub API rate limit）
  const CONCURRENCY = 4
  const list = brokerList.value.slice(0)
  let idx = 0

  const worker = async () => {
    while (idx < list.length) {
      const cur = list[idx++]
      if (!cur) return
      const [key, path] = cur
      // 单仓库失败不影响整体
      await fetchRepoPRSummary(key, path).catch(() => {})
    }
  }

  // 让 UI 先渲染，再并发请求
  setTimeout(() => {
    const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker())
    Promise.all(workers).catch(() => {})
  }, 150)
  
  // 同时预取聚合 PR 列表
  setTimeout(() => fetchAllMyPRs(), 200)
}

// 获取所有仓库的"关于我的 PR"聚合列表
const fetchAllMyPRs = async () => {
  if (!githubToken.value) return
  if (allMyPRsLoading.value) return
  
  allMyPRsLoading.value = true
  const aggregated = []
  
  try {
    // 确保拿到当前用户
    if (!currentGitHubUser.value) {
      await fetchCurrentUser().catch(() => {})
    }
    const me = normalize(currentGitHubUser.value)
    
    // 并发获取各仓库 PR
    const results = await Promise.all(
      brokerList.value.map(async ([key, path]) => {
        try {
          const repoInfo = await invoke('git_get_remote_info', { projectPath: path }).catch(() => '')
          const normalized = (repoInfo || '').trim().replace(/\.git$/i, '')
          const [owner, repo] = normalized.split('/').filter(Boolean)
          if (!owner || !repo) return []
          
          const result = await invoke('github_list_open_prs', { owner, repo, token: githubToken.value })
          if (result.status !== 200) return []
          
          const prs = JSON.parse(result.body || '[]') || []
          // 筛选与我相关的 PR：我创建的 或 我是 reviewer
          return prs
            .filter(pr => {
              const isMine = normalize(pr.user?.login) === me
              const isReviewer = (pr.requested_reviewers || []).some(r => normalize(r.login) === me)
              return isMine || isReviewer
            })
            .map(pr => ({
              id: pr.id,
              number: pr.number,
              title: pr.title,
              url: pr.html_url,
              author: pr.user?.login,
              authorAvatar: pr.user?.avatar_url,
              base: pr.base?.ref,
              head: pr.head?.ref,
              draft: pr.draft,
              createdAt: pr.created_at,
              updatedAt: pr.updated_at,
              repoKey: key,
              repoName: repo,
              isMine: normalize(pr.user?.login) === me,
              isReviewer: (pr.requested_reviewers || []).some(r => normalize(r.login) === me)
            }))
        } catch {
          return []
        }
      })
    )
    
    // 扁平化并按更新时间排序
    results.forEach(list => aggregated.push(...list))
    aggregated.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    
    allMyPRs.value = aggregated
    allMyPRsLoaded.value = true
  } catch {
    // 静默失败
  } finally {
    allMyPRsLoading.value = false
  }
}

// 打开 PR 链接
const openPRUrl = async (url) => {
  try {
    await invoke('open_url_raw', { url })
  } catch {
    window.open(url, '_blank')
  }
}
// 切换分支（安全校验通过才允许）
const checkoutBranch = async (key, path, branch) => {
  // 根除“点了没动作”：不依赖 repoStatuses（可能尚未刷新/为空），而是现场做安全校验
  let wt = null
  try {
    wt = await invoke('git_check_working_tree', { projectPath: path })
  } catch (e) {}

  const clean = wt?.clean ?? true
  const hasTrackedChanges = (wt?.stagedFiles?.length > 0) || (wt?.unstagedFiles?.length > 0)
  if (!clean && hasTrackedChanges) {
    repoErrors.value[key] = '⚠️ 工作区有未提交的更改，禁止切换分支'
    return
  }

  const current = showRepoDetailsPage.value && repoDetail.repoKey === key
    ? repoDetail.currentBranch
    : (repoStatuses[key]?.currentBranch || '')
  if (branch === current) {
    ensureBranchUI(key)
    branchUI[key].open = false
    return
  }

  loadingRepos.value.add(key)
  repoErrors.value[key] = ''
  try {
    await invoke('git_checkout_branch', { projectPath: path, branch })
    // 刷新轻量卡片
    await fetchRepoStatus(key, path)
    // 刷新详情页 Stage A
    if (showRepoDetailsPage.value && repoDetail.repoKey === key) {
      repoDetail.loading = true
      repoDetail.error = ''
      setTimeout(() => openRepoDetails(key, path), 0)
    }
  } catch (e) {
    repoErrors.value[key] = e.toString()
  } finally {
    loadingRepos.value.delete(key)
    ensureBranchUI(key)
    branchUI[key].open = false
    branchUI[key].query = ''
  }
}

// Pull 当前分支（仅在落后且安全校验通过时允许）
const pullCurrentBranch = async (key, path) => {
  if (!repoStatuses[key]) return
  const branch = repoStatuses[key].currentBranch
  if (!repoStatuses[key].workingTree?.clean) {
    repoErrors.value[key] = '⚠️ 工作区有未提交的更改，禁止 pull'
    return
  }
  loadingRepos.value.add(key)
  repoErrors.value[key] = ''
  try {
    await invoke('git_pull_branch', { projectPath: path, branch })
    await fetchRepoStatus(key, path)
  } catch (e) {
    repoErrors.value[key] = e.toString()
  } finally {
    loadingRepos.value.delete(key)
    if (showRepoDetailsModal.value && repoDetail.repoKey === key) {
      openRepoDetails(key, path)
    }
  }
}

// 刷新所有仓库状态
const refreshAllRepos = async () => {
  const promises = brokerList.value.map(([key, path]) => 
    fetchRepoStatus(key, path)
  )
  await Promise.all(promises)
}

// Fetch 单个仓库
const fetchRepo = async (key, path) => {
  loadingRepos.value.add(key)
  try {
    await invoke('git_fetch', { projectPath: path })
    await fetchRepoStatus(key, path)
  } catch (e) {
    repoErrors.value[key] = `Fetch 失败: ${e}`
  } finally {
    loadingRepos.value.delete(key)
  }
}

// 打开仓库详情（点击单个仓库后再加载重信息）
const openRepoDetails = async (key, path) => {
  repoDetail.repoKey = key
  repoDetail.repoPath = path
  repoDetail.repoName = getRepoName(path)
  repoDetailTab.value = 'overview'
  repoDetail.loading = true
  repoDetail.error = ''
  repoDetail.currentBranch = ''
  repoDetail.workingTree = null
  repoDetail.currentStatus = null
  repoDetail.latestStatus = null
  repoDetail.recentCommits = []
  repoDetail.remoteInfo = ''
  repoDetail.prsLoaded = false
  repoDetail.prsLoading = false
  repoDetail.prsError = ''
  repoDetail.prs = []
  repoDetail.prSearch = ''
  repoDetail.prOnlyAssignedToMe = false
  // 先“进页面”再请求，避免点击后等待导致不响应
  showRepoDetailsPage.value = true

  // 分阶段加载：A(分支+工作区) -> B(sync) -> C(commits)；每阶段都让 UI 先渲染再请求
  setTimeout(async () => {
    try {
      // Stage A
      const [currentBranch, workingTree, remoteInfo] = await Promise.all([
        invoke('git_current_branch', { projectPath: path }),
        invoke('git_check_working_tree', { projectPath: path }),
        invoke('git_get_remote_info', { projectPath: path }).catch(() => '')
      ])
      repoDetail.currentBranch = currentBranch
      repoDetail.workingTree = workingTree
      repoDetail.remoteInfo = remoteInfo
      repoDetail.loading = false

      // 先把轻量卡片同步刷新掉（避免 UI 仍显示旧分支）
      fetchRepoStatus(key, path)

      // Stage B（sync）与 Stage C（commits）再异步加载，避免进入详情时卡顿体感
      setTimeout(async () => {
        const [currentStatus, latestStatus] = await Promise.all([
          invoke('git_check_behind_ahead', { projectPath: path, branch: currentBranch }).catch(() => null),
          invoke('git_check_behind_ahead', { projectPath: path, branch: 'latest' }).catch(() => null)
        ])
        repoDetail.currentStatus = currentStatus
        repoDetail.latestStatus = latestStatus
      }, 0)

      setTimeout(async () => {
        const commits = await invoke('git_get_recent_commits', { projectPath: path, count: 5 }).catch(() => ({ commits: [] }))
        repoDetail.recentCommits = commits?.commits || []
      }, 0)
    } catch (e) {
      repoDetail.error = e.toString()
      repoDetail.loading = false
    }
  }, 0)
}

const closeRepoDetails = () => {
  showRepoDetailsPage.value = false
}

// 打开 Merge Modal
const openMergeModal = async (key, path, name) => {
  mergeTarget.value = {
    repoKey: key,
    repoPath: path,
    repoName: name,
    sourceBranch: 'latest',
    targetBranch: '',
    branches: [],
    query: '',
    open: false
  }
  mergeResult.value = null
  
  // 获取分支列表
  try {
    const branches = await invoke('git_list_branches', { projectPath: path })
    mergeTarget.value.branches = branches
      .filter(b => !b.includes('remotes/') && b !== 'latest')
      .map(b => b.replace('* ', '').trim())
  } catch (e) {
    console.error('Failed to list branches:', e)
  }
  
  showMergeModal.value = true
}

// 执行 Merge
const executeMerge = async () => {
  if (!mergeTarget.value.targetBranch) return
  
  merging.value = true
  mergeResult.value = null
  
  try {
    const result = await invoke('git_merge_branch', {
      projectPath: mergeTarget.value.repoPath,
      sourceBranch: mergeTarget.value.sourceBranch,
      targetBranch: mergeTarget.value.targetBranch
    })
    
    mergeResult.value = result
    
    // 刷新仓库状态
    if (result.success) {
      await fetchRepoStatus(mergeTarget.value.repoKey, mergeTarget.value.repoPath)
    }
  } catch (e) {
    mergeResult.value = { success: false, message: e.toString() }
  } finally {
    merging.value = false
  }
}

// 关闭 Merge Modal
const closeMergeModal = () => {
  showMergeModal.value = false
  mergeTarget.value = {
    repoKey: '',
    repoPath: '',
    repoName: '',
    sourceBranch: 'latest',
    targetBranch: '',
    branches: [],
    query: '',
    open: false
  }
  mergeResult.value = null
}

// ============================================
// AI Code Review
// ============================================

// 执行 AI Code Review
const performCodeReview = async () => {
  if (!repoDetail.repoPath) return
  
  // 检查 AI 配置
  if (!AIConfigManager.isConfigured()) {
    codeReviewError.value = '请先在设置中配置 AI API Key'
    showCodeReview.value = true
    return
  }
  
  codeReviewLoading.value = true
  codeReviewResult.value = ''
  codeReviewError.value = ''
  showCodeReview.value = true
  
  try {
    // 获取 git diff
    const diffResult = await invoke('git_get_diff', {
      repoPath: repoDetail.repoPath
    })
    
    const diff = diffResult.body || ''
    
    if (!diff.trim()) {
      codeReviewResult.value = '当前没有需要审查的代码变更。'
      return
    }
    
    // 调用 AI 进行代码审查
    const review = await AIChatService.codeReview(diff, 'javascript')
    codeReviewResult.value = review
  } catch (e) {
    codeReviewError.value = e.message || String(e)
  } finally {
    codeReviewLoading.value = false
  }
}

// 关闭 Code Review
const closeCodeReview = () => {
  showCodeReview.value = false
  codeReviewResult.value = ''
  codeReviewError.value = ''
}

// ============================================
// PR 相关方法
// ============================================

// 获取当前 GitHub 用户
const fetchCurrentUser = async () => {
  if (!githubToken.value) return
  
  try {
    const result = await invoke('github_get_current_user', { 
      token: githubToken.value 
    })
    if (result.status === 200) {
      const user = JSON.parse(result.body)
      currentGitHubUser.value = user.login
    }
  } catch (e) {
    console.error('Failed to get GitHub user:', e)
  }
}

// 获取 git global user（作为 reviewer name 匹配兜底）
const gitGlobalUser = ref({ name: '', email: '' })
const fetchGitGlobalUser = async () => {
  try {
    const result = await invoke('git_get_global_user')
    gitGlobalUser.value = result || { name: '', email: '' }
  } catch (e) {}
}

// 获取当前仓库的 PR（在仓库详情里按需加载）
const fetchRepoPRs = async () => {
  if (!githubToken.value) {
    repoDetail.prsError = '请先在设置中配置 GitHub Token'
    return
  }
  if (!repoDetail.remoteInfo) {
    repoDetail.prsError = '未找到 GitHub remote 信息（请检查 origin 是否指向 GitHub）'
    return
  }

  const [owner, repo] = repoDetail.remoteInfo.split('/')
  if (!owner || !repo) {
    repoDetail.prsError = 'GitHub remote 解析失败'
    return
  }

  repoDetail.prsLoading = true
  repoDetail.prsError = ''
  repoDetail.prs = []

  try {
    const result = await invoke('github_list_open_prs', {
      owner,
      repo,
      token: githubToken.value
    })

    if (result.status === 200) {
      const prs = JSON.parse(result.body)
      repoDetail.prs = (prs || []).map(pr => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        draft: pr.draft,
        base: pr.base?.ref || '',
        head: pr.head?.ref || '',
        author: pr.user?.login || '',
        authorAvatar: pr.user?.avatar_url || '',
        reviewers: pr.requested_reviewers?.map(r => ({
          login: r.login,
          avatar: r.avatar_url
        })) || [],
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        isAuthor: pr.user?.login === currentGitHubUser.value,
        needsMyReview: pr.requested_reviewers?.some(r => r.login === currentGitHubUser.value) || false
      })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      repoDetail.prsLoaded = true
    } else {
      repoDetail.prsError = `获取 PR 失败: HTTP ${result.status}`
    }
  } catch (e) {
    repoDetail.prsError = `获取 PR 失败: ${e}`
  } finally {
    repoDetail.prsLoading = false
  }
}

// 打开 PR 链接
const openPR = (url) => {
  invoke('open_url_raw', { url })
}

// 格式化时间
const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date
  
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return date.toLocaleDateString('zh-CN')
}

// ============================================
// 事件监听
// ============================================

const handleBrokerPathsUpdated = (event) => {
  brokerPaths.value = event.detail
  refreshAllRepos()
}

const handleGithubTokenUpdated = (event) => {
  githubToken.value = event.detail
  if (event.detail) {
    fetchCurrentUser()
    // token 更新后刷新 PR 摘要
    schedulePRSummaryPrefetch()
  }
}

// ============================================
// 生命周期
// ============================================

onMounted(async () => {
  window.addEventListener('broker-paths-updated', handleBrokerPathsUpdated)
  window.addEventListener('github-token-updated', handleGithubTokenUpdated)
  
  // 初始化
  // 不阻塞首屏渲染：这些初始化异步串行会让 UI 看起来“卡住”
  setTimeout(() => {
    fetchGitGlobalUser()
    if (githubToken.value) fetchCurrentUser()
  }, 0)

  if (hasRepos.value) {
    initReposLoading.value = true
    // 让 UI 先渲染出 skeleton，再开始并行拉取各仓库状态
    setTimeout(async () => {
      try {
        await refreshAllRepos()
      } finally {
        initReposLoading.value = false
        schedulePRSummaryPrefetch()
      }
    }, 0)
  }
})

onUnmounted(() => {
  window.removeEventListener('broker-paths-updated', handleBrokerPathsUpdated)
  window.removeEventListener('github-token-updated', handleGithubTokenUpdated)
})

</script>

<template>
  <div class="git-module">
    <!-- 顶部导航 -->
    <div class="module-header">
      <div class="module-title">
        <span class="tab-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
        </span>
        <span>Git 仓库</span>
        <span class="tab-count" v-if="brokerList.length">{{ brokerList.length }}</span>
      </div>
      
      <div class="header-actions">
        <button 
          class="refresh-btn" 
          @click="refreshAllRepos()"
          :disabled="loadingRepos.size > 0 || initReposLoading"
        >
          <span class="refresh-icon" :class="{ spinning: loadingRepos.size > 0 || initReposLoading }">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
              <path d="M16 21h5v-5"></path>
            </svg>
          </span>
        </button>
      </div>
    </div>
    
    <!-- 仓库状态（轻量） -->
    <div v-if="!showRepoDetailsPage" class="repos-view">
      <!-- 无仓库提示 -->
      <div v-if="!hasRepos" class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>未配置项目仓库</h3>
        <p>请在全局设置中添加项目路径</p>
      </div>

      <!-- 初始化加载态：避免空白/误判未配置，同时不阻塞整个 App -->
      <div v-else-if="initReposLoading" class="init-loading">
        <div class="init-loading-bar">
          <div class="init-loading-dot"></div>
          <div class="init-loading-text">正在初始化仓库状态...</div>
        </div>
        <div class="repo-grid skeleton-grid">
          <div v-for="n in Math.min(6, brokerList.length)" :key="n" class="repo-card skeleton">
            <div class="card-header">
              <div class="repo-identity">
                <span class="broker-badge skeleton-pill">----</span>
                <div class="skeleton-line w-200"></div>
              </div>
              <div class="skeleton-icon"></div>
            </div>
            <div class="card-content">
              <div class="skeleton-row">
                <div class="skeleton-line w-120"></div>
                <div class="skeleton-line w-140"></div>
              </div>
              <div class="skeleton-row">
                <div class="skeleton-line w-120"></div>
                <div class="skeleton-line w-180"></div>
              </div>
              <div class="skeleton-row">
                <div class="skeleton-line w-120"></div>
                <div class="skeleton-line w-140"></div>
              </div>
              <div class="card-footer">
                <div class="skeleton-btn"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 正常内容区（PR 汇总 + 仓库卡片） -->
      <template v-else>
        <!-- 关于我的 PR 汇总（置顶） -->
        <div v-if="allMyPRs.length > 0 || allMyPRsLoading" class="my-prs-section">
          <div class="section-header">
            <span class="section-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="18" r="3"></circle>
                <circle cx="6" cy="6" r="3"></circle>
                <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
                <line x1="6" y1="9" x2="6" y2="21"></line>
              </svg>
            </span>
            <span class="section-title">关于我的 PR</span>
            <span class="section-count" v-if="allMyPRs.length">{{ allMyPRs.length }}</span>
            <button class="refresh-mini" @click="fetchAllMyPRs()" :disabled="allMyPRsLoading" title="刷新">
              <span class="refresh-icon" :class="{ spinning: allMyPRsLoading }">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                  <path d="M16 21h5v-5"></path>
                </svg>
              </span>
            </button>
          </div>
          
          <div v-if="allMyPRsLoading && allMyPRs.length === 0" class="pr-loading">
            <div class="mini-spinner"></div>
            <span>加载中...</span>
          </div>
          
          <div v-else class="my-prs-list">
            <div 
              v-for="pr in allMyPRs" 
              :key="pr.id" 
              class="my-pr-item"
              :class="{ draft: pr.draft, mine: pr.isMine, reviewer: pr.isReviewer && !pr.isMine }"
              @click="openPRUrl(pr.url)"
            >
              <div class="pr-main">
                <span class="pr-repo-badge" :style="brokerStyle(pr.repoKey)">{{ pr.repoKey.toUpperCase() }}</span>
                <span class="pr-number">#{{ pr.number }}</span>
                <span class="pr-title">{{ pr.title }}</span>
              </div>
              <div class="pr-meta">
                <span class="pr-branch">{{ pr.head }} → {{ pr.base }}</span>
                <span v-if="pr.isMine" class="pr-tag mine">我创建</span>
                <span v-if="pr.isReviewer" class="pr-tag review">待我 Review</span>
                <span v-if="pr.draft" class="pr-tag draft">Draft</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 仓库卡片网格 -->
        <div class="repo-grid">
        <div 
          v-for="[key, path] in brokerList" 
          :key="key"
          class="repo-card"
          :style="brokerStyle(key)"
          :class="{ 
            loading: loadingRepos.has(key),
            error: repoErrors[key],
            'has-changes': repoStatuses[key]?.workingTree && !repoStatuses[key]?.workingTree.clean,
            'is-tmgm': key.toLowerCase() === 'tmgm'
          }"
        >
          <!-- 卡片头部 -->
          <div class="card-header">
            <div class="repo-identity">
              <span class="broker-badge">{{ key.toUpperCase() }}</span>
              <h4 class="repo-name">{{ getRepoName(path) }}</h4>
            </div>
            <div class="card-actions">
              <button 
                class="action-btn" 
                title="Fetch"
                @click="fetchRepo(key, path)"
                :disabled="loadingRepos.has(key)"
              >
                <span :class="{ spinning: loadingRepos.has(key) }">⬇️</span>
              </button>
            </div>
          </div>
          
          <!-- 加载状态 -->
          <div v-if="loadingRepos.has(key) && !repoStatuses[key]" class="card-loading">
            <div class="mini-spinner"></div>
            <span>加载中...</span>
          </div>
          
          <!-- 错误状态 -->
          <div v-else-if="repoErrors[key]" class="card-error">
            <span class="error-icon">⚠️</span>
            <span class="error-text">{{ repoErrors[key] }}</span>
          </div>
          
          <!-- 仓库信息 -->
          <div v-else-if="repoStatuses[key]" class="card-content">
            <!-- 当前分支（轻量展示） -->
            <div class="info-row branch-row">
              <span class="info-label">🌿 当前分支</span>
              <span class="branch-name">{{ repoStatuses[key].currentBranch }}</span>
            </div>
            
            <!-- 工作区状态 -->
            <div class="info-row status-row">
              <span class="info-label">📝 工作区</span>
              <span 
                class="status-badge"
                :class="repoStatuses[key].workingTree.clean ? 'clean' : 'dirty'"
              >
                {{ repoStatuses[key].workingTree.clean ? '✓ 干净' : repoStatuses[key].workingTree.summary }}
              </span>
            </div>

            <!-- PR 摘要（与你相关） -->
            <div class="info-row pr-row">
              <span class="info-label">🔀 PR</span>
              <div class="pr-summary">
                <span v-if="prSummary[key]?.loading" class="mini-muted">加载中...</span>
                <template v-else>
                  <span class="pr-chip mine">我的 {{ prSummary[key]?.mine ?? 0 }}</span>
                  <span class="pr-chip review">待我 Review {{ prSummary[key]?.review ?? 0 }}</span>
                </template>
              </div>
            </div>

            <!-- 操作按钮（进入详情再加载更多信息） -->
            <div class="card-footer">
              <button 
                class="merge-btn"
                @click="openRepoDetails(key, path)"
              >
                查看详情
              </button>
            </div>
          </div>
        </div>
        </div>
      </template>
    </div>
    
    <!-- 仓库详情页（点击仓库后再加载重信息 & PR） -->
    <div v-else class="repo-details-page" :style="brokerStyle(repoDetail.repoKey)">
      <div class="details-header">
        <button class="back-btn" @click="closeRepoDetails">← 返回</button>
        <div class="details-title">
          <span class="broker-badge">{{ repoDetail.repoKey.toUpperCase() }}</span>
          <span class="repo-title">{{ repoDetail.repoName }}</span>
        </div>
      </div>

      <div class="details-body">
        <div class="detail-tabs">
          <button class="detail-tab" :class="{ active: repoDetailTab === 'overview' }" @click="repoDetailTab = 'overview'">概览</button>
          <button class="detail-tab" :class="{ active: repoDetailTab === 'prs' }" @click="repoDetailTab = 'prs'; if (!repoDetail.prsLoaded && !repoDetail.prsLoading) fetchRepoPRs()">Pull Requests</button>
        </div>

        <div v-if="repoDetail.loading" class="loading-state">
          <div class="spinner"></div>
          <span>加载仓库详情...</span>
        </div>
        <div v-else-if="repoDetail.error" class="error-state">
          <span class="error-icon">⚠️</span>
          <span>{{ repoDetail.error }}</span>
        </div>

        <template v-else>
          <div v-if="repoDetailTab === 'overview'" class="detail-section">
            <div class="info-row">
              <span class="info-label">🌿 当前分支</span>
              <div class="branch-switch">
                <button
                  class="branch-pill"
                  :disabled="!repoDetail.workingTree?.clean"
                  @click="ensureBranchUI(repoDetail.repoKey); fetchRepoBranches(repoDetail.repoKey, repoDetail.repoPath); branchUI[repoDetail.repoKey].open = !branchUI[repoDetail.repoKey].open"
                  :title="!repoDetail.workingTree?.clean ? '工作区有未提交更改，禁止切换分支' : '切换分支'"
                >
                  <span class="branch-name">{{ repoDetail.currentBranch }}</span>
                  <span class="chev">▾</span>
                </button>
                <div v-if="branchUI[repoDetail.repoKey]?.open" class="branch-dropdown">
                  <div class="branch-search">
                    <input v-model="branchUI[repoDetail.repoKey].query" class="branch-search-input" type="text" placeholder="搜索分支..." />
                  </div>
                  <div class="branch-options">
                    <button
                      v-for="b in (branchUI[repoDetail.repoKey].branches || []).filter(x => !branchUI[repoDetail.repoKey].query || x.toLowerCase().includes(branchUI[repoDetail.repoKey].query.toLowerCase()))"
                      :key="b"
                      class="branch-option"
                      @click="checkoutBranch(repoDetail.repoKey, repoDetail.repoPath, b)"
                    >{{ b }}</button>
                    <div v-if="branchUI[repoDetail.repoKey].loading" class="branch-loading">加载中...</div>
                    <div v-else-if="(branchUI[repoDetail.repoKey].branches || []).length === 0" class="branch-empty">暂无分支</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="info-row">
              <span class="info-label">📝 工作区</span>
              <span class="status-badge" :class="repoDetail.workingTree?.clean ? 'clean' : 'dirty'">
                {{ repoDetail.workingTree?.clean ? '✓ 干净' : repoDetail.workingTree?.summary }}
              </span>
              <button 
                v-if="!repoDetail.workingTree?.clean"
                class="ai-review-btn"
                @click="performCodeReview"
                :disabled="codeReviewLoading"
                title="AI 代码审查"
              >
                {{ codeReviewLoading ? '⏳ 审查中...' : '🔍 AI Review' }}
              </button>
            </div>

            <div class="info-row">
              <span class="info-label">⬆️ 当前分支同步</span>
              <div class="sync-status">
                <span v-if="repoDetail.currentStatus?.synced" class="sync-badge synced">✓ 已同步</span>
                <template v-else>
                  <span v-if="repoDetail.currentStatus?.behind > 0" class="sync-badge behind">↓ {{ repoDetail.currentStatus.behind }} 落后</span>
                  <span v-if="repoDetail.currentStatus?.ahead > 0" class="sync-badge ahead">↑ {{ repoDetail.currentStatus.ahead }} 领先</span>
                </template>
                <button
                  v-if="repoDetail.currentStatus?.behind > 0"
                  class="pull-btn"
                  :disabled="!repoDetail.workingTree?.clean || loadingRepos.has(repoDetail.repoKey)"
                  @click="pullCurrentBranch(repoDetail.repoKey, repoDetail.repoPath)"
                >Pull</button>
              </div>
            </div>

            <div class="info-row">
              <span class="info-label">🔄 latest 同步</span>
              <div class="sync-status">
                <span v-if="repoDetail.latestStatus?.synced" class="sync-badge synced">✓ 已同步</span>
                <template v-else>
                  <span v-if="repoDetail.latestStatus?.behind > 0" class="sync-badge behind">↓ {{ repoDetail.latestStatus.behind }} 落后</span>
                  <span v-if="repoDetail.latestStatus?.ahead > 0" class="sync-badge ahead">↑ {{ repoDetail.latestStatus.ahead }} 领先</span>
                </template>
                <button class="merge-btn" :disabled="!repoDetail.workingTree?.clean" @click="openMergeModal(repoDetail.repoKey, repoDetail.repoPath, repoDetail.repoName)">Merge latest</button>
              </div>
            </div>

            <div class="detail-subtitle">最近提交</div>
            <div v-if="repoDetail.recentCommits.length === 0" class="muted">暂无提交记录</div>
            <div v-else class="commit-list">
              <div v-for="c in repoDetail.recentCommits" :key="c.hash" class="commit-item">
                <span class="commit-hash">{{ (c.hash || '').slice(0, 7) }}</span>
                <span class="commit-message">{{ c.message }}</span>
              </div>
            </div>
          </div>

          <div v-else class="detail-section">
            <div v-if="!githubToken" class="empty-state small">
              <div class="empty-icon">🔑</div>
              <p>请先在设置中配置 GitHub Token</p>
            </div>
            <template v-else>
              <div class="pr-controls">
                <div class="pr-search">
                  <input v-model="repoDetail.prSearch" class="pr-search-input" type="text" placeholder="搜索 PR（标题/分支/作者）..." />
                </div>
                <label class="pr-filter">
                  <input v-model="repoDetail.prOnlyAssignedToMe" type="checkbox" />
                  <span>只看指派给我（Review）</span>
                </label>
                <button class="action-btn" title="刷新 PR" @click="fetchRepoPRs" :disabled="repoDetail.prsLoading">
                  <span class="refresh-icon" :class="{ spinning: repoDetail.prsLoading }">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                      <path d="M3 3v5h5"></path>
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                      <path d="M16 21h5v-5"></path>
                    </svg>
                  </span>
                </button>
              </div>

              <div v-if="repoDetail.prsLoading" class="loading-state">
                <div class="spinner"></div>
                <span>加载 Pull Requests...</span>
              </div>
              <div v-else-if="repoDetail.prsError" class="error-state">
                <span class="error-icon">⚠️</span>
                <span>{{ repoDetail.prsError }}</span>
              </div>
              <div v-else class="pr-list pr-scroll">
                <div v-if="filteredRepoPRs.length === 0" class="empty-state small">
                  <div class="empty-icon">✨</div>
                  <p>没有匹配的 Pull Requests</p>
                </div>
                <div
                  v-for="pr in filteredRepoPRs"
                  :key="pr.id"
                  class="pr-card"
                  :class="{ 'needs-review': pr.needsMyReview, 'is-author': pr.isAuthor, 'is-draft': pr.draft }"
                  @click="openPR(pr.url)"
                >
                  <div class="pr-header">
                    <div class="pr-title-row">
                      <span class="pr-number">#{{ pr.number }}</span>
                      <span class="pr-title">{{ pr.title }}</span>
                    </div>
                    <div class="pr-badges">
                      <span v-if="pr.draft" class="badge draft">Draft</span>
                      <span v-if="pr.needsMyReview" class="badge review-needed">需要 Review</span>
                      <span v-if="pr.isAuthor" class="badge author">我的 PR</span>
                    </div>
                  </div>
                  <div class="pr-info">
                    <div class="branch-flow">
                      <span class="branch base">{{ pr.base }}</span>
                      <span class="arrow">←</span>
                      <span class="branch head">{{ pr.head }}</span>
                    </div>
                    <div class="pr-meta">
                      <div class="author-info">
                        <img v-if="pr.authorAvatar" :src="pr.authorAvatar" :alt="pr.author" class="avatar" />
                        <span class="author-name">{{ pr.author }}</span>
                      </div>
                      <span class="pr-time">{{ formatTime(pr.updatedAt) }}</span>
                    </div>
                  </div>
                  <div v-if="pr.reviewers.length > 0" class="pr-reviewers">
                    <span class="reviewers-label">Reviewers:</span>
                    <div class="reviewer-list">
                      <div v-for="reviewer in pr.reviewers" :key="reviewer.login" class="reviewer" :class="{ 'is-me': reviewer.login === currentGitHubUser }">
                        <img v-if="reviewer.avatar" :src="reviewer.avatar" :alt="reviewer.login" class="avatar" />
                        <span class="reviewer-name">{{ reviewer.login }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
    
    <!-- Merge Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showMergeModal" class="modal-overlay" @click.self="closeMergeModal">
          <div class="modal-container merge-modal">
            <div class="modal-header">
              <h3 class="modal-title-with-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="18" r="3"></circle>
                  <circle cx="6" cy="6" r="3"></circle>
                  <path d="M6 21V9a9 9 0 0 0 9 9"></path>
                </svg>
                <span>Merge Latest</span>
              </h3>
              <button class="close-btn" @click="closeMergeModal">✕</button>
            </div>
            
            <div class="modal-content">
              <div class="merge-info">
                <div class="info-item">
                  <span class="label">仓库</span>
                  <span class="value">{{ mergeTarget.repoName }}</span>
                </div>
                <div class="info-item">
                  <span class="label">源分支</span>
                  <span class="value branch-tag">{{ mergeTarget.sourceBranch }}</span>
                </div>
              </div>
              
              <div class="form-section">
                <label>目标分支</label>
                <div class="merge-branch-picker">
                  <button class="branch-select" type="button" @click="mergeTarget.open = !mergeTarget.open">
                    <span>{{ mergeTarget.targetBranch || '选择目标分支...' }}</span>
                    <span class="chev">▾</span>
                  </button>
                  <div v-if="mergeTarget.open" class="branch-dropdown">
                    <div class="branch-search">
                      <input
                        v-model="mergeTarget.query"
                        class="branch-search-input"
                        type="text"
                        placeholder="搜索目标分支..."
                      />
                    </div>
                    <div class="branch-options">
                      <button
                        v-for="b in (mergeTarget.branches || []).filter(x => !mergeTarget.query || x.toLowerCase().includes(mergeTarget.query.toLowerCase()))"
                        :key="b"
                        class="branch-option"
                        @click="mergeTarget.targetBranch = b; mergeTarget.open = false"
                      >
                        {{ b }}
                      </button>
                      <div v-if="(mergeTarget.branches || []).length === 0" class="branch-empty">暂无分支</div>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Merge 结果 -->
              <div v-if="mergeResult" class="merge-result" :class="{ success: mergeResult.success, error: !mergeResult.success }">
                <span class="result-icon">{{ mergeResult.success ? '✅' : '❌' }}</span>
                <span class="result-message">{{ mergeResult.message }}</span>
              </div>
            </div>
            
            <div class="modal-footer">
              <button class="btn-secondary" @click="closeMergeModal">取消</button>
              <button 
                class="btn-primary"
                @click="executeMerge"
                :disabled="!mergeTarget.targetBranch || merging"
              >
                <span v-if="merging" class="mini-spinner"></span>
                {{ merging ? '合并中...' : '执行 Merge' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    
    <!-- AI Code Review Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCodeReview" class="modal-overlay" @click.self="closeCodeReview">
          <div class="modal-container code-review-modal">
            <div class="modal-header">
              <h3 class="modal-title-with-icon">
                <span class="modal-icon">🔍</span>
                AI Code Review
              </h3>
              <button class="modal-close" @click="closeCodeReview">✕</button>
            </div>
            <div class="modal-body code-review-body">
              <div v-if="codeReviewLoading" class="review-loading">
                <div class="loading-spinner"></div>
                <p>正在分析代码变更...</p>
              </div>
              <div v-else-if="codeReviewError" class="review-error">
                <span class="error-icon">❌</span>
                <p>{{ codeReviewError }}</p>
              </div>
              <div v-else class="review-content" v-html="formatReviewContent(codeReviewResult)"></div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="closeCodeReview">关闭</button>
              <button 
                class="btn-primary" 
                @click="performCodeReview"
                :disabled="codeReviewLoading"
              >
                {{ codeReviewLoading ? '分析中...' : '重新分析' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script>
// 格式化 Code Review 内容（处理 Markdown）
function formatReviewContent(content) {
  if (!content) return ''
  
  return content
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 处理代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // 处理行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 处理标题
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // 处理加粗
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 处理列表
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    // 处理换行
    .replace(/\n/g, '<br>')
}

export default {
  methods: {
    formatReviewContent
  }
}
</script>

<style scoped>
.git-module {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  padding-bottom: 100px;
  overflow-y: auto;
}

/* ============================================
   Header
   ============================================ */
.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--glass-border);
}

.module-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.repo-details-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: transparent;
}

.details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.back-btn {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.details-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.repo-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.details-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 14px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
}

.pr-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
  padding-bottom: 14px;
}

.view-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.view-tab:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.view-tab.active {
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.tab-icon {
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
}

.tab-icon svg {
  display: block;
}

.tab-count {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  background: var(--glass-bg-hover);
  border-radius: 10px;
}

.tab-count.highlight {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.refresh-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.detail-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.detail-tab {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.detail-tab:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.detail-tab.active {
  color: var(--broker-color, var(--accent-primary));
  border-color: var(--broker-color, var(--accent-primary));
  background: var(--broker-color-bg, var(--accent-primary-bg));
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 让 PR 列表区域可滚动到底：父容器必须允许子元素收缩 */
.details-body .detail-section {
  min-height: 0;
}

.detail-subtitle {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.muted {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ============================================
   Repo Grid
   ============================================ */
/* ========================================
   关于我的 PR 汇总区域
   ======================================== */
.my-prs-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.section-icon {
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
}

.section-icon svg {
  display: block;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-count {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-primary-bg);
  color: var(--accent-primary);
}

.refresh-mini {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.15s;
}

.refresh-mini:hover:not(:disabled) {
  background: var(--glass-bg);
}

.refresh-mini:disabled {
  opacity: 0.5;
}

.pr-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 12px;
}

.my-prs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}

.my-pr-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.my-pr-item:hover {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
  transform: translateY(-1px);
}

.my-pr-item.mine {
  border-left: 3px solid #22d3ee;
}

.my-pr-item.reviewer {
  border-left: 3px solid #f59e0b;
}

.my-pr-item.draft {
  opacity: 0.7;
}

.pr-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pr-repo-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--broker-color-bg, rgba(34, 211, 238, 0.15));
  color: var(--broker-color, #22d3ee);
  text-transform: uppercase;
  flex-shrink: 0;
}

.pr-number {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.pr-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pr-branch {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', Monaco, monospace;
}

.pr-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.pr-tag.mine {
  background: rgba(34, 211, 238, 0.15);
  color: #22d3ee;
}

.pr-tag.review {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.pr-tag.draft {
  background: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
}

.repo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
}

.init-loading {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.init-loading-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  color: var(--text-secondary);
}

.init-loading-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--accent-primary);
  box-shadow: 0 0 0 6px var(--accent-primary-bg);
  animation: pulse 1.2s ease-in-out infinite;
}

.init-loading-text {
  font-size: 12px;
  font-weight: 500;
}

.skeleton-grid .repo-card {
  border-left: 4px solid rgba(255, 255, 255, 0.12);
}

.repo-card.skeleton {
  position: relative;
  overflow: hidden;
}

.repo-card.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.06) 45%,
    rgba(255, 255, 255, 0.12) 50%,
    rgba(255, 255, 255, 0.06) 55%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: shimmer 1.4s ease-in-out infinite;
  pointer-events: none;
}

.skeleton-line {
  height: 12px;
  border-radius: 8px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.skeleton-pill {
  opacity: 0.7;
}

.skeleton-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

.skeleton-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--glass-border);
}

.skeleton-row:last-of-type {
  border-bottom: none;
}

.w-120 { width: 120px; }
.w-140 { width: 140px; }
.w-180 { width: 180px; }
.w-200 { width: 200px; }

.skeleton-btn {
  width: 100%;
  height: 36px;
  border-radius: 8px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}

@keyframes shimmer {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50% { transform: scale(1.08); opacity: 1; }
}

.repo-card {
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s;
}

.repo-card {
  /* per-broker accent */
  border-left: 4px solid var(--broker-color, var(--glass-border));
}

.repo-card:hover {
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-glass);
}

.repo-card.has-changes {
  border-color: #f59e0b;
}

.repo-card.error {
  border-color: #ef4444;
}

.repo-card.is-tmgm {
  border-left-width: 6px;
  box-shadow: 0 0 0 1px var(--broker-color-bg) inset;
}

/* Card Header */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
}

.repo-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.broker-badge {
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 700;
  color: var(--broker-color, var(--accent-primary));
  background: var(--broker-color-bg, var(--accent-primary-bg));
  border: 1px solid var(--broker-color, var(--accent-primary));
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.repo-card.is-tmgm .broker-badge {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 800;
  box-shadow: 0 0 0 1px var(--broker-color-bg) inset, 0 10px 24px var(--broker-color-glow);
}

.repo-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}

/* Card Content */
.card-content {
  padding: 16px 20px;
}

.card-loading,
.card-error {
  padding: 32px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.card-error {
  color: #ef4444;
}

.error-icon {
  margin-right: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--glass-border);
}

.info-row:last-of-type {
  border-bottom: none;
}

.info-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.pr-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mini-muted {
  font-size: 11px;
  color: var(--text-tertiary);
}

.pr-chip {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid transparent;
}

.pr-chip.mine {
  color: var(--broker-color, var(--accent-primary));
  background: var(--broker-color-bg, var(--accent-primary-bg));
  border-color: var(--broker-color, var(--accent-primary));
}

.pr-chip.review {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
}

.branch-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  font-family: var(--font-mono);
}

.branch-switch {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.branch-pill:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
}

.branch-pill:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chev {
  font-size: 12px;
  color: var(--text-tertiary);
}

.branch-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: 320px;
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
  z-index: 50;
}

.branch-search {
  padding: 10px;
  border-bottom: 1px solid var(--glass-border);
}

.branch-search-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
}

.branch-search-input:focus {
  border-color: var(--accent-primary);
}

.branch-options {
  max-height: 240px;
  overflow: auto;
}

.branch-option {
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  font-size: 12px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}

.branch-option:hover {
  background: var(--glass-bg-hover);
}

.branch-loading,
.branch-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}

.pull-btn {
  margin-left: 8px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  border: 1px solid var(--accent-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.pull-btn:hover:not(:disabled) {
  filter: brightness(1.05);
}

.pull-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.status-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
}

.status-badge.clean {
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
}

.status-badge.dirty {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}

.sync-status {
  display: flex;
  gap: 8px;
}

.sync-badge {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
}

.sync-badge.synced {
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
}

.sync-badge.behind {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

.sync-badge.ahead {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.15);
}

/* Recent Commits */
.recent-commits {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);
}

.commits-header {
  margin-bottom: 8px;
}

.commit-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.commit-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}

.commit-hash {
  font-family: var(--font-mono);
  color: var(--accent-primary);
  background: var(--accent-primary-bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.commit-message {
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* Card Footer */
.card-footer {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
}

.merge-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.merge-btn:hover:not(:disabled) {
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.merge-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ============================================
   PR List
   ============================================ */
.pr-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 24px;
  padding: 16px 20px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}

.pr-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.pr-search {
  flex: 1;
}

.pr-search-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
}

.pr-search-input:focus {
  border-color: var(--accent-primary);
}

.pr-filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.pr-filter input {
  accent-color: var(--accent-primary);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-item.highlight .stat-value {
  color: #ef4444;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.pr-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pr-card {
  padding: 16px 20px;
  background: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.pr-card:hover {
  border-color: var(--accent-primary);
  background: var(--glass-bg-hover);
}

.pr-card.needs-review {
  border-left: 3px solid #ef4444;
}

.pr-card.is-author {
  border-left: 3px solid #3b82f6;
}

.pr-card.is-draft {
  opacity: 0.7;
}

.pr-header {
  margin-bottom: 12px;
}

.pr-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.pr-number {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  font-family: var(--font-mono);
}

.pr-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.pr-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge {
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.badge.draft {
  color: #6b7280;
  background: rgba(107, 114, 128, 0.15);
}

.badge.review-needed {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

.badge.author {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.15);
}

.badge.repo {
  color: var(--text-secondary);
  background: var(--glass-bg);
}

.pr-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.branch-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.branch {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--glass-bg);
}

.branch.base {
  color: #10b981;
}

.branch.head {
  color: var(--accent-primary);
}

.arrow {
  color: var(--text-tertiary);
}

.pr-meta {
  display: flex;
  align-items: center;
  gap: 16px;
}

.author-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.author-name {
  font-size: 12px;
  color: var(--text-secondary);
}

.pr-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.pr-reviewers {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);
}

.reviewers-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.reviewer-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.reviewer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--glass-bg);
  border-radius: 16px;
  font-size: 11px;
}

.reviewer.is-me {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.reviewer .avatar {
  width: 18px;
  height: 18px;
}

.reviewer-name {
  color: var(--text-secondary);
}

.reviewer.is-me .reviewer-name {
  color: #ef4444;
  font-weight: 600;
}

/* ============================================
   Empty & Loading States
   ============================================ */
.empty-state,
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-state.small {
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

.refresh-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: color 0.2s;
}

.refresh-icon svg {
  display: block;
}

.refresh-btn:hover:not(:disabled) .refresh-icon,
.refresh-mini:hover:not(:disabled) .refresh-icon,
.action-btn:hover:not(:disabled) .refresh-icon {
  color: var(--accent-primary);
}

/* ============================================
   Modal
   ============================================ */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 90%;
  max-width: 480px;
  background: var(--modal-bg);
  border: 1px solid var(--modal-border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal-title-with-icon {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title-with-icon svg {
  color: var(--accent-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.modal-content {
  padding: 24px;
}

.merge-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--glass-bg);
  border-radius: 10px;
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.info-item .label {
  font-size: 12px;
  color: var(--text-secondary);
}

.info-item .value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.branch-tag {
  padding: 4px 10px;
  background: var(--accent-primary-bg);
  color: var(--accent-primary);
  border-radius: 6px;
  font-family: var(--font-mono);
}

.form-section {
  margin-bottom: 20px;
}

.form-section label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.branch-select {
  width: 100%;
  padding: 12px 16px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
}

.branch-select:focus {
  border-color: var(--accent-primary);
}

.merge-branch-picker {
  position: relative;
}

.merge-result {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 13px;
}

.merge-result.success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.merge-result.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid var(--glass-border);
}

.btn-secondary,
.btn-primary {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
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

.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  color: white;
  background: var(--accent-primary);
  border: none;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.95);
}

/* ============================================
   AI Code Review
   ============================================ */
.ai-review-btn {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent-secondary);
  background: var(--accent-secondary-glow);
  border: 1px solid var(--accent-secondary);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  margin-left: auto;
}

.ai-review-btn:hover:not(:disabled) {
  background: var(--accent-secondary);
  color: white;
}

.ai-review-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.code-review-modal {
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.code-review-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  max-height: 60vh;
}

.review-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 16px;
}

.review-loading p {
  color: var(--text-secondary);
  font-size: 14px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.review-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}

.review-error .error-icon {
  font-size: 32px;
}

.review-error p {
  color: var(--error);
  font-size: 14px;
}

.review-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
}

.review-content :deep(h2),
.review-content :deep(h3),
.review-content :deep(h4) {
  margin: 16px 0 8px 0;
  color: var(--text-primary);
  font-weight: 600;
}

.review-content :deep(h2) {
  font-size: 18px;
}

.review-content :deep(h3) {
  font-size: 16px;
}

.review-content :deep(h4) {
  font-size: 14px;
}

.review-content :deep(strong) {
  color: var(--accent-primary);
  font-weight: 600;
}

.review-content :deep(code) {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 2px 6px;
  background: var(--glass-bg-hover);
  border-radius: 4px;
  color: var(--accent-secondary);
}

.review-content :deep(pre) {
  margin: 12px 0;
  padding: 12px;
  background: var(--bg-gradient-start);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  overflow-x: auto;
}

.review-content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: var(--text-primary);
}

.review-content :deep(li) {
  margin: 4px 0;
  padding-left: 8px;
}
</style>
