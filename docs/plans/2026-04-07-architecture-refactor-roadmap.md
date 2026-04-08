# FlowDesk 架构重构与改进路线

> 版本：2026-04-07
> 基于第一性原理分析的落地实施计划
> 目标：让 FlowDesk 从"可用的原型"进化为"可维护、可扩展的高效桌面产品"

---

## 0. 现状概览

| 指标 | 当前值 | 目标 |
|---|---|---|
| 最大单组件行数 | 3023 行 (`GitModule.vue`) | < 500 行 |
| Rust 后端文件数 | 1 (`main.rs`, 1652 行) | 8+ 模块 |
| 状态管理方案 | localStorage + CustomEvent | Pinia Store |
| 重复数据请求 | Jira × 2, PR × 2 | 每类数据单一来源 |
| 死代码 | ~6 处 | 0 |
| 已知运行时 Bug | 1 (`showRepoDetailsModal`) | 0 |
| 测试覆盖 | 0 | 关键路径覆盖 |

---

## Phase 0：紧急修复（预计 0.5 天）

> 不涉及架构变更，纯修复。

### TODO-001：修复 GitModule `showRepoDetailsModal` 运行时 Bug

- **文件**：`src/components/dev/GitModule.vue`
- **问题**：代码中引用了 `showRepoDetailsModal.value`，但只定义了 `showRepoDetailsPage`，导致运行时报错
- **修复**：将 `showRepoDetailsModal` 替换为 `showRepoDetailsPage`（或确认原意后统一命名）
- **验收**：点击仓库详情按钮不再报错，功能正常

### TODO-002：移除 `main.rs` 中的 `println!` 调试日志

- **文件**：`src-tauri/src/main.rs`
- **问题**：`call_openai_compatible` 函数中大量 `println!`，包括打印 API Key 前 10 字符（安全风险）
- **修复**：删除所有 `println!` 调试输出；如需保留日志，改用 `log` / `tracing` crate 并设置级别
- **验收**：运行时终端无调试输出；API Key 不再泄露

### TODO-003：移除未使用的导入和特性

- **文件与内容**：
  - `src/main.js`：删除未使用的 `import { h }`
  - `src-tauri/Cargo.toml`：移除 `reqwest` 的 `blocking` feature（代码全部使用 async）
  - `src-tauri/Cargo.toml`：确认 `tauri-plugin-shell` 是否有用，若 Rust 端全部用 `std::process::Command` 则考虑移除
- **验收**：编译通过，无 warning

---

## Phase 1：引入状态管理层（预计 2 天）

> 最高 ROI 的改进。解决数据重复请求、组件间状态不同步的根本问题。

### TODO-010：安装 Pinia 并建立 Store 骨架

- **操作**：`npm install pinia`
- **新建文件**：

```
src/stores/
├── index.js          # createPinia() 并导出
├── jira.js           # Jira 配置 + 任务数据
├── git.js            # Git 仓库状态 + 分支数据
├── github.js         # GitHub Token + PR 数据
├── ai.js             # AI 配置 + 聊天历史
├── settings.js       # Broker 路径、全局设置
└── app.js            # 视图状态、主题、UI 状态
```

- **修改**：`src/main.js` 中 `app.use(pinia)`
- **验收**：Pinia DevTools 可正常显示 Store

### TODO-011：迁移 Jira 数据到 `stores/jira.js`

- **目标**：统一 Jira 配置读写 + 任务数据获取，消除三处重复
- **当前冗余**：
  - `App.vue`：Jira 配置读取/保存/校验
  - `JiraPanel.vue`：Jira 配置读取 + `jira_get_my_issues` 调用 + customfield 日期解析
  - `TodoListPanel.vue`：Jira 配置读取 + `jira_get_my_issues` 调用 + customfield 日期解析（完全重复）
- **Store 设计**：

