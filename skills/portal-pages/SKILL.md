---
name: openclaw-wrt-portal-pages
description: 根据用户提示生成中文为主的门户页 HTML，并通过现有 ClawWRT 门户流程发布。
user-invocable: false
---

# OpenClaw WRT 门户页生成

当用户需要生成门户页、落地页、欢迎页、提示页或认证页，并且希望页面内容适配具体场景时，使用这个 skill。

这个页面通常是用户连接 Wi-Fi 后弹出的门户页。用户看到它时，大概率已经能上网，所以页面职责是承接、说明、引导或确认，不是替用户建立网络连接。

任务分成两步：

1. 根据用户提示和场景生成 HTML。
2. 通过 `clawwrt_publish_portal_page` 发布该 HTML。

## 适用范围

- 将用户意图转换成自包含的门户页 HTML。
- 根据场景选择合适的模板。
- 保持输出足够简单，便于作为独立的门户 HTML 文件使用。
- 将生成页面发布到宿主机 nginx Web 目录，并在路由器上启用。

## 场景前提

- 页面展示时，用户已经连上 Wi-Fi，通常也已经具备网络连接。
- 文案应默认用户已在线，优先做欢迎、说明、条款确认或品牌承接。
- 除非用户明确要求认证、券码或条款流程，不要把页面写成“先登录才能上网”的语气。
- 主按钮更适合写成“继续浏览”“查看信息”“同意并继续”“返回首页”这类动作，而不是强调“现在才开始联网”。

## 不适用范围

- 路由器健康检查。
- 无线网络或客户端管理。
- 认证服务器或 VPN 配置。
- 任意路由器 shell 命令。

这些属于现有的 `clawwrt` skill。

## 语言规则

- 页面中所有可见文案默认只使用中文，包括标题、按钮、提示语、页脚、表单占位符和说明文字。
- 页面默认使用 `lang="zh-CN"`。
- 只有用户明确要求保留英文品牌名、英文口号或双语页面时，才保留英文内容。
- 如果用户没有给出品牌名，就用中文中性的网络名，比如“访客网络”或“游客网络”。
- 页面里不要混入英文按钮文案、英文说明或英文标签。
- 面向中文场景时，禁止使用英文缩写、英文按钮、英文表单提示或英文页脚文案；必要时把像 `Wi-Fi`、`IT` 这样的说法替换成中文。

## 模板选择

根据用户意图选择最贴切的模板：

- `default` - 通用、简洁、现代的无线网络弹出页。
- `welcome` - 友好欢迎页，带简短问候和明确继续按钮。
- `business` - 适合办公室、场馆或企业网络的专业页面。
- `cafe` - 更轻松、更温暖，适合咖啡馆、餐厅、休息区。
- `hotel` - 适合酒店宾客接入的精致页面。
- `terms` - 突出条款、政策确认和访客规则的页面。
- `voucher` - 需要输入验证码、券码或口令的页面。

当用户表达不够明确时，默认使用 `default`，并保持页面通用、易懂。

## 提示解析

根据用户的措辞和目标判断页面类型：

- 通用接入、无线网络弹出页或简单访客页 -> `default`。
- 用户只是连上 Wi-Fi 后看到一个品牌页、欢迎页或提示页 -> `welcome` / `default`。
- 友好欢迎页、咖啡馆欢迎语或宾客问候 -> `welcome` 或 `cafe`。
- 办公网络、企业接入或统一管理网络 -> `business`。
- 酒店宾客欢迎页或房号接入 -> `hotel`。
- 条款、政策、同意或规则确认 -> `terms`。
- 验证码、券码、口令或票据式接入 -> `voucher`。
- 活动、会议、展会或促销页面 -> `event / campaign`。

如果用户提示里包含下面信息，就提取出来：

- 品牌名或场所名。
- 标题或口号。
- 按钮文案和目标动作。
- 访客说明或补充文字。
- 券码输入、房号提示或规则条款。
- 主色调或视觉风格。

