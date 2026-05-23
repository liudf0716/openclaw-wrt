import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createClawWRTPluginConfigSchema, resolveClawWRTConfig } from "./src/config.js";
import { ChawrtdEventStreamClient } from "./src/chawrtd-events.js";
import { createClawWRTTools } from "./src/tool.js";
import {
  formatDeviceEventMessage,
  parseNotificationTarget,
  deliverDeviceEventDirect,
  summarizeEventData,
  type DirectOutboundAdapter,
} from "./src/event-notifier.js";

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
          const message = formatDeviceEventMessage(deviceId, op, payload, event.alias, event.time);
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
export {
  formatDeviceEventMessage,
  deliverDeviceEventDirect,
  parseNotificationTarget,
  resolveSessionStoreKeys,
} from "./src/event-notifier.js";
