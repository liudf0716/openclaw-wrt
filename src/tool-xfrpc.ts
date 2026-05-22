import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const XFRPC_TOOL_NAMES = [
  "clawwrt_get_xfrpc_common_config",
  "clawwrt_get_xfrpc_common",
  "clawwrt_get_xfrpc_tcp_service",
  "clawwrt_del_xfrpc_tcp_service",
  "clawwrt_disable_xfrpc_tcp_service",
  "clawwrt_disable_xfrpc_service",
  "clawwrt_set_xfrpc_common",
  "clawwrt_add_xfrpc_tcp_service",
  "clawwrt_restart_xfrpc",
  "openclaw_frps_full_status",
] as const;

export function createXfrpcTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, XFRPC_TOOL_NAMES);
}
