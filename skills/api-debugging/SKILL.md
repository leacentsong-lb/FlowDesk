# API Debugging - 系统化调试 API 问题

## Description
指导 Claude 系统化地调试 API 调用问题，通过假设-验证-证据的方法论快速定位 API 行为差异的根本原因。

## Input
用户报告 API 调用未返回预期结果，但相同的请求在浏览器或其他环境中工作正常。

## Output
定位问题根因并提供修复方案，包括：
- 明确的问题诊断
- 运行时证据支持
- 可验证的修复代码

## Constraints
- 不基于猜测修复，必须有运行时证据
- 不一次性尝试多个修复，逐步验证假设
- 不删除调试代码直到问题确认修复

## Methodology: 假设-验证-证据循环

### Phase 1: 信息收集
1. **获取工作示例**：请求用户提供浏览器中成功的真实请求（Chrome DevTools Network 面板）
2. **对比差异**：系统对比成功请求与失败请求的差异点
   - URL 参数
   - 请求头（Headers）
   - 认证方式
   - Cookies

### Phase 2: 生成假设
针对每个差异点生成具体假设（3-5 个），例如：
- **假设 A**：缺少特定请求头（如 User-Agent）
- **假设 B**：参数作用域限制（如 isPinnedDataOnly）
- **假设 C**：认证 Token 范围不同
- **假设 D**：缺少 Cookies/Session 状态

### Phase 3: 直接验证（关键步骤）
**使用 curl 直接测试 API**，而不是通过应用代码间接测试：

```bash
# 1. 先获取有效 Token
curl -s -X POST "https://api.example.com/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=xxx&password=xxx"

# 2. 用 Token 测试 API（对比不同参数）
TOKEN="获取到的token"

# 测试 A：不带可疑参数
curl -s "https://api.example.com/users?keyword=xxx" \
  -H "Authorization: Bearer $TOKEN"

# 测试 B：带可疑参数
curl -s "https://api.example.com/users?keyword=xxx&scopeParam=1" \
  -H "Authorization: Bearer $TOKEN"
```

### Phase 4: 分析结果
| 测试条件 | 结果 | 结论 |
|---------|------|------|
| 无 scopeParam | 空结果 | ❌ |
| scopeParam=1 | 有数据 | ✅ |

**根因确认**：API 参数 `scopeParam` 控制了查询范围

### Phase 5: 修复与验证
1. 实现修复代码
2. 保留调试日志
3. 请用户验证
4. 确认成功后清理调试代码

## 典型场景：API 参数作用域问题

### 问题描述
搜索功能在应用中返回空结果，但浏览器中相同搜索有数据。

### 调试过程

**Step 1: curl 验证数据存在**
```bash
# 获取全部数据列表
curl "https://api.example.com/users?per_page=20" -H "Authorization: Bearer $TOKEN"
# 结果：包含 "targetUser"
```

**Step 2: curl 验证搜索行为**
```bash
# 搜索 targetUser
curl "https://api.example.com/users?keyword=targetUser" -H "Authorization: Bearer $TOKEN"
# 结果：空！

# 检查是否有作用域参数
curl "https://api.example.com/users?keyword=targetUser&isPinnedDataOnly=1" -H "Authorization: Bearer $TOKEN"
# 结果：找到 targetUser！
```

**Step 3: 根因分析**
- API 有两个独立作用域：收藏用户 和 普通用户
- 搜索只在当前作用域内生效
- `isPinnedDataOnly=1` 切换到收藏用户作用域
- 目标用户在收藏列表中，但搜索默认查普通列表

**Step 4: 修复方案**
```javascript
// 同时搜索两个作用域，合并结果
const [regularResult, pinnedResult] = await Promise.all([
  searchAPI(keyword),                    // 搜索普通用户
  searchAPI(keyword, { pinned: true })   // 搜索收藏用户
])

// 合并去重
const allResults = [...pinnedResult, ...regularResult]
  .filter((user, index, self) => 
    self.findIndex(u => u.id === user.id) === index
  )
```

## Checklist: API 调试检查清单

### 请求对比
- [ ] URL 路径完全一致？
- [ ] Query 参数完全一致？
- [ ] 是否有隐含的作用域参数？
- [ ] HTTP Method 一致？

### Headers 对比
- [ ] Authorization 格式一致？
- [ ] Accept 头一致？
- [ ] Content-Type 一致？
- [ ] User-Agent 是否必需？
- [ ] Referer 是否必需？

### 认证对比
- [ ] Token 来源相同（同一登录）？
- [ ] Token 权限范围相同？
- [ ] 是否依赖 Cookies？
- [ ] 是否依赖 Session 状态？

### 环境对比
- [ ] API 版本相同？
- [ ] 环境（dev/qa/prod）相同？
- [ ] 时区/语言参数相同？

## Anti-Patterns: 避免的做法

### ❌ 不要做
1. **盲目添加所有浏览器请求头** - 先验证哪个是关键的
2. **假设认证问题就修改认证代码** - 先用 curl 证明
3. **一次改多处** - 每次只改一个变量
4. **删除调试代码再验证** - 保留直到确认修复

### ✅ 应该做
1. **先用 curl 隔离问题** - 排除应用代码干扰
2. **对比成功/失败请求的最小差异**
3. **每次只修改一个参数重新测试**
4. **用日志记录每个假设的验证结果**

## Sample Prompt

```
我的 API 搜索请求返回空结果，但在浏览器中有数据。请按照 api-debugging 技能帮我排查。

成功的浏览器请求：
[粘贴 Chrome DevTools 中的 fetch 请求]

失败的代码：
[粘贴相关代码]
```