```javascript
// stores/jira.js
export const useJiraStore = defineStore('jira', () => {
  // State
  const config = ref({ host: '', email: '', token: '', projectKey: '' })
  const issues = ref([])
  const loading = ref(false)

  // Getters
  const isConfigured = computed(() => ...)
  const groupedByStatus = computed(() => ...)
  const upcomingDeadlines = computed(() => ...)  // TodoListPanel 需要的

  // Actions
  function loadConfig() { /* 从 localStorage 读取，单一来源 */ }
  function saveConfig(newConfig) { /* 写 localStorage + 更新 ref */ }
  async function fetchMyIssues() { /* 唯一的 API 调用点 */ }
  function parseDueDate(issue) { /* 统一的 customfield 解析 */ }
})
```

- **迁移步骤**：
  1. 创建 `stores/jira.js`，从 `JiraPanel.vue` 提取逻辑
  2. `JiraPanel.vue` 改用 `useJiraStore()`
  3. `TodoListPanel.vue` 删除重复的 Jira 逻辑，改用 `useJiraStore()`
  4. `App.vue` 删除 Jira 配置管理逻辑，改用 `useJiraStore()`
- **验收**：
  - Jira 面板功能不变
  - TodoListPanel 中的 Jira 截止提醒功能不变
  - 两个组件共享同一份数据，不再重复请求
  - 设置抽屉中修改 Jira 配置后，两个面板自动响应更新

### TODO-012：迁移 GitHub 数据到 `stores/github.js`

- **目标**：统一 GitHub Token 管理 + PR 数据获取
- **当前冗余**：
  - `App.vue`：GitHub Token 读取/保存
  - `TodoListPanel.vue`：独立调用 `github_list_open_prs`
  - `GitModule.vue`：独立调用 `github_list_open_prs`（带 60s 缓存）
- **Store 设计**：

```javascript
// stores/github.js
export const useGithubStore = defineStore('github', () => {
  const token = ref('')
  const currentUser = ref(null)
  const openPRs = ref(new Map())  // key: owner/repo
  const prLastFetch = ref(new Map())  // 缓存时间戳

  async function fetchOpenPRs(repoPath, force = false) {
    // 统一缓存策略，避免重复请求
  }
})
```

- **迁移步骤**：同 TODO-011 模式
- **验收**：PR 数据单一来源，TodoListPanel 和 GitModule 展示一致

### TODO-013：迁移全局设置到 `stores/settings.js`

- **目标**：从 `App.vue` 中剥离 Broker 路径、AI 配置等全局设置
- **包含内容**：
  - Broker 项目路径映射（当前在 `App.vue` 中约 50 行逻辑）
  - AI 配置（当前通过 `AIConfigManager` 静态类管理，重构为 Store）
  - 主题偏好（当前在 `config.js`）
- **验收**：`App.vue` 中不再有配置相关的业务逻辑

---

## Phase 2：拆分巨型组件（预计 3 天）

> 解决 God Component 问题，每个组件单一职责。

### TODO-020：从 `App.vue` 提取 SettingsDrawer 组件

- **当前**：`App.vue` 1698 行，其中设置抽屉（4 个 Tab + 所有表单）占约 600 行模板 + 400 行逻辑
- **新建**：`src/components/settings/SettingsDrawer.vue`
- **子组件**：
  - `SettingsProjectTab.vue` — Broker 路径配置
  - `SettingsJiraTab.vue` — Jira 连接配置
  - `SettingsGithubTab.vue` — GitHub Token 配置
  - `SettingsAITab.vue` — AI 提供商/模型配置
- **目标**：`App.vue` 降至 < 400 行
- **验收**：设置功能完全不变，`App.vue` 只包含布局、视图切换、全局快捷键

### TODO-021：拆分 `GitModule.vue`（3023 行 → 5+ 组件）

- **新建**：

```
src/components/dev/git/
├── GitModule.vue           # 容器组件，< 200 行
├── RepoList.vue            # 仓库列表 + 状态概览
├── RepoDetail.vue          # 单仓库详情（分支、提交、工作区状态）
├── PRManager.vue           # PR 列表 + PR 摘要
├── MergeModal.vue          # Merge 弹窗 + 冲突处理
└── AICodeReview.vue         # AI 代码审查面板
```

- **数据流**：`GitModule` 作为容器，通过 `useGitStore()` 驱动子组件
- **验收**：所有 Git 功能不变，每个子组件 < 500 行

