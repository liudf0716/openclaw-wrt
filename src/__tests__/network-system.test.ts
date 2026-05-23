import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("network and system tools", () => {
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
});
