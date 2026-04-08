# Release Agent 设计文档

> 版本：2026-04-07 v2
> 范式：Harness Agent（参照 Claude Code 架构 + learn-claude-code 最佳实践）
> 定位：Chat 驱动的发布流水线 Agent，运行在 Tauri 桌面 App 内
> 技术栈：Vue 3 + Pinia + Tauri (Rust) + OpenAI/DeepSeek API

---

## 0. 核心哲学

> **The model already knows how to be an agent. Your job is to get out of the way.**
> — learn-claude-code / agent-philosophy

Agent 不是复杂工程。它是一个简单循环，邀请模型行动：

```
LOOP:
  Model sees: context + available capabilities
  Model decides: act or respond
  If act: execute capability, add result, continue
  If respond: return to user
```

### 三要素

| 要素 | 定义 | 设计原则 |
|------|------|---------|
| **Capabilities（工具）** | Agent 能做什么 | 3-5 个核心工具起步，按需增加 |
| **Knowledge（知识）** | Agent 知道什么 | 按需加载，不要一次性全塞 system prompt |
| **Context（上下文）** | 发生了什么 | 上下文是稀缺资源，隔离噪声子任务，截断冗长输出 |

### 反模式（必须避免）

| 反模式 | 问题 | 正确做法 |
|--------|------|---------|
| 过度工程 | 未验证需求前就搭复杂架构 | 从最小可行开始 |
| 工具过多 | 模型困惑，选错工具 | 3-5 个起步 |
| 流程写死 | 无法适应变化 | 让模型自己决定顺序 |
| 知识前置 | 上下文膨胀 | 按需通过 tool_result 注入 |
| 微观管理 | 削弱智能 | 信任模型的推理能力 |

### 渐进复杂度

| 级别 | 加什么 | 什么时候加 |
|------|--------|-----------|
| Level 0 | 模型 + 1 个工具 | 永远从这里开始 |
| Level 1 | 模型 + 3-5 个工具 | 基础功能需要 |
| Level 2 | + 进度追踪（Todo） | 多步任务丢失连贯性 |
| Level 3 | + 子 Agent | 探索任务污染上下文 |
| Level 4 | + 技能按需加载 | 领域专业知识需要 |

**大多数 Agent 永远不需要超过 Level 2。**

---

## 1. 设计哲学：Build the Harness, Not the Code

参照 Claude Code 的 Harness Agent 架构 + learn-claude-code 的实现范式：

**人构建环境（Tool 定义、权限系统、上下文管理、验证反馈），模型在这个环境中自主决策和执行。**

三个关键转变：

| 传统做法 | Harness Agent 做法 |
|---------|-------------------|
| 硬编码流程顺序 (`agentSelectEnv -> agentSelectVersion -> ...`) | 模型根据当前状态自主选择下一个 Tool |
| 按钮触发固定函数 | 模型接收意图，选择合适的 Tool 组合 |
| 全局 if/else 判断 | 每个 Tool 自带前置条件和权限检查 |
| 所有知识塞进 system prompt | 知识通过 `load_skill` 按需注入 tool_result |
| 上下文无限增长 | micro-compact + auto-compact + 子任务隔离 |

---

## 2. 架构：五层 Harness

```
+------------------------------------------------------------------+
| Layer 1: 入口层 (Entry)                                           |
|   Chat UI / 内联按钮 / 自由对话输入                                |
+------------------------------------------------------------------+
| Layer 2: Agent Loop (核心循环)                                    |
|   observe() -> plan() -> selectTool() -> execute() -> evaluate()  |
+------------------------------------------------------------------+
| Layer 3: Tool & Permission System                                 |
|   Tool Registry / Tool Contract / Permission Gate                 |
+------------------------------------------------------------------+
| Layer 4: State Management                                         |
|   Release Session / Pipeline Steps / Chat Messages                |
+------------------------------------------------------------------+
| Layer 5: 命令层 (Tauri Rust)                                      |
|   Jira API / GitHub API / Git CLI / Build CLI / AI API            |
+------------------------------------------------------------------+
```

---

## 3. Tool Contract（工具合约）

每个发布操作定义为一个标准化 Tool。Tool 不是普通函数，它是 Agent 和 Harness 之间的合约。

### 3.1 Tool 接口定义

```javascript
/**
 * @typedef {Object} Tool
 * @property {string} name - 唯一标识
 * @property {string} description - Agent 可读的描述（用于决策）
 * @property {Function} precondition - 前置条件检查，返回 { ok, reason }
 * @property {Function} execute - 实际执行逻辑
 * @property {string} permission - 'auto' | 'confirm' | 'dangerous'
 * @property {boolean} isReadOnly - 是否只读（不修改状态）
 * @property {boolean} isConcurrencySafe - 是否可并发执行
 * @property {string[]} requires - 依赖哪些 Tool 先完成
 */
```

