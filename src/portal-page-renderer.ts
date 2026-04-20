export const PORTAL_TEMPLATE_VALUES = [
  "default",
  "welcome",
  "business",
  "cafe",
  "hotel",
  "terms",
  "voucher",
  "event",
] as const;

export type PortalTemplate = (typeof PORTAL_TEMPLATE_VALUES)[number];

export type PortalContent = {
  brandName?: string;
  networkName?: string;
  venueName?: string;
  title?: string;
  body?: string;
  buttonText?: string;
  footerText?: string;
  supportText?: string;
  voucherLabel?: string;
  voucherHint?: string;
  rules?: string[];
  accentColor?: string;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readPortalText(input: unknown): string {
  return typeof input === "string" && input.trim() ? input.trim() : "";
}

function pickPortalText(...values: unknown[]): string {
  for (const value of values) {
    const text = readPortalText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function portalColor(accentColor?: string): string {
  return readPortalText(accentColor) || "#2563eb";
}

function buildPortalContext(params: { deviceId: string; template?: PortalTemplate; content?: PortalContent }) {
  const content = params.content ?? {};
  const networkName = pickPortalText(content.networkName, content.brandName, "访客网络");
  const venueName = pickPortalText(content.venueName, content.brandName, networkName);
  const title = pickPortalText(content.title);
  const body = pickPortalText(content.body, content.supportText);
  const buttonText = pickPortalText(content.buttonText);
  const footerText = pickPortalText(content.footerText);
  const accentColor = portalColor(content.accentColor);

  return {
    template: params.template ?? "default",
    deviceId: params.deviceId,
    networkName,
    venueName,
    title,
    body,
    buttonText,
    footerText,
    supportText: readPortalText(content.supportText),
    voucherLabel: pickPortalText(content.voucherLabel, "接入券码"),
    voucherHint: pickPortalText(content.voucherHint, "请输入现场提供的券码。"),
    rules: Array.isArray(content.rules) ? content.rules.map((rule) => rule.trim()).filter(Boolean) : [],
    accentColor,
  };
}

export function renderPortalPageHtml(params: {
  deviceId: string;
  template?: PortalTemplate;
  content?: PortalContent;
}): string {
  const ctx = buildPortalContext(params);
  const escapedNetwork = escapeHtml(ctx.networkName);
  const escapedVenue = escapeHtml(ctx.venueName);
  const escapedTitle = escapeHtml(
    ctx.title ||
      (ctx.template === "welcome"
        ? `欢迎来到 ${ctx.venueName}`
        : ctx.template === "business"
          ? "企业访客网络"
          : ctx.template === "cafe"
            ? "轻松浏览"
            : ctx.template === "hotel"
              ? "宾客网络"
              : ctx.template === "terms"
                ? "请先阅读并同意使用条款"
                : ctx.template === "voucher"
                  ? "请输入接入券码"
                  : ctx.template === "event"
                    ? "欢迎参与本次活动"
                    : `欢迎使用 ${ctx.networkName}`),
  );
  const escapedBody = escapeHtml(
    ctx.body ||
      (ctx.template === "welcome"
        ? "页面已打开，继续浏览即可。"
        : ctx.template === "business"
          ? "这是安全稳定的访客网络。"
          : ctx.template === "cafe"
            ? "点杯饮品，慢慢浏览。"
            : ctx.template === "hotel"
              ? "宾客网络已就绪，可继续使用。"
              : ctx.template === "terms"
                ? "继续前请先查看规则。"
                : ctx.template === "voucher"
                  ? "请输入现场提供的券码。"
                  : ctx.template === "event"
                    ? "活动页面已准备好，可继续查看详情。"
                    : `您已连接到 ${ctx.networkName}，可直接继续浏览。`),
  );
  const buttonText = escapeHtml(
    ctx.buttonText ||
      (ctx.template === "terms"
        ? "同意并继续"
        : ctx.template === "voucher"
          ? "提交券码"
          : ctx.template === "business"
            ? "继续使用"
            : ctx.template === "hotel"
              ? "继续使用"
              : ctx.template === "event"
                ? "查看活动"
                : "继续浏览"),
  );
  const footerText = escapeHtml(
    ctx.footerText ||
      (ctx.template === "terms"
        ? "继续使用即表示您接受以上条款。"
        : ctx.template === "voucher"
          ? "如果券码无效，请联系现场人员重新获取。"
          : ctx.template === "business"
            ? "如需帮助，请联系接待人员或技术支持。"
            : ctx.template === "cafe"
              ? "也请一起照顾好这里的轻松氛围。"
              : ctx.template === "hotel"
                ? "如有提示，请输入房号或券码。"
                : ctx.template === "event"
                  ? "感谢您的参与。"
                  : "如需帮助，请联系现场工作人员或技术支持."),
  );
  const supportText = escapeHtml(ctx.supportText);
  const rules = ctx.rules.length > 0 ? ctx.rules : ["请遵守现场网络使用规则。", "如需帮助，请联系现场工作人员。"];
  const rulesHtml = rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("");

  const sharedStyles = `
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: rgba(255, 255, 255, 0.9);
      --text: #14213d;
      --muted: #5f6b85;
      --line: rgba(20, 33, 61, 0.12);
      --shadow: 0 24px 80px rgba(20, 33, 61, 0.14);
      --accent: ${ctx.accentColor};
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at top, rgba(37, 99, 235, 0.12), transparent 34%),
        linear-gradient(180deg, #ffffff 0%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    }
    .shell {
      width: min(100%, 560px);
    }
    .card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--panel);
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
      padding: 28px 22px 22px;
    }
    .accent {
      width: 72px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
      margin-bottom: 18px;
    }
    .eyebrow {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 12px;
    }
    .eyebrow span {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.08);
      color: var(--accent);
      font-weight: 700;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(28px, 7vw, 42px);
      line-height: 1.08;
      letter-spacing: -0.03em;
    }
    .body {
      margin: 0;
      font-size: 16px;
      line-height: 1.75;
      color: var(--muted);
    }
    .meta {
      margin-top: 18px;
      display: grid;
      gap: 12px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.72);
      padding: 16px;
    }
    .panel-title {
      margin: 0 0 8px;
      font-size: 14px;
      color: var(--muted);
    }
    .rules {
      margin: 0;
      padding-left: 18px;
      color: var(--text);
      line-height: 1.7;
    }
    .voucher {
      display: grid;
      gap: 10px;
    }
    .voucher label {
      font-weight: 700;
    }
    .voucher input {
      width: 100%;
      min-height: 48px;
      border-radius: 14px;
      border: 1px solid var(--line);
      padding: 12px 14px;
      font: inherit;
      background: #fff;
    }
    .voucher input::placeholder { color: #93a0ba; }
    .actions { margin-top: 20px; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 52px;
      padding: 14px 18px;
      border: 0;
      border-radius: 16px;
      background: var(--accent);
      color: white;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 16px 30px color-mix(in srgb, var(--accent) 28%, transparent);
    }
    .footer {
      margin-top: 16px;
      font-size: 13px;
      line-height: 1.7;
      color: var(--muted);
      text-align: center;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .chip {
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(20, 33, 61, 0.05);
      color: var(--text);
      font-size: 13px;
    }
    @media (max-width: 480px) {
      .card { padding: 22px 16px 18px; border-radius: 24px; }
    }
  `;

  const commonHeader = `
    <div class="eyebrow"><span>${escapedNetwork}</span>${escapedVenue && escapedVenue !== escapedNetwork ? `<strong>${escapedVenue}</strong>` : ""}</div>
    <div class="accent"></div>
    <h1>${escapedTitle}</h1>
    <p class="body">${escapedBody}</p>
  `;

  const mainContent =
    ctx.template === "terms"
      ? `
        ${commonHeader}
        <div class="meta">
          <div class="panel">
            <p class="panel-title">使用条款</p>
            <ul class="rules">${rulesHtml}</ul>
          </div>
        </div>
      `
      : ctx.template === "voucher"
        ? `
          ${commonHeader}
          <div class="meta">
            <div class="panel voucher">
              <label for="voucher-code">${escapeHtml(ctx.voucherLabel)}</label>
              <input id="voucher-code" name="voucher-code" type="text" inputmode="text" autocomplete="one-time-code" placeholder="${escapeHtml(ctx.voucherHint)}" />
              ${supportText ? `<div class="body">${supportText}</div>` : ""}
            </div>
          </div>
        `
      : `
        ${commonHeader}
        ${supportText ? `<div class="meta"><div class="panel"><p class="panel-title">补充说明</p><div class="body">${supportText}</div></div></div>` : ""}
        ${ctx.template === "event" ? `<div class="chips"><span class="chip">限时活动</span><span class="chip">继续浏览</span></div>` : ""}
      `;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="${ctx.accentColor}" />
    <title>${escapedTitle}</title>
    <style>${sharedStyles}</style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        ${mainContent}
        <div class="actions">
          <a class="button" href="#continue">${buttonText}</a>
        </div>
        <div class="footer">${footerText}</div>
      </section>
    </main>
  </body>
</html>`;
}
