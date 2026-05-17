import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const NETWORK_SYSTEM_TOOL_NAMES = [
  "clawwrt_get_firmware_info",
  "clawwrt_get_network_interfaces",
  "clawwrt_get_br_lan",
  "clawwrt_set_br_lan",
  "clawwrt_firmware_upgrade",
  "clawwrt_delete_wifi_relay",
  "clawwrt_execute_shell",
  "clawwrt_get_speedtest_servers",
  "clawwrt_speedtest",
  "clawwrt_reboot_device",
] as const;

export function createNetworkSystemTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, NETWORK_SYSTEM_TOOL_NAMES);
}