### TODO-022：拆分 `JiraPanel.vue`（1748 行 → 3+ 组件）

- **新建**：

```
src/components/dashboard/jira/
├── JiraPanel.vue           # 容器，< 200 行
├── JiraIssueList.vue       # 任务列表 + 筛选
├── JiraIssueCard.vue       # 单条任务卡片
└── SubmitTestModal.vue     # 提测弹窗 + Webhook
```

- **验收**：Jira 功能不变

### TODO-023：拆分 `HotTopicsPanel.vue`（1537 行 → 3+ 组件）

- **新建**：

```
src/components/dashboard/topics/
├── HotTopicsPanel.vue      # Tab 容器，< 100 行
├── RSSFeedTab.vue          # RSS 精选
├── AINewsTab.vue           # AI 资讯
└── GitHubTrendingTab.vue   # GitHub 周榜
```

- **验收**：三个 Tab 功能不变

### TODO-024：统一 `<script setup>` 写法，移除 Options API 混用

- **文件**：`GitModule.vue`、`AIChatWindow.vue`
- **问题**：两个文件同时有 `<script setup>` 和 `<script>`（Options API），仅为了 `methods` 中的格式化函数
- **修复**：将 `formatReviewContent` / `formatMessageContent` 移入 `<script setup>` 作为普通函数
- **验收**：每个 `.vue` 文件只有一个 `<script>` 块

---

## Phase 3：提取公共逻辑（预计 2 天）

> 消除重复代码，建立 composable 和 utility 层。

### TODO-030：提取 Tauri invoke 封装层

- **新建**：`src/services/tauri-commands.js`
- **内容**：对所有 `invoke()` 调用做统一封装，包含错误处理、类型约定

```javascript
// services/tauri-commands.js
import { invoke } from '@tauri-apps/api/core'

export const jiraCommands = {
  getMyIssues: (host, email, token, project) =>
    invoke('jira_get_my_issues', { host, email, apiToken: token, project }),
  getProjects: (host, email, token) =>
    invoke('jira_get_projects', { host, email, apiToken: token }),
}

export const gitCommands = {
  currentBranch: (repoPath) => invoke('git_current_branch', { repoPath }),
  listBranches: (repoPath) => invoke('git_list_branches', { repoPath }),
  // ... 其余 Git 命令
}

export const githubCommands = { /* ... */ }
export const aiCommands = { /* ... */ }
```

- **价值**：所有 Tauri 命令调用有单一的查找入口；未来迁移或 mock 测试都只需改这一处
- **验收**：所有组件的 `invoke()` 调用替换为封装函数

### TODO-031：提取公共 composables

- **新建**：

```
src/composables/
├── useJira.js      # Jira 相关 UI 逻辑（筛选、分组、格式化）
├── useGit.js       # Git 仓库相关 UI 逻辑（状态轮询、分支操作）
├── useGithub.js    # GitHub PR 相关 UI 逻辑
└── useFormatters.js # 日期格式化、Markdown 渲染等公共函数
```

- **重点提取**：
  - **日期格式化**：至少 5 个组件各自定义了格式化函数 → 统一到 `useFormatters`
  - **customfield 日期解析**：`JiraPanel` 和 `TodoListPanel` 重复 → 统一到 `useJira`
  - **Markdown 内容格式化**：`GitModule` 和 `AIChatWindow` 各自实现 → 统一到 `useFormatters`
- **验收**：grep 全项目，不再有重复的日期格式化函数

### TODO-032：统一 `config.js` 中的 URL 生成函数

- **文件**：`src/config.js`（288 行）
- **问题**：`getDefaultAdminHost`、`getDefaultMemberPortalHost`、`getDefaultStaffPortalHost` 三个函数逻辑几乎一样
- **重构**：

```javascript
// 抽取通用函数
function buildHost(prefix, broker, env) {
  return `https://${prefix}-${broker}-cn-${env}.lbcrmsit.com`
}

