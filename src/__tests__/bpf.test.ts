import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("bpf tools", () => {
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
});
