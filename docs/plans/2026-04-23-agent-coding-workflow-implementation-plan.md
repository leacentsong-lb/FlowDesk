# Agent Coding Workflow V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 coding intent / workflow 增加更强的工程执行骨架：tool grounding、filesystem policy、failure taxonomy + recovery、code world model、task-local context；这些能力只挂在 coding 任务下，不污染全局 graph。

**Architecture:** 保持 core graph 不变，把 coding-specific 能力作为 workflow-layer 插件挂载：先做 tool 参数 grounding，再做文件系统操作策略，再补 code world model 与 task context，最后接上 failure taxonomy + recovery。所有 state 都只在 coding intent 生效。

**Tech Stack:** LangGraph workflow hooks, Vitest, Tauri file tools, OpenAI-compatible tool calling

---

## 范围

### In Scope
- coding intent / workflow route
- tool grounding
- filesystem operation policy
- code world model
- task-local context
- failure taxonomy + recovery

### Out of Scope
- release workflow 改造
- answer composer
- 全局 UI phase redesign

---

### Task 1: 为 coding 任务建立独立 workflow/intent 入口

**Files:**
- Modify: `src/agent/router.js`
- Modify: `src/agent/workflows/index.js`
- Modify: `src/stores/release.js`（若入口复用这里的 route 解析）
- Test: `src/agent/__tests__/router.test.js`

**Step 1: 增加 coding intent 识别**

至少区分：
- `workspace-analysis`
- `code-editing`
- `repo-mapping`
- `git-operations`
- `freeform-qna`

**Step 2: 让 coding-specific state 只在 coding intent 下启用**

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/router.test.js
```

Expected: PASS

---

### Task 2: 增加 tool grounding 层

**Files:**
- Create: `src/agent/tool-resolution.js`
- Modify: `src/agent/graph.js`
- Modify: `src/agent/tools/filesystem.js`
- Test: `src/agent/__tests__/loop-invalid-tool-call.test.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 设计统一链路**
```text
schema -> resolver/grounder -> validator -> handler
```

**Step 2: 先覆盖文件类工具**
- `read_file / read`
- `list_directory / ls`
- `edit / multiedit / write`

**Step 3: 输出结构化解析结果**
- `resolvedArgs`
- `confidence`
- `ambiguities`
- `needsUserConfirmation`
- `resolutionTrace`

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/loop-invalid-tool-call.test.js src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 3: 增加文件系统操作策略层

**Files:**
- Create: `src/agent/filesystem-policy.js`
- Modify: `src/agent/graph.js`
- Modify: `src/agent/context.js`
- Modify: `src/agent/tools/filesystem.js`
- Test: `src/agent/tools/__tests__/claude-mvp-tools.test.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 固化操作顺序**
```text
先定位 -> 再读取 -> 再最小编辑 -> 再验证
```

**Step 2: 为 policy 增加阶段状态**
- `targetPathResolved`
- `fileRead`
- `editStrategy`
- `verificationRequired`

**Step 3: 硬拦截违规动作**
- 未定位不许 read/edit/write
- 未读取不许 edit/multiedit
- 能最小 patch 时不许全量 write

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/tools/__tests__/claude-mvp-tools.test.js src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 4: 增加 Code World Model / Workspace Fact Graph

**Files:**
- Create: `src/agent/code-world-model.js`
- Modify: `src/agent/context.js`
- Modify: `src/agent/tools/workspace.js`
- Modify: `src/agent/graph.js`
- Test: `src/agent/tools/__tests__/workspace.test.js`
- Test: `src/agent/__tests__/context.test.js`

**Step 1: 建结构化代码事实**
- `workspaceMap`
- `candidateFiles`
- `selectedFile`
- `readSpans`
- `patchTargets`
- `verificationPlan`
- `verificationResult`

**Step 2: 把标准 coding 流程固化为事实流**
```text
scan workspace -> locate -> read -> confirm patch target -> minimal patch -> verify -> recover/replan
```

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/tools/__tests__/workspace.test.js src/agent/__tests__/context.test.js
```

Expected: PASS

---

### Task 5: 增加 task-local context（scratchpad / working set / change summary）

**Files:**
- Create: `src/agent/task-context.js`
- Modify: `src/agent/context.js`
- Modify: `src/agent/graph.js`
- Modify: `src/agent/tracing.js`
- Test: `src/agent/__tests__/context.test.js`
- Test: `src/agent/__tests__/tracing.test.js`

**Step 1: 新增结构化任务状态**
- `taskGoal`
- `taskScratchpad`
- `workingSet`
- `changeSummary`
- `verificationBacklog`

**Step 2: 只把 task-relevant facts 注入 prompt**

**Step 3: 定义 reset / carry-over 规则**
- 任务完成
- replan
- 用户切换话题

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/context.test.js src/agent/__tests__/tracing.test.js
```

Expected: PASS

---

### Task 6: 增加 failure taxonomy + recovery

**Files:**
- Create: `src/agent/recovery.js`
- Modify: `src/agent/graph.js`
- Modify: `src/agent/context.js`
- Test: `src/agent/__tests__/graph.test.js`
- Test: `src/agent/__tests__/loop-invalid-tool-call.test.js`

**Step 1: 定义失败分类**
- `missing_params`
- `ambiguous_target`
- `missing_prerequisite`
- `wrong_tool_choice`
- `tool_runtime_error`
- `verification_failed`
- `approval_blocked`

**Step 2: 绑定恢复策略**
- 缺参 -> ground/补全
- 目标歧义 -> 候选定位 / ask user
- 前置缺失 -> 自动补跑前置
- 工具选错 -> 切换推荐工具
- 校验失败 -> retry / replan

**Step 3: 接到 core verifier/reflector 挂点**

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/loop-invalid-tool-call.test.js
```

Expected: PASS

---

### Task 7: （可选）仓库文件设计可读性评估

**Files:**
- Create: `docs/plans/2026-04-23-agent-readable-repo-audit.md`

**Step 1: 评估目录结构、文件粒度、README/ADR/命名元数据**

**Step 2: 输出建议，不强绑到本轮实现**

---

## 交付顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7（可选）

