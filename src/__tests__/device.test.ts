import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("device tools", () => {
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
});
