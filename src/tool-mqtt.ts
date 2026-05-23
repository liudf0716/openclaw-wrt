/**
 * MQTT tools - delegates to the real implementation in src/tools/mqtt.ts.
 * This file exists for backward compatibility during the migration period.
 */
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolFactoryParams } from "./tool-factories.js";
import { createMqttTools as createMqttToolsImpl } from "./tools/mqtt.js";

export function createMqttTools(params: ToolFactoryParams): AnyAgentTool[] {
  return createMqttToolsImpl({ bridge: params.bridge, logger: params.logger });
}