如果用户要多页方案，先生成最符合主诉求的主版本，只有在明确要求时才补充备选版本。

## 场景到模板映射

- `需要一个简洁提示页` -> `default`。
- `给我的咖啡馆做得更亲切一点` -> `cafe`。
- `酒店宾客欢迎页` -> `hotel`。
- `办公室访客无线网络` -> `business`。
- `先展示条款再放行` -> `terms`。
- `需要输入券码才能继续` -> `voucher`。
- `用于活动或推广页` -> `event / campaign`。
- `做得更有欢迎感` -> `welcome`。

优先选择最简单、最贴合的模板；如果简洁版已经足够，不要刻意做得更复杂。

## 模板结构

先按下面的结构搭页面，再填入与用户提示匹配的中文文案。

### 默认页

- 主视觉区展示网络名和简短说明。
- 一句简洁的好处说明。
- 一个主按钮，例如“继续浏览”。
- 底部放简短的访客说明或支持提示。

### 欢迎页

- 大标题欢迎语。
- 场所名或网络名。
- 一段简短问候语。
- 一个主按钮，例如“继续浏览”或“开始浏览”。

### 企业页

- 稳重的标题区和低饱和品牌感。
- 接入说明面板。
- 可选的支持或联系方式。
- 一个主按钮，例如“继续使用”或“进入内容”。

### 咖啡馆页

- 亲切的标题。
- 简短的推荐语或店铺提示。
- 可选的菜单或无线网络说明。
- 一个主按钮，例如“继续浏览”。

### 酒店页

- 面向宾客的欢迎标题。
- 如有提供，加入房号或券码提示。
- 简短的操作说明块。
- 一个主按钮，例如“继续使用”。

### 条款页

- 条款与政策摘要卡片。
- 简短的确认说明。
- 可选的关键规则列表。
- 一个主按钮，例如“同意并继续”。

### 券码页

- 券码输入面板。
- 说明券码来源的辅助文本。
- 校验或帮助提示区域。
- 一个主按钮，例如“提交券码”。

### 活动页

- 活动型标题。
- 限时提示或品牌口号。
- 如果用户要求，可加入二维码或活动信息。
- 一个主按钮，例如“查看活动”。

### 简单兜底页

如果提示无法明确归类，就用最小的三段式结构：

1. 主标题。
2. 一段说明文字。
3. 一个主按钮。

## HTML 规则

- 生成自包含的 HTML。
- 除非用户明确要求外部资源，否则内联 CSS 和 JavaScript。
- 保持响应式，优先适配手机。
- 默认页优先使用单列卡片、全宽按钮、足够大的字号和触控区域，避免桌面式左右分栏。
- iOS Safari 上优先考虑 `viewport-fit=cover`、安全区内边距、动态视口高度和输入框/按钮的最小触控高度。
- 不要加载远程图片、字体或脚本，除非用户明确要求且有本地可服务的位置。
- 文案简洁，只保留一个主动作。
- 页面要符合门户页发布契约，并支持按设备生成独立文件名。
- 除非用户明确要求更复杂的设计，否则优先单栏、移动优先布局。
- 色彩要克制，只保留一个主强调色给主按钮。
- 文案默认假设用户已经在线，不要写成“请先连接网络”“立即上网”这类建立连接的表达，除非用户明确要做认证流程。
- 除非场景需要券码或条款确认，否则不要做得很密集。
- 如果用户明确要求中文场景，则页面内不要出现英文单词、英文缩写或双语提示词。
- 最终交付必须是完整的 HTML 文档，不能只输出局部片段或未闭合的模板块。

## 生成流程

1. 认真阅读用户提示，判断场景、语气和必填信息。
2. 选择最合适的模板。
3. 用中文填充模板，包括标题、按钮文案和用户要求的字段。
4. 确保页面自包含且响应式。
5. 使用最终 HTML 和目标 `deviceId` 调用 `clawwrt_publish_portal_page`。
6. 如果用户要多个版本，一次只生成并发布一个页面。
7. 如果提示里有品牌信息，把品牌放在主视觉区和页脚，不要散落在整页各处。

