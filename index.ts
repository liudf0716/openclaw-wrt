import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createClawWRTPluginConfigSchema, resolveClawWRTConfig } from "./src/config.js";
import { ChawrtdEventStreamClient } from "./src/chawrtd-events.js";
import { createClawWRTTools } from "./src/tool.js";

function resolveSessionStoreKeys(sessionKey: string): string[] {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("agent:")) {
    return [trimmed];
  }
  return [trimmed, `agent:main:${trimmed}`];
}

type NotificationRoute = {
  channel: string;
  to: string;
};

type DirectOutboundAdapter = {
  sendText?: (ctx: { cfg: unknown; to: string; text: string }) => Promise<unknown>;
};

function parseNotificationTarget(target: string | undefined): NotificationRoute | null {
  const trimmed = target?.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^([^:]+):(.+)$/);
  if (!match) {
    return null;
  }
  const channel = match[1]?.trim() ?? "";
  const to = match[2]?.trim() ?? "";
  if (!channel || !to) {
    return null;
  }
  return { channel, to };
}

async function deliverDeviceEventDirect(params: {
  cfg: unknown;
  loadAdapter: (channelId: string) => Promise<DirectOutboundAdapter | undefined>;
  route: NotificationRoute;
  message: string;
}) {
  const adapter = await params.loadAdapter(params.route.channel);
  if (!adapter?.sendText) {
    throw new Error(`Direct outbound sendText unavailable for channel ${params.route.channel}`);
  }
  return await adapter.sendText({
    cfg: params.cfg,
    to: params.route.to,
    text: params.message,
  });
}

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

function summarizeEventData(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  return keys.length > 0 ? keys.join(",") : "<empty>";
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
          api.logger.info(`openclaw-wrt: received device event deviceId=${deviceId || "<missing>"} op=${op}`);
          if (!deviceId) {
            api.logger.warn("openclaw-wrt: dropping device event with empty deviceId");
            return;
          }

          const payload = event.data ?? {};
          const message = formatDeviceEventMessage(deviceId, op, payload);
          const sessionKey = `openclaw-wrt:device-events:${deviceId}`;
          const route = parseNotificationTarget(config.notificationTarget);
          api.logger.debug?.(
            `openclaw-wrt: event payload summary deviceId=${deviceId} op=${op} keys=${summarizeEventData(payload)}`,
          );

          if (!route) {
            api.logger.warn(
              `openclaw-wrt: notificationTarget is unset or invalid, skipping direct event delivery deviceId=${deviceId} target=${config.notificationTarget ?? "<unset>"}`,
            );
            return;
          }

          api.logger.info(
            `openclaw-wrt: direct event delivery deviceId=${deviceId} channel=${route.channel} to=${route.to} sessionKey=${sessionKey}`,
          );
          const result = await deliverDeviceEventDirect({
            cfg: api.runtime.config.loadConfig(),
            loadAdapter: api.runtime.channel.outbound.loadAdapter as unknown as (
              channelId: string,
            ) => Promise<DirectOutboundAdapter | undefined>,
            route,
            message,
          });
          const messageId =
            result && typeof result === "object" && "messageId" in result
              ? String((result as { messageId?: unknown }).messageId ?? "")
              : "";
          api.logger.info(
            `openclaw-wrt: direct event delivery completed deviceId=${deviceId} op=${op}${messageId ? ` messageId=${messageId}` : ""}`,
          );
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
export { deliverDeviceEventDirect, parseNotificationTarget, resolveSessionStoreKeys };
