<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// Tab 状态
const activeTab = ref('ai')
const tabs = [
  { id: 'ai', label: 'AI资讯', icon: '🤖' },
  { id: 'github', label: 'GitHub', icon: '🐙' }
]

// 加载状态
const loading = ref({ github: false, ai: false })
const error = ref({ github: '', ai: '' })

// GitHub Trending 数据
const trendingRepos = ref([])
const selectedPeriod = ref('daily')
const periods = [
  { id: 'daily', label: 'Today' },
  { id: 'weekly', label: 'This week' },
  { id: 'monthly', label: 'This month' }
]

// AI 资讯数据
const aiNews = ref([])
const allAiNews = ref([]) // 存储所有获取到的新闻
const aiCurrentPage = ref(1)
const aiPageSize = 15
const aiHasMore = computed(() => aiCurrentPage.value * aiPageSize < allAiNews.value.length)

// 中文/技术向 AI 资讯来源（优先直连 RSS，避免 RSSHub 不稳定/被限流；必要时再 fallback RSSHub）
// 每个来源可以配置多个候选 URL，按顺序尝试，成功一个就用。
const aiSources = [
  {
    name: 'InfoQ',
    icon: '📡',
    color: '#10b981',
    urls: [
      // InfoQ 中文（较稳定）
      'https://www.infoq.cn/feed',
      // InfoQ 英文 articles（兜底）
      'https://www.infoq.com/RSS/articles/'
    ],
    // 只保留 AI 相关条目（避免全站内容太杂）
    keywords: ['ai', '人工智能', '大模型', 'llm', 'agent', '模型', 'deepseek', 'gpt', 'claude']
  },
  {
    name: '36氪',
    icon: '🔷',
    color: '#3b82f6',
    urls: [
      'https://www.36kr.com/feed'
    ],
    keywords: ['ai', '人工智能', '大模型', 'llm', 'agent', '模型', 'deepseek', 'gpt', 'claude']
  },
  {
    name: '机器之心',
    icon: '🤖',
    color: '#6366f1',
    urls: [
      // 有些站点会暴露 /rss 或 /feed，尝试常见路径
      'https://www.jiqizhixin.com/rss',
      'https://www.jiqizhixin.com/feed',
      // fallback：RSSHub（如可用）
      'https://rsshub.app/jiqizhixin'
    ],
    keywords: ['ai', '人工智能', '大模型', 'llm', 'agent', '模型', '深度学习', '推理', '多模态']
  },
  {
    name: '量子位',
    icon: '⚛️',
    color: '#06b6d4',
    urls: [
      // RSSHub 分类路由（更可能可用）
      'https://rsshub.app/qbitai/category/资讯',
      // 常见直连尝试（若网站提供）
      'https://www.qbitai.com/feed',
      'https://www.qbitai.com/rss'
    ],
    keywords: ['ai', '人工智能', '大模型', 'llm', 'agent', '模型', 'deepseek', 'gpt', 'claude']
  }
]

/**
 * 获取 GitHub Trending
 */
const fetchGitHubTrending = async () => {
  loading.value.github = true
  error.value.github = ''
  
  try {
    const url = `https://api.gitterapp.com/repositories?since=${selectedPeriod.value}&language=&spoken_language_code=`
    const result = await invoke('fetch_rss_feed', { url })

    if (result.status === 200) {
      const data = JSON.parse(result.body || '[]')
      trendingRepos.value = (data || []).slice(0, 15).map(repo => ({
        name: `${repo.author}/${repo.name}`,
        description: repo.description || '',
        language: repo.language || '',
        languageColor: repo.languageColor || '#8b949e',
        stars: repo.stars || 0,
        starsToday: repo.currentPeriodStars || 0,
        forks: repo.forks || 0,
        url: repo.url || `https://github.com/${repo.author}/${repo.name}`
      }))
    } else {
      trendingRepos.value = getStaticTrendingData()
    }
  } catch (e) {
    console.error('GitHub trending fetch error:', e)
    trendingRepos.value = getStaticTrendingData()
  } finally {
    loading.value.github = false
  }
}

