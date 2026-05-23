import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("common and meta tools", () => {
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
});
