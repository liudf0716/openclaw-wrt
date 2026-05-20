import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createClawWRTPluginConfigSchema, resolveClawWRTConfig } from "./src/config.js";
import { ChawrtdEventStreamClient } from "./src/chawrtd-events.js";
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
    "Subscribe to chawrtd device events, inspect online router snapshots, and send management requests through the chawrtd API.",
  configSchema: () => {
    const schema = createClawWRTPluginConfigSchema();
    schema.uiHints = {
      enabled: { label: "Enable event stream" },
      chawrtdEventStream: {
        label: "chawrtd event stream",
        help: "Configure the chawrtd base URL and SSE event stream path.",
        advanced: false,
      },
    };
    return schema;
  },
  register(api) {
    const config = resolveClawWRTConfig(api.pluginConfig);
    const eventStream = new ChawrtdEventStreamClient({
      logger: api.logger,
      config,
      async onEvent(event) {
        try {
          const deviceId = typeof event.deviceId === "string" ? event.deviceId.trim() : "";
          const op = typeof event.op === "string" ? event.op : "unknown";
          if (!deviceId) {
            return;
          }

          const payload = event.data ?? {};
          const message = formatDeviceEventMessage(deviceId, op, payload);
          const sessionKey = `openclaw-wrt:device-events:${deviceId}`;

          // Inject delivery context if a notification target is configured.
          // This ensures background runs know where to deliver the message.
          if (config.notificationTarget) {
            try {
              const match = config.notificationTarget.match(/^([^:]+):(.+)$/);
              if (match) {
                const channel = match[1];
                const to = match[2];
                const storePath = api.runtime.agent.session.resolveStorePath();
                const store = await Promise.resolve(api.runtime.agent.session.loadSessionStore(storePath));
                store[sessionKey] = {
                  ...(store[sessionKey] as any || {}),
                  lastChannel: channel,
                  lastTo: to,
                };
                await Promise.resolve(api.runtime.agent.session.saveSessionStore(storePath, store));
              }
            } catch (err) {
              api.logger.warn(`openclaw-wrt: failed to inject session delivery context: ${String(err)}`);
            }
          }

          await api.runtime.subagent.run({
            sessionKey,
            message,
            deliver: true,
          });
        } catch (error) {
          api.logger.warn(`openclaw-wrt: failed to deliver device event: ${String(error)}`);
        }
      },
    });

    api.registerService({
      id: "openclaw-wrt-chawrtd-events",
      async start() {
        eventStream.start();
      },
      async stop() {
        await eventStream.stop();
      },
    });

    api.registerTool(() => createClawWRTTools({ config, logger: api.logger }));
  },
});

export { createClawWRTTools } from "./src/tool.js";
export {
  createClawWRTPluginConfigSchema,
  resolveClawWRTConfig,
  type ResolvedClawWRTConfig,
} from "./src/config.js";
