/**
 * Device management tools: list, get, status, sys info, device info, reboot, firmware, network interfaces.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  UpdateDeviceInfoParams,
  ClawWRTBridge,
  Logger,
} from "../tool-types.js";
import {
  callDeviceOp,
  getDevicesListViaChawrtd,
  getDeviceViaChawrtd,
} from "../chawrtd-client.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";
import {
  buildToolResult,
  logToolInvocation,
} from "../tool-parsers.js";

// ============================================================================
// Custom tools (not using createSimpleOperationTool)
// ============================================================================

function createListDevicesTool(params: { bridge?: ClawWRTBridge; logger?: Logger }): AnyAgentTool {
  return {
    name: "clawwrt_list_devices",
    label: "OpenClaw WRT Devices",
    description:
      "List all currently connected online routers, wireless routers, or OpenWrt devices managed by openclaw-wrt.",
    parameters: Type.Object(
      {
        dummy_field: Type.Optional(
          Type.String({
            description: "Ignore this field. It exists to prevent empty parameter objects.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async () => {
      logToolInvocation(params.logger, "clawwrt_list_devices");
      const devices = await getDevicesListViaChawrtd();

      const deviceStrings = devices
        .map((d) => `- ${d.alias || "WiFi"} (ID: ${d.deviceId})`)
        .join("\n");
      const textOutput = `当前 ${devices.length} 台设备在线：\n\n${deviceStrings}`;

      return buildToolResult(textOutput, { devices });
    },
  };
}

function createGetDeviceTool(params: { bridge?: ClawWRTBridge; logger?: Logger }): AnyAgentTool {
  return {
    name: "clawwrt_get_device",
    label: "OpenClaw WRT Device",
    description:
      "Get the current connection snapshot for one online router or wireless router. This is a quick connectivity view, not the full runtime detail report.",
    parameters: Type.Object(
      { deviceId: SharedSchemas.DeviceIdField },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, rawParams) => {
      logToolInvocation(params.logger, "clawwrt_get_device", rawParams);
      const args = rawParams as { deviceId: string };
      const device = await getDeviceViaChawrtd(args.deviceId.trim());
      return buildToolResult(`Device ${args.deviceId} is connected.`, { device });
    },
  };
}

// ============================================================================
// Domain tool factory
// ============================================================================

export function createDeviceTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createListDevicesTool(deps),
    createGetDeviceTool(deps),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_status",
      label: "OpenClaw WRT Status",
      description:
        "Get detailed runtime status and health information for an online router or wireless router. Prefer this when the user asks for router details or current router status.",
      op: "get_status",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched status for device ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_sys_info",
      label: "OpenClaw WRT System Info",
      description:
        "Get detailed router system information such as model, platform, memory, storage, uptime, and resource usage for an online router.",
      op: "get_sys_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched system info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_device_info",
      label: "OpenClaw WRT Device Info",
      description:
        "Get configured router metadata such as site, label, location, and other saved device information for an online router.",
      op: "get_device_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched device info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_update_device_info",
      label: "OpenClaw WRT Update Device Info",
      description: "Update device metadata such as site, label, location, or custom fields.",
      op: "update_device_info",
      parameters: SharedSchemas.UpdateDeviceInfoSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as UpdateDeviceInfoParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { device_info: args.deviceInfo },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as UpdateDeviceInfoParams;
        return `Updated device info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_reboot_device",
      label: "OpenClaw WRT Reboot Device",
      description:
        "Request a router reboot. The device should respond before rebooting, but it may disconnect immediately.",
      op: "reboot_device",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Reboot request sent to ${args.deviceId}. Treat this as best-effort and expect disconnect.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_firmware_info",
      label: "OpenClaw WRT Firmware Info",
      description: "Get the router's firmware/build information.",
      op: "get_firmware_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched firmware info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_firmware_upgrade",
      label: "OpenClaw WRT Firmware Upgrade",
      description: "Trigger a firmware upgrade (OTA) on the router using a URL.",
      op: "firmware_upgrade",
      parameters: SharedSchemas.FirmwareUpgradeSchema,
      summarize: (_response, rawParams) => {
        const args = rawParams as Static<typeof SharedSchemas.FirmwareUpgradeSchema>;
        return `Firmware upgrade requested for ${args.deviceId} from ${args.url}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_network_interfaces",
      label: "OpenClaw WRT Network Interfaces",
      description: "Get network interface inventory and IP details using a native API call.",
      op: "get_network_interfaces",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched network interfaces for ${args.deviceId}.`;
      },
    }),
  ];
}
