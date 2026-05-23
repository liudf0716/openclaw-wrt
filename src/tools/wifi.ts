/**
 * WiFi tools: get/set WiFi info, scan, set relay, delete relay.
 */

import type { Static } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  SetWifiInfoParams,
  ScanWifiParams,
  SetWifiRelayParams,
} from "../tool-types.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";

export function createWifiTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_wifi_info",
      label: "OpenClaw WRT WiFi Info",
      description: "Get the router's Wi-Fi and radio configuration.",
      op: "get_wifi_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched Wi-Fi info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_set_wifi_info",
      label: "OpenClaw WRT Set WiFi Info",
      description:
        "Update Wi-Fi configuration on the router, such as changing SSID (network name), password, encryption type, or hiding the network. Use this tool when the user asks to modify, change, or update Wi-Fi settings including SSID.",
      op: "set_wifi_info",
      parameters: SharedSchemas.SetWifiInfoSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWifiInfoParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: args.data,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWifiInfoParams;
        return `Applied Wi-Fi config changes to ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_scan_wifi",
      label: "OpenClaw WRT Scan WiFi",
      description: "Scan nearby Wi-Fi networks, optionally filtered to 2.4 GHz or 5 GHz.",
      op: "scan_wifi",
      parameters: SharedSchemas.ScanWifiSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as ScanWifiParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: args.band ? { band: args.band } : undefined,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as ScanWifiParams;
        return `Completed Wi-Fi scan for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_set_wifi_relay",
      label: "OpenClaw WRT Set WiFi Relay",
      description: "Configure the router to join an upstream Wi-Fi as relay/STA.",
      op: "set_wifi_relay",
      parameters: SharedSchemas.SetWifiRelaySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWifiRelayParams;
        const payload: JsonRecord = { ssid: args.ssid };
        if (typeof args.key === "string") {
          payload.key = args.key;
        }
        if (typeof args.band === "string") {
          payload.band = args.band;
        }
        if (typeof args.encryption === "string") {
          payload.encryption = args.encryption;
        }
        if (typeof args.bssid === "string") {
          payload.bssid = args.bssid;
        }
        if (typeof args.apply === "boolean") {
          payload.apply = args.apply;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWifiRelayParams;
        return `Configured Wi-Fi relay for ${args.deviceId} using SSID ${args.ssid}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_delete_wifi_relay",
      label: "OpenClaw WRT Delete WiFi Relay",
      description: "Remove Wi-Fi relay/STA configuration from the router.",
      op: "delete_wifi_relay",
      parameters: SharedSchemas.DeleteWifiRelaySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as Static<typeof SharedSchemas.DeleteWifiRelaySchema>;
        return {
          deviceId: args.deviceId.trim(),
          payload: args.apply !== undefined ? { apply: args.apply } : undefined,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as Static<typeof SharedSchemas.DeleteWifiRelaySchema>;
        return `Requested Wi-Fi relay deletion on ${args.deviceId}.`;
      },
    }),
  ];
}
