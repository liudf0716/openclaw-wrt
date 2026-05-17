import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const WIREGUARD_CLIENT_TOOL_NAMES = [
  "clawwrt_get_wireguard_vpn",
  "clawwrt_set_wireguard_vpn",
  "clawwrt_reset_wireguard_vpn",
  "clawwrt_get_wireguard_vpn_status",
  "clawwrt_verify_wireguard_connectivity",
  "clawwrt_generate_wireguard_keys",
  "clawwrt_get_vpn_routes",
  "clawwrt_set_vpn_routes",
  "clawwrt_collect_wireguard_protected_routes",
] as const;

export function createWireguardClientTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, WIREGUARD_CLIENT_TOOL_NAMES);
}
