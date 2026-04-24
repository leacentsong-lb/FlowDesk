# Agent Harness Refactor Roadmap

> 该文档不再作为单一 implementation plan 使用，而是作为拆分后的 roadmap / index。

## 为什么拆分

原始大文档同时包含：
- harness core graph 升级
- coding workflow 治理
- presentation / observability

这三层依赖关系不同、改动文件高度重叠、推进节奏也不同。继续按单一大 TODO 实施，会导致：
- 范围失控
- 状态模型反复返工
- `graph.js / context.js / runtime.js` 高频冲突

因此改为 3 份 plan：先 core，再 coding workflow，最后 presentation。

## 拆分后的计划文档

### 1. Core Graph V1

文件：`docs/plans/2026-04-23-agent-core-graph-implementation-plan.md`

范围：
- state model 收敛
- planner
- executor
- tools bridge
- verifier
- reflector
- graph routing / stopReason
- runtime/tracing 最小 phase 暴露

### 2. Coding Workflow V1

文件：`docs/plans/2026-04-23-agent-coding-workflow-implementation-plan.md`

范围：
- coding intent / workflow
- tool grounding
- filesystem policy
- code world model
- task-local context
- failure taxonomy + recovery
- 可选的 repo 可读性评估

### 3. Presentation & Observability V1

文件：`docs/plans/2026-04-23-agent-presentation-observability-implementation-plan.md`

范围：
- answer composer
- 最终输出 contract
- phase tracing
- runtime/UI 阶段暴露

## 推荐执行顺序

1. `agent-core-graph-implementation-plan`
2. `agent-coding-workflow-implementation-plan`
3. `agent-presentation-observability-implementation-plan`

## 设计原则

- 先收敛状态模型，再扩能力层
- coding-specific 能力只挂在 coding workflow 下，不污染全局 graph
- answer composer 不参与动作决策，只负责收口表达
- planner 走 structured output，不复用 executor 的流式通路
- verifier 每步轻量运行，reflector 仅在异常/阻塞分支触发

