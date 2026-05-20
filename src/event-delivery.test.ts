import { describe, expect, it, vi } from "vitest";
import { deliverDeviceEventDirect, parseNotificationTarget, resolveSessionStoreKeys } from "../index.js";

describe("resolveSessionStoreKeys", () => {
  it("writes both raw and agent-scoped keys for plugin-owned subagent sessions", () => {
    expect(resolveSessionStoreKeys("openclaw-wrt:device-events:dev-1")).toEqual([
      "openclaw-wrt:device-events:dev-1",
      "agent:main:openclaw-wrt:device-events:dev-1",
    ]);
  });

  it("preserves already-normalized agent session keys", () => {
    expect(resolveSessionStoreKeys("agent:main:openclaw-wrt:device-events:dev-1")).toEqual([
      "agent:main:openclaw-wrt:device-events:dev-1",
    ]);
  });
});

describe("parseNotificationTarget", () => {
  it("parses a direct Feishu user target", () => {
    expect(parseNotificationTarget("feishu:user:ou_123")).toEqual({
      channel: "feishu",
      to: "user:ou_123",
    });
  });

  it("returns null for an invalid target", () => {
    expect(parseNotificationTarget("feishu")).toBeNull();
  });
});

describe("deliverDeviceEventDirect", () => {
  it("sends direct text through the channel outbound adapter", async () => {
    const sendText = vi.fn(async () => ({ channel: "feishu", messageId: "msg-1" }));
    const loadAdapter = vi.fn(async () => ({ sendText }));

    const result = await deliverDeviceEventDirect({
      cfg: { channels: { feishu: { enabled: true } } },
      loadAdapter,
      route: {
        channel: "feishu",
        to: "user:ou_123",
      },
      message: "hello",
    });

    expect(loadAdapter).toHaveBeenCalledWith("feishu");
    expect(sendText).toHaveBeenCalledWith({
      cfg: { channels: { feishu: { enabled: true } } },
      to: "user:ou_123",
      text: "hello",
    });
    expect(result).toEqual({ channel: "feishu", messageId: "msg-1" });
  });
});