## 内容填充规则

- 标题尽量控制在一句话内。
- 补充文案尽量控制在 1 到 2 句，移动端优先短句。
- 按钮文案要直接、动作明确，优先选用“继续浏览”“查看信息”“同意并继续”“返回首页”这类已联网场景文案。
- 券码、条款和访客说明使用简短提示语。
- 法律或政策文本集中放进一个小区域，不要在整页重复。
- 如果用户没有给品牌名，就用中文中性的名称，比如“访客网络”。
- 如果用户要求极简风格，就去掉次要面板、额外数据和多余装饰。

## 示例文案

把下面这些文案当作中文首稿，先按场景套进去，再根据用户语气微调。

### 默认页

- 标题：`欢迎使用 {{network_name}}`
- 正文：`您已连接到 {{network_name}}，可直接继续浏览。`
- 按钮：`继续浏览`
- 页脚：`如需帮助，请联系现场工作人员或技术支持。`

### 欢迎页

- 标题：`欢迎来到 {{venue_name}}`
- 正文：`页面已打开，继续浏览即可。`
- 按钮：`继续浏览`
- 页脚：`感谢您的光临。`

### 企业页

- 标题：`企业访客网络`
- 正文：`这是安全稳定的访客网络。`
- 按钮：`继续使用`
- 页脚：`如需帮助，请联系接待人员或技术支持。`

### 咖啡馆页

- 标题：`轻松浏览`
- 正文：`点杯饮品，慢慢浏览。`
- 按钮：`继续浏览`
- 页脚：`也请一起照顾好这里的轻松氛围。`

### 酒店页

- 标题：`宾客网络`
- 正文：`宾客网络已就绪，可继续使用。`
- 按钮：`继续使用`
- 页脚：`如有提示，请输入房号或券码。`

### 条款页

- 标题：`请先阅读并同意使用条款`
- 正文：`继续前请先查看规则。`
- 按钮：`同意并继续`
- 页脚：`继续使用即表示您接受以上条款。`

### 券码页

- 标题：`请输入接入券码`
- 正文：`请输入现场提供的券码。`
- 按钮：`提交券码`
- 页脚：`如果券码无效，请联系现场人员重新获取。`

### 活动页

- 标题：`活动信息`
- 正文：`查看活动信息，继续浏览。`
- 按钮：`查看活动`
- 页脚：`感谢您参与本次活动。`

### 语气调整

- 高端场所用语气要更克制，句子更短。
- 家庭或休闲场景用语气要更亲切温暖。
- 企业场景保持中性、专业、稳重。
- 活动页面的标题可以更有动感，按钮要更直接。

## 发布前检查

发布前，确认页面满足这些条件：

- 有明确的标题。
- 只有一个主动作。
- 仅使用自包含资源。
- 间距和字号适合手机阅读。
- 除非用户明确要模板草稿，否则不要留占位文案。
- 内容与所选场景一致。

## 模板指引

### 默认页指引

- 中性、干净的版式。
- 单列卡片布局，避免左右分栏。
- 标题和正文层级清晰，首屏不堆太多信息。
- 主按钮占满可视宽度，触控高度不低于 44px。
- 页面要兼容 iOS Safari 的地址栏收起和展开，优先使用安全区内边距和动态视口高度。

### 欢迎页指引

- 温暖的欢迎语。
- 清楚展示网络名或场所名。
- 大按钮。

### 企业页指引

- 专业字体和排版。
- 结构清晰的信息块。
- 主按钮加可选联系方式或接入提示。

### 咖啡馆页指引

- 柔和的强调色。
- 友好的文案。
- 可选的短促销语或欢迎语。

### 酒店页指引

- 精致的版式和宾客导向文案。
- 清晰的接入说明。
- 如用户要求，可加入房号或券码提示。

### 条款页指引

- 条款摘要区块。
- 以确认同意为目标的按钮。
- 除非用户提供完整政策，否则法律文案保持简短。