export const getDefaultAdminHost = (b, e) => buildHost('crm-api', b, e)
export const getDefaultMemberPortalHost = (b, e) => buildHost('crm-member', b, e)
export const getDefaultStaffPortalHost = (b, e) => buildHost('crm-staff', b, e)
```

- **同时**：拆分 `config.js` 为 `api-config.js`（URL 生成 + API 常量）+ `theme.js`（主题管理）
- **验收**：功能不变，`config.js` 职责清晰

### TODO-033：替换 `alert()` / `confirm()` 为统一的 Toast/Modal 组件

- **影响文件**：`App.vue`、`JiraPanel.vue`、`MemberModule.vue` 等
- **方案**：新建 `src/components/common/AppToast.vue` 和 `src/composables/useToast.js`
- **验收**：全项目无原生 `alert()` / `confirm()` 调用

---

## Phase 4：Rust 后端模块化（预计 2 天）

> 将 1652 行的 `main.rs` 拆分为可维护的模块结构。

### TODO-040：拆分 `main.rs` 为模块

- **目标结构**：

```
src-tauri/src/
├── main.rs              # 仅 tauri::Builder 配置 + 模块注册（< 60 行）
├── commands/
│   ├── mod.rs           # 统一 re-export
│   ├── screenshot.rs    # screenshot_capture_region, clipboard_write_image_png, screenshot_save_png
│   ├── http.rs          # http_admin_login, http_get_user_list, http_get_member_token, http_post_json
│   ├── member.rs        # update_member_config, start_member_dev, stop_service_by_port, check_port_in_use, open_url_raw
│   ├── jira.rs          # jira_get_my_issues, jira_get_projects
│   ├── git.rs           # 全部 15 个 git_* 命令
│   ├── github.rs        # github_create_draft_pr, github_list_open_prs, github_get_current_user
│   ├── rss.rs           # fetch_rss_feed
│   └── ai.rs            # ai_chat_completion + call_openai/anthropic/ollama/openai_compatible
└── shared/
    ├── mod.rs
    └── http_client.rs   # 共享的 reqwest::Client（连接池）
