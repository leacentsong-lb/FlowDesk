---
name: workspace-topology
description: Use when the user mentions CRM system names, repo names, folder names, local paths, admin, Staff, backend, AI system, or asks which repository or app should be used in the current LifeByteCodes workspace
---

# LifeByteCodes 工作区拓扑

## Overview

这份 skill 用于把当前工作区中的**应用名、别名、仓库名、本地文件夹路径**对应起来。

当用户提到系统名、品牌名、repo 名、文件夹名、本地路径时，优先使用本 skill，不要只靠目录名或 `package.json.name` 猜测。

## 当前工作区

- 当前工作区根目录由 App 设置动态提供
- 本 skill 记录的是**仓库身份与相对目录名**
- 需要本地绝对路径时，用：`当前工作区根目录 + 相对目录名`

## 强制规则

- 优先按**明确仓库名**匹配。
- 若用户说“AI系统” / “AI服务系统” / “AI服务”，默认指 `ai-enhancer-system`。
- 若用户说“admin” / “Admin系统” / “Admin后台” / “Staff系统” / “Staff后台” / “后台配置系统”，默认指 Staff 系统，不是后端 API。
- 若用户说“后台系统”且可能同时指后端 API 或 Staff 配置端，先做一次简短澄清。
- “Member” 默认指客户 C 端系统；不同品牌 Member 仓库大体同源，但存在品牌定制。
- 若同一应用对应多个仓库，回答或执行前先列出涉及的仓库。
- 不要仅根据 `package.json.name` 判断仓库身份，因为多个仓库的包名是通用值：
  - Staff 前端仓库包名可能是 `crm`
  - Member 前端仓库包名可能是 `member`

## 主要应用映射

### AI 服务系统

- 应用名：AI服务系统
- 默认别名：AI系统、AI服务系统、AI服务
- 主仓库：`ai-enhancer-system`
- 相对目录名：`ai-enhancer-system`
- Git 远程：`lifebyte-systems/ai-enhancer-system`

### 后台 API 系统

- 应用名：后台 API
- 常见指代：后端、后台 API
- 仓库：`TMGM-CRM-Back-End`
- 相对目录名：`TMGM-CRM-Back-End`
- Git 远程：`lifebyte-systems/TMGM-CRM-Back-End`
- 注意：如果用户说“后台系统”，不要直接假定是它；先判断是否可能是在说 Staff 配置端。

### Staff / Admin 系统

- 应用名：Staff系统
- 默认别名：admin、Admin系统、Admin后台、Staff系统、Staff后台、后台配置系统
- 关联仓库：
  - `TMGM-CRM-Staff-Front-End`
    - 相对目录名：`TMGM-CRM-Staff-Front-End`
    - Git 远程：`lifebyte-systems/TMGM-CRM-Staff-Front-End`
  - `TMGM-CRM-Staff-Front-End-Mobile`
    - 相对目录名：`TMGM-CRM-Staff-Front-End-Mobile`
    - Git 远程：`lifebyte-systems/TMGM-CRM-Staff-Front-End-Mobile`

### Member 系统（客户 C 端）

- 应用名：Member
- 含义：品牌客户前台 / C 端系统
- 说明：以下仓库大体同源，但按品牌定制

#### TMGM

- 品牌：TMGM
- 仓库：`TMGM-CRM-Member-Frontend`
- 相对目录名：`TMGM-CRM-Member-Frontend`
- Git 远程：`lifebyte-systems/TMGM-CRM-Member-Frontend`

#### OQTIMA

- 品牌：OQTIMA
- 仓库：`OQTIMA-CRM-Member-Frontend`
- 相对目录名：`OQTIMA-CRM-Member-Frontend`
- Git 远程：`lifebyte-systems/OQTIMA-CRM-Member-Frontend`

#### ANZO

- 品牌：ANZO
- 仓库：`ANZO-CRM-Member-Frontend`
- 相对目录名：`ANZO-CRM-Member-Frontend`
- Git 远程：`lifebyte-systems/ANZO-CRM-Member-Frontend`

#### DLS

- 品牌：DLS
- 仓库：`DLS-CRM-Member-Frontend`
- 相对目录名：`DLS-CRM-Member-Frontend`
- Git 远程：`lifebyte-systems/DLS-CRM-Member-Frontend`

#### TTG

- 品牌：TTG
- 仓库：`TTG-CRM-Member-Frontend`
- 相对目录名：`TTG-CRM-Member-Frontend`
- Git 远程：`lifebyte-systems/TTG-CRM-Member-Frontend`

## 工作区中的其他仓库

这些仓库也位于当前工作区内，但不属于上面的 CRM 主映射核心集合。用户提到时再按名称精确匹配：

- `Atom-Frontend-Kit`
- `CRM-I18N`
- `CRM-Sales-Frontend`
- `I18N-Script`

## 解析顺序

当需要把“用户说法”映射到“仓库 / 路径”时，按这个顺序处理：

1. 先看用户是否给了**明确仓库名**
2. 再看是否命中本 skill 中的**系统别名**
3. 再看是否命中**品牌名 + Member** 组合
4. 如果仍存在 backend / admin / staff / 后台系统歧义，先澄清
5. 只有在上述信息不足时，才参考目录名、remote、`package.json`

## 回复要求

- 回答仓库归属时，优先同时给出：**应用名 + 仓库名 + 相对目录名**
- 如果一个应用包含多个仓库，不要只报其中一个
- 如果用户说法有歧义，不要猜，先问一句简短澄清
