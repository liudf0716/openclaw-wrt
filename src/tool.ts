import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedClawWRTConfig } from "./config.js";
import type { ClawWRTBridge, Logger } from "./tool-types.js";
import * as ToolSchemas from "./tool-schemas.js";
import * as ToolTypes from "./tool-types.js";
import { createDeviceTools } from "./tools/device.js";
import { createClientTools } from "./tools/client.js";
import { createWifiTools } from "./tools/wifi.js";
import { createBpfTools } from "./tools/bpf.js";
import { createAuthTrustedTools } from "./tools/auth-trusted.js";
import { createMqttTools } from "./tools/mqtt.js";
import { createPortalTools } from "./tools/portal.js";
import { createWireguardTools } from "./tools/wireguard.js";
import { createXfrpcTools } from "./tools/xfrpc.js";
import { createNetworkSystemTools } from "./tools/network-system.js";
import { createFrpsTools } from "./tools/frps.js";
import { createMetaTools } from "./tools/meta.js";

export { ToolSchemas, ToolTypes };

export type CreateClawWRTToolsParams = {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  logger?: Logger;
};

export function createClawWRTTools(params: CreateClawWRTToolsParams): AnyAgentTool[] {
  const deps = { bridge: params.bridge, logger: params.logger };
  return [
    ...createDeviceTools(deps),
    ...createClientTools(deps),
    ...createWifiTools(deps),
    ...createBpfTools(deps),
    ...createAuthTrustedTools(deps),
    ...createMqttTools(deps),
    ...createPortalTools(deps),
    ...createWireguardTools(deps),
    ...createNetworkSystemTools(deps),
    ...createXfrpcTools(deps),
    ...createFrpsTools(deps),
    ...createMetaTools(deps),
  ];
}
