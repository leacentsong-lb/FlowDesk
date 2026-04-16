# Agent Perception System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete perception system for the current FlowDesk Agent so workflow code reads deterministic state truth and the LLM reads only compiled context snapshots.

**Architecture:** Add a new `src/agent/perception` kernel with an event bus, state store, reducers, projectors, selectors, and a context compiler. Then integrate existing signal sources (`runtime`, `release session`, `tool results`, `workspace`, `memory`) into that kernel and migrate prompt building / workflow guards to read from selectors instead of ad-hoc state assembly.

**Tech Stack:** Vue 3, Pinia, Tauri 2, Vitest, LangGraph, OpenAI-compatible tool calling

---

### Task 1: Create the perception kernel skeleton

**Files:**
- Create: `src/agent/perception/index.js`
- Create: `src/agent/perception/event-types.js`
- Create: `src/agent/perception/bus.js`
- Create: `src/agent/perception/store.js`
- Test: `src/agent/perception/__tests__/bus.test.js`
- Test: `src/agent/perception/__tests__/store.test.js`

**Step 1: Write the failing tests**

Cover at least:
- `createPerceptionBus()` supports `publish()` and `subscribe()`
- unsubscribe stops later notifications
- `createPerceptionStore()` returns initial empty state
- `replaceState()` and `patchState()` update snapshots immutably

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/perception/__tests__/bus.test.js src/agent/perception/__tests__/store.test.js
```

Expected: FAIL because the perception files do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `createPerceptionBus()` with `{ publish, subscribe }`
- `createInitialPerceptionState()`
- `createPerceptionStore()` with `{ getState, replaceState, patchState, resetState }`
- export event type constants like:
  - `WORKSPACE_UPDATED`
  - `MEMORY_UPDATED`
  - `RELEASE_SESSION_UPDATED`
  - `TOOL_RESULT_RECEIVED`
  - `RUNTIME_RUN_STARTED`

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/perception/__tests__/bus.test.js src/agent/perception/__tests__/store.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/perception/index.js src/agent/perception/event-types.js src/agent/perception/bus.js src/agent/perception/store.js src/agent/perception/__tests__/bus.test.js src/agent/perception/__tests__/store.test.js
git commit -m "feat(agent-perception-kernel): add event bus and state store"
```

### Task 2: Add reducers and freshness helpers for fact state

**Files:**
- Create: `src/agent/perception/reducers.js`
- Create: `src/agent/perception/freshness.js`
- Test: `src/agent/perception/__tests__/reducers.test.js`
- Test: `src/agent/perception/__tests__/freshness.test.js`

**Step 1: Write the failing tests**

Cover at least:
- workspace events update `facts.workspace`
- memory events update `facts.memory`
- release session events update `facts.release`
- tool result events update `facts.tools.lastResults`
- `isExpired()` returns true when `expiresAt` is in the past
- `computeFreshness()` returns `fresh | stale | expired`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/perception/__tests__/reducers.test.js src/agent/perception/__tests__/freshness.test.js
```

Expected: FAIL because reducers and freshness helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `reducePerceptionEvent(state, event)`
- state branches:
  - `facts.workspace`
  - `facts.release`
  - `facts.tools`
  - `facts.memory`
  - `facts.runtime`
- freshness helpers:
  - `toExpiresAt(ts, ttlMs)`
  - `isExpired(record, now)`
  - `computeFreshness(record, now)`

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/perception/__tests__/reducers.test.js src/agent/perception/__tests__/freshness.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/perception/reducers.js src/agent/perception/freshness.js src/agent/perception/__tests__/reducers.test.js src/agent/perception/__tests__/freshness.test.js
git commit -m "feat(agent-perception-facts): add reducers and freshness helpers"
```

### Task 3: Add projectors for derived state

**Files:**
- Create: `src/agent/perception/projectors.js`
- Test: `src/agent/perception/__tests__/projectors.test.js`

**Step 1: Write the failing tests**

Cover at least:
- `workspaceRepoFresh` is true only when repo scan exists and is fresh
- `shouldPrimeWorkspaceSkill` becomes true for workspace mapping questions
- `isReleaseBlocked` becomes true when blocked steps exist or pending approval exists
- `canProceedDangerousStep` becomes false when release is blocked
- `nextRecommendedStep` resolves from current release session step data

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/perception/__tests__/projectors.test.js
```

Expected: FAIL because projectors do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `derivePerceptionState(state, options?)`
- derived branches:
  - `derived.workspaceRepoFresh`
  - `derived.shouldPrimeWorkspaceSkill`
  - `derived.isReleaseBlocked`
  - `derived.hasPendingApproval`
  - `derived.canProceedDangerousStep`
  - `derived.nextRecommendedStep`
  - `derived.contextRiskLevel`

Use existing release session fields from `src/stores/release.js` and `src/agent/workflows/release-session.js` instead of inventing new step semantics.

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/perception/__tests__/projectors.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/perception/projectors.js src/agent/perception/__tests__/projectors.test.js
git commit -m "feat(agent-perception-derived-state): add perception projectors"
```

