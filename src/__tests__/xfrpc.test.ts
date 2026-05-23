import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", fetchMock);

describe("xfrpc tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
                  port: "7000",
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
