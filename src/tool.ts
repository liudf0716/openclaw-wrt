import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedClawWRTConfig } from "./config.js";
import type { ClawWRTBridge, Logger } from "./tool-types.js";
import * as ToolSchemas from "./tool-schemas.js";
import * as ToolTypes from "./tool-types.js";
import {
  createLegacyToolMap,
  type ToolFactoryParams,
  pickLegacyTools,
} from "./tool-factories.js";
import { createDeviceTools, createMetaTools } from "./tool-device.js";
import { createClientTools } from "./tool-client.js";
import { createWifiTools } from "./tool-wifi.js";
import { createPortalTools } from "./tool-portal.js";
import { createBpfTools } from "./tool-bpf.js";
import { createAuthTrustedTools } from "./tool-auth-trusted.js";
import { createWireguardClientTools } from "./tool-wireguard-client.js";
import { createNetworkSystemTools } from "./tool-network-system.js";
import { createMqttTools } from "./tool-mqtt.js";
import { createXfrpcTools } from "./tool-xfrpc.js";
import { createServerInfraTools } from "./tool-server-infra.js";

export { ToolSchemas, ToolTypes };

export type CreateClawWRTToolsParams = {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  logger?: Logger;
};

const AUTH_SERVER_NAMES = ["clawwrt_get_auth_serv", "clawwrt_set_auth_serv"] as const;

function withoutTools(tools: AnyAgentTool[], excludedNames: readonly string[]): AnyAgentTool[] {
  const excluded = new Set(excludedNames);
  return tools.filter((tool) => !excluded.has(tool.name));
}

function createOrderedTools(params: ToolFactoryParams): AnyAgentTool[] {
  const deviceTools = createDeviceTools(params);
  const clientTools = createClientTools(params);
  const wifiTools = createWifiTools(params);
  const bpfTools = createBpfTools(params);
  const authTrustedTools = createAuthTrustedTools(params);
  const authServerTools = pickLegacyTools(params, AUTH_SERVER_NAMES);
  const portalTools = createPortalTools(params);
  const mqttTools = createMqttTools(params);
  const wireguardClientTools = createWireguardClientTools(params);
  const networkSystemTools = createNetworkSystemTools(params);
  const xfrpcTools = createXfrpcTools(params);
  const serverInfraTools = createServerInfraTools(params);
  const metaTools = createMetaTools(params);

  return [
    ...deviceTools,
    ...clientTools,
    ...wifiTools,
    ...bpfTools,
    ...withoutTools(authTrustedTools, AUTH_SERVER_NAMES),
    ...authServerTools,
    ...portalTools,
    ...mqttTools,
    ...wireguardClientTools,
    ...networkSystemTools,
    ...xfrpcTools,
    ...serverInfraTools,
    ...metaTools,
  ];
}

export function createClawWRTTools(params: CreateClawWRTToolsParams): AnyAgentTool[] {
  const orderedTools = createOrderedTools(params);

  const legacyToolMap = createLegacyToolMap(params);
  for (const tool of orderedTools) {
    if (!legacyToolMap.has(tool.name)) {
      throw new Error(`Missing legacy tool in refactored aggregator: ${tool.name}`);
    }
  }

  return orderedTools;
}
