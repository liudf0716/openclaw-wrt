import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("client tools", () => {
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
});