### 3.2 Tool 注册表

| Tool Name | 描述 | 权限 | 只读 | 依赖 |
|-----------|------|------|------|------|
| `check_credentials` | 检查 Jira/GitHub/AI token 状态 | auto | yes | - |
| `fetch_jira_versions` | 获取 Jira 待发布版本列表 | auto | yes | check_credentials |
| `fetch_version_issues` | 读取指定版本的所有 Jira issue | auto | yes | fetch_jira_versions |
| `generate_release_summary` | AI 生成发布摘要 | auto | yes | fetch_version_issues |
| `scan_pr_status` | 扫描各仓库 PR 合并状态 | auto | yes | fetch_version_issues |
| `identify_repos` | 从 PR 结果推导发布仓库列表 | auto | yes | scan_pr_status |
| `confirm_repos` | 人工确认仓库列表 | confirm | no | identify_repos |
| `check_release_branch` | 检查 release 分支是否存在 | auto | yes | confirm_repos |
| `check_latest_branch` | 检查 latest 分支是否存在 | auto | yes | confirm_repos |
| `check_package_version` | 校验 package.json 版本号一致性 | auto | yes | confirm_repos |
| `check_merge_conflict` | 预检 latest -> release 冲突 | auto | yes | confirm_repos |
| `check_working_tree` | 检查工作区是否干净 | auto | yes | confirm_repos |
| `run_build` | 执行 pnpm run build | auto | yes | check_* 全部通过 |
| `merge_to_latest` | release 合并到 latest | dangerous | no | run_build |
| `create_tag` | 创建 release tag | dangerous | no | merge_to_latest |
| `generate_release_doc` | 生成发布文档 | auto | no | create_tag |

### 3.3 权限分级

| 权限级别 | 含义 | Agent 行为 |
|---------|------|-----------|
| `auto` | 自动执行，无需确认 | Agent 直接调用 |
| `confirm` | 需要人工确认 | Agent 在 Chat 中提供确认按钮 |
| `dangerous` | 高风险，必须二次确认 | Agent 给出风险说明 + 确认按钮，按钮样式强调危险性 |

---

## 4. Agent Loop（核心循环）

### 4.1 当前实现（Phase 1：硬编码链式调用）

当前是写死的 `agentSelectEnv -> agentSelectVersion -> agentRunPrCheck -> ...` 链式调用。这是 learn-claude-code 列出的反模式（Rigid workflows），但作为 MVP 可以先运行。

### 4.2 目标实现（Phase 3+：AI Tool Calling Loop）

参照 learn-claude-code 的核心模式——**`while True + stop_reason == "tool_use"`**：

```python
# 伪代码：Release Agent 的目标 Loop
def agent_loop(messages):
    while True:
        response = model.create(
            system=RELEASE_AGENT_SYSTEM,
            messages=messages,
            tools=RELEASE_TOOLS,   # Tool schema 列表
        )

        messages.append({"role": "assistant", "content": response.content})

        # 如果模型决定回复用户（而非调用工具），循环结束
        if response.stop_reason != "tool_use":
            return extract_text(response)

        # 模型选择了工具 -> 执行 -> 把结果送回
        results = []
        for tool_call in response.tool_uses:
            # 权限检查
            if tool_call.name in DANGEROUS_TOOLS:
                result = await request_human_confirmation(tool_call)
            else:
                result = execute_tool(tool_call.name, tool_call.input)

            results.append({
                "type": "tool_result",
                "tool_use_id": tool_call.id,
                "content": result
            })

        messages.append({"role": "user", "content": results})
        # 循环继续 -> 模型看到结果 -> 决定下一步
```

**关键区别**：
- 模型自己决定调用哪个 Tool，不是代码硬编码顺序
- 模型看到 Tool 结果后自己决定下一步：继续调用另一个 Tool？还是回复用户？
- 循环本身极简，复杂性在 Tool 定义和 System Prompt 里

### 4.3 Tool 定义给模型看的格式

```json
{
  "name": "scan_pr_status",
  "description": "扫描所有配置仓库，检查与当前 Jira Version 关联的 PR 是否已合并。返回每个 PR 的合并状态、仓库归属、链接。如果存在未合并的 PR，发布将被阻塞。",
  "input_schema": {
    "type": "object",
    "properties": {
      "version": { "type": "string", "description": "发布版本号，如 3.8.2" }
    },
    "required": ["version"]
  }
}
```

模型会读这个 description 来决定"现在应不应该调用这个 Tool"。所以 **description 要写清楚 Tool 做什么、什么时候该用、结果对发布意味着什么**。

### 4.4 Dangerous Tool 的权限门禁

当模型选择了 `merge_to_latest` 或 `create_tag` 这类高风险 Tool 时：

