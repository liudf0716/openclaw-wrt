import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

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

describe("wireguard tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
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

  it("wireguard reset tool triggers reload_network_async after reset", async () => {
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
        if (params.op === "reset_wireguard_vpn") {
          return { type: "reset_wireguard_vpn_response", status: "success" };
        }
        if (params.op === "reload_network_async") {
          return { scheduled: true, async: true, op: "reload_network_async" };
        }
        return { type: `${params.op}_response`, status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_reset_wireguard_vpn",
    );

    await tool?.execute?.("tool-wg-reset", {
      deviceId: "dev-wg",
      interface: "wg0",
      flushRoutes: true,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "reset_wireguard_vpn",
      payload: {
        interface: "wg0",
        flush_routes: true,
      },
    });
    expect(calls[1]).toMatchObject({
      deviceId: "dev-wg",
      op: "reload_network_async",
    });
  });

  it("wireguard reset tool skips reload_network_async when reloadNetworkAsync=false", async () => {
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
        return { type: `${params.op}_response`, status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_reset_wireguard_vpn",
    );

    await tool?.execute?.("tool-wg-reset-no-reload", {
      deviceId: "dev-wg",
      interface: "wg0",
      reloadNetworkAsync: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-wg",
      op: "reset_wireguard_vpn",
      payload: {
        interface: "wg0",
      },
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
    const peers = (calls[0]?.payload as Record<string, unknown>)?.peers as Array<
      Record<string, unknown>
    >;
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
        mode: "selective",
        routes: ["10.0.0.0/24", "192.168.8.0/24", "1.2.3.0/24", "4.5.6.0/24"],
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
          mode: "selective",
          routes: ["10.0.0.0/24", "192.168.9.0/24", "192.168.10.0/24"],
        },
      });
    } finally {
      await rm(routePlanFile, { recursive: true, force: true });
    }
  });
});
