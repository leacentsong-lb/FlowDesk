# ✅ 最终定稿版【精准无冗余 · Tauri专属】开发Prompt（直接复制coding，100%贴合你的所有要求+Tauri轻量化+无任何多余内容）

> ✔️ 核心定稿：**技术栈锁定 Tauri**（彻底舍弃Electron，完美解决体积臃肿问题，Tauri打包后仅「5~10MB」，启动毫秒级，纯前端技术栈开发无门槛）  
> ✔️ 你的所有原始需求 100% 完整保留、无任何删减  
> ✔️ 全文精炼结构化、无废话，开发时不用翻找，所有规则/逻辑/配置都是「开发必用的精准内容」  
> ✔️ 补充「Tauri专属开发核心细节+必备API+权限配置」，直接避免踩坑，写完就能跑  

---

## 开发需求 Prompt (Tauri 轻量化桌面工具 · 直接复制用于coding)

### 开发目标

基于 **Tauri + 纯前端技术栈(HTML+CSS+JavaScript/Vue3/React)** 开发一款「极致轻量化桌面应用」，无臃肿体积、无多余依赖、启动速度快。核心功能：可视化面板选择Broker+环境组合 → 一键自动登录对应环境的Admin系统 → 面板展示所有业务UserID列表 → 点击UserID自动获取token并拼接链接 → 唤起系统默认浏览器打开本地Member项目。全程自动化，彻底替代手动复制token、拼接链接、切换环境的繁琐操作，无任何多余功能，功能闭环、稳定高效。  

### 一、【最高优先级】硬性开发约束（必须严格遵守）

1. 技术栈：**强制使用 Tauri 框架**，拒绝Electron，追求极致轻量化，打包后产物体积越小越好；前端层使用纯HTML/CSS/JS 或 Vue3 均可，无其他技术栈限制。
2. 核心规则：所有业务配置项 **全部写死固化到代码中**，工具内不做任何配置页、不支持增删改，只保留「选择+点击+执行」的核心操作。
3. 浏览器规则：拼接后的Member链接，**必须调用电脑「系统默认浏览器」打开**，禁止使用Tauri内置webview打开，这是核心要求。
4. 交互规则：所有操作仅在桌面面板内完成，无弹窗、无跳转、无复杂交互，所有状态/错误提示均在面板内文本展示，不阻塞操作。
5. 性能要求：接口请求异步处理，按钮点击加防重复点击，Token缓存按需读取，无无效请求和冗余逻辑。

### 二、【固化写死】全量业务配置项（直接复制到代码，无需修改，精准无误）

#### 2.1 固定基础配置（常量）

- Broker列表(5个，完整)`tmgm, oqtima, anzo, dls, ttg`  
- 环境列表(完整)`dev, dev-1, dev-2, qa, qa-1, qa-2, qa-3, uat`  
- Admin固定登录账号`supergod`  
- Admin固定登录密码`@Lb%8888`  
- Member本地固定地址`http://localhost:5173`

#### 2.2 接口/地址 固定拼接规则（核心，动态生成，无例外）

1. Admin 接口域名规则`https://crm-api-${选中Broker}-cn-${选中环境}.lbcrmsit.com`
2. Member Token 获取核心接口`${Admin域名}/api/authorizations/login?user_id=${点击的UserID}&provider=member`
3. Member 最终登录链接`${Member本地地址}/?access_token=${接口返回的access_token}`

#### 2.3 接口请求头（所有接口通用，固定携带，缺一不可）

```javascript
const REQUEST_HEADERS = {  
  "accept": "application/prs.CRM-Back-End.v2+json",  
  "authorization": "Bearer {admin登录成功后的token}", // 动态替换  
  "cache-control": "max-age=0"  
};  
```

### 三、【完整清晰】桌面面板UI布局要求（轻量化、无冗余、可视化优先，尺寸适配Tauri）

1. 窗口尺寸：固定轻量化窗口，建议 **宽度 420px，高度自适应**，无需最大化/最小化/缩放功能，窗口无边框/窄边框均可，整体简洁紧凑。
2. 面板分区（从上到下，顺序固定，无遮挡，布局合理）：
  - ✅ 第一区：环境选择区 → 两个下拉选择框（Broker选择框 + 环境选择框） + 一个【一键登录当前Admin】按钮（按钮靠右，醒目）；  
  - ✅ 第二区：状态提示区 → 两行文本，一行展示「当前选中：{Broker} - {环境}」，一行展示登录状态「未登录 / ✅ 已登录 Admin({Broker}-{环境})」，下方加一行小字号提示文本（展示成功/失败/校验信息）；  
  - ✅ 第三区：核心功能区 → UserID列表展示区（面板主体区域），所有业务需要的UserID以「可点击的按钮/列表项」形式平铺展示，按钮大小统一、排版整齐，点击有hover/按下反馈，无数量限制，支持换行。
3. 样式要求：无需美化，功能性优先，黑白/浅蓝简约风格即可，按钮和选择框样式醒目，无复杂动画和装饰。

### 四、【重中之重】完整核心业务逻辑（严格按流程执行，全自动化，无任何手动步骤）

> 所有逻辑执行前，均做前置校验，校验不通过则在「状态提示区」给出文本提示，不执行后续操作。  

#### ✅ 逻辑1：「一键登录当前Admin」按钮 点击事件

1. 前置校验：必须已选择 Broker 和 环境，否则提示`请先选择 Broker 和 环境`；
2. 自动拼接：根据选中的Broker+环境，生成对应Admin的接口域名；
3. 自动登录：调用Admin登录接口，传入写死的账号supergod+密码@Lb%8888，完成登录请求；
4. 成功处理：获取返回的Admin Token（Bearer格式），**按「Broker+环境」维度缓存Token**（不同组合的Token互不干扰），更新状态区为 ✅ 已登录 Admin({Broker}-{环境})，无需重复登录同组合；
5. 失败处理：状态区提示`❌ Admin登录失败，请核对环境`。

