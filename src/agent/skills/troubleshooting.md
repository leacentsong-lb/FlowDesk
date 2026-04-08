---
name: troubleshooting
description: 发布过程中常见问题的排查和解决方案
---

# 常见问题排查

## PR 未合并

**现象**：scan_pr_status 报告存在未合并的 PR

**排查步骤**：
1. 确认 PR 的 target branch 是否正确（应为 `release/v{version}`）
2. 检查 PR 是否有 review 尚未完成
3. 检查 CI 是否通过
4. 如果是误报（PR title 意外匹配了 issue key），可以忽略

**解决**：合并 PR 后重新执行 scan_pr_status

## package.json 版本号不匹配

**现象**：run_preflight 报告版本号不一致

**排查步骤**：
1. 读取仓库的 package.json 检查实际版本号
2. 确认 release 分支是否正确切出
3. 是否忘记更新 package.json

**解决**：在 release 分支上修正 package.json 的 version 字段

## 合并冲突

**现象**：run_preflight 报告 latest → release 存在冲突

**排查步骤**：
1. 用 `git merge-tree` 查看冲突文件
2. 确认冲突是否来自 release 分支上的独立修改

**解决**：在 release 分支上 merge latest 并手动解决冲突

## 构建失败

**现象**：run_build 报告 pnpm build 失败

**排查步骤**：
1. 查看 build 日志中的错误信息
2. 常见原因：TypeScript 类型错误、缺少依赖、环境变量未配置
3. 尝试本地 `pnpm install && pnpm build` 复现

**解决**：修复代码错误后重新构建

## 凭证问题

**Jira 401**：API Token 过期或邮箱不正确
**GitHub 401**：Personal Access Token 过期或缺少 `repo` scope
**DeepSeek 401**：API Key 无效或余额不足