// 静态备用数据
const getStaticTrendingData = () => [
  { name: 'anthropics/claude-code', description: 'Claude coding assistant SDK', language: 'Python', languageColor: '#3572A5', stars: 12300, starsToday: 567, forks: 890 },
  { name: 'openai/openai-python', description: 'OpenAI Python API library', language: 'Python', languageColor: '#3572A5', stars: 18500, starsToday: 234, forks: 2100 },
  { name: 'tauri-apps/tauri', description: 'Build smaller, faster desktop apps', language: 'Rust', languageColor: '#dea584', stars: 82400, starsToday: 156, forks: 2500 },
  { name: 'vuejs/core', description: 'Vue.js 3 core', language: 'TypeScript', languageColor: '#3178c6', stars: 45000, starsToday: 89, forks: 7800 },
  { name: 'microsoft/vscode', description: 'Visual Studio Code', language: 'TypeScript', languageColor: '#3178c6', stars: 162000, starsToday: 78, forks: 28500 }
]

// 尝试从多个候选 URL 获取 RSS/XML（通过 Rust 侧 fetch，避免 CORS）
const fetchFromCandidates = async (urls) => {
  for (const url of (urls || [])) {
    try {
      const result = await invoke('fetch_rss_feed', { url })
      if (result.status === 200 && result.body) return result.body
    } catch (e) {
      // ignore and try next
    }
  }
  return null
}

// 解析 RSS/Atom XML
const parseRSSItems = (xmlString, sourceName, sourceIcon, sourceColor) => {
  const items = []
  try {
    const parser = new DOMParser()
    const xml = parser.parseFromString(xmlString, 'text/xml')
    // RSS 2.0 uses <item>, Atom uses <entry>
    const nodes = xml.querySelectorAll('item, entry')
    
    nodes.forEach((node) => {
      const title = node.querySelector('title')?.textContent?.trim() || ''
      // Atom: <link href="..."/> ; RSS: <link>...</link>
      const linkEl = node.querySelector('link')
      const link = (linkEl?.getAttribute?.('href') || linkEl?.textContent || '').trim()
      const description =
        node.querySelector('description')?.textContent?.trim() ||
        node.querySelector('summary')?.textContent?.trim() ||
        node.querySelector('content')?.textContent?.trim() ||
        ''
      const pubDate =
        node.querySelector('pubDate')?.textContent ||
        node.querySelector('updated')?.textContent ||
        node.querySelector('published')?.textContent ||
        ''
      
      // 清理 HTML 标签
      const cleanDesc = description
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
        .slice(0, 150)
      
      if (title) {
        items.push({
          id: `${sourceName}-${link || title}-${pubDate || ''}`.slice(0, 200),
          title,
          description: cleanDesc,
          link,
          source: sourceName,
          sourceIcon,
          sourceColor,
          time: formatRSSDate(pubDate),
          pubDate: new Date(pubDate || Date.now())
        })
      }
    })
  } catch (e) {
    console.error('RSS parse error:', e)
  }
  return items
}