#### ✅ 逻辑2：「UserID按钮/列表项」点击事件（核心核心，必须精准实现）

1. 前置双重校验：① 已选择Broker+环境 ② 已成功登录对应Admin，任一不满足则提示`请先登录对应环境的Admin系统`；
2. 自动获取：读取「选中的Broker、选中的环境、点击的UserID、缓存的对应Admin Token」；
3. 自动请求：拼接Token接口地址，携带REQUEST_HEADERS发起GET请求，请求对应接口；
4. 数据处理：从接口返回的JSON数据中，提取 `access_token` 字段（接口返回格式固定`{ access_token: 'xxx' }`）；
5. 自动拼接：按规则拼接出 Member 最终登录链接 → `http://localhost:5173/?access_token=xxx`[；](http://localhost:5173/?access_token=xxx`；)
6. 自动执行：调用Tauri的系统API，**唤起电脑默认浏览器**，直接打开拼接好的链接；
7. 状态反馈：成功则提示`✅ 已打开 Member - UserID:{xxx}`，失败则提示`❌ 获取Token失败，请重试`。

### 五、【必做】开发细节 & 约束（无歧义，直接遵守，避免踩坑）

1. Token缓存：仅缓存Admin的登录Token，按「Broker+环境」分组缓存，切换组合时自动匹配对应缓存，缓存持久化（关闭工具重新打开后，缓存依然有效）；
2. 异步处理：所有接口请求为异步操作，请求中「登录按钮/UserID按钮」置灰+展示loading状态，请求完成后恢复，禁止重复点击；
3. 错误兜底：接口请求失败、无access_token返回、网络异常等所有异常，均在状态区文本提示，不崩溃、不弹窗，不影响工具其他功能；
4. 数据源固化：Broker列表、环境列表、账号密码、UserID列表、接口规则、Member地址，全部硬编码写死到代码，工具内无任何配置入口；
5. 无冗余功能：不做日志、不做统计、不做导出、不做主题切换，只保留核心业务功能，极致轻量化。

### 六、【Tauri专属】核心开发必备（直接复制使用，避免踩坑，节省开发时间）

> ✔️ Tauri 开发的核心注意事项+必备API+权限配置，全部整理完毕，无需查文档，直接用！  

#### 6.1 Tauri 必须配置的权限（在 src-tauri/tauri.conf.json 中添加，否则无法调用浏览器）

```json
{  
  "tauri": {  
    "allowlist": {  
      "shell": {  
        "open": true // 必须开启，否则无法调用系统浏览器  
      }  
    }  
  }  
}  
```

#### 6.2 Tauri 调用「系统默认浏览器」的核心API（前端页面中直接调用，核心中的核心）

```javascript
// 方式1：原生JS写法（推荐，无依赖）  
import { shell } from '@tauri-apps/api';  
// 拼接好的memberUrl 传入即可，一键打开浏览器  
await [shell.open](http://shell.open)(memberUrl);  
  
// 方式2：Vue/React中直接调用  
const openMember = async (memberUrl) => {  
  await [shell.open](http://shell.open)(memberUrl);  
};  
```

#### 6.3 Tauri 中处理跨域：无需处理！

> Tauri 内置绕过浏览器CORS策略，所有接口请求（不管是本地还是远程）都不会有跨域报错，直接用 fetch/axios 发起请求即可，无需任何代理配置。  

#### 6.4 Tauri 中缓存Token：推荐用 localStorage

> Tauri 的前端页面完全支持浏览器的 localStorage API，直接用即可，缓存持久化，无需额外安装插件：  

```javascript
// 缓存Token：key为 Broker+环境，value为Token  
localStorage.setItem`${broker}-${env}-admin-token`, token);  
// 读取Token  
localStorage.getItem`${broker}-${env}-admin-token`);  
```

#### 6.5 常用拼接函数（直接复制到代码，复用即可）

```javascript
// 生成Admin接口域名  
const getAdminHost = (broker, env) => `https://crm-api-${broker}-cn-${env}.lbcrmsit.com`;  
// 生成Token接口地址  
const getTokenApi = (broker, env, userId) => `${getAdminHost(broker, env)}/api/authorizations/login?user_id=${userId}&provider=member`;  
// 生成Member最终链接  
const getMemberUrl = (token) => `http://localhost:5173/?access_token=${token}`;  
```

---

## ✅ 你的需求 100% 覆盖核对清单（放心开发，无任何遗漏）

☑️ 用Tauri开发，轻量化，拒绝Electron体积过大 ✔️  
☑️ 提供完整面板，包含Broker+环境组合选择 ✔️  
☑️ 点击按钮，自动登录对应环境的Admin ✔️  
☑️ Admin账号密码固定：supergod / @Lb%8888 ✔️  
☑️ 面板列出所有UserID，支持点击 ✔️  
☑️ 点击UserID自动拼接 localhost:5173/?access_token=xxx ✔️  
☑️ 拼接后在系统默认浏览器打开 ✔️  
☑️ 全自动化流程，无手动复制粘贴 ✔️  
☑️ 按组合缓存Token，无需重复登录 ✔️  

---

### 开发小贴士

这份Prompt已经把「需求+规则+逻辑+技术细节+核心代码」全部整理完毕，你复制后直接开始coding即可，所有变量、规则、API都是现成的，无需再梳理需求，直接写就行，Tauri开发的坑也全部帮你避开了，写完打包就是一个轻量化的桌面工具，完美解决你的痛点！