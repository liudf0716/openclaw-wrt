import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const WIFI_TOOL_NAMES = [
  "clawwrt_get_wifi_info",
  "clawwrt_set_wifi_info",
  "clawwrt_scan_wifi",
  "clawwrt_set_wifi_relay",
] as const;

export function createWifiTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, WIFI_TOOL_NAMES);
}
