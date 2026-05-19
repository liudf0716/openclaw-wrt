---
name: openclaw-wrt-portal-pages
description: 生成商用级别的中文门户页 (Portal) HTML，采用现代玻璃拟态设计，并通过 ClawWRT 流程发布。
user-invocable: false
---

# OpenClaw WRT 门户页生成

## 两步发布工作流

门户页的生成与发布是严格分离的两个工具，必须按顺序调用：

1. **`clawwrt_generate_portal_page`**（第一步）  
   渲染 HTML 并写入 VPS nginx webroot（从 `/etc/nginx/sites-enabled/default` 自动检测），返回：
   - `details.filePath`：nginx webroot 中的完整文件路径（如 `/var/www/html/portal-AW123.html`）
   - `details.pageName`：文件名

2. **`clawwrt_publish_portal_page`**（第二步）  
   接受上一步的 `filePath`，读取文件内容后通过 chawrtd 的 `/v1/vps/public-ip` 获取 VPS 公网 IP，组装门户 URL，并将其下发到路由器。  
   必须传入：
   - `filePath = details.filePath`（来自第一步的返回值）
   - `pageName = details.pageName`（可选，建议同时传入）

> **不要**跳过 generate 步骤直接调用 publish。HTML 文件必须由 generate 先写到 webroot。

## 代码驱动设计

- HTML 模板源码在 [src/portal-page-renderer.ts](src/portal-page-renderer.ts)。
- **商用级审美**：页面采用 HSL 精准调色、动态三层 Blob 背景、以及高级玻璃拟态 (Glassmorphism) 原生 CSS 开发。
- **自动配色**：不同模板内置了最符合行业心智的配色（如咖啡厅琥珀色、企业深蓝色），除非用户指定，否则无需干预。



## 输出要求

- **主动询问与定制**：在调用生成工具前，Agent 应当主动询问或确认关键文案信息（如品牌名称、场馆名、网络名、特定欢迎语等）。如果用户没有提供，不要直接使用全默认值跑工具，应提示用户：“我可以为您定制品牌名、标题、上网规则等，您有具体要求吗？”。
- **参数映射**：将收集到的信息精准映射到 `content` 参数的对应字段（如 `brandName`, `title`, `body`, `rules`, `voucherLabel` 等）。
- **视觉反馈**：告诉用户生成的页面是“商用级、适配深色模式、具有高度玻璃拟态质感和动态背景”的高端页面。
- **默认合规**：所有生成的页面默认包含“服务条款与隐私政策”协议勾选框。
- **多端适配**：文案优先中文，单列布局，针对移动设备进行了视口优化。
- **动态特性**：告知用户背景具备流动的视觉动画效果。
- 除非用户明确要求，否则不要写成“先联网再继续”。
- 每个龙虾 WiFi 默认生成独立文件名，避免冲突。
