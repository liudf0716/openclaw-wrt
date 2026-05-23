import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { execSyncMock, execFileSyncMock, fetchMock } = vi.hoisted(() => ({
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
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", fetchMock);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: execSyncMock,
    execFileSync: execFileSyncMock,
  };
});

describe("openclaw-wrt intent tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

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

  it("deploy frps delegates to chawrtd API", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "FRPS deployed successfully",
            output: "ok",
            data: { port: 7000 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "Fetched FRPS status",
            data: {
              token: "abc",
              port: 7000,
              listen_addr: "0.0.0.0",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

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

    const result = await tool?.execute?.("tool-deploy", {
      port: 7000,
      token: "abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [deployUrl, deployInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [statusUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(deployUrl).toBe("http://127.0.0.1:8001/v1/frps/deploy");
    expect(statusUrl).toBe("http://127.0.0.1:8001/v1/frps/status");
    const deployBody = JSON.parse(String(deployInit.body)) as { port?: number; token?: string };
    expect(deployBody.port).toBe(7000);
    expect(deployBody.token).toBe("abc");
    expect((result as { details?: Record<string, unknown> }).details?.token).toBe("abc");
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "FRPS deployed successfully",
    );
  });

  it("deploy frps auto-generates a token when omitted", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "FRPS deployed successfully",
            data: { port: 7070 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "Fetched FRPS status",
            data: { token: "generated-token", port: 7070 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

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

    const result = await tool?.execute?.("tool-deploy-auto-token", {
      port: 7070,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, deployInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const deployBody = JSON.parse(String(deployInit.body)) as { port?: number; token?: string };
    expect(deployBody.port).toBe(7070);
    expect(typeof deployBody.token).toBe("string");
    expect(deployBody.token).toMatch(/\S+/);
    expect((result as { details?: Record<string, unknown> }).details?.token).toBe("generated-token");
  });

  it("deploy frps forwards chawrtd errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "deploy failed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

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

    await expect(tool?.execute?.("tool-deploy-binary", { port: 7000 })).rejects.toThrow("deploy failed");
  });

  it("frps status fetches details from chawrtd", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "Fetched FRPS status",
          output: "SERVICE_STATE=active",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultText).toContain("Fetched FRPS status");
    expect(resultText).toContain("SERVICE_STATE=active");
  });

  it("frps verify checks the vps listener via chawrtd", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "FRPS listener is active",
          output: "STATUS=LISTENING\nPROTOCOL=tcp\nPORT=7070",
          data: { protocol: "tcp", port: 7070, listening: true },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "openclaw_verify_frps",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-frps-verify", {
      protocol: "tcp",
      port: 7070,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8001/v1/frps/verify");
    expect(init.method).toBe("POST");
    expect(init.body).toContain('"protocol":"tcp"');
    expect(init.body).toContain('"port":7070');
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "Intranet-penetration service listener is active",
    );
  });

  it("frps full status aggregates server, public ip, and device xfrpc snapshots", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "Fetched FRPS status",
            data: {
              token: "token-1",
              port: "7070",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            summary: "Detected VPS public IPv4 address",
            data: {
              publicIp: "203.0.113.42",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const bridge = {
      listDevices() {
        return [{ deviceId: "dev-1" }];
      },
      getDevice(deviceId: string) {
        if (deviceId === "dev-1") {
          return { deviceId: "dev-1", connectedAtMs: 1, lastSeenAtMs: 1 };
        }
        return null;
      },
      async callDevice(params: { deviceId: string; op: string; payload?: Record<string, unknown> }) {
        if (params.op === "get_xfrpc_common") {
          return {
            enabled: "1",
            loglevel: "7",
            server_addr: "203.0.113.42",
            server_port: "7070",
            token: "token-1",
          };
        }
        if (params.op === "get_xfrpc_tcp_service") {
          return [{ name: "ssh", remote_port: "6022" }];
        }
        return { status: "ok" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "openclaw_frps_full_status",
    );
    expect(tool).toBeTruthy();

    const result = await tool?.execute?.("tool-frps-full-status", {});
    const details = (result as { details?: Record<string, unknown> }).details ?? {};

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(details.status).toBe("success");
    expect(details.publicIp).toBe("203.0.113.42");
    expect(Array.isArray(details.devices)).toBe(true);
    expect((details.devices as Array<Record<string, unknown>>)[0]).toMatchObject({
      deviceId: "dev-1",
      consistent: true,
    });
    expect((details.conflicts as Array<Record<string, unknown>>)).toHaveLength(0);
  });

  it("detects the VPS public IP via ifconfig.me", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "Detected VPS public IPv4 address",
          output: "203.0.113.42",
          data: {
            publicIp: "203.0.113.42",
            source: "curl https://ifconfig.me/ip",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(details.status).toBe("success");
    expect(details.publicIp).toBe("203.0.113.42");
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain("203.0.113.42");
  });

  it("returns a confirmation-required error when VPS public IP detection fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "ifconfig.me returned a non-IPv4 response: not-an-ip" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(details.status).toBe("error");
    expect(details.requiresUserConfirmation).toBe(true);
    expect(details.requiredAction).toBe("confirm_vps_public_ip_or_domain");
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain("confirm the VPS public IP or domain");
  });

  it("deploy wg server forwards peerBindings to chawrtd", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "WireGuard server deployed successfully",
          data: {
            peerBindings: [
              {
                deviceId: "dev-1",
                tunnelIp: "10.0.0.2/32",
                lanCidr: "192.168.10.0/24",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8001/v1/wg/deploy");
    expect(init.method).toBe("POST");
    expect(init.body).toContain('"peerBindings"');
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "WireGuard server deployed successfully",
    );
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

  it("kickoff tool resolves client IP from get_clients with explicit gwId", async () => {
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
      gwId: "gw-1",
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

  it("set wifi info tool sends flat Wi-Fi config payload", async () => {
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
        return { type: "set_wifi_info_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_set_wifi_info",
    );
    expect(tool).toBeTruthy();

    await tool?.execute?.("tool-wifi", {
      deviceId: "dev-wifi",
      data: {
        radio: "radio0",
        interface: "wifnet0",
        key: "12345678",
        encryption: "psk2",
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wifi",
      op: "set_wifi_info",
      payload: {
        radio: "radio0",
        interface: "wifnet0",
        key: "12345678",
        encryption: "psk2",
      },
    });
    expect(calls[0].payload).not.toHaveProperty("data");
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
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "Fetched WireGuard server status",
          output: "WG_BEGIN\nwg0\nWG_END\nNAT_BEGIN\n-A POSTROUTING -j MASQUERADE\nNAT_END\nIP_FORWARD=1\n",
          data: {
            server: {
              wgShow: "wg0",
              natRules: "-A POSTROUTING -j MASQUERADE",
              ipForwardOk: true,
              snatOk: true,
              serverPublicKey: "SERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              reportLines: [
                "- IP Forwarding: ✅ enabled",
                "- SNAT/MASQUERADE: ✅ present",
                "- Server key pair: ✅ private/public key match",
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "get_wireguard_vpn_status",
    });
  });

  it("wireguard server public key tool reads chawrtd status response", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "Fetched WireGuard server status",
          output: "WG_BEGIN\nwg0\nWG_END\nNAT_BEGIN\n-A POSTROUTING -j MASQUERADE\nNAT_END\nIP_FORWARD=1\n",
          data: {
            server: {
              serverPublicKey: "SERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const tool = createClawWRTTools({ bridge: { listDevices() { return []; }, getDevice() { return null; } } as never }).find(
      (entry) => entry.name === "openclaw_get_wg_server_public_key",
    );

    const result = await tool?.execute?.("tool-server-pubkey", {});
    const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    const details = (result as { details?: Record<string, unknown> }).details ?? {};

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("Fetched WireGuard server public key from chawrtd.");
    expect(details).toMatchObject({
      status: "success",
      serverPublicKey: "SERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
  });

  it("wireguard verify reports client/server key mismatches explicitly", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: "Verified WireGuard server connectivity",
          output: "interface: wg0\n",
          data: {
            server: {
              wgShow: "interface: wg0\n",
              snatOk: true,
              ipForwardOk: true,
              serverPublicKey: "WRONGSERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              keyCheck: {
                status: "mismatch",
                configuredPublicKey: "WRONGSERVERPUBKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                derivedPublicKey: "n5R43PCum1w8OIIH3Yyok8zYCbkCWkZc0qopQCPE9Rk=",
              },
              peerConfig: [
                {
                  publicKey: "MISMATCHEDCLIENTPUBKEYAAAAAAAAAAAAAAAAAAAA=",
                  allowedIps: ["10.0.0.2/32", "192.168.10.0/24"],
                },
              ],
            },
            pingResults: [
              {
                target: "10.0.0.2",
                reachable: true,
                output: "3 packets transmitted, 3 received, 0% packet loss",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    {
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

  it("xfrpc mutation tools restart xfrpc after updating config", async () => {
    const cases = [
      {
        toolName: "clawwrt_set_xfrpc_common",
        input: {
          deviceId: "dev-1",
          enabled: "1",
          loglevel: "info",
        },
        expectedOp: "set_xfrpc_common",
      },
      {
        toolName: "clawwrt_add_xfrpc_tcp_service",
        input: {
          deviceId: "dev-1",
          name: "ssh",
          enabled: "1",
          local_ip: "127.0.0.1",
          local_port: "22",
          remote_port: "6022",
        },
        expectedOp: "add_xfrpc_tcp_service",
      },
      {
        toolName: "clawwrt_del_xfrpc_tcp_service",
        input: {
          deviceId: "dev-1",
          name: "ssh",
        },
        expectedOp: "del_xfrpc_tcp_service",
      },
      {
        toolName: "clawwrt_disable_xfrpc_tcp_service",
        input: {
          deviceId: "dev-1",
          name: "ssh",
        },
        expectedOp: "disable_xfrpc_tcp_service",
      },
      {
        toolName: "clawwrt_disable_xfrpc_service",
        input: {
          deviceId: "dev-1",
        },
        expectedOp: "disable_xfrpc_service",
      },
    ] as const;

    for (const testCase of cases) {
      const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
      if (testCase.toolName === "clawwrt_set_xfrpc_common") {
        fetchMock
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                data: {
                  token: "token-1",
                  port: 7000,
                  publicIp: "203.0.113.42",
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
      }
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
            type: `${params.op}_response`,
            status: "ok",
          };
        },
      };

      const tool = createClawWRTTools({ bridge: bridge as never }).find((entry) => entry.name === testCase.toolName);
      await tool?.execute?.(`tool-${testCase.toolName}`, testCase.input as never);

      if (testCase.toolName === "clawwrt_add_xfrpc_tcp_service") {
        expect(calls).toHaveLength(3);
        expect(calls[0]).toMatchObject({
          deviceId: "dev-1",
          op: "get_xfrpc_tcp_service",
          payload: {},
        });
        expect(calls[1]).toMatchObject({
          deviceId: "dev-1",
          op: testCase.expectedOp,
        });
        expect(calls[2]).toMatchObject({
          deviceId: "dev-1",
          op: "restart_xfrpc",
        });
      } else if (testCase.toolName === "clawwrt_set_xfrpc_common") {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({
          deviceId: "dev-1",
          op: testCase.expectedOp,
          payload: {
            enabled: "1",
            loglevel: "info",
            server_addr: "203.0.113.42",
            server_port: "7000",
            token: "token-1",
          },
        });
        expect(calls[1]).toMatchObject({
          deviceId: "dev-1",
          op: "restart_xfrpc",
        });
      } else {
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({
          deviceId: "dev-1",
          op: testCase.expectedOp,
        });
        expect(calls[1]).toMatchObject({
          deviceId: "dev-1",
          op: "restart_xfrpc",
        });
      }
    }
  });

  it("add xfrpc tcp service rejects remote port conflicts before mutation", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: { deviceId: string; op: string; payload?: Record<string, unknown> }) {
        calls.push(params);
        if (params.op === "get_xfrpc_tcp_service") {
          return {
            type: "get_xfrpc_tcp_service_response",
            services: [{ name: "ssh", remote_port: "6022" }],
          };
        }
        return {
          type: `${params.op}_response`,
          status: "ok",
        };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_add_xfrpc_tcp_service",
    );
    expect(tool).toBeTruthy();

    await expect(
      tool?.execute?.("tool-add-conflict", {
        deviceId: "dev-1",
        name: "web",
        remote_port: "6022",
      }),
    ).rejects.toThrow("remote_port 6022 already in use on this device");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-1",
      op: "get_xfrpc_tcp_service",
    });
  });
});