### Task 4: Add selectors and the context compiler

**Files:**
- Create: `src/agent/perception/selectors.js`
- Create: `src/agent/perception/compiler.js`
- Test: `src/agent/perception/__tests__/selectors.test.js`
- Test: `src/agent/perception/__tests__/compiler.test.js`
- Modify: `src/agent/context.js`
- Test: `src/agent/__tests__/context.test.js`

**Step 1: Write the failing tests**

Cover at least:
- `selectWorkflowState()` returns workflow-safe state for code paths
- `selectReleaseGateState()` returns `blocked/pending approval/next step`
- `compileContextSnapshot()` returns only relevant facts, blockers, memory summary, tool summary, risk, and next actions
- `buildPromptMessages()` can render `compiledContext` when passed in state
- old direct memory/tool/workflow sections do not duplicate when compiled context exists

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/perception/__tests__/selectors.test.js src/agent/perception/__tests__/compiler.test.js src/agent/__tests__/context.test.js
```

Expected: FAIL because selectors/compiler do not exist and `context.js` does not support compiled context yet.

**Step 3: Write minimal implementation**

Implement:
- `selectWorkflowState(state)`
- `selectReleaseGateState(state)`
- `selectPromptInputs(state)`
- `compileContextSnapshot({ state, userText, availableTools, workflowId })`

Update `src/agent/context.js`:
- prefer `state.compiledContext` if present
- render a compact snapshot section
- keep backward compatibility for current callers

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/perception/__tests__/selectors.test.js src/agent/perception/__tests__/compiler.test.js src/agent/__tests__/context.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/perception/selectors.js src/agent/perception/compiler.js src/agent/context.js src/agent/perception/__tests__/selectors.test.js src/agent/perception/__tests__/compiler.test.js src/agent/__tests__/context.test.js
git commit -m "feat(agent-perception-context): add selectors and prompt compiler"
```

### Task 5: Integrate perception into runtime bootstrap

**Files:**
- Modify: `src/agent/runtime.js`
- Create: `src/agent/perception/collectors/runtime.js`
- Create: `src/agent/perception/collectors/memory.js`
- Test: `src/agent/__tests__/runtime.test.js`

**Step 1: Write the failing tests**

Cover at least:
- starting a run publishes runtime start event
- loaded memories publish memory update event
- primed skills appear in perception-backed compiled context
- runtime passes `compiledContext` into `agentLoop` state

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/__tests__/runtime.test.js
```

Expected: FAIL because runtime does not initialize or publish into perception yet.

**Step 3: Write minimal implementation**

In `src/agent/runtime.js`:
- create or receive a perception kernel instance
- publish:
  - `RUNTIME_RUN_STARTED`
  - `MEMORY_UPDATED`
  - `WORKFLOW_CONTEXT_UPDATED` (if needed)
- call `compileContextSnapshot()` before `agentLoop`
- pass `compiledContext` through `state`

Implement collectors:
- `collectRuntimeRunStarted(...)`
- `collectMemoryLoaded(...)`

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/__tests__/runtime.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/runtime.js src/agent/perception/collectors/runtime.js src/agent/perception/collectors/memory.js src/agent/__tests__/runtime.test.js
git commit -m "feat(agent-perception-runtime): integrate runtime with perception state"
```

### Task 6: Integrate tool results and graph events into perception

**Files:**
- Modify: `src/agent/graph.js`
- Modify: `src/agent/loop.js`
- Create: `src/agent/perception/collectors/tools.js`
- Create: `src/agent/perception/collectors/workspace.js`
- Test: `src/agent/__tests__/graph.test.js`
- Test: `src/agent/__tests__/tracing.test.js`
- Test: `src/agent/tools/__tests__/workspace.test.js`

**Step 1: Write the failing tests**

Cover at least:
- tool completion publishes `TOOL_RESULT_RECEIVED`
- workspace scan tool publishes `WORKSPACE_UPDATED`
- graph tool results update perception facts before the next model round
- traces still record sanitized tool/network events after integration

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/tracing.test.js src/agent/tools/__tests__/workspace.test.js
```

Expected: FAIL because graph/tool handlers do not publish perception events yet.

**Step 3: Write minimal implementation**

Update graph/loop:
- after each tool result, publish a tool result event
- if tool name is `scan_workspace_repos`, also publish workspace event with `repos` and `path`
- keep trace order unchanged: trace first-class logging must still work

Implement collectors:
- `collectToolResult(...)`
- `collectWorkspaceScanResult(...)`

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/__tests__/graph.test.js src/agent/__tests__/tracing.test.js src/agent/tools/__tests__/workspace.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/graph.js src/agent/loop.js src/agent/perception/collectors/tools.js src/agent/perception/collectors/workspace.js src/agent/__tests__/graph.test.js src/agent/__tests__/tracing.test.js src/agent/tools/__tests__/workspace.test.js
git commit -m "feat(agent-perception-tools): capture tool and workspace events"
```

