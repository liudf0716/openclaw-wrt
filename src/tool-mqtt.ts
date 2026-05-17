import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const MQTT_TOOL_NAMES = ["clawwrt_get_mqtt_serv", "clawwrt_set_mqtt_serv"] as const;

export function createMqttTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, MQTT_TOOL_NAMES);
}
