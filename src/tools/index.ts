/**
 * src/tools/index.ts - Aggregates all domain tool factories.
 * This is the new entry point that replaces tool.ts + tool-factories.ts.
 */

export { createSimpleOperationTool, buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";
export { createDeviceTools } from "./device.js";
export { createClientTools } from "./client.js";
export { createWifiTools } from "./wifi.js";
export { createBpfTools } from "./bpf.js";
export { createAuthTrustedTools } from "./auth-trusted.js";
export { createMqttTools } from "./mqtt.js";
export { createPortalTools } from "./portal.js";
export { createDiagnosticsTools } from "./diagnostics.js";
export { createWireguardTools } from "./wireguard.js";
export { createXfrpcTools } from "./xfrpc.js";
export { createNetworkSystemTools } from "./network-system.js";
export { createFrpsTools } from "./frps.js";
export { createMetaTools } from "./meta.js";
