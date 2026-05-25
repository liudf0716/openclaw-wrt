import { describe, expect, it } from "vitest";
import { formatDeviceEventMessage } from "../src/event-notifier.js";

describe("formatDeviceEventMessage", () => {
  it("formats a client connected event in Chinese", () => {
    const message = formatDeviceEventMessage("dev-1", "client_connected", {
      mac: "aa:bb:cc:dd:ee:ff",
      connect_duration_ms: 187,
    }, "WiFi101", 1716336000000);

    expect(message).toContain("🕒 2024-05-22 00:00:00 UTC ·");
    expect(message).toContain("设备 `dev-1`（WiFi101） 上有新的 WiFi 客户端接入");
    expect(message).toContain("MAC `aa:bb:cc:dd:ee:ff`");
    expect(message).toContain("连接耗时 187ms");
  });

  it("omits connection duration text when missing", () => {
    const message = formatDeviceEventMessage("dev-1", "client_connected", {
      mac: "aa:bb:cc:dd:ee:ff",
    });

    expect(message).toContain("设备 `dev-1` 上有新的 WiFi 客户端接入");
    expect(message).not.toContain("连接耗时");
  });

  it("formats a DHCP IP assignment event in Chinese", () => {
    const message = formatDeviceEventMessage("dev-1", "client_ip_assigned", {
      client_mac: "aa:bb:cc:dd:ee:ff",
      client_ip: "192.0.2.10",
    }, "WiFi101", 1716336000000);

    expect(message).toContain("🕒 2024-05-22 00:00:00 UTC ·");
    expect(message).toContain("设备 `dev-1`（WiFi101） 上的 DHCP 已分配 IP");
    expect(message).toContain("MAC `aa:bb:cc:dd:ee:ff`");
    expect(message).toContain("IP `192.0.2.10`");
  });

  it("formats a client disconnected event in Chinese", () => {
    const message = formatDeviceEventMessage("dev-1", "client_disconnected", {
      client_mac: "aa:bb:cc:dd:ee:ff",
      disconnect_duration_ms: 2042,
    });

    expect(message).toContain("设备 `dev-1` 上的 WiFi 客户端已断开");
    expect(message).toContain("MAC `aa:bb:cc:dd:ee:ff`");
    expect(message).toContain("断开耗时 2042ms");
  });

  it("omits disconnect duration text when missing", () => {
    const message = formatDeviceEventMessage("dev-1", "client_disconnected", {
      client_mac: "aa:bb:cc:dd:ee:ff",
    });

    expect(message).toContain("设备 `dev-1` 上的 WiFi 客户端已断开");
    expect(message).not.toContain("断开耗时");
  });

  it("formats unknown events with a Chinese fallback", () => {
    const message = formatDeviceEventMessage("dev-1", "mystery_event", {
      foo: "bar",
    });

    expect(message).toContain("来自设备 `dev-1` 的事件 `mystery_event`");
    expect(message).toContain('"foo":"bar"');
  });
});