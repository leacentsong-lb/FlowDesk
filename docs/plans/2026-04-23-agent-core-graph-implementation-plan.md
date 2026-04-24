# Agent Core Graph V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前 `model -> tools -> model` 的最小反应式循环升级为带有显式 `planner / executor / verifier / reflector` 的 core graph，但保持单一 `StateGraph`、保留现有 tools 节点与消息契约。

**Architecture:** V1 只做 harness core，不混入 coding-specific workflow。`planner` 用独立 structured output 产出短计划；`executor` 复用现有流式 tool-calling 通路；`verifier` 用轻量规则判断每一步状态；`reflector` 只在失败、阻塞、replan、retry 超限时触发。`answer composer` 延后到 V2。

**Tech Stack:** LangGraph, OpenAI-compatible tool calling, Vitest, Vue 3 runtime integration

---

## 范围

### In Scope
- 收敛 graph state
- 引入 `planner / executor / verifier / reflector`
- 保留 `tools` 节点
- 细化 stopReason 与 phase event
- 补 graph / runtime / tracing 核心测试

### Out of Scope
- tool grounding
- filesystem policy
- code world model
- task-local scratchpad
- answer composer

---

### Task 1: 收敛 graph state 与状态枚举

**Files:**
- Modify: `src/agent/graph.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 定义最小状态模型**

新增并统一：
- `plan`
- `currentStep`
- `stepIndex`
- `execution`
- `verification`
- `reflection`
- `retryCount`

并把多布尔位改成枚举：
- `verification.status = passed | blocked | failed | need_info | need_replan`
- `reflection.action = advance | retry | replan | ask_user | finish | abort`

**Step 2: 保留旧字段但收紧职责**

保留：
- `messages`
- `round`
- `toolFailureCounts`
- `finalText`
- `stopReason`

`lastAssistantMessage` 只作为兼容桥接字段，不能再作为核心路由事实源。

**Step 3: 写失败测试**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: FAIL，因为新状态字段与枚举尚未接入。

**Step 4: 实现并跑通测试**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 2: 增加 planner 节点，并使用 structured output

**Files:**
- Modify: `src/agent/graph.js`
- Modify: `src/agent/context.js`
- Modify: `src/ai/client.js`（若需要单独 planner API helper）
- Test: `src/agent/__tests__/graph.test.js`
- Test: `src/agent/__tests__/context.test.js`

**Step 1: 写 planner contract**

planner 最小输出：
- `goal`
- `steps`
- `currentStepId`
- `done`

**Step 2: 让 planner 走非流式结构化输出**

要求：
- 不复用 executor 的 streaming tool-call 通路
- 先做 schema 校验，再写入 state
- 失败时直接 `planning_failed`

**Step 3: 调整 prompt，只给 planner 看它该看的上下文**

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/context.test.js
```

Expected: PASS

---

### Task 3: 把现有 model 节点收敛成 executor 节点

**Files:**
- Modify: `src/agent/graph.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 将 `runModelNode()` 重构为 `runExecutorNode()`**

executor 只负责：
- 围绕 `currentStep` 生成 tool calls 或阶段性文本
- 把结果写入 `execution`

executor 不负责：
- 重新全局规划
- 直接给出最终用户态结论

**Step 2: 保持流式 tool-call 兼容**

继续复用 `streamAgentRound()`。

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 4: 保留 tools 节点，但改为消费 `execution.toolCalls`

**Files:**
- Modify: `src/agent/graph.js`
- Test: `src/agent/__tests__/graph.test.js`
- Test: `src/agent/__tests__/loop-invalid-tool-call.test.js`

**Step 1: 将 tools 输入从 `lastAssistantMessage.tool_calls` 迁到 `execution.toolCalls`**

**Step 2: 把 tool results 结构化写回 `execution.toolResults`**

**Step 3: 保留现有参数校验与 recoverable validation error**

**Step 4: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/loop-invalid-tool-call.test.js
```

Expected: PASS

---

### Task 5: 增加轻量 verifier 节点

**Files:**
- Modify: `src/agent/graph.js`
- Create: `src/agent/verifier.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 写 verifier 规则**

输入：
- `currentStep`
- `execution`
- `toolResults`
- `toolFailureCounts`

输出：
- `verification.status`
- `verification.reason`
- `verification.nextHint`

**Step 2: verifier 每步都跑，但保持轻量**

只做状态判断，不做复杂模型推理。

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 6: 增加异常导向 reflector 节点

**Files:**
- Modify: `src/agent/graph.js`
- Create: `src/agent/reflector.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 只在异常/阻塞场景触发 reflector**

触发条件：
- `verification.status !== passed`
- retry 超限
- `tool_failure`
- `need_replan`

**Step 2: reflector 输出动作枚举**
- `advance`
- `retry`
- `replan`
- `ask_user`
- `finish`
- `abort`

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 7: 重写 graph 路由与 stopReason

**Files:**
- Modify: `src/agent/graph.js`
- Test: `src/agent/__tests__/graph.test.js`

**Step 1: 改造主图**

目标路由：
```text
START -> planner -> executor -> tools? -> verifier -> reflector? -> planner|executor|END
```

**Step 2: stopReason 收敛为枚举**
- `completed`
- `max_rounds`
- `planning_failed`
- `execution_failed`
- `verification_failed`
- `tool_failure`
- `user_input_required`

**Step 3: 写 happy / retry / replan / hard-stop 测试**

Run:
```bash
npm test -- src/agent/__tests__/graph.test.js
```

Expected: PASS

---

### Task 8: 扩展 runtime / tracing 以暴露 phase

**Files:**
- Modify: `src/agent/loop.js`
- Modify: `src/agent/runtime.js`
- Modify: `src/agent/tracing.js`
- Test: `src/agent/__tests__/runtime.test.js`
- Test: `src/agent/__tests__/tracing.test.js`

**Step 1: 增加 phase event**
- `planner.started/completed`
- `executor.started/completed`
- `verifier.completed`
- `reflector.completed`

**Step 2: trace 中记录枚举状态，而不是自由文本**

**Step 3: 写测试并验证**

Run:
```bash
npm test -- src/agent/__tests__/runtime.test.js src/agent/__tests__/tracing.test.js
```

Expected: PASS

---

## 交付顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8

## 延后到后续计划

- `answer composer`
- `tool grounding`
- `filesystem policy`
- `code world model`
- `task context`

