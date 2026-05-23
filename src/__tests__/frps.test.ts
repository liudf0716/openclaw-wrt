import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", fetchMock);

describe("frps tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
          summary: "Intranet-penetration service listener is active",
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
});
