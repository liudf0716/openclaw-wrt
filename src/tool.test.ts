import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderPortalPageHtml } from "./portal-page-renderer.js";
import { createClawWRTTools } from "./tool.js";

function defaultExecSyncMockImpl(command: string) {
  if (command.startsWith("which nwct-server")) {
    return "/usr/bin/nwct-server\n";
  }
  if (command.startsWith("sudo cat /etc/nwct/nwct-server.toml")) {
    return 'bindPort = 7000\nauth.token = "secret-token"\n';
  }
  if (command.startsWith("curl -4 -fsSL --max-time 8 https://ifconfig.me/ip")) {
    return "203.0.113.42\n";
  }
  if (command.startsWith("systemctl is-active nwct-server")) {
    return "active\n";
  }
  if (command.startsWith("sudo ss -tulpn | grep nwct-server")) {
    return 'tcp LISTEN 0 4096 0.0.0.0:7000 0.0.0.0:* users:(("nwct-server",pid=1234,fd=3))\n';
  }
  return "";
}

const { execSyncMock, execFileSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(defaultExecSyncMockImpl),
  execFileSyncMock: vi.fn((file: string, args: string[] = [], options?: { input?: string }) => {
    if (file === "wg" && args[0] === "pubkey") {
      const input = options?.input?.trim();
      if (input === "KAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") {
        return "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=\n";
      }
      if (input === "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") {
        return "n5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=\n";
      }
      return "invalid\n";
    }
    if (file === "sudo" && args[0] === "wg-quick" && args[1] === "strip") {
      return "[Interface]\nAddress = 10.0.0.1/24\n";
    }
    return "";
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: execSyncMock,
    execFileSync: execFileSyncMock,
  };
});

