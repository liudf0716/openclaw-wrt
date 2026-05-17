import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedClawWRTConfig } from "./config.js";
import { createClawWRTTools as createLegacyClawWRTTools } from "./tool-monolith.js";
import type { ClawWRTBridge, Logger } from "./tool-types.js";

export type ToolFactoryParams = {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  logger?: Logger;
};

export function createLegacyTools(params: ToolFactoryParams): AnyAgentTool[] {
  return createLegacyClawWRTTools(params);
}

export function createLegacyToolMap(params: ToolFactoryParams): Map<string, AnyAgentTool> {
  const tools = createLegacyTools(params);
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function pickLegacyTools(params: ToolFactoryParams, names: readonly string[]): AnyAgentTool[] {
  const toolMap = createLegacyToolMap(params);
  return names.map((name) => {
    const tool = toolMap.get(name);
    if (!tool) {
      throw new Error(`Legacy tool not found: ${name}`);
    }
    return tool;
  });
}
