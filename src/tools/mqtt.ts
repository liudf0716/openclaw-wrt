/**
 * MQTT tools: get/set MQTT server configuration on device.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type { JsonRecord, DeviceOnlyParams, SetMqttServerParams } from "../tool-types.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";

export function createMqttTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_mqtt_serv",
      label: "OpenClaw WRT Get MQTT Server",
      description: "Get the current MQTT server configuration for the device.",
      op: "get_mqtt_serv",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched MQTT server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_set_mqtt_serv",
      label: "OpenClaw WRT Set MQTT Server",
      description: "Set the MQTT server hostname, port, credentials, and TLS flag.",
      op: "set_mqtt_serv",
      parameters: SharedSchemas.SetMqttServerSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetMqttServerParams;
        const payload: JsonRecord = {};
        if (typeof args.hostname === "string") {
          payload.hostname = args.hostname;
        }
        if (args.port !== undefined) {
          payload.port = args.port;
        }
        if (typeof args.username === "string") {
          payload.username = args.username;
        }
        if (typeof args.password === "string") {
          payload.password = args.password;
        }
        if (typeof args.useSsl === "boolean") {
          payload.use_ssl = args.useSsl;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetMqttServerParams;
        return `Updated MQTT server config for ${args.deviceId}.`;
      },
    }),
  ];
}
