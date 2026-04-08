# RSS 精选 Tab 设计

日期：2026-02-03

## 目标
在“今日热点”面板中新增 **RSS精选** Tab（顺序：RSS精选 | AI资讯 | GitHub周榜），基于给定 OPML/Gist 的前 50 个源获取文章，呈现优质文章 RSS 订阅列表，点击即可打开原文。

## 数据来源
- 来源：HN popular blogs OPML（前 50 个源）。
- 每个源最多取 2 篇文章，汇总后去重并按发布时间倒序。

## 功能范围
- 新增 `rss` Tab 及状态管理：加载/错误/分页。
- 批量并发抓取：按批次（8 个源/批）并发，降低峰值请求压力。
- 展示样式沿用“AI资讯”卡片样式，显示来源、时间、标题、摘要。
- “加载更多”分页（每页 20 条）。
- 若所有源失败，展示空态提示（不使用虚假静态数据）。

## 组件与数据流
- 组件：`src/components/dashboard/HotTopicsPanel.vue`
- 主要状态：
  - `rssSources`：前 50 源列表（name + url + site）
  - `allRssNews / rssNews`：完整列表与分页列表
  - `rssCurrentPage / rssPageSize / rssHasMore`
  - `loading.rss / error.rss`
- 复用函数：`fetchFromCandidates`、`parseRSSItems`、`formatRSSDate`。
- 新增函数：`fetchRssNews`、`updateRssNewsPage`、`loadMoreRssNews`。

## 交互与错误处理
- 进入 RSS Tab 或点击刷新时拉取。
- 单源失败不影响整体；全部失败显示“暂无内容或源不可用”。
- 去重策略：`link || title`。

## 非目标
- 不做用户自定义源编辑、缓存策略或后台定时刷新。

## 验收标准
- Tab 顺序正确且可切换。
- RSS 精选可以加载并展示文章（每源 2 篇）。
- 点击条目能打开原文链接。
- 加载/失败状态显示合理。
