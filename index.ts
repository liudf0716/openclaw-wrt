import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createClawWRTPluginConfigSchema, resolveClawWRTConfig } from "./src/config.js";
import { ClawWRTBridge } from "./src/manager.js";
import { createClawWRTTools } from "./src/tool.js";

/** Format a device push event as a human-readable notification message. */
function formatDeviceEventMessage(deviceId: string, op: string, data: Record<string, unknown>): string {
  switch (op) {
    case "client_connected": {
      const mac = typeof data.mac === "string" ? data.mac : (typeof data.client_mac === "string" ? data.client_mac : "unknown");
      const ip = typeof data.ip === "string" ? data.ip : (typeof data.client_ip === "string" ? data.client_ip : "");
      const name = typeof data.name === "string" ? ` (${data.name})` : "";
      return `📶 New WiFi client connected on device \`${deviceId}\`: MAC \`${mac}\`${ip ? `, IP \`${ip}\`` : ""}${name}`;
    }
    case "client_disconnected": {
      const mac = typeof data.mac === "string" ? data.mac : (typeof data.client_mac === "string" ? data.client_mac : "unknown");
      return `🔌 WiFi client disconnected from device \`${deviceId}\`: MAC \`${mac}\``;
    }
    case "net_link_up": {
      const iface = typeof data.interface === "string" ? data.interface : (typeof data.iface === "string" ? data.iface : "unknown");
      const dev = typeof data.device === "string" ? data.device : "";
      return `🌐 Network link UP on device \`${deviceId}\`: interface \`${iface}\`${dev ? `, dev \`${dev}\`` : ""}`;
    }
    case "net_link_down": {
      const iface = typeof data.interface === "string" ? data.interface : (typeof data.iface === "string" ? data.iface : "unknown");
      const dev = typeof data.device === "string" ? data.device : "";
      return `🚫 Network link DOWN on device \`${deviceId}\`: interface \`${iface}\`${dev ? `, dev \`${dev}\`` : ""}`;
    }
    case "usb_storage_attached": {
      const product = typeof data.product === "string" ? data.product : "unknown";
      const devname = typeof data.devname === "string" ? data.devname : (typeof data.device === "string" ? data.device : "");
      return `💽 USB storage attached on device \`${deviceId}\`: product \`${product}\`${devname ? `, dev \`${devname}\`` : ""}`;
    }
    case "usb_storage_detached": {
      const product = typeof data.product === "string" ? data.product : "unknown";
      const devname = typeof data.devname === "string" ? data.devname : (typeof data.device === "string" ? data.device : "");
      return `🧷 USB storage detached on device \`${deviceId}\`: product \`${product}\`${devname ? `, dev \`${devname}\`` : ""}`;
    }
    default:
      return `📡 Event \`${op}\` from device \`${deviceId}\`: ${JSON.stringify(data)}`;
  }
}

export default definePluginEntry({
  id: "openclaw-wrt",
  name: "OpenClaw WRT",
  description:
    "List and inspect online OpenWrt or wireless router devices, publish captive portal HTML pages, and send management requests to connected routers over WebSocket.",
  configSchema: () => {
    const schema = createClawWRTPluginConfigSchema();
    schema.uiHints = {
      enabled: { label: "Enable bridge" },
      bind: { label: "Bind address", advanced: true },
      port: { label: "Bridge port" },
      path: { label: "WebSocket path" },
      allowDeviceIds: {
        label: "Allowed device IDs",
        help: "Optional allowlist. Leave empty to accept any device_id.",
      },
      requestTimeoutMs: { label: "Default request timeout (ms)", advanced: true },
      maxPayloadBytes: { label: "Max payload bytes", advanced: true },
      token: {
        label: "Device authentication token",
        help: "Optional shared secret. If set, routers must provide this token in their connect message.",
        advanced: true,
      },
      awasEnabled: { label: "Enable AWAS auth proxy" },
      awasHost: { label: "AWAS server hostname" },
      awasPort: { label: "AWAS server port" },
      awasPath: { label: "AWAS WebSocket path" },
      awasSsl: { label: "Use TLS (wss://)", advanced: true },
    };
    return schema;
  },
  register(api) {
    const config = resolveClawWRTConfig(api.pluginConfig);
    const bridge = ClawWRTBridge.getOrCreate({ config, logger: api.logger });

    api.registerService({
      id: "openclaw-wrt-bridge",
      async start() {
        await bridge.start();
      },
      async stop() {
        await bridge.stop();
      },
    });

    api.registerTool(() => createClawWRTTools({ bridge, logger: api.logger }));

    // Forward device push events to the active channel via the subagent runtime.
    bridge.onDeviceEvent((event) => {
      const message = formatDeviceEventMessage(event.deviceId, event.op, event.data);
      api.runtime.subagent
        .run({
          sessionKey: `openclaw-wrt:device-events:${event.deviceId}`,
          message,
          deliver: true,
        })
        .catch((error: unknown) => {
          api.logger.warn(
            `openclaw-wrt: failed to deliver device event op=${event.op} device=${event.deviceId}: ${String(error)}`,
          );
        });
    });
  },
});

// Public API exports (re-exported from api.ts barrel)
export { ClawWRTBridge, type DeviceSnapshot, type DeviceEvent } from "./src/manager.js";
export { createClawWRTTools } from "./src/tool.js";
export {
  createClawWRTPluginConfigSchema,
  resolveClawWRTConfig,
  type ResolvedClawWRTConfig,
} from "./src/config.js";
