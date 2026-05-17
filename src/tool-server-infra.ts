import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const SERVER_INFRA_TOOL_NAMES = [
  "openclaw_deploy_frps",
  "openclaw_get_frps_status",
  "openclaw_reset_frps",
  "openclaw_reset_wg_server",
  "openclaw_deploy_wg_server",
  "openclaw_get_wg_status",
  "openclaw_get_wg_server_public_key",
  "openclaw_get_vps_public_ip",
] as const;

export function createServerInfraTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, SERVER_INFRA_TOOL_NAMES);
}
