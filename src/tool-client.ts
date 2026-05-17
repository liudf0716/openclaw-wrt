import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const CLIENT_TOOL_NAMES = [
  "clawwrt_get_clients",
  "clawwrt_get_client_info",
  "clawwrt_auth_client",
  "clawwrt_kickoff_client",
  "clawwrt_tmp_pass_client",
] as const;

export function createClientTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, CLIENT_TOOL_NAMES);
}