1. Loop 不直接执行
2. 在 Chat 中向用户展示确认按钮
3. 用户点击确认后，执行 Tool
4. 结果送回模型，循环继续

这就是 learn-claude-code 中 `safe_path` / `bash 黑名单` 的等价实现。

### 4.5 终止条件

- 模型 `stop_reason != "tool_use"` -> 模型选择回复用户 -> 循环结束
- 所有门禁 Tool PASS -> 模型会自然判断"可以发布"并回复
- Dangerous Tool 等待确认 -> 循环暂停，等待用户按钮

### 4.6 上下文管理（参照 learn-claude-code s06）

| 策略 | 做法 |
|------|------|
| micro-compact | 旧 tool_result 替换为 `[已完成: PR 检查通过，8 个 PR 全部 merged]` |
| auto-compact | token 超阈值时，用 AI 生成摘要替换早期对话 |
| 子任务隔离 | build gate 等长任务用独立 messages[]，只把摘要回传主对话 |
| 持久化 | Session toolResults 存盘（不依赖对话历史） |

---

## 5. Context Management（上下文管理）

### 5.1 Release Session 作为核心上下文

```javascript
ReleaseSession = {
  version: '3.8.2',
  environment: 'production',
  status: 'checking',      // idle | checking | blocked | ready | completed
  currentToolIndex: 3,     // 当前执行到哪个 Tool
  toolResults: {           // 每个 Tool 的执行结果
    check_credentials: { status: 'pass', data: {...} },
    fetch_jira_versions: { status: 'pass', data: {...} },
    scan_pr_status: { status: 'blocked', data: {...}, error: '2 unmerged PRs' },
    ...
  },
  repos: ['tmgm', 'oqtima', 'admin'],
  chatMessages: [...]
}
```

### 5.2 上下文传递原则

参照 Claude Code 的上下文压缩策略：

1. **Tool 结果只保留摘要**：scan_pr_status 完成后，Chat 中只展示"8 个 PR，2 个未合并"，完整数据放在左栏 PipelinePanel
2. **AI 对话上下文窗口有限**：只传最近 12 条消息给 AI，避免 token 浪费
3. **Session 状态是持久的**：即使 Chat 消息被压缩，Session 中的 toolResults 始终完整

---

## 6. AI 集成设计

### 6.1 流式对话架构

```
用户输入 -> Store.agentChat()
              |
              v
         构建 messages[] (system prompt + 最近 12 条上下文)
              |
              v
         invoke('ai_chat_stream', { provider, model, messages, requestId })
              |
              v  (Rust 后端)
         POST /chat/completions { stream: true, reasoning_effort: "medium" }
              |
              v  (SSE 逐 chunk)
         app.emit(`ai-chat-chunk-{requestId}`, { delta, reasoning, done })
              |
              v  (前端 event listener)
         msg.text += delta -> Vue reactivity -> UI 实时渲染
```

### 6.2 System Prompt 设计原则

参照 Claude Code 的 prompt 工程：

1. **角色定位明确**：你是发布工程助手，不是通用 AI
2. **能力边界清晰**：告诉 AI 它能做什么（解释状态、回答问题）和不能做什么（不能直接执行发布）
3. **工具感知**：让 AI 知道有哪些操作按钮可以引导用户使用
4. **语言约束**：固定中文回复

```
你是一个发布工程助手 (Release Agent)，运行在桌面 App 中。

你的能力：
- 回答关于发布流程、Git 分支策略、Jira、PR 的问题
- 解释当前发布状态和阻塞原因
- 生成发布摘要和风险分析

你不能直接执行的操作（用户需要点击按钮）：
- 发布生产 / 选择版本 / 检查 PR / 确认仓库 / 运行构建

当前 Release Session 状态：
- 版本：{version}
- 阶段：{currentStep}
- 状态：{pipelineStatus}
```

### 6.3 Provider 差异

| 特性 | OpenAI | DeepSeek |
|------|--------|----------|
| 思考模式 | `reasoning_effort: "medium"` | model = `deepseek-reasoner` |
| 思考内容 | 不直接暴露 | `delta.reasoning_content` |
| 测试端点 | `/responses` | `/chat/completions` |

---

## 7. Permission Gate（权限门禁）

### 7.1 三级权限模型

```
auto      -> Agent 直接执行，结果通过 Chat 报告
confirm   -> Agent 在 Chat 中提供按钮，等待用户点击
dangerous -> Agent 发送风险警告 + 红色按钮，等待用户二次确认
```

### 7.2 Chat 内联按钮作为权限确认机制

按钮不只是 UI 元素，它是 Permission Gate 的具现化：

- Agent 判断下一个 Tool 需要 `confirm` 权限
- Agent 在 Chat 中生成一条带按钮的消息
- 用户点击按钮 = 授权通过
- `handleChatAction` 接收 actionId，调用对应 Tool