### 券码页指引

- 让券码输入框更突出。
- 有清晰的校验或继续按钮。
- 如果提示里有券码来源，要顺带说明清楚。

## 起始 HTML 模板

下面是精简的参考骨架。填入占位符，保留内联 CSS，并删掉场景不需要的字段。

下面这套基础样式适合所有模板共用，尤其是企业、酒店、条款、券码和活动页。生成完整 HTML 时，优先复用这些类，而不是为每个页面单独写一套桌面式布局。
在此基础上，欢迎页、企业页、咖啡馆页、酒店页、条款页、券码页和活动页可以只替换强调色和少量语气，而不是重做整套结构。

### 默认页模板

```html
<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
		<title>{{network_name}} 欢迎页</title>
		<style>
			:root {
				color-scheme: light;
				--bg: #edf2f7;
				--panel: rgba(255, 255, 255, 0.96);
				--text: #101828;
				--muted: #5b6475;
				--accent: #0f766e;
				--accent-soft: rgba(15, 118, 110, 0.12);
			}
			* { box-sizing: border-box; }
			html, body { min-height: 100%; }
			body {
				margin: 0;
				min-height: 100vh;
				min-height: 100svh;
				min-height: 100dvh;
				-webkit-text-size-adjust: 100%;
				text-size-adjust: 100%;
				-webkit-font-smoothing: antialiased;
				-webkit-tap-highlight-color: transparent;
				background:
					radial-gradient(circle at 20% 0%, #ffffff 0%, #f6f8fb 34%, var(--bg) 100%);
				color: var(--text);
				font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
			}
			.wrap {
				min-height: 100vh;
				min-height: 100svh;
				min-height: 100dvh;
				display: grid;
				place-items: center;
				padding:
					max(16px, env(safe-area-inset-top))
					max(16px, env(safe-area-inset-right))
					max(16px, env(safe-area-inset-bottom))
					max(16px, env(safe-area-inset-left));
			}
			.card {
				position: relative;
				overflow: hidden;
				width: min(100%, 480px);
				background: var(--panel);
				border: 1px solid rgba(15, 23, 42, 0.08);
				border-radius: 28px;
				padding: clamp(24px, 6vw, 36px);
				box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
				backdrop-filter: blur(18px);
				-webkit-backdrop-filter: blur(18px);
			}
			.card::before {
				content: "";
				position: absolute;
				inset: 0 auto auto 0;
				width: 100%;
				height: 4px;
				background: linear-gradient(90deg, var(--accent), rgba(15, 118, 110, 0.35));
			}
			.eyebrow {
				display: inline-flex;
				align-items: center;
				margin: 0 0 14px;
				padding: 6px 12px;
				border-radius: 999px;
				background: var(--accent-soft);
				color: var(--accent);
				font-size: 0.88rem;
				font-weight: 700;
				letter-spacing: 0.02em;
			}
			h1 {
				margin: 0 0 12px;
				font-size: clamp(1.8rem, 7vw, 3rem);
				line-height: 1.08;
				letter-spacing: -0.03em;
				text-wrap: balance;
				overflow-wrap: anywhere;
			}
			p {
				margin: 0 0 16px;
				color: var(--muted);
				font-size: clamp(1rem, 3.8vw, 1.06rem);
				line-height: 1.7;
				overflow-wrap: anywhere;
			}
			.cta {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 100%;
				min-height: 48px;
				padding: 14px 20px;
				border-radius: 16px;
				background: var(--accent);
				color: #fff;
				text-decoration: none;
				font-weight: 700;
				font-size: 1rem;
				box-shadow: 0 12px 24px rgba(15, 118, 110, 0.24);
				-webkit-tap-highlight-color: transparent;
			}
			.cta:active { transform: translateY(1px); }
			.cta:focus-visible,
			.voucher-form input:focus-visible,
			.voucher-form button:focus-visible {
				outline: 3px solid rgba(15, 118, 110, 0.2);
				outline-offset: 2px;
			}
			.foot {
				margin-top: 16px;
				font-size: 0.9rem;
				line-height: 1.5;
				color: var(--muted);
				overflow-wrap: anywhere;
			}
			.info-grid {
				display: grid;
				grid-template-columns: 1fr;
				gap: 12px;
				margin: 0 0 18px;
			}
			@media (min-width: 520px) {
				.info-grid {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}
			}
			.info-grid div,
			.mini-note,
			.bullets,
			.voucher-form {
				border: 1px solid rgba(15, 23, 42, 0.08);
				background: rgba(248, 250, 252, 0.92);
				border-radius: 18px;
			}
			.info-grid div {
				padding: 14px 16px;
			}
			.info-grid strong {
				display: block;
				margin-bottom: 4px;
				font-size: 0.9rem;
				color: var(--accent);
			}
			.info-grid span {
				display: block;
				line-height: 1.55;
				color: var(--text);
				overflow-wrap: anywhere;
			}
			.mini-note {
				margin: 0 0 18px;
				padding: 14px 16px;
				color: var(--text);
				background: rgba(15, 118, 110, 0.08);
			}
			.bullets {
				list-style: none;
				padding: 0;
				margin: 0 0 18px;
				overflow: hidden;
			}
			.bullets li {
				position: relative;
				padding: 14px 16px 14px 42px;
				border-top: 1px solid rgba(15, 23, 42, 0.08);
				color: var(--muted);
				line-height: 1.55;
				overflow-wrap: anywhere;
			}
			.bullets li:first-child { border-top: 0; }
			.bullets li::before {
				content: "";
				position: absolute;
				left: 16px;
				top: 1.05em;
				width: 10px;
				height: 10px;
				border-radius: 999px;
				background: var(--accent);
				transform: translateY(-50%);
			}
			.voucher-form {
				display: grid;
				gap: 12px;
				margin: 0 0 16px;
				padding: 14px;
			}
			.voucher-form input,
			.voucher-form button {
				width: 100%;
				min-height: 50px;
				border-radius: 14px;
				font: inherit;
			}
			.voucher-form input {
				padding: 14px 16px;
				border: 1px solid rgba(15, 23, 42, 0.12);
				background: #fff;
				color: var(--text);
				-webkit-appearance: none;
				appearance: none;
			}
			.voucher-form input::placeholder { color: #8b95a7; }
			.voucher-form button {
				border: 0;
				padding: 14px 18px;
				background: var(--accent);
				color: #fff;
				font-weight: 700;
				-webkit-appearance: none;
				appearance: none;
				box-shadow: 0 12px 24px rgba(15, 118, 110, 0.22);
				touch-action: manipulation;
			}
			@media (max-width: 420px) {
				.wrap {
					padding:
						max(14px, env(safe-area-inset-top))
						max(14px, env(safe-area-inset-right))
						max(14px, env(safe-area-inset-bottom))
						max(14px, env(safe-area-inset-left));
				}
				.card {
					width: 100%;
					border-radius: 24px;
					padding: 20px;
				}
				h1 {
					font-size: clamp(1.6rem, 8vw, 2.4rem);
				}
				.cta,
				.voucher-form input,
				.voucher-form button {
					min-height: 52px;
				}
			}
			.card-business {
				--accent: #334155;
				--accent-soft: rgba(51, 65, 85, 0.12);
			}
			.card-cafe {
				--accent: #b45309;
				--accent-soft: rgba(180, 83, 9, 0.12);
			}
			.card-hotel {
				--accent: #7c3aed;
				--accent-soft: rgba(124, 58, 237, 0.12);
			}
			.card-terms {
				--accent: #475569;
				--accent-soft: rgba(71, 85, 105, 0.12);
			}
			.card-voucher {
				--accent: #0f766e;
				--accent-soft: rgba(15, 118, 110, 0.12);
			}
			.card-event {
				--accent: #c2410c;
				--accent-soft: rgba(194, 65, 12, 0.12);
			}
		</style>
	</head>
	<body>
		<main class="wrap">
			<section class="card">
				<p class="eyebrow">无线网络提示</p>
				<h1>欢迎使用 {{network_name}}</h1>
				<p>{{简短说明}}</p>
				<a class="cta" href="{{cta_url}}">继续浏览</a>
				<div class="foot">{{页脚说明}}</div>
			</section>
		</main>
	</body>
</html>
```

