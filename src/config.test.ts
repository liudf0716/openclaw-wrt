import { describe, expect, it } from "vitest";
import pluginManifest from "../openclaw.plugin.json";
import { createClawWRTPluginConfigSchema, resolveClawWRTConfig } from "./config.js";

describe("resolveClawWRTConfig", () => {
  it("enables the plugin by default", () => {
    expect(resolveClawWRTConfig(undefined).enabled).toBe(true);
    expect(resolveClawWRTConfig({}).enabled).toBe(true);
  });

  it("allows explicit disable", () => {
    expect(resolveClawWRTConfig({ enabled: false }).enabled).toBe(false);
  });

  it("uses defaults for the chawrtd event stream when omitted", () => {
    const resolved = resolveClawWRTConfig({});

    expect(resolved.chawrtdEventStream.baseUrl).toBe("http://127.0.0.1:8001");
    expect(resolved.chawrtdEventStream.path).toBe("/v1/events/stream");
    expect(resolved.chawrtdEventStream.reconnectMinMs).toBe(1000);
    expect(resolved.chawrtdEventStream.reconnectMaxMs).toBe(15000);
  });

  it("preserves valid event stream fields when another field is invalid", () => {
    const resolved = resolveClawWRTConfig({
      enabled: false,
      chawrtdEventStream: {
        baseUrl: "http://chawrtd.local:9000",
        reconnectMinMs: 999.5,
      },
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.chawrtdEventStream.baseUrl).toBe("http://chawrtd.local:9000");
    expect(resolved.chawrtdEventStream.reconnectMinMs).toBe(1000);
  });

  it("falls back only the invalid event stream integers instead of resetting the whole config", () => {
    const resolved = resolveClawWRTConfig({
      chawrtdEventStream: {
        reconnectMinMs: 8001.5,
        reconnectMaxMs: 9000,
      },
    });

    expect(resolved.chawrtdEventStream.reconnectMinMs).toBe(1000);
    expect(resolved.chawrtdEventStream.reconnectMaxMs).toBe(9000);
  });

  it("clamps reconnectMinMs to reconnectMaxMs when min is greater than max", () => {
    const resolved = resolveClawWRTConfig({
      chawrtdEventStream: {
        reconnectMinMs: 12_000,
        reconnectMaxMs: 3_000,
      },
    });

    expect(resolved.chawrtdEventStream.reconnectMinMs).toBe(3_000);
    expect(resolved.chawrtdEventStream.reconnectMaxMs).toBe(3_000);
  });

  it("accepts notificationTarget in the runtime config schema", () => {
    const schema = createClawWRTPluginConfigSchema();
    const parsed = schema.safeParse({
      notificationTarget: "feishu:chat:oc_xxx",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.notificationTarget).toBe("feishu:chat:oc_xxx");
    }
  });

  it("publishes notificationTarget in the plugin manifest schema", () => {
    expect(pluginManifest.configSchema.properties.notificationTarget).toEqual({
      type: "string",
      description: 'Optional delivery target for device events, e.g. "feishu:chat:oc_xxx"',
    });
  });
});