### 7.3 按钮文案原则

参照 Claude Code 的 tool description 设计——告诉用户"点了会发生什么"：

| 差 | 好 |
|---|---|
| `Check PRs` | `检查是否存在未合并的 PR` |
| `Confirm` | `确认仓库列表，进入发布预检` |
| `Build` | `预检通过，开始执行构建验证 (pnpm run build)` |
| `Merge` | `将 release/v3.8.2 合并到 latest（不可撤销）` |

---

## 8. UI 双栏设计

### 8.1 职责分离

| 左栏 PipelinePanel | 右栏 AgentChatPanel |
|-------------------|-------------------|
| 事实层：结构化数据 | 交互层：对话流 |
| 展示 Tool 执行结果详情 | 展示 Agent 消息 + 按钮 |
| 点击展开查看完整数据 | 流式 AI 输出 |
| 节点状态可视化 | 用户自由输入 |

### 8.2 状态同步

两栏通过共享 Pinia Store 实时同步：
- Chat 中点击按钮 -> Store 更新 -> PipelinePanel 节点状态变化
- Tool 执行完成 -> Store 更新 -> Chat 自动推送结果消息

### 8.3 渐进式布局

- 初始：只显示 Chat（全宽），Agent 打招呼
- 选择版本后：左栏滑入，Session 激活
- 发布完成/重置：左栏滑出

---

## 9. 演进路径（对应 learn-claude-code 渐进层级）

### Phase 1（当前 - Level 1: 工具 + 硬编码流程）

- 硬编码 `agentSelectEnv -> agentSelectVersion -> ...` 链式调用
- Tool 逻辑散落在 Store 函数中
- AI 只参与自由对话和摘要生成
- **足够运行 MVP，但不是真正的 Agent**

### Phase 2（Level 1 -> Level 2: 工具注册表 + 进度追踪）

- 定义 `ToolRegistry`：统一的 `{ name, description, inputSchema, execute, permission }` 接口
- 每个发布操作抽成独立 Tool 文件
- 引入 TodoWrite 式进度追踪：`只有一个 in_progress 任务`
- **模型还不直接选 Tool，但架构已就绪**

### Phase 3（Level 2 -> Level 3: AI Tool Calling Loop）

这是最关键的一步——从"硬编码流程"到"模型自主循环"：

- 实现 `while True + stop_reason == "tool_use"` 核心循环
- Tool schema 注册到 AI model 的 `tools` 参数
- 模型自己决定调用哪个 Tool、什么顺序
- Permission Gate 拦截 dangerous Tool
- **这一步之后，Release Agent 才是真正的 Agent**

### Phase 4（Level 3+: 子 Agent + 知识按需加载）

- Build Gate 作为子 Agent：独立 messages[]，只回传摘要
- 发布规范作为 Skill：`SKILL.md` 按需加载到 tool_result
- 上下文压缩：micro-compact + auto-compact
- **大多数场景不需要这一步**

### Phase 5（Level 4: 多 Agent 协作）

- PR Agent / Build Agent / Doc Agent 独立运行
- 主 Agent 通过消息总线协调（参照 learn-claude-code s09-s11）
- 队友 idle 轮询 + 自动认领任务
- **只在团队多人发布场景才需要**

---

## 10. 关键设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| Agent 是否可以自主执行 merge/tag | 不可以，必须人工确认 | 高风险动作不可逆，审计要求 |
| AI 是否参与"是否可以发布"的判定 | 不参与 | 规则判定必须确定性，AI 只做解释和摘要 |
| Chat 是否是唯一入口 | 是 | 所有操作通过对话推进，左栏只做展示 |
| Tool 执行是否需要流式反馈 | 构建需要，其他不需要 | 构建耗时长，需要实时日志 |
| AI 对话是否需要流式 | 必须 | 用户体验要求，逐字输出 |
| Session 数据是否持久化 | 当前不持久化（localStorage） | MVP 阶段，后续可加 |

---

## 11. 文件清单

| 文件 | 职责 |
|------|------|
| `src/stores/release.js` | Release Store：Session + Workflow + Agent + Chat |
| `src/views/DevView.vue` | Dev 页面：双栏容器 |
| `src/components/release/PipelinePanel.vue` | 左栏：节点面板 |
| `src/components/release/AgentChatPanel.vue` | 右栏：Chat 面板 |
| `src-tauri/src/commands/release.rs` | Rust：Jira / Git / GitHub / AI / Build 命令 |
| `src-tauri/src/commands/ai.rs` | Rust：AI 连接测试 |
| `src/stores/settings.js` | 全局设置 |
| `src/components/settings/SettingsDrawer.vue` | 设置面板 |
| `docs/plans/2026-04-07-release-agent-design.md` | 本文档 |