### Task 7: Integrate release workflow and guard logic with perception selectors

**Files:**
- Modify: `src/stores/release.js`
- Create: `src/agent/perception/collectors/release.js`
- Test: `src/stores/__tests__/release-routing.test.js`
- Test: `src/stores/__tests__/release-skill-priming.test.js`
- Test: `src/stores/__tests__/release.test.js`

**Step 1: Write the failing tests**

Cover at least:
- release session changes publish `RELEASE_SESSION_UPDATED`
- `beforeToolCall` reads `selectReleaseGateState()` rather than local ad-hoc conditions
- release continuation messages still keep sticky workflow behavior
- dangerous release tools stay blocked until approval is reflected in perception state

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/stores/__tests__/release-routing.test.js src/stores/__tests__/release-skill-priming.test.js src/stores/__tests__/release.test.js
```

Expected: FAIL because release store does not yet publish/consume perception state.

**Step 3: Write minimal implementation**

Update `src/stores/release.js`:
- publish release session update events whenever local session changes
- replace direct gate checks with selector results from perception state
- keep existing UX behavior unchanged

Implement:
- `collectReleaseSessionUpdated(...)`

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/stores/__tests__/release-routing.test.js src/stores/__tests__/release-skill-priming.test.js src/stores/__tests__/release.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/release.js src/agent/perception/collectors/release.js src/stores/__tests__/release-routing.test.js src/stores/__tests__/release-skill-priming.test.js src/stores/__tests__/release.test.js
git commit -m "feat(agent-perception-release): wire release workflow to perception selectors"
```

### Task 8: Add perception tracing snapshot and debug surface

**Files:**
- Modify: `src/agent/tracing.js`
- Modify: `src/agent/runtime.js`
- Create: `src/agent/perception/__tests__/integration.test.js`
- Test: `src/agent/__tests__/tracing.test.js`

**Step 1: Write the failing tests**

Cover at least:
- trace snapshot contains the compiled context summary, not full raw state dump
- perception state changes remain sanitized in trace output
- end-to-end run shows runtime -> perception -> compiler -> graph -> tool result flow

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/perception/__tests__/integration.test.js src/agent/__tests__/tracing.test.js
```

Expected: FAIL because trace does not include perception-aware snapshot metadata yet.

**Step 3: Write minimal implementation**

Update tracing/runtime:
- attach compact perception metadata to trace session
- never dump secrets or full prompt memory bodies
- persist only:
  - workflowId
  - risk level
  - blockers
  - next actions
  - relevant fact keys

**Step 4: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/perception/__tests__/integration.test.js src/agent/__tests__/tracing.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/tracing.js src/agent/runtime.js src/agent/perception/__tests__/integration.test.js src/agent/__tests__/tracing.test.js
git commit -m "feat(agent-perception-debug): add perception-aware trace snapshots"
```

### Task 9: Verify the whole agent path

**Files:**
- Verify only: `src/agent/**`, `src/stores/release.js`, `docs/plans/2026-04-16-agent-perception-system-implementation-plan.md`

**Step 1: Run targeted verification**

Run:

```bash
npm test -- src/agent/perception/__tests__/bus.test.js src/agent/perception/__tests__/store.test.js src/agent/perception/__tests__/reducers.test.js src/agent/perception/__tests__/freshness.test.js src/agent/perception/__tests__/projectors.test.js src/agent/perception/__tests__/selectors.test.js src/agent/perception/__tests__/compiler.test.js src/agent/perception/__tests__/integration.test.js src/agent/__tests__/context.test.js src/agent/__tests__/graph.test.js src/agent/__tests__/runtime.test.js src/agent/__tests__/tracing.test.js src/agent/tools/__tests__/workspace.test.js src/stores/__tests__/release-routing.test.js src/stores/__tests__/release-skill-priming.test.js src/stores/__tests__/release.test.js
```

Expected: PASS

**Step 2: Run one regression slice for the current agent runtime**

Run:

```bash
npm test -- src/agent/__tests__/loop-stream.test.js src/agent/__tests__/loop-invalid-tool-call.test.js src/agent/__tests__/memory.test.js
```

Expected: PASS

**Step 3: Commit final integration**

```bash
git add src/agent src/stores/release.js docs/plans/2026-04-16-agent-perception-system-implementation-plan.md
git commit -m "feat(agent-perception-system): add complete perception system"
```