```

- **验收**：`cargo build` 通过，所有前端 `invoke()` 功能不变

### TODO-041：统一 AI 调用函数，消除 80% 重复

- **当前**：`call_openai`、`call_anthropic`、`call_ollama`、`call_openai_compatible` 四个函数大量重复
- **重构方向**：提取 `build_request` + `parse_response` 公共逻辑，各 provider 只实现差异部分
- **验收**：AI 聊天功能在所有 provider 下正常工作

### TODO-042：共享 `reqwest::Client` 实例

- **问题**：每个命令函数内都 `reqwest::Client::new()`，不复用 TCP 连接
- **方案**：使用 `tauri::Manager` 的 `manage()` 注入共享 `Client`，或使用 `once_cell::sync::Lazy`
- **验收**：全局只创建一个 `Client`，连接复用

### TODO-043：修复 `git_get_diff` 的线程阻塞问题

- **问题**：其他 Git 命令都用 `spawn_blocking` 包装，`git_get_diff` 直接在 async 上下文调用同步 `std::process::Command`
- **修复**：用 `tauri::async_runtime::spawn_blocking` 包装
- **验收**：大 diff 场景下 UI 不卡顿

### TODO-044：清理 `jira_get_my_issues` 未使用的 `_project` 参数

- **修复**：若确实不需要则从函数签名和前端调用处移除
- **验收**：编译通过，无 warning

---

## Phase 5：清理死代码与安全加固（预计 1 天）

### TODO-050：删除 `QuickNotesPanel.vue`

- **文件**：`src/components/dashboard/QuickNotesPanel.vue`（457 行）
- **原因**：无任何组件导入或使用，是完全的死代码
- **决策**：若后续需要笔记功能，可从 Git 历史恢复；当前应清理以减少认知负担
- **验收**：`grep -r "QuickNotesPanel" src/` 无结果

### TODO-051：清理 Spotlight 占位代码

- **文件**：`App.vue`、`FloatingDock.vue`
- **内容**：移除 `spotlightOpen` 状态、Spotlight 遮罩模板、`FloatingDock` 中无用的 `openSpotlight` emit 和相关 CSS
- **决策**：等实际实现时再加回来；占位代码只增加噪音
- **验收**：无 Spotlight 相关的残留代码

### TODO-052：清理 `MemberModule` 的无效 emit

- **文件**：`src/components/dev/MemberModule.vue`
- **内容**：移除 `defineEmits(['showMessage', 'showLoading', 'hideLoading'])` 及所有 `emit('showMessage', ...)` 调用（无父组件监听）
- **修复方向**：若需要消息提示，改用 TODO-033 中的 `useToast`
- **验收**：无 orphan emit

### TODO-053：安全加固

| 项目 | 操作 |
|---|---|
| `tauri.conf.json` CSP | 配置合理的 Content-Security-Policy，至少限制 `script-src` |
| `config.js` 硬编码凭证 | 将 `ADMIN_CREDENTIALS` 迁移至环境变量或 Tauri 安全存储 |
| `config.js` 硬编码路径 | 将 `/Users/leacentsong/...` 改为通过 `$HOME` 或配置动态获取 |
| `v-html` XSS 风险 | 在 `AIChatWindow` 和 `GitModule` 中使用 DOMPurify 或等效方案 sanitize |

- **验收**：无硬编码凭证和路径，`v-html` 内容经过清理

---

## Phase 6：性能优化（预计 1.5 天）

### TODO-060：RSS 解析移到 Rust 端

- **当前问题**：50 个 RSS XML 完整传到前端，前端用 `DOMParser` 解析（传输量大）
- **重构**：在 `fetch_rss_feed` 命令中直接解析 XML，只返回结构化的 `{title, link, summary, date, source}` 数组
- **Rust 端**：引入 `quick-xml` 或 `feed-rs` crate 做解析
- **验收**：前端收到的是已解析的 JSON 数据，首屏加载时间明显缩短

### TODO-061：RSS 加载策略优化

- **当前**：一次性拉 50 个源，首次加载慢
- **优化方案**：
  1. 先加载前 8 个源，立即展示
  2. 后续 42 个源在后台 lazy 加载
  3. 加载完成后静默合并排序
  4. 增加内存缓存（5 分钟 TTL），切换 Tab 不重新请求
- **验收**：首屏 RSS 内容 < 3 秒展示

### TODO-062：TodoListPanel deep watch 加 debounce

- **问题**：`watch(myTodos, saveNotes, { deep: true })` 每次数组变化都写 localStorage
- **修复**：加 `{ debounce: 300 }` 或手动 `watchDebounced`
- **验收**：频繁操作待办时 localStorage 写入有节流

---

## Phase 7：功能价值评估（预计 0.5 天讨论）

> 非代码任务，需要产品决策。

### TODO-070：评估截图功能的 ROI

- **当前**：`ScreenshotFloatView.vue` 1222 行，实现了完整的画布标注工具
- **问题**：macOS 自带截图标注（Shift+Cmd+5）已足够好；维护这 1200+ 行的自研标注工具成本高
- **决策点**：保留 / 简化为仅截图（去掉标注）/ 移除

### TODO-071：评估 HotTopics 面板的定位

- **当前**：1537 行，3 个 Tab（RSS/AI资讯/GitHub周榜）
- **问题**：这是"信息消费"而非"效率工具"——与 FlowDesk "解决工作中最频繁操作" 的核心定位有偏差
- **决策点**：保留但精简 / 移为独立面板可选显隐 / 移除

### TODO-072：评估主题系统的必要性

- **当前**：6 个精心设计的主题 + ThemeSwitcher 组件
- **问题**：对效率工具而言，一个好看的默认主题 + dark/light 切换足够
- **决策点**：精简为 2 个主题（亮/暗）/ 保留全部

---

## Phase 8：面向未来的基础设施（预计 3 天，可选）

### TODO-080：渐进引入 TypeScript

- **步骤**：
  1. `vite.config.js` 支持 `.ts` 文件
  2. 新文件用 `.ts` 编写（stores、composables、services）
  3. 存量文件逐步迁移（从 `config.js` → `config.ts` 开始）
- **优先迁移**：`stores/` → `services/` → `composables/` → `views/` → `components/`

### TODO-081：考虑引入轻量 vue-router

- **触发条件**：当视图数 > 3 时（如加入 Release Agent 页面）
- **当前**：hash 判断 + ref 切换，2 个视图够用
- **预案**：功能增长时引入 `vue-router`，支持 URL 导航、路由守卫

### TODO-082：基础测试框架

- **前端**：Vitest（与 Vite 生态一致）+ Vue Test Utils
- **后端**：Rust 内置 `#[cfg(test)]` 模块
- **优先测试**：Store 逻辑（Jira/GitHub 数据转换）、AI 配置管理、Git 分支名生成规则

