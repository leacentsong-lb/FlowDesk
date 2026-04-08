# Agent P0 Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the current `src/agent` implementation behave more like a stable production agent by adding hard routing, memory injection, deterministic skill triggering, safer shell execution, and basic traceability.

**Architecture:** Keep the existing single-agent loop, but add a thin orchestration layer before and around it. The key change is moving critical behavior out of “prompt suggestions” and into deterministic code paths in the store, loop, and tool boundary. Skills remain useful, but no longer rely purely on the model remembering to call them.

**Tech Stack:** Vue 3, Pinia, Tauri 2, Vitest, Rust Tauri commands, OpenAI-compatible tool calling

---

### Task 1: Add an explicit intent router before `agentLoop`

**Files:**
- Create: `src/agent/router.js`
- Modify: `src/stores/release.js`
- Test: `src/agent/__tests__/router.test.js`
- Test: `src/stores/__tests__/release-routing.test.js`

**Step 1: Write the failing router unit tests**

Cover at least these cases:
- `分析当前工作区有哪些仓库` → `general` + `workspace_inventory`
- `admin 对应哪个仓库` → `general` + `workspace_mapping`
- `发布生产环境` → `release` + `release_flow`
- `请读一下 src/agent/context.js` → `general` + `file_explain`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/__tests__/router.test.js src/stores/__tests__/release-routing.test.js
```

Expected: FAIL because `router.js` and route-driven behavior do not exist yet.

**Step 3: Implement minimal router**

Create `src/agent/router.js` exporting a pure function like:

```js
routeAgentIntent(userText) => {
  mode,
  intent,
  shouldPrimeWorkspaceSkill,
  shouldScanWorkspaceFirst
}
```

Rules:
- Workspace / repo / folder / path / admin / staff / backend / AI系统 → `general`
- 发布 / release / jira / pr / preflight / build / version → `release`
- Explicit file-read intent → `general`
- Default fallback → `general`

**Step 4: Wire router into the store**

In `src/stores/release.js`:
- Route every user message before `agentLoop`
- Set `mode` deterministically before loop start
- Preserve existing release flow behavior
- Do not let casual workspace questions accidentally switch into release mode

**Step 5: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/__tests__/router.test.js src/stores/__tests__/release-routing.test.js
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/agent/router.js src/stores/release.js src/agent/__tests__/router.test.js src/stores/__tests__/release-routing.test.js
git commit -m "feat(agent-routing): add deterministic intent routing"
```

---

### Task 2: Add project memory and user memory injection

**Files:**
- Create: `src/agent/memory.js`
- Modify: `src/agent/context.js`
- Modify: `src/agent/loop.js`
- Modify: `src/stores/release.js`
- Test: `src/agent/__tests__/memory.test.js`
- Test: `src/agent/__tests__/context.test.js`

**Step 1: Write the failing memory tests**

Cover at least:
- Project memory path resolves from current workspace, e.g. `<workspace>/.flow-desk/AGENT.md`
- User memory path resolves from a stable user location, e.g. `~/.flow-desk/AGENT.md`
- Missing files do not break prompt building
- Prompt includes memory summaries when present

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/__tests__/memory.test.js src/agent/__tests__/context.test.js
```

Expected: FAIL because memory loader does not exist yet.

**Step 3: Implement memory loader**

Create `src/agent/memory.js` with:
- `getProjectMemoryPath(workspacePath)`
- `getUserMemoryPath()`
- `loadAgentMemories({ workspacePath })`

Design constraints:
- No crash on missing files
- Truncate aggressively for prompt safety
- Return structured data:
  - `projectMemory`
  - `userMemory`
  - `sources`

**Step 4: Inject memory into prompt build**

In `src/agent/context.js`:
- Add a dedicated “Memory” section
- Keep it concise
- Prefer short summaries over full file dumps

In `src/stores/release.js` or `src/agent/loop.js`:
- Load memory before building prompt state
- Pass memory-derived summary into `buildSystemPrompt`

**Step 5: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/__tests__/memory.test.js src/agent/__tests__/context.test.js
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/agent/memory.js src/agent/context.js src/agent/loop.js src/stores/release.js src/agent/__tests__/memory.test.js src/agent/__tests__/context.test.js
git commit -m "feat(agent-memory): inject project and user memory"
```

---

### Task 3: Make workspace skill triggering deterministic

**Files:**
- Modify: `src/stores/release.js`
- Modify: `src/agent/loop.js`
- Modify: `src/agent/context.js`
- Test: `src/stores/__tests__/release-skill-priming.test.js`

**Step 1: Write the failing skill-priming tests**

