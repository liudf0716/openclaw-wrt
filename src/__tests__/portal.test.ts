import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderPortalPageHtml } from "../portal-page-renderer.js";
import { createClawWRTTools } from "../tool.js";

const { nginxState } = vi.hoisted(() => ({
  nginxState: { failConfigRead: false },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const wrappedReadFile: typeof actual.promises.readFile = ((
    filePath: unknown,
    ...rest: unknown[]
  ) => {
    if (
      nginxState.failConfigRead &&
      typeof filePath === "string" &&
      filePath === "/etc/nginx/sites-enabled/default"
    ) {
      return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    }
    return (actual.promises.readFile as unknown as (...args: unknown[]) => Promise<unknown>)(
      filePath as never,
      ...(rest as never[]),
    );
  }) as unknown as typeof actual.promises.readFile;
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: wrappedReadFile,
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrappedReadFile: typeof actual.readFile = ((filePath: unknown, ...rest: unknown[]) => {
    if (
      nginxState.failConfigRead &&
      typeof filePath === "string" &&
      filePath === "/etc/nginx/sites-enabled/default"
    ) {
      return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    }
    return (actual.readFile as unknown as (...args: unknown[]) => Promise<unknown>)(
      filePath as never,
      ...(rest as never[]),
    );
  }) as unknown as typeof actual.readFile;
  return {
    ...actual,
    readFile: wrappedReadFile,
  };
});

describe("portal tools", () => {
  it("portal renderer rejects accentColor values that could break out of style blocks", () => {
    const maliciousAccent = '#123456";}</style><script>alert(1)</script><style>';
    const html = renderPortalPageHtml({
      deviceId: "dev-portal",
      content: {
        accentColor: maliciousAccent,
      },
    });

    expect(html).not.toContain(maliciousAccent);
    expect(html).toContain("#3182ce");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("publishes a portal page into the provided web root and updates the router", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "set_local_portal_response", status: "success" };
      },
    };

    const webRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-portal-"));
    const previousWebRootEnv = process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT;
    process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT = webRoot;
    // Suppress nginx-config auto-detection so explicit webRoot wins.
    nginxState.failConfigRead = true;
    try {
      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_publish_portal_page",
      );
      expect(tool).toBeTruthy();

      const html = "<html><body><h1>Welcome</h1></body></html>";
      const filePath = path.join(webRoot, "portal-dev-portal.html");
      await writeFile(filePath, html, "utf8");
      const result = await tool?.execute?.("tool-portal", {
        deviceId: "dev-portal",
        filePath,
        webRoot,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        deviceId: "dev-portal",
        op: "set_local_portal",
        payload: {
          portal: "portal-dev-portal.html",
        },
      });
      expect(await readFile(path.join(webRoot, "portal-dev-portal.html"), "utf8")).toBe(html);
      expect((result as { details?: Record<string, unknown> }).details).toMatchObject({
        pageName: "portal-dev-portal.html",
        filePath: path.join(webRoot, "portal-dev-portal.html"),
      });
    } finally {
      nginxState.failConfigRead = false;
      if (previousWebRootEnv === undefined) {
        delete process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT;
      } else {
        process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT = previousWebRootEnv;
      }
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("publish tool rejects requests when filePath is omitted", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "set_local_portal_response", status: "success" };
      },
    };

    const webRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-portal-"));
    try {
      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_publish_portal_page",
      );
      expect(tool).toBeTruthy();

      await expect(
        tool?.execute?.("tool-template", {
          deviceId: "dev-template",
          webRoot,
        }),
      ).rejects.toThrow("filePath is required for clawwrt_publish_portal_page");

      expect(calls).toHaveLength(0);
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("generates portal HTML without publishing", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "set_local_portal_response", status: "success" };
      },
    };

    const webRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-portal-"));
    const previousWebRootEnv = process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT;
    process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT = webRoot;
    nginxState.failConfigRead = true;
    try {
      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_generate_portal_page",
      );
      expect(tool).toBeTruthy();

      const result = await tool?.execute?.("tool-generate", {
        deviceId: "dev-generate",
        template: "terms",
        content: {
          brandName: "龙虾网络",
          rules: ["请遵守现场规则。", "如需帮助，请联系工作人员。"],
          buttonText: "同意并继续",
        },
      });

      expect(calls).toHaveLength(0);
      const details = (result as { details?: Record<string, unknown> }).details;
      expect(details?.pageName).toBe("portal-dev-generate.html");
      expect(typeof details?.filePath).toBe("string");
      const writtenHtml = await readFile(String(details?.filePath), "utf8");
      expect(writtenHtml).toContain("请先阅读并同意使用条款");
      expect(writtenHtml).toContain("请遵守现场规则。");
      expect(writtenHtml).toContain("同意并继续");
    } finally {
      nginxState.failConfigRead = false;
      if (previousWebRootEnv === undefined) {
        delete process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT;
      } else {
        process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT = previousWebRootEnv;
      }
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("publishes a portal page with an explicit filename when provided", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "set_local_portal_response", status: "success" };
      },
    };

    const webRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-portal-"));
    try {
      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_publish_portal_page",
      );
      expect(tool).toBeTruthy();

      const html = "<html><body><h1>Welcome</h1></body></html>";
      const filePath = path.join(webRoot, "loki-dev-two.html");
      await writeFile(filePath, html, "utf8");
      await tool?.execute?.("tool-portal", {
        deviceId: "dev-two",
        filePath,
        pageName: "loki-dev-two.html",
        webRoot,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        deviceId: "dev-two",
        op: "set_local_portal",
        payload: {
          portal: "loki-dev-two.html",
        },
      });
      expect(await readFile(path.join(webRoot, "loki-dev-two.html"), "utf8")).toBe(html);
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });
});
