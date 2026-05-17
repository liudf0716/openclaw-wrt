import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const DEVICE_TOOL_NAMES = [
  "clawwrt_list_devices",
  "clawwrt_get_device",
  "clawwrt_get_status",
  "clawwrt_get_sys_info",
  "clawwrt_get_device_info",
  "clawwrt_update_device_info",
] as const;

const META_TOOL_NAMES = ["claw_wifi_hello", "clawwrt"] as const;

export function createDeviceTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, DEVICE_TOOL_NAMES);
}

export function createMetaTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, META_TOOL_NAMES);
}
