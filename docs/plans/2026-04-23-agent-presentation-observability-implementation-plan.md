# Agent Presentation & Observability V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 core graph 与 coding workflow 稳定后，再补 answer composer、phase tracing、runtime/UI 暴露，让最终用户输出与系统状态一致且可观测。

**Architecture:** `answer composer` 不参与动作决策，只在 terminal / blocked / need_info / abort 等收口回合生成最终对外话术；observability 只消费结构化 state，不再从自由文本反推系统状态。

**Tech Stack:** LangGraph, Vue 3 runtime, Vitest, tracing helpers

---

## 范围

### In Scope
- answer composer
- phase tracing
- runtime/UI 暴露当前阶段
- 输出与状态一致性测试

### Out of Scope
- core graph 路由重构
- coding workflow grounding / policy / recovery

---

### Task 1: 增加 answer composer 节点

**Files:**
- Create: `src/agent/answer-composer.js`
- Modify: `src/agent/graph.js`
- Modify: `src/agent/context.js`
- Modify: `src/agent/prompt-config.js`
- Test: `src/agent/__tests__/graph.test.js`
- Test: `src/agent/__tests__/context.test.js`

**Step 1: 限定 answer composer 触发时机**
- `completed`
- `blocked`
- `need_info`
- `abort`

**Step 2: 限定 answer composer 输入**
- `verification`
- `execution/toolResults`
- `plan/currentStep`
- `reflection`
- `stopReason`

**Step 3: 明确 answer composer 不做什么**
- 不选工具
- 不改计划
- 不决定执行分支

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/context.test.js
```

Expected: PASS

---

### Task 2: 规范最终对外输出 contract

**Files:**
- Modify: `src/agent/answer-composer.js`
- Modify: `src/components/release/chat-format.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 统一输出模板**
至少能表达：
- 已完成什么
- 未完成什么
- 为什么停在这里
- 用户下一步该做什么

**Step 2: 防止典型错误**
- 中间状态被说成最终结论
- tool result 与最终话术不一致
- 该短答时写成流水账

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 3: 扩展 tracing phase 与 runtime 事件

**Files:**
- Modify: `src/agent/tracing.js`
- Modify: `src/agent/loop.js`
- Modify: `src/agent/runtime.js`
- Test: `src/agent/__tests__/tracing.test.js`
- Test: `src/agent/__tests__/runtime.test.js`

**Step 1: 增加 phase event**
- `planner`
- `executor`
- `tools`
- `verifier`
- `reflector`
- `answer_composer`

**Step 2: trace 记录结构化字段**
- `verification.status`
- `reflection.action`
- `stopReason`
- `currentStep`

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/tracing.test.js src/agent/__tests__/runtime.test.js
```

Expected: PASS

---

### Task 4: 暴露 UI 最小可见阶段

**Files:**
- Modify: `src/agent/runtime.js`
- Modify: `src/stores/release.js`
- Test: `src/agent/__tests__/runtime.test.js`

**Step 1: 在 UI 侧至少能显示当前 phase**

**Step 2: blocked / need_info / abort 时展示正确收口态**

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/runtime.test.js
```

Expected: PASS

---

## 交付顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4