describe("openclaw-wrt intent tools", () => {
  it("router discovery and detail tools mention online and wireless router wording", () => {
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
    };

    const tools = createClawWRTTools({ bridge: bridge as never });
    const listTool = tools.find((entry) => entry.name === "clawwrt_list_devices");
    const getDeviceTool = tools.find((entry) => entry.name === "clawwrt_get_device");
    const getStatusTool = tools.find((entry) => entry.name === "clawwrt_get_status");

    expect(listTool?.description).toContain("online routers");
    expect(listTool?.description).toContain("wireless routers");
    expect(getDeviceTool?.description).toContain("connection snapshot");
    expect(getDeviceTool?.description).toContain("not the full runtime detail report");
    expect(getStatusTool?.description).toContain("detailed runtime status");
    expect(getStatusTool?.description).toContain("router details");
  });

  it("claw wifi hello uses getDevice snapshots for online router info", async () => {
    const getDevice = vi.fn((deviceId: string) => {
      if (deviceId === "dev-1") {
        return {
          deviceId: "dev-1",
          alias: "WiFi101",
          connectedAtMs: Date.now() - 3_600_000,
          lastSeenAtMs: Date.now() - 12_000,
          remoteAddress: "198.51.100.10",
          authMode: 2,
        };
      }
      return {
        deviceId: "dev-2",
        alias: "WiFi102",
        connectedAtMs: Date.now() - 7_200_000,
        lastSeenAtMs: Date.now() - 8_000,
        remoteAddress: "198.51.100.11",
        authMode: 1,
      };
    });

    const bridge = {
      listDevices() {
        return [{ deviceId: "dev-1" }, { deviceId: "dev-2" }];
      },
      getDevice,
      callDevice: vi.fn(),
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find((entry) => entry.name === "claw_wifi_hello");
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-hello", {});
    const resultText = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    const helloIntro = resultText.split("## 🛠️ 快捷功能导航")[0] ?? resultText;

    expect(getDevice).toHaveBeenCalledTimes(2);
    expect((bridge.callDevice as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(helloIntro).toContain("在线路由器");
    expect(helloIntro).toContain("接入时长");
    expect(helloIntro).toContain("连接快照");
    expect(helloIntro).not.toContain("在线时长");
    expect(helloIntro).toContain("WiFi101");
    expect(helloIntro).toContain("198.51.100.10");
    expect(helloIntro).toContain("WiFi102");
  });

  it("deploy frps uses secure temporary files for the config and systemd unit", async () => {
    try {
      execSyncMock.mockClear();

      const bridge = {
        listDevices() {
          return [];
        },
        getDevice() {
          return null;
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "openclaw_deploy_frps",
      );
      expect(tool).toBeTruthy();

      await tool?.execute?.("tool-deploy", {
        port: 7000,
      });

      const installCommands = execSyncMock.mock.calls
        .map(([command]) => command)
        .filter(
          (command): command is string =>
            typeof command === "string" && command.startsWith("sudo install -o root -g root -m "),
        );

      expect(installCommands.some((command) => command.includes("sudo install -o root -g root -m 600 "))).toBe(true);
      expect(installCommands.some((command) => command.includes("sudo install -o root -g root -m 644 "))).toBe(true);
    } finally {
      execSyncMock.mockClear();
    }
  });

  it("deploy frps installs the binary as root-owned when nwct-server is missing", async () => {
    const originalExecSyncImpl = execSyncMock.getMockImplementation() ?? defaultExecSyncMockImpl;
    execSyncMock.mockImplementation(((command: string): string => {
      if (command.startsWith("test -x ")) {
        throw new Error("not found");
      }
      if (command.includes("api.github.com/repos/fatedier/frp/releases/latest")) {
        return '{"tag_name":"v1.2.3"}';
      }
      if (command.includes("-o /tmp/frp_1.2.3_linux_amd64.tar.gz")) {
        return "";
      }
      if (command.startsWith("tar -C /tmp -zxvf /tmp/frp_1.2.3_linux_amd64.tar.gz")) {
        return "";
      }
      if (command.startsWith("sudo install -o root -g root -m 755 /tmp/frp_1.2.3_linux_amd64/frps /usr/bin/nwct-server")) {
        return "";
      }
      return originalExecSyncImpl(command);
    }) as any);

    try {
      const bridge = {
        listDevices() {
          return [];
        },
        getDevice() {
          return null;
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "openclaw_deploy_frps",
      );
      expect(tool).toBeTruthy();

      await tool?.execute?.("tool-deploy-binary", {
        port: 7000,
      });

      expect(
        execSyncMock.mock.calls.some(
          ([command]) =>
            typeof command === "string" &&
            command.includes("sudo install -o root -g root -m 755 /tmp/frp_1.2.3_linux_amd64/frps /usr/bin/nwct-server"),
        ),
      ).toBe(true);
    } finally {
      execSyncMock.mockImplementation(defaultExecSyncMockImpl);
    }
  });

  it("frps status redacts the auth token from returned config content", async () => {
    execSyncMock.mockClear();

    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "openclaw_get_frps_status",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-status", {});
    const resultText = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    const details = (result as { details?: Record<string, unknown> }).details;
    const configContent = details?.configContent as string | undefined;

    expect(resultText).toContain('auth.token = "[REDACTED]"');
    expect(resultText).not.toContain("secret-token");
    expect(configContent).toContain('auth.token = "[REDACTED]"');
    expect(configContent).not.toContain("secret-token");
  });

  it("detects the VPS public IP via ifconfig.me", async () => {
    execSyncMock.mockClear();

    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "openclaw_get_vps_public_ip",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-vps-ip", {});
    const details = (result as { details?: Record<string, unknown> }).details ?? {};

    expect(execSyncMock.mock.calls.some(([command]) => command === "curl -4 -fsSL --max-time 8 https://ifconfig.me/ip")).toBe(true);
    expect(details.status).toBe("success");
    expect(details.publicIp).toBe("203.0.113.42");
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain("203.0.113.42");
  });

  it("returns a confirmation-required error when VPS public IP detection fails", async () => {
    const originalExecSyncImpl = execSyncMock.getMockImplementation() ?? defaultExecSyncMockImpl;
    execSyncMock.mockImplementation(((command: string): string => {
      if (command.startsWith("curl -4 -fsSL --max-time 8 https://ifconfig.me/ip")) {
        throw new Error("curl: (6) Could not resolve host");
      }
      return originalExecSyncImpl(command);
    }) as any);

    try {
      const bridge = {
        listDevices() {
          return [];
        },
        getDevice() {
          return null;
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "openclaw_get_vps_public_ip",
      );
      expect(tool).toBeTruthy();

      const result = await tool?.execute?.("tool-vps-ip-fail", {});
      const details = (result as { details?: Record<string, unknown> }).details ?? {};

      expect(details.status).toBe("error");
      expect(details.requiresUserConfirmation).toBe(true);
      expect(details.requiredAction).toBe("confirm_vps_public_ip_or_domain");
      expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain("confirm the VPS public IP or domain");
    } finally {
      execSyncMock.mockImplementation(defaultExecSyncMockImpl);
    }
  });

  it("deploy wg server writes peer bindings into the generated server config in one pass", async () => {
    const originalExecSyncImpl = execSyncMock.getMockImplementation() ?? defaultExecSyncMockImpl;
    let writtenConfigSource = "";

    execSyncMock.mockImplementation(((command: string): string => {
      if (command.startsWith("command -v wg")) {
        return "/usr/bin/wg\n";
      }
      if (command.startsWith("sudo ls /etc/wireguard/server_private.key")) {
        throw new Error("missing key");
      }
      if (command.startsWith("wg genkey | sudo tee /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key")) {
        return "";
      }
      if (command.startsWith("sudo cat /etc/wireguard/server_private.key")) {
        return "server-private-key\n";
      }
      if (command.startsWith("sudo cat /etc/wireguard/server_public.key")) {
        return "server-public-key\n";
      }
      if (command.startsWith("sudo sysctl -w net.ipv4.ip_forward=1")) {
        return "";
      }
      if (command.startsWith("echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-wireguard.conf")) {
        return "";
      }
      if (command.startsWith("sudo install -o root -g root -m 600 ")) {
        const match = command.match(/^sudo install -o root -g root -m 600 (\S+) \/etc\/wireguard\/wg0\.conf$/);
        expect(match).toBeTruthy();
        writtenConfigSource = match?.[1] ?? "";
        return "";
      }
      if (command.startsWith("sudo systemctl enable wg-quick@wg0")) {
        return "";
      }
      if (command.startsWith("sudo systemctl restart wg-quick@wg0")) {
        return "";
      }
      return originalExecSyncImpl(command);
    }) as any);

    try {
      const bridge = {
        listDevices() {
          return [];
        },
        getDevice() {
          return null;
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "openclaw_deploy_wg_server",
      );
      expect(tool).toBeTruthy();

      const result = await tool?.execute?.("tool-deploy-wg", {
        port: 51820,
        tunnelIp: "10.0.0.1/24",
        egressInterface: "eth0",
        peerBindings: [
          {
            deviceId: "dev-1",
            peerPublicKey: "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
            tunnelIp: "10.0.0.2/32",
            lanCidr: "192.168.10.0/24",
          },
        ],
      });

      expect(writtenConfigSource).toMatch(/^\/tmp\/wg0-[a-f0-9]+\.conf$/);
      const config = await readFile(writtenConfigSource, "utf8");

      expect(config).toContain("Address = 10.0.0.1/24");
      expect(config).toContain("ListenPort = 51820");
      expect(config).toContain("[Peer]");
      expect(config).toContain("PublicKey = b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=");
      expect(config).toContain("AllowedIPs = 10.0.0.2/32, 192.168.10.0/24");
      expect((result as { details?: Record<string, unknown> }).details?.peerBindings).toEqual([
        {
          deviceId: "dev-1",
          tunnelIp: "10.0.0.2/32",
          lanCidr: "192.168.10.0/24",
          endpoint: undefined,
        },
      ]);
    } finally {
      execSyncMock.mockImplementation(originalExecSyncImpl);
    }
  });

  it("deploy wg server requires peer bindings before starting deployment", async () => {
    execSyncMock.mockClear();

    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "openclaw_deploy_wg_server",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-deploy-wg-empty", {
      port: 51820,
      tunnelIp: "10.0.0.1/24",
      egressInterface: "eth0",
      peerBindings: [],
    });

    expect((result as { details?: Record<string, unknown> }).details?.status).toBe("error");
    expect((result as { details?: Record<string, unknown> }).details?.missingPeerBindings).toBe(true);
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "collect every client's LAN CIDR first",
    );
    expect(execSyncMock).not.toHaveBeenCalled();
  });

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

  it("kickoff tool resolves client IP from get_clients and infers gwId from a single gateway", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return {
          deviceId: "dev-1",
          connectedAtMs: Date.now(),
          lastSeenAtMs: Date.now(),
          gateway: [{ gw_id: "gw-1" }],
        };
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        if (params.op === "get_clients") {
          return {
            type: "get_clients_response",
            clients: [{ mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.1.10" }],
          };
        }
        return {
          type: "kickoff_response",
          status: "success",
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_kickoff_client",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-1", {
      deviceId: "dev-1",
      clientMac: "aa-bb-cc-dd-ee-ff",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ op: "get_clients", deviceId: "dev-1" });
    expect(calls[1]).toMatchObject({
      op: "kickoff",
      deviceId: "dev-1",
      payload: {
        client_ip: "192.168.1.10",
        client_mac: "aa:bb:cc:dd:ee:ff",
        gw_id: "gw-1",
      },
    });
    expect((result as { details?: Record<string, unknown> }).details?.resolved).toEqual({
      clientIp: "192.168.1.10",
      gwId: "gw-1",
      clientMac: "aa:bb:cc:dd:ee:ff",
    });
  });

  it("get device tool accepts a device alias from the device list", async () => {
    const bridge = {
      listDevices() {
        return [{ deviceId: "dev-1", alias: "Router-1", connectedAtMs: 1, lastSeenAtMs: 1 }];
      },
      getDevice(deviceId: string) {
        if (deviceId === "Router-1" || deviceId === "dev-1") {
          return { deviceId: "dev-1", alias: "Router-1", connectedAtMs: 1, lastSeenAtMs: 1 };
        }
        return null;
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_get_device",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-alias", {
      deviceId: "Router-1",
    });

    expect((result as { details?: Record<string, unknown> }).details?.device).toMatchObject({
      deviceId: "dev-1",
      alias: "Router-1",
    });
  });

  it("auth client tool sends the new auth_client op with client IP and MAC", async () => {
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
        return { type: "auth_client_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_auth_client",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-auth", {
      deviceId: "dev-auth",
      clientMac: "aa-bb-cc-dd-ee-ff",
      clientIp: "192.168.1.10",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-auth",
      op: "auth_client",
      payload: {
        client_ip: "192.168.1.10",
        client_mac: "AA:BB:CC:DD:EE:FF",
      },
    });
    expect((result as { details?: Record<string, unknown> }).details?.resolved).toEqual({
      clientIp: "192.168.1.10",
      clientMac: "AA:BB:CC:DD:EE:FF",
    });
  });

  it("kickoff tool skips get_clients when clientIp and gwId are provided", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return {
          deviceId: "dev-1",
          connectedAtMs: Date.now(),
          lastSeenAtMs: Date.now(),
          gateway: [{ gw_id: "gw-1" }],
        };
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return {
          type: "kickoff_response",
          status: "success",
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_kickoff_client",
    );
    expect(tool).toBeTruthy();

    await tool?.execute?.("tool-explicit", {
      deviceId: "dev-1",
      clientMac: "aa-bb-cc-dd-ee-ff",
      clientIp: "192.168.1.20",
      gwId: "gw-explicit",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      op: "kickoff",
      deviceId: "dev-1",
      payload: {
        client_ip: "192.168.1.20",
        client_mac: "AA:BB:CC:DD:EE:FF",
        gw_id: "gw-explicit",
      },
    });
  });

  it("trusted-domain sync tool sends the full domains array as sync_trusted_domain payload", async () => {
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
        return { type: "sync_trusted_domain_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_sync_trusted_domains",
    );

    const result = await tool?.execute?.("tool-2", {
      deviceId: "dev-2",
      domains: ["example.com", "login.example.net"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-2",
      op: "sync_trusted_domain",
      payload: {
        domains: ["example.com", "login.example.net"],
      },
    });
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "Synced 2 trusted domains",
    );
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
    try {
      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_publish_portal_page",
      );
      expect(tool).toBeTruthy();

      const html = "<html><body><h1>Welcome</h1></body></html>";
      const result = await tool?.execute?.("tool-portal", {
        deviceId: "dev-portal",
        html,
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
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("renders a portal template when html is omitted", async () => {
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

      const result = await tool?.execute?.("tool-template", {
        deviceId: "dev-template",
        template: "welcome",
        content: {
          venueName: "龙虾访客网络",
          body: "页面已打开，继续浏览即可。",
          buttonText: "继续浏览",
          footerText: "感谢您的光临。",
        },
        webRoot,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        deviceId: "dev-template",
        op: "set_local_portal",
        payload: {
          portal: "portal-dev-template.html",
        },
      });

      const html = await readFile(path.join(webRoot, "portal-dev-template.html"), "utf8");
      expect(html).toContain("欢迎来到 龙虾访客网络");
      expect(html).toContain("继续浏览");
      expect((result as { details?: Record<string, unknown> }).details).toMatchObject({
        pageName: "portal-dev-template.html",
        template: "welcome",
      });
    } finally {
      await rm(webRoot, { recursive: true, force: true });
    }
  });

  it("generates a portal page through the template-first tool", async () => {
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
        (entry) => entry.name === "clawwrt_generate_portal_page",
      );
      expect(tool).toBeTruthy();

      await tool?.execute?.("tool-generate", {
        deviceId: "dev-generate",
        template: "terms",
        content: {
          brandName: "龙虾网络",
          rules: ["请遵守现场规则。", "如需帮助，请联系工作人员。"],
          buttonText: "同意并继续",
        },
        webRoot,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        deviceId: "dev-generate",
        op: "set_local_portal",
        payload: {
          portal: "portal-dev-generate.html",
        },
      });

      const html = await readFile(path.join(webRoot, "portal-dev-generate.html"), "utf8");
      expect(html).toContain("请先阅读并同意使用条款");
      expect(html).toContain("请遵守现场规则。");
      expect(html).toContain("同意并继续");
    } finally {
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
      await tool?.execute?.("tool-portal", {
        deviceId: "dev-two",
        html,
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

  it("shell tool forwards command and device-side timeout to the shell op", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice(id: string) {
        if (id === "dev-3") return { id: "dev-3", name: "Router 3", online: true };
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "shell_response", exit_code: 0, output: "ok" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_execute_shell",
    );

    await tool?.execute?.("tool-3", {
      deviceId: "dev-3",
      command: "uci show wireless",
      timeoutSeconds: 15,
      userConfirmed: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-3",
      op: "shell",
      payload: {
        command: "uci show wireless",
        timeout: 15,
      },
    });
  });

  it("bpf add tool sends normalized payload to bpf_add", async () => {
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
        return { type: "bpf_add_response", status: "success", output: "added" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_add",
    );

    const result = await tool?.execute?.("tool-4", {
      deviceId: "dev-4",
      table: "mac",
      address: "AA-BB-CC-DD-EE-FF",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-4",
      op: "bpf_add",
      payload: {
        table: "mac",
        address: "aa:bb:cc:dd:ee:ff",
      },
    });
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "Added AA-BB-CC-DD-EE-FF",
    );
  });

  it("bpf json tool queries the selected table", async () => {
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
        return {
          type: "bpf_json_response",
          data: [{ address: "203.0.113.45", bytes: 1024 }],
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_json",
    );

    const result = await tool?.execute?.("tool-5", {
      deviceId: "dev-5",
      table: "ipv4",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-5",
      op: "bpf_json",
      payload: {
        table: "ipv4",
      },
    });
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "Fetched ipv4 BPF stats",
    );
  });

  it("bpf json tool supports sid table for active L7 traffic stats", async () => {
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
        return { type: "bpf_json_response", data: [{ sid: 101, bps: 4096 }] };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_json",
    );

    await tool?.execute?.("tool-5b", {
      deviceId: "dev-5b",
      table: "sid",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-5b",
      op: "bpf_json",
      payload: {
        table: "sid",
      },
    });
  });

  it("bpf del tool sends normalized payload to bpf_del", async () => {
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
        return { type: "bpf_del_response", status: "success", output: "deleted" };
      },
    };
    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_del",
    );

    await tool?.execute?.("tool-6", {
      deviceId: "dev-6",
      table: "mac",
      address: "AA-BB-CC-DD-EE-11",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-6",
      op: "bpf_del",
      payload: {
        table: "mac",
        address: "aa:bb:cc:dd:ee:11",
      },
    });
  });

  it("wireguard set tool maps payload to set_wireguard_vpn data schema", async () => {
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
        return { type: "set_wireguard_vpn_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_set_wireguard_vpn",
    );

    await tool?.execute?.("tool-wg-set", {
      deviceId: "dev-wg",
      interface: {
        privateKey: "PRIVATE_KEY_BASE64",
        listenPort: 51820,
        addresses: ["10.0.0.1/24"],
      },
      peers: [
        {
          publicKey: "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
          presharedKey: "PRESHARED_BASE64",
          allowedIps: ["10.0.0.0/24", "192.168.9.0/24"],
          endpointHost: "vpn.example.com",
          endpointPort: 51820,
          persistentKeepalive: 25,
          routeAllowedIps: true,
        },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "set_wireguard_vpn",
      payload: {
        data: {
          interface: {
            private_key: "PRIVATE_KEY_BASE64",
            listen_port: 51820,
            addresses: ["10.0.0.1/24"],
          },
          peers: [
            {
              public_key: "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
              preshared_key: "PRESHARED_BASE64",
              allowed_ips: ["0.0.0.0/0"],
              endpoint_host: "vpn.example.com",
              endpoint_port: 51820,
              persistent_keepalive: 25,
              route_allowed_ips: "0",
            },
          ],
        },
      },
    });
  });

  it("wireguard set tool does not forward GENERATED_ON_DEVICE as a literal private key", async () => {
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
        return { type: "set_wireguard_vpn_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_set_wireguard_vpn",
    );

    await tool?.execute?.("tool-wg-set-generated-placeholder", {
      deviceId: "dev-wg",
      interface: {
        privateKey: "GENERATED_ON_DEVICE",
        listenPort: 51820,
        addresses: ["10.0.0.2/24"],
      },
      peers: [
        {
          publicKey: "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
          endpointHost: "vpn.example.com",
          endpointPort: 51820,
          allowedIps: ["0.0.0.0/0"],
          persistentKeepalive: 25,
          routeAllowedIps: false,
        },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "set_wireguard_vpn",
    });
    expect(calls[0]?.payload).toEqual({
      data: {
        interface: {
          listen_port: 51820,
          addresses: ["10.0.0.2/24"],
        },
        peers: [
          {
            public_key: "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
            allowed_ips: ["0.0.0.0/0"],
            endpoint_host: "vpn.example.com",
            endpoint_port: 51820,
            persistent_keepalive: 25,
            route_allowed_ips: "0",
          },
        ],
      },
    });
  });

  it("wireguard status tool calls get_wireguard_vpn_status op", async () => {
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
        return { type: "get_wireguard_vpn_status_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_get_wireguard_vpn_status",
    );

    await tool?.execute?.("tool-wg-status", {
      deviceId: "dev-wg",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "get_wireguard_vpn_status",
    });
  });

  it("wireguard verify reports client/server key mismatches explicitly", async () => {
    const originalExecSyncImpl = execSyncMock.getMockImplementation() ?? defaultExecSyncMockImpl;
    const originalExecFileSyncImpl = execFileSyncMock.getMockImplementation();

    execSyncMock.mockImplementation(((command: string): string => {
      if (command === "sudo wg show 2>&1 || echo 'wg not found'") {
        return "interface: wg0\n";
      }
      if (command === "sudo iptables -t nat -S POSTROUTING") {
        return "-A POSTROUTING -j MASQUERADE\n";
      }
      if (command === "sysctl -n net.ipv4.ip_forward") {
        return "1\n";
      }
      if (command === "sudo cat /etc/wireguard/server_private.key") {
        return "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n";
      }
      if (command === "sudo cat /etc/wireguard/server_public.key") {
        return "WRONGSERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n";
      }
      if (command === "sudo cat /etc/wireguard/wg0.conf 2>/dev/null || true") {
        return [
          "[Interface]",
          "Address = 10.0.0.1/24",
          "",
          "[Peer]",
          "PublicKey = MISMATCHEDCLIENTPUBKEYAAAAAAAAAAAAAAAAAAAA=",
          "AllowedIPs = 10.0.0.2/32, 192.168.10.0/24",
          "",
        ].join("\n");
      }
      if (command.startsWith("ping -c 3 -W 2 10.0.0.2")) {
        return "3 packets transmitted, 3 received, 0% packet loss\n";
      }
      return originalExecSyncImpl(command);
    }) as any);

    execFileSyncMock.mockImplementation(((file: string, args: string[] = [], options?: { input?: string }) => {
      if (file === "wg" && args[0] === "pubkey") {
        const input = options?.input?.trim();
        if (input === "KAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") {
          return "b5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=\n";
        }
        if (input === "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") {
          return "n5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=\n";
        }
      }
      return originalExecFileSyncImpl?.(file, args, options) ?? "";
    }) as any);

    try {
      const bridge = {
        listDevices() {
          return [{ deviceId: "dev-wg", connectedAtMs: 1, lastSeenAtMs: 1 }];
        },
        getDevice() {
          return null;
        },
        async callDevice(params: {
          deviceId: string;
          op: string;
          payload?: Record<string, unknown>;
        }) {
          if (params.op === "get_wireguard_vpn_status") {
            return {
              peers: [
                {
                  last_handshake_time: "never",
                  receive_bytes: 0,
                  transmit_bytes: 0,
                },
              ],
            };
          }
          if (params.op === "get_wireguard_vpn") {
            return {
              interface: {
                private_key: "KAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                addresses: ["10.0.0.2/24"],
              },
              peers: [
                {
                  public_key: "WRONGROUTERSERVERPUBKEYAAAAAAAAAAAAAAAAAAA=",
                },
              ],
            };
          }
          return { status: "ok" };
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_verify_wireguard_connectivity",
      );
      expect(tool).toBeTruthy();

      const result = await tool?.execute?.("tool-wg-verify", {
        deviceIds: ["dev-wg"],
        pingTargets: ["10.0.0.2"],
      });

      const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
      const details = (result as { details?: Record<string, unknown> }).details ?? {};
      const warnings = Array.isArray(details.warnings) ? details.warnings : [];

      expect(text).toContain("Server key pair: ❌");
      expect(text).toContain("server peer public key does not match the router private key derived public key");
      expect(text).toContain("router configured server public key does not match the VPS actual server public key");
      expect(warnings).toContain("server private/public key pair mismatch");
      expect(
        warnings.some(
          (entry) =>
            typeof entry === "string" &&
            entry.includes("dev-wg: server peer public key does not match the router private key derived public key"),
        ),
      ).toBe(true);
    } finally {
      execSyncMock.mockImplementation(originalExecSyncImpl);
      if (originalExecFileSyncImpl) {
        execFileSyncMock.mockImplementation(originalExecFileSyncImpl);
      }
    }
  });

  it("bpf flush tool targets the selected table", async () => {
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
        return { type: "bpf_flush_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_flush",
    );

    await tool?.execute?.("tool-7", {
      deviceId: "dev-7",
      table: "ipv4",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-7",
      op: "bpf_flush",
      payload: {
        table: "ipv4",
      },
    });
  });

  it("bpf update tool sends target and rates to bpf_update", async () => {
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
        return { type: "bpf_update_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_update",
    );

    await tool?.execute?.("tool-8", {
      deviceId: "dev-8",
      table: "mac",
      target: "AA-BB-CC-DD-EE-22",
      downrate: 2_000_000,
      uprate: 1_000_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-8",
      op: "bpf_update",
      payload: {
        table: "mac",
        target: "aa:bb:cc:dd:ee:22",
        downrate: 2_000_000,
        uprate: 1_000_000,
      },
    });
  });

  it("bpf update all tool sends table-wide rates to bpf_update_all", async () => {
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
        return { type: "bpf_update_all_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_bpf_update_all",
    );

    await tool?.execute?.("tool-9", {
      deviceId: "dev-9",
      table: "ipv6",
      downrate: 1_500_000,
      uprate: 750_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-9",
      op: "bpf_update_all",
      payload: {
        table: "ipv6",
        downrate: 1_500_000,
        uprate: 750_000,
      },
    });
  });

  it("l7 active stats tool maps to bpf_json sid", async () => {
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
        return { type: "bpf_json_response", data: [{ sid: 42, bytes: 1024 }] };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_get_l7_active_stats",
    );

    await tool?.execute?.("tool-10", { deviceId: "dev-10" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-10",
      op: "bpf_json",
      payload: { table: "sid" },
    });
  });

  it("l7 protocol catalog tool maps to bpf_json l7", async () => {
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
        return { type: "bpf_json_response", data: [{ proto: "youtube" }] };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_get_l7_protocol_catalog",
    );

    await tool?.execute?.("tool-11", { deviceId: "dev-11" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-11",
      op: "bpf_json",
      payload: { table: "l7" },
    });
  });

  it("set wireguard vpn maps routeAllowedIps to route_allowed_ips UCI string", async () => {
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
        return { type: "set_wireguard_vpn_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_set_wireguard_vpn",
    );

    await tool?.execute?.("tool-wg-rai", {
      deviceId: "dev-wg",
      interface: { privateKey: "abc123" },
      peers: [
        {
          publicKey: "peer-pub",
          allowedIps: ["0.0.0.0/0"],
          routeAllowedIps: false,
        },
      ],
    });

    expect(calls).toHaveLength(1);
    const data = (calls[0]?.payload as Record<string, unknown>)?.data as Record<string, unknown>;
    const peers = data?.peers as Array<Record<string, unknown>>;
    expect(peers?.[0]).toMatchObject({
      public_key: "peer-pub",
      allowed_ips: ["0.0.0.0/0"],
      route_allowed_ips: "0",
    });
    expect(peers?.[0]).not.toHaveProperty("routeAllowedIps");
  });

  it("get vpn routes tool sends get_vpn_routes op", async () => {
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
        return {
          type: "get_vpn_routes_response",
          interface: "wg0",
          routes: [{ destination: "10.0.0.0/24" }],
          tunnel_up: true,
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_get_vpn_routes",
    );

    await tool?.execute?.("tool-vpnr-get", { deviceId: "dev-vpn" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-vpn",
      op: "get_vpn_routes",
    });
  });

  it("set vpn routes selective sends routes in data payload", async () => {
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
        if (params.op === "get_vpn_routes") {
          return {
            type: "get_vpn_routes_response",
            interface: "wg0",
            routes: [{ destination: "10.0.0.0/24" }, { destination: "192.168.8.0/24" }],
            tunnel_up: true,
          };
        }
        return {
          type: "set_vpn_routes_response",
          interface: "wg0",
          mode: "selective",
          added: 2,
          failed: 0,
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_set_vpn_routes",
    );

    await tool?.execute?.("tool-vpnr-set", {
      deviceId: "dev-vpn",
      mode: "selective",
      routes: ["1.2.3.0/24", "4.5.6.0/24"],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-vpn",
      op: "get_vpn_routes",
    });
    expect(calls[1]).toMatchObject({
      deviceId: "dev-vpn",
      op: "set_vpn_routes",
      payload: {
        data: {
          mode: "selective",
          routes: ["10.0.0.0/24", "192.168.8.0/24", "1.2.3.0/24", "4.5.6.0/24"],
        },
      },
    });
  });

  it("collect wireguard protected routes writes a JSON file with shared wg0 subnet routes", async () => {
    const routePlanFile = path.join(os.tmpdir(), "openclaw-wrt-wireguard-protected-routes.json");
    await rm(routePlanFile, { force: true });

    try {
      const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
      const bridge = {
        listDevices() {
          return [
            { deviceId: "wifi-1", deviceName: "Alpha", connectedAtMs: 1, lastSeenAtMs: 1 },
            { deviceId: "wifi-2", deviceName: "Beta", connectedAtMs: 1, lastSeenAtMs: 1 },
            { deviceId: "wifi-3", deviceName: "Gamma", connectedAtMs: 1, lastSeenAtMs: 1 },
          ];
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
          if (params.op === "get_br_lan") {
            if (params.deviceId === "wifi-1") {
              return { cidr: "192.168.8.0/24" };
            }
            if (params.deviceId === "wifi-2") {
              return { cidr: "192.168.9.0/24" };
            }
            return { cidr: "192.168.10.0/24" };
          }
          return { status: "ok" };
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_collect_wireguard_protected_routes",
      );

      const result = await tool?.execute?.("tool-collect-protected-routes", {
        deviceIds: ["wifi-1", "wifi-2", "wifi-3"],
        serverTunnelIp: "10.0.0.1/24",
      });

      expect(calls).toEqual([
        { deviceId: "wifi-1", op: "get_br_lan", timeoutMs: undefined },
        { deviceId: "wifi-2", op: "get_br_lan", timeoutMs: undefined },
        { deviceId: "wifi-3", op: "get_br_lan", timeoutMs: undefined },
      ]);

      const details = (result as { details?: Record<string, unknown> }).details ?? {};
      expect(details.hasConflict).toBe(false);
      expect(details.routePlanFile).toBe(routePlanFile);
      expect(details.routePlans).toEqual([
        {
          deviceId: "wifi-1",
          deviceName: "Alpha",
          lanCidr: "192.168.8.0/24",
          routes: ["10.0.0.0/24", "192.168.9.0/24", "192.168.10.0/24"],
        },
        {
          deviceId: "wifi-2",
          deviceName: "Beta",
          lanCidr: "192.168.9.0/24",
          routes: ["10.0.0.0/24", "192.168.8.0/24", "192.168.10.0/24"],
        },
        {
          deviceId: "wifi-3",
          deviceName: "Gamma",
          lanCidr: "192.168.10.0/24",
          routes: ["10.0.0.0/24", "192.168.8.0/24", "192.168.9.0/24"],
        },
      ]);

      const fileContent = JSON.parse(await readFile(routePlanFile, "utf8")) as Record<string, unknown>;
      expect(fileContent.serverTunnelCidr).toBe("10.0.0.0/24");
      expect(fileContent.routePlans).toEqual(details.routePlans);
    } finally {
      await rm(routePlanFile, { force: true });
    }
  });

  it("set vpn routes selective can read routes from a routePlanFile", async () => {
    const routePlanFile = await mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-route-plan-"));
    const filePath = path.join(routePlanFile, "route-plan.json");

    try {
      await writeFile(
        filePath,
        JSON.stringify(
          {
            version: 1,
            generatedAt: new Date().toISOString(),
            serverTunnelIp: "10.0.0.1/24",
            serverTunnelCidr: "10.0.0.0/24",
            deviceIds: ["dev-vpn"],
            devices: [{ deviceId: "dev-vpn", lanCidr: "192.168.8.0/24" }],
            failedDevices: [],
            conflicts: [],
            blockedDeviceIds: [],
            hasConflict: false,
            routePlans: [
              {
                deviceId: "dev-vpn",
                lanCidr: "192.168.8.0/24",
                routes: ["10.0.0.0/24", "192.168.9.0/24", "192.168.10.0/24"],
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

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
          if (params.op === "get_vpn_routes") {
            return {
              type: "get_vpn_routes_response",
              interface: "wg0",
              routes: [{ destination: "10.0.0.0/24" }],
              tunnel_up: true,
            };
          }
          return {
            type: "set_vpn_routes_response",
            interface: "wg0",
            mode: "selective",
            added: 3,
            failed: 0,
          };
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find(
        (entry) => entry.name === "clawwrt_set_vpn_routes",
      );

      await tool?.execute?.("tool-vpnr-set-file", {
        deviceId: "dev-vpn",
        mode: "selective",
        routePlanFile: filePath,
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        deviceId: "dev-vpn",
        op: "get_vpn_routes",
      });
      expect(calls[1]).toMatchObject({
        deviceId: "dev-vpn",
        op: "set_vpn_routes",
        payload: {
          data: {
            mode: "selective",
            routes: ["10.0.0.0/24", "192.168.9.0/24", "192.168.10.0/24"],
          },
        },
      });
    } finally {
      await rm(routePlanFile, { recursive: true, force: true });
    }
  });

  it("restart xfrpc tool sends restart_xfrpc op", async () => {
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
        return {
          type: "restart_xfrpc_response",
          status: "ok",
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_restart_xfrpc",
    );

    await tool?.execute?.("tool-restart-xfrpc", {
      deviceId: "dev-1",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-1",
      op: "restart_xfrpc",
    });
  });
});
