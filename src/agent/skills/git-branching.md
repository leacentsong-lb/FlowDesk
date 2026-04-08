---
name: git-branching
description: git相关操作都使用此skills，git commit， git branch等
---

# Git 分支策略

## Branch-Aware Commit Writer

### Purpose

Generate and execute a compliant commit message based on current branch suffix, while always using `feat` as commit type.

### Workflow

1. Read current branch name.
2. Extract branch suffix as scope.
3. Review staged diff to understand the change, but do **not** change commit type from `feat`.
4. Build commit header:
   - `feat(<scope>): <subject>`
5. Validate before commit:
   - scope equals branch suffix
   - English subject
   - type must start with `feat`
   - no malformed punctuation/casing
6. Commit and print final message.

### Fallback Rules

- If branch has no `/`, use entire branch name as scope.
- If branch suffix is not ticket-like, still use exact suffix and warn user.
- Even for bugfix / rollback / release-only changes, keep `feat` unless the user gives a stronger explicit override.

### Commit Message Rules

- scope 默认取 **当前分支最后一段 suffix**
  - `feat/CRMCN-11186` -> scope = `CRMCN-11186`
  - `feature/member-login/CRMCN-11186` -> scope = `CRMCN-11186`
  - `hotfix/no-jira` -> scope = `no-jira`
- 如果分支没有 `/`，scope 就使用整个分支名
- 如果 suffix 不是 Jira / ticket 风格，也不要私自改写；应保留 exact suffix，并提醒用户当前 scope 不是 ticket-like
- subject 使用简短英文、小写开头、描述本次改动本身
- header 固定为：
  - `feat(<scope>): <subject>`
- staged diff 用于帮助生成准确 subject，不用于切换成 `fix` / `revert` / `chore` / `build`

### Output Example

- Branch: `feat/CRMCN-11186`
- Commit: `feat(CRMCN-11186): show fixed amount hint at clear minimum boundary`

## commit message examples by branch

- 分支：`feat/CRMCN-100078`
  - commit：`feat(CRMCN-100078): add new login function`
- 分支：`feature/member/CRMCN-45678-login`
  - commit：`feat(CRMCN-45678): improve member login flow`
- 分支：`chore/local-dev`
  - commit：`feat(local-dev): improve local dev workflow`
- 分支：`hotfix/no-jira`
  - commit：`feat(no-jira): adjust hotfix guard logic`
- 分支：`rollback/payment-copy`
  - commit：`feat(payment-copy): rollback incorrect payment copy`
- 分支：`release/v3.8.2`
  - commit：`feat(v3.8.2): bump release version metadata`

## 分支命名

- `latest` — 主稳定分支，线上最新代码的分支。
- `release/v{version}` — 发布分支， Example：release/v3.8.2
- `feat/{JiraKey}` — 常见功能分支, example: `feat/CRMCN-123`
- `feature/.../{JiraKey}-...` — 只要分支里带 Jira Key，commit message 仍按 `feat({JiraKey}): ...`
- `hotfix/{ticket}-{desc}` — 紧急修复分支

## 常用 Git 检查命令

```bash
# 检查远程分支是否存在
git fetch origin --prune
git branch -r --list "origin/release/v3.8.2"

# 检查 behind/ahead
git rev-list --count origin/release/v3.8.2..origin/latest

# 检查合并冲突（dry run）
git merge-base origin/latest origin/release/v3.8.2
git merge-tree <base-sha> origin/latest origin/release/v3.8.2

# 检查工作区是否干净
git status --porcelain
```

## 冲突处理原则

- latest → release 如果有冲突，说明 release 分支上有独立修改
- 解决方案：在 release 分支上创建一个 merge commit，手动解决冲突
- 不要在 latest 上 rebase release

## PR 关联规则

- PR title 或 head branch 中包含 Jira issue key（如 CRMCN-1234）
- Agent 通过正则 `/[A-Z][A-Z0-9]+-\d+/g` 自动匹配

## 禁止

- 禁止主动push代码
- 禁止git删除操作
- 禁止主动 git merge 操作