Cover:
- Message `admin 对应哪个仓库` primes `workspace-topology`
- Message `后台系统是哪一个 repo` primes `workspace-topology`
- Message `发布生产环境` does **not** pre-load `workspace-topology`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/stores/__tests__/release-skill-priming.test.js
```

Expected: FAIL because the current system relies on prompt guidance only.

**Step 3: Implement pre-loop skill priming**

Design:
- If router returns `shouldPrimeWorkspaceSkill`, inject a synthetic assistant/tool exchange or a system-side “preloaded knowledge” payload before the main loop
- Keep this deterministic; do not wait for model discretion
- Do not spam-load the same skill repeatedly in one session

Recommended state additions:
- `loadedSkills: Set<string>` or equivalent session cache

**Step 4: Keep prompt guidance minimal**

In `src/agent/context.js`:
- Keep “when to use skill” guidance
- But remove any wording that suggests the model must always decide this itself

**Step 5: Run tests to verify it passes**

Run:

```bash
npm test -- src/stores/__tests__/release-skill-priming.test.js
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/release.js src/agent/loop.js src/agent/context.js src/stores/__tests__/release-skill-priming.test.js
git commit -m "feat(agent-skill-priming): make workspace skill loading deterministic"
```

---

### Task 4: Tighten `run_command` and reduce shell overreach

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`
- Modify: `src/agent/tools/command.js`
- Modify: `src/agent/context.js`
- Test: `src/agent/tools/__tests__/command-policy.test.js`

**Step 1: Write the failing command policy tests**

Cover:
- Command allowed inside workspace
- Command rejected outside workspace when `cwd` escapes current workspace
- Dangerous patterns rejected with stable error shape
- Missing workspace path fails closed for risky shell usage

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/tools/__tests__/command-policy.test.js
```

Expected: FAIL because the current command tool is too permissive.

**Step 3: Implement minimal command guardrails**

In `src-tauri/src/commands/agent.rs`:
- Accept current workspace path as an explicit parameter, or at minimum validate `cwd`
- Reject execution outside current workspace root
- Expand the denylist cautiously
- Return structured rejection results

In `src/agent/tools/command.js`:
- Pass workspace context through
- Keep schema explicit about intended use as a fallback tool

**Step 4: Update agent policy text**

In `src/agent/context.js`:
- Tell the model to prefer typed tools over shell
- Describe `run_command` as last-resort fallback

**Step 5: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/tools/__tests__/command-policy.test.js
cargo check
```

Expected: PASS and Rust compile succeeds.

**Step 6: Commit**

```bash
git add src-tauri/src/commands/agent.rs src/agent/tools/command.js src/agent/context.js src/agent/tools/__tests__/command-policy.test.js
git commit -m "feat(agent-guardrails): tighten shell command boundaries"
```

---

### Task 5: Add basic traceability for each agent turn

**Files:**
- Create: `src/agent/tracing.js`
- Modify: `src/agent/loop.js`
- Modify: `src/stores/release.js`
- Test: `src/agent/__tests__/tracing.test.js`

**Step 1: Write the failing tracing tests**

Cover:
- Each loop round records:
  - mode
  - workspace path
  - user text
  - chosen tool calls
  - tool results
  - final answer
- Trace store truncates old entries safely

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/agent/__tests__/tracing.test.js
```

Expected: FAIL because trace capture does not exist yet.

**Step 3: Implement lightweight tracing**

Create `src/agent/tracing.js` with helpers like:
- `createTraceSession()`
- `recordTraceEvent()`
- `finalizeTrace()`

In `src/agent/loop.js`:
- Record each model call
- Record each tool dispatch
- Record terminal output

In `src/stores/release.js`:
- Keep a rolling buffer, e.g. latest 20 traces
- Expose them for future debug UI

**Step 4: Keep tracing local-only**

Do not add remote telemetry yet.
Do not block the user flow if tracing fails.

**Step 5: Run tests to verify it passes**

Run:

```bash
npm test -- src/agent/__tests__/tracing.test.js
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/agent/tracing.js src/agent/loop.js src/stores/release.js src/agent/__tests__/tracing.test.js
git commit -m "feat(agent-tracing): add local trace capture for agent turns"
```

---

### Task 6: Full verification and regression sweep

**Files:**
- Verify only: `src/agent/**`, `src/stores/release.js`, `src-tauri/src/commands/agent.rs`

**Step 1: Run targeted agent tests**

```bash
npm test -- src/agent/__tests__/context.test.js src/agent/__tests__/router.test.js src/agent/__tests__/memory.test.js src/agent/__tests__/tracing.test.js src/agent/tools/__tests__/workspace.test.js src/agent/tools/__tests__/command-policy.test.js src/stores/__tests__/release-routing.test.js src/stores/__tests__/release-skill-priming.test.js
```

Expected: PASS

**Step 2: Run full frontend test suite**

```bash
npm test
```

Expected: PASS

**Step 3: Run Rust verification**

```bash
cd src-tauri && cargo check
```

Expected: PASS

**Step 4: Manual verification checklist**

Validate these chat prompts manually in the app:
- `分析当前工作区的代码仓库都有哪些，列出名称`
- `admin 对应哪些仓库`
- `后台系统是哪个 repo`
- `请读取 src/agent/context.js 并总结`
- `发布生产环境，请开始`

Expected:
- Workspace questions stay in general mode
- Release question switches to release mode
- Repo mapping questions are stable
- No accidental shell overuse

**Step 5: Final commit**

```bash
git add src/agent src/stores/release.js src-tauri/src/commands/agent.rs docs/plans/2026-04-08-agent-p0-hardening-implementation.md
git commit -m "feat(agent-p0-hardening): improve routing memory safety and tracing"
```