---

## 执行优先级总览

```
Phase 0 ━━━━━━━━ 紧急修复（0.5 天）
  ┃
Phase 1 ━━━━━━━━ 引入 Pinia Store（2 天）  ← 最高 ROI
  ┃
Phase 4 ━━━━━━━━ Rust 模块化（2 天）       ← 可与 Phase 2 并行
  ┃
Phase 2 ━━━━━━━━ 拆分巨型组件（3 天）
  ┃
Phase 3 ━━━━━━━━ 提取公共逻辑（2 天）
  ┃
Phase 5 ━━━━━━━━ 清理 + 安全（1 天）
  ┃
Phase 6 ━━━━━━━━ 性能优化（1.5 天）
  ┃
Phase 7 ━━━━━━━━ 功能评估（讨论）
  ┃
Phase 8 ━━━━━━━━ 基础设施（可选，3 天）
```

**总计核心工作量**：约 12 天（Phase 0-6）
**可选扩展**：约 3.5 天（Phase 7-8）

---

## 验收总标准

完成所有 Phase 后，项目应满足：

1. **无超过 500 行的 Vue 组件**
2. **Rust 后端按功能拆分为 8+ 模块文件**
3. **Pinia Store 作为唯一数据源**，无组件直接操作 localStorage
4. **无重复的 API 调用**（同类数据只请求一次）
5. **无死代码**（每个文件都被使用）
6. **无硬编码凭证和本地路径**
7. **无 `println!` 调试日志和 `alert()` 原生弹窗**
8. **全部使用 `<script setup>` 组合式 API**

---

## 附录：文件影响矩阵

| TODO | 新建文件 | 修改文件 | 删除文件 |
|---|---|---|---|
| 001 | - | GitModule.vue | - |
| 002 | - | main.rs | - |
| 003 | - | main.js, Cargo.toml | - |
| 010 | stores/*.js | main.js | - |
| 011 | stores/jira.js | JiraPanel.vue, TodoListPanel.vue, App.vue | - |
| 012 | stores/github.js | TodoListPanel.vue, GitModule.vue, App.vue | - |
| 013 | stores/settings.js | App.vue, CreateBranchModal.vue | - |
| 020 | components/settings/*.vue | App.vue | - |
| 021 | components/dev/git/*.vue | - | GitModule.vue (替换) |
| 022 | components/dashboard/jira/*.vue | - | JiraPanel.vue (替换) |
| 023 | components/dashboard/topics/*.vue | - | HotTopicsPanel.vue (替换) |
| 024 | - | GitModule.vue, AIChatWindow.vue | - |
| 030 | services/tauri-commands.js | 所有使用 invoke 的组件 | - |
| 031 | composables/*.js | 所有含重复逻辑的组件 | - |
| 032 | api-config.js, theme.js | 所有引用 config.js 的文件 | config.js (拆分) |
| 033 | components/common/AppToast.vue, composables/useToast.js | 所有使用 alert/confirm 的文件 | - |
| 040 | commands/*.rs, shared/*.rs | main.rs (大幅缩减) | - |
| 041 | - | commands/ai.rs | - |
| 042 | shared/http_client.rs | 所有使用 reqwest 的 rs 文件 | - |
| 050 | - | - | QuickNotesPanel.vue |
| 051 | - | App.vue, FloatingDock.vue | - |
| 060 | - | main.rs (rss), HotTopicsPanel.vue | - |
