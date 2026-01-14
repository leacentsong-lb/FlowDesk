# Frontend Aesthetics

## Description
指导 Claude 在生成前端代码时避免 "AI slop" 美学风格，创造具有创意、独特且令人惊喜的前端设计。

## Input
用户请求创建或修改前端界面、UI 组件、样式等。

## Output
具有独特美感的前端代码，包含精心选择的字体、配色方案、动效和背景设计。

## Constraints
- 避免使用 Inter、Roboto、Arial 等系统字体
- 避免紫色渐变配白底等俗套配色
- 避免可预测的布局和组件模式
- 避免缺乏场景特色的模板化设计

## Steps

### 1. Typography 排版
- 选择独特、优美且有趣的字体
- 避免使用 Arial、Inter 等通用字体
- 用独特的字体选择提升前端美感
- 推荐：Playfair Display、Space Mono、Fira Code、JetBrains Mono

### 2. Color & Theme 配色与主题
- 坚持统一的美学风格
- 使用 CSS 变量保持一致性
- 主色调搭配鲜明的强调色，优于分散平淡的配色方案
- 从 IDE 主题（Dracula、One Dark、Nord）和文化美学中汲取灵感

### 3. Motion 动效
- 使用动画实现视觉效果和微交互
- 优先使用纯 CSS 方案（transition/animation）
- 聚焦高影响力时刻：页面加载动画比零散的微交互更令人愉悦
- 使用 animation-delay 实现交错展现效果

### 4. Backgrounds 背景
- 营造氛围和层次感，而非默认使用纯色
- 叠加 CSS 渐变创造深度
- 使用几何图案或 SVG 图案增加质感
- 添加与整体美学契合的背景效果（如 backdrop-filter 毛玻璃效果）

## Sample Prompt

请按照 frontend-aesthetics 技能要求，为我创建一个具有独特美感的 {{组件/页面名称}}。

要求：
- 使用独特字体
- 采用 {{深色/浅色}} 主题
- 添加适当的动效
- 背景要有层次感

## Example

### Before (AI Slop 风格)
```css
body {
  font-family: Arial, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #333;
}

.card {
  background: white;
  border-radius: 8px;
  padding: 20px;
}
```

### After (独特美感)
```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@300;500;700&display=swap');

:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --accent-cyan: #58a6ff;
  --accent-green: #3fb950;
  --text-primary: #f0f6fc;
  --text-muted: #8b949e;
}

body {
  font-family: 'Outfit', sans-serif;
  background: 
    radial-gradient(ellipse at top, rgba(88, 166, 255, 0.1) 0%, transparent 50%),
    linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
  color: var(--text-primary);
  min-height: 100vh;
}

.card {
  background: rgba(22, 27, 34, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(88, 166, 255, 0.2);
  border-radius: 12px;
  padding: 24px;
  animation: fadeInUp 0.5s ease-out;
  animation-fill-mode: both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```
