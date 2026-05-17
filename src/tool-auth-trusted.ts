import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const AUTH_TRUSTED_TOOL_NAMES = [
  "clawwrt_get_trusted_domains",
  "clawwrt_sync_trusted_domains",
  "clawwrt_get_trusted_wildcard_domains",
  "clawwrt_sync_trusted_wildcard_domains",
  "clawwrt_get_trusted_mac",
  "clawwrt_sync_trusted_mac",
  "clawwrt_get_auth_serv",
  "clawwrt_set_auth_serv",
] as const;

export function createAuthTrustedTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, AUTH_TRUSTED_TOOL_NAMES);
}
