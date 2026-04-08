---
name: release-flow
description: 前端多仓库发布流程的完整规范和最佳实践
---

# 发布流程规范

## 分支策略

- `latest` — 长期稳定分支，所有功能最终合入此处
- `release/v{version}` — 发布分支，从 latest 切出，用于预发布验证
- 功能分支 → PR → 合入 release 分支 → 发布后合入 latest

## 标准发布步骤

1. **凭证检查** — 确认 Jira 和 GitHub 凭证可用
2. **版本确认** — 从 Jira 获取未发布版本，用户选择本次发布的版本号
3. **Issue 范围** — 获取该版本下所有 Jira issue，了解发布内容
4. **PR 合并检查** — 扫描所有仓库，确认与 issue 关联的 PR 已全部合并到 release 分支
5. **发布预检** — 检查 release 分支存在、latest 分支存在、package.json 版本号匹配、无合并冲突
6. **构建验证** — pnpm run build 通过

## 阻塞条件（硬门禁）

以下任一条件不满足，必须阻塞发布：
- 存在未合并的 PR
- release 分支不存在
- package.json 版本号与 release 分支后缀不一致
- latest → release 存在合并冲突
- pnpm build 失败

## 版本号规范

- 版本号格式：`x.y.z`（语义化版本）
- release 分支命名：`release/v{x.y.z}`
- package.json 中的 version 字段必须与分支名中的版本号一致