### 欢迎页模板

```html
<main class="wrap">
	<section class="card">
		<p class="eyebrow">{{场所名称}}</p>
		<h1>{{欢迎标题}}</h1>
		<p>{{欢迎文案}}</p>
		<a class="cta" href="{{cta_url}}">继续浏览</a>
	</section>
</main>
```

### 企业页模板

```html
<main class="wrap">
	<section class="card card-business">
		<p class="eyebrow">{{单位名称}}</p>
		<h1>{{企业标题}}</h1>
		<p>{{企业说明}}</p>
		<div class="info-grid">
			<div><strong>接入</strong><span>{{接入说明}}</span></div>
			<div><strong>支持</strong><span>{{支持说明}}</span></div>
		</div>
		<a class="cta" href="{{cta_url}}">继续使用</a>
	</section>
</main>
```

### 咖啡馆页模板

```html
<main class="wrap">
	<section class="card card-cafe">
		<p class="eyebrow">{{店铺名称}}</p>
		<h1>{{咖啡馆标题}}</h1>
		<p>{{咖啡馆文案}}</p>
		<div class="mini-note">{{优惠说明}}</div>
		<a class="cta" href="{{cta_url}}">继续浏览</a>
	</section>
</main>
```

### 酒店页模板

```html
<main class="wrap">
	<section class="card card-hotel">
		<p class="eyebrow">{{酒店名称}}</p>
		<h1>{{酒店标题}}</h1>
		<p>{{酒店说明}}</p>
		<ul class="bullets">
			<li>{{宾客步骤一}}</li>
			<li>{{宾客步骤二}}</li>
		</ul>
		<a class="cta" href="{{cta_url}}">继续使用</a>
	</section>
</main>
```

