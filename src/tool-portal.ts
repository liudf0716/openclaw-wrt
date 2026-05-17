import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const PORTAL_TOOL_NAMES = ["clawwrt_generate_portal_page", "clawwrt_publish_portal_page"] as const;

export function createPortalTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, PORTAL_TOOL_NAMES);
}