// 获取 AI 资讯 (合并多个来源)
const fetchAINews = async () => {
  loading.value.ai = true
  error.value.ai = ''
  allAiNews.value = []
  aiCurrentPage.value = 1
  
  try {
    const PER_SOURCE_LIMIT = 12

    // 并行获取所有来源（每个源独立容错）
    const fetchPromises = aiSources.map(async (source) => {
      const xmlContent = await fetchFromCandidates(source.urls)
      if (!xmlContent) return []

      let items = parseRSSItems(xmlContent, source.name, source.icon, source.color)

      // 可选：按关键词过滤（避免全站内容太杂）
      const kws = (source.keywords || []).map(k => k.toLowerCase())
      if (kws.length > 0) {
        items = items.filter(it => {
          const hay = `${it.title} ${it.description}`.toLowerCase()
          return kws.some(k => hay.includes(k))
        })
      }

      // 每个来源最多取 N 条，保证混合效果
      return items.slice(0, PER_SOURCE_LIMIT)
    })
    
    const results = await Promise.all(fetchPromises)
    
    // 合并所有来源
    const allItems = results.flat()
    
    // 去重 (根据标题)
    const seen = new Set()
    const uniqueItems = allItems.filter(item => {
      const key = item.title.toLowerCase().slice(0, 50)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    
    // 随机打乱顺序 (Fisher-Yates shuffle)
    for (let i = uniqueItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueItems[i], uniqueItems[j]] = [uniqueItems[j], uniqueItems[i]]
    }
    
    allAiNews.value = uniqueItems
    
    // 更新当前页显示
    updateAiNewsPage()
    
    if (allAiNews.value.length === 0) {
      aiNews.value = getStaticAINews()
    }
  } catch (e) {
    console.error('AI news fetch error:', e)
    aiNews.value = getStaticAINews()
  } finally {
    loading.value.ai = false
  }
}

// 更新当前页显示的新闻
const updateAiNewsPage = () => {
  const start = 0
  const end = aiCurrentPage.value * aiPageSize
  aiNews.value = allAiNews.value.slice(start, end)
}

// 加载更多
const loadMoreAiNews = () => {
  if (aiHasMore.value) {
    aiCurrentPage.value++
    updateAiNewsPage()
  }
}

// 静态 AI 资讯备用数据 (随机返回)
const getStaticAINews = () => {
  const items = [
    { id: 1, title: 'Claude 3.5 Sonnet 在多项基准测试中刷新记录', description: 'Anthropic 发布的最新模型在代码生成、数学推理等任务上表现优异，超越 GPT-4。', link: '#', source: '机器之心', sourceIcon: '🤖', sourceColor: '#6366f1', time: '2小时前' },
    { id: 2, title: 'OpenAI 发布 GPT-4o 多模态升级版本', description: '新版本支持更流畅的语音对话和图像理解，响应速度提升50%。', link: '#', source: '量子位', sourceIcon: '⚛️', sourceColor: '#06b6d4', time: '4小时前' },
    { id: 3, title: '国产大模型 DeepSeek 开源，性能对标 Llama 3', description: '深度求索发布开源大模型，在中文理解和代码能力上表现出色。', link: '#', source: '36氪 AI', sourceIcon: '🔷', sourceColor: '#3b82f6', time: '6小时前' },
    { id: 4, title: 'AI 编程助手市场格局：Cursor、Copilot 对比分析', description: '各大 AI 编程工具的功能特点、适用场景和定价策略深度对比。', link: '#', source: '机器之心', sourceIcon: '🤖', sourceColor: '#6366f1', time: '8小时前' },
    { id: 5, title: 'Anthropic 获得亚马逊追加 40 亿美元投资', description: '这笔投资将用于扩大计算资源和加速下一代模型的研发。', link: '#', source: '36氪 AI', sourceIcon: '🔷', sourceColor: '#3b82f6', time: '12小时前' },
    { id: 6, title: 'Sora 视频生成模型正式开放公测', description: 'OpenAI 视频生成模型向部分用户开放，支持生成最长60秒的高质量视频。', link: '#', source: '量子位', sourceIcon: '⚛️', sourceColor: '#06b6d4', time: '3小时前' },
    { id: 7, title: 'Meta 发布 Llama 3.2 多模态版本', description: '新版本支持图像理解和视觉推理，开源社区迎来重大升级。', link: '#', source: '机器之心', sourceIcon: '🤖', sourceColor: '#6366f1', time: '5小时前' },
    { id: 8, title: 'AI Agent 创业热潮：多家初创获亿元融资', description: '自主智能体赛道持续火热，投资机构看好 AI Agent 长期价值。', link: '#', source: '36氪 AI', sourceIcon: '🔷', sourceColor: '#3b82f6', time: '7小时前' }
  ]
  // 随机打乱
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

// 格式化 RSS 日期
const formatRSSDate = (dateStr) => {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now - date
    
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${Math.floor(diff / 86400000)} 天前`
  } catch {
    return dateStr
  }
}

// 格式化星数
const formatStars = (num) => {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num
}

// 打开链接
const openLink = (url) => {
  invoke('open_url_raw', { url })
}

// 刷新数据
const refresh = () => {
  if (activeTab.value === 'github') {
    fetchGitHubTrending()
  } else {
    fetchAINews()
  }
}

onMounted(() => {
  fetchAINews()
  setTimeout(() => fetchGitHubTrending(), 0)
})
</script>

<template>
  <div class="panel hot-topics-panel">
    <div class="panel-header">
      <div class="panel-title">
        <span class="panel-icon">🔥</span>
        <span>今日热点</span>
      </div>
      <button class="panel-action" title="刷新" @click="refresh" :disabled="loading.github || loading.ai">
        <span :class="{ spinning: loading.github || loading.ai }">🔄</span>
      </button>
    </div>
    
    <div class="panel-content">
      <!-- Tab 切换 -->
      <div class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </div>
      
      <!-- GitHub 智能混合 Feed -->
      <template v-if="activeTab === 'github'">
        <div class="feed-hint">
          <span class="hint-text">🎯 智能推荐：热门趋势 + 新兴之星 + 话题精选</span>
        </div>
        
        <div v-if="loading.github" class="loading-state">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        
        <div v-else class="repo-list">
          <div
            v-for="repo in mixedFeed"
            :key="repo.name"
            class="repo-card"
            @click="openLink(repo.url)"
          >
            <div class="repo-tag-wrapper">
              <span 
                class="repo-tag" 
                :class="repo.tag"
                :style="{ background: TAG_TYPES[repo.tag]?.color + '20', color: TAG_TYPES[repo.tag]?.color }"
              >
                {{ TAG_TYPES[repo.tag]?.icon }} {{ TAG_TYPES[repo.tag]?.label }}
                <span v-if="repo.tag === 'topic' && repo.topicLang" class="tag-lang">· {{ repo.topicLang }}</span>
              </span>
            </div>
            <div class="repo-content">
              <div class="repo-name">{{ repo.name }}</div>
              <div class="repo-desc">{{ repo.description }}</div>
              <div class="repo-meta">
                <span class="repo-language">
                  <span class="lang-dot" :style="{ background: repo.languageColor }"></span>
                  {{ repo.language }}
                </span>
                <span class="repo-stars">⭐ {{ formatStars(repo.stars) }}</span>
                <span class="repo-stars-today">+{{ repo.starsToday }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      
      <!-- AI 资讯 -->
      <template v-else>
        <div v-if="loading.ai" class="loading-state">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        
        <div v-else class="news-list">
          <div
            v-for="news in aiNews"
            :key="news.id"
            class="news-card"
            @click="openLink(news.link)"
          >
            <div class="news-header">
              <div class="news-source">
                <span class="source-icon" :style="{ color: news.sourceColor }">{{ news.sourceIcon }}</span>
                <span class="source-name">{{ news.source }}</span>
              </div>
              <span class="news-time">{{ news.time }}</span>
            </div>
            <div class="news-title">{{ news.title }}</div>
            <div v-if="news.description" class="news-desc">{{ news.description }}</div>
          </div>
          
          <!-- 加载更多 -->
          <button 
            v-if="aiHasMore" 
            class="load-more-btn"
            @click="loadMoreAiNews"
          >
            加载更多 ({{ allAiNews.length - aiNews.length }} 条)
          </button>
        </div>
      </template>
    </div>
    
    <div class="panel-footer">
      <span class="footer-text">
        {{ activeTab === 'github' ? `GitHub 发现 (${mixedFeed.length})` : `AI 热门资讯 (${aiNews.length}/${allAiNews.length})` }}
      </span>
      <span class="update-time">刚刚更新</span>
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
  font-size: 14px;
  transition: all 0.2s ease;
}

.panel-action:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Tab Bar */
.tab-bar {
  display: flex;
  gap: 6px;
  padding: 4px;
  margin-bottom: 14px;
  background: var(--glass-bg);
  border-radius: 10px;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-secondary);
}

.tab-btn.active {
  background: var(--accent-glow);
  color: var(--accent-primary);
}

.tab-icon {
  font-size: 14px;
}

/* Feed Hint */
.feed-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  margin-bottom: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
}

.hint-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* Repo Tag */
.repo-tag-wrapper {
  margin-bottom: 8px;
}

.repo-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
}

.repo-tag.trending {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.repo-tag.rising {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.repo-tag.topic {
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
}

.tag-lang {
  font-weight: 400;
  opacity: 0.8;
  text-transform: capitalize;
}

/* Loading */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--glass-border);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Repo List */
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.repo-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.repo-card:hover {
  background: var(--glass-bg-hover);
  border-color: var(--accent-secondary);
}

.repo-content {
  flex: 1;
  min-width: 0;
}

.repo-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-secondary-light);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.repo-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.repo-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.repo-language {
  display: flex;
  align-items: center;
  gap: 4px;
}

.lang-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.repo-stars-today {
  color: var(--success);
}

/* News List */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.news-card {
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.news-card:hover {
  background: var(--glass-bg-hover);
  border-color: var(--accent-primary);
}

.news-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.news-source {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.source-icon {
  font-size: 14px;
}

.source-name {
  color: var(--text-tertiary);
}

.news-time {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.news-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 6px;
}

.news-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.load-more-btn {
  width: 100%;
  padding: 12px;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-primary);
  background: var(--glass-bg);
  border: 1px dashed var(--glass-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.load-more-btn:hover {
  background: var(--accent-primary-bg);
  border-color: var(--accent-primary);
  border-style: solid;
}

/* Footer */
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

.update-time {
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
