/**
 * Meta/aggregate tools: claw_wifi_hello and clawwrt (low-level fallback).
 * These are extracted from tool-monolith.ts during Phase C migration.
 * They will be fully reimplemented in Phase E when tool-monolith.ts is removed.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolFactoryDeps } from "./_factory.js";
import { createClawWRTTools } from "../tool-monolith.js";

const META_TOOL_NAMES = new Set(["claw_wifi_hello", "clawwrt"]);

export function createMetaTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  // Get all tools from the monolith and filter to just the meta tools
  const allMonolithTools = createClawWRTTools({
    bridge: deps.bridge,
    logger: deps.logger,
  });
  return allMonolithTools.filter((tool) => META_TOOL_NAMES.has(tool.name));
}
