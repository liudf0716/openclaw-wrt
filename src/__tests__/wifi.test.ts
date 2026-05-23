import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("wifi tools", () => {
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
});