### 条款页模板

```html
<main class="wrap">
	<section class="card card-terms">
		<p class="eyebrow">使用条款</p>
		<h1>{{条款标题}}</h1>
		<p>{{条款摘要}}</p>
		<ul class="bullets">
			<li>{{规则一}}</li>
			<li>{{规则二}}</li>
			<li>{{规则三}}</li>
		</ul>
		<a class="cta" href="{{cta_url}}">同意并继续</a>
	</section>
</main>
```

### 券码页模板

```html
<main class="wrap">
	<section class="card card-voucher">
		<p class="eyebrow">券码接入</p>
		<h1>{{券码标题}}</h1>
		<p>{{券码说明}}</p>
		<form class="voucher-form">
			<input type="text" name="code" placeholder="请输入券码" aria-label="券码" />
			<button type="submit">提交券码</button>
		</form>
		<div class="foot">{{券码帮助}}</div>
	</section>
</main>
```

### 活动页模板

```html
<main class="wrap">
	<section class="card card-event">
		<p class="eyebrow">{{活动名称}}</p>
		<h1>{{活动标题}}</h1>
		<p>{{活动说明}}</p>
		<div class="info-grid">
			<div><strong>时间</strong><span>{{活动时间}}</span></div>
			<div><strong>地点</strong><span>{{活动地点}}</span></div>
		</div>
		<a class="cta" href="{{cta_url}}">查看活动</a>
	</section>
</main>
```

### 共享规则

- 主按钮只保留一种强调色。
- 只有在需要券码输入或条款确认时才使用表单。
- 文案保持简短，字号要易读。
- 只添加场景真正需要的字段。

## 发布

使用 `clawwrt_publish_portal_page` 把生成的 HTML 写入宿主机 nginx Web 目录中的设备专属门户文件，然后启用路由器侧的本地门户流程。

如果用户要非默认的 Web 目录，就通过工具的可选 `webRoot` 字段传入。
