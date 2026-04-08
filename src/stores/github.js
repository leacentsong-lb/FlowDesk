import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from './settings'

export const useGithubStore = defineStore('github', () => {
  const currentUser = ref('')
  const prTodos = ref([])
  const prLoading = ref(false)
  const prError = ref('')

  const normalize = (s) => (s || '').toString().trim().toLowerCase()

  async function fetchCurrentUser() {
    const settings = useSettingsStore()
    if (!settings.githubToken) return ''
    try {
      const result = await invoke('github_get_current_user', { token: settings.githubToken })
      if (result.status === 200) {
        const user = JSON.parse(result.body || '{}')
        currentUser.value = user.login || ''
        return currentUser.value
      }
    } catch { /* ignore */ }
    return ''
  }

  function parseOwnerRepo(remoteInfo) {
    const normalized = (remoteInfo || '').trim().replace(/\.git$/i, '')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1] }
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now - date
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
    return date.toLocaleDateString('zh-CN')
  }

  /**
   * 获取所有配置仓库中与当前用户相关的 PR
   */
  async function fetchPrTodos() {
    const settings = useSettingsStore()
    prLoading.value = true
    prError.value = ''
    prTodos.value = []

    if (!settings.githubToken) {
      prLoading.value = false
      prError.value = '请先在设置中配置 GitHub Token'
      return
    }

    try {
      if (!currentUser.value) {
        await fetchCurrentUser()
      }
      const myLogin = normalize(currentUser.value)
      if (!myLogin) {
        prError.value = '无法获取当前 GitHub 用户信息'
        prLoading.value = false
        return
      }

      const entries = Object.entries(settings.brokerPaths || {})
      if (entries.length === 0) {
        prLoading.value = false
        prError.value = '未配置项目仓库（请在设置中配置 broker paths）'
        return
      }

      const CONCURRENCY = 4
      let idx = 0
      const collected = []

      const worker = async () => {
        while (idx < entries.length) {
          const cur = entries[idx++]
          if (!cur) return
          const [, path] = cur
          try {
            const remoteInfo = await invoke('git_get_remote_info', { projectPath: path }).catch(() => '')
            const parsed = parseOwnerRepo(remoteInfo)
            if (!parsed) continue
            const { owner, repo } = parsed

            const res = await invoke('github_list_open_prs', { owner, repo, token: settings.githubToken })
            if (res.status !== 200) continue
            const prs = JSON.parse(res.body || '[]') || []

            const relevant = prs.filter(pr => {
              const author = normalize(pr.user?.login)
              if (author === myLogin) return true
              const reviewers = (pr.requested_reviewers || []).map(r => normalize(r.login))
              return reviewers.includes(myLogin)
            })

            relevant.forEach(pr => {
              const number = pr.number
              const title = pr.title || ''
              const base = pr.base?.ref || ''
              const head = pr.head?.ref || ''
              const updatedAt = pr.updated_at || pr.created_at || ''
              collected.push({
                id: `${owner}/${repo}#${number}`,
                title: `[#${number}] ${title}`,
                description: `${owner}/${repo}: ${base} ← ${head} · 更新于 ${formatTime(updatedAt)}`,
                url: pr.html_url || ''
              })
            })
          } catch { /* ignore single repo failure */ }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()))
      prTodos.value = collected
    } catch (e) {
      prError.value = `获取 PR 待办失败: ${e?.message || e}`
    } finally {
      prLoading.value = false
    }
  }

  function reset() {
    currentUser.value = ''
    prTodos.value = []
    prError.value = ''
  }

  return {
    currentUser,
    prTodos,
    prLoading,
    prError,
    fetchCurrentUser,
    fetchPrTodos,
    reset
  }
})
