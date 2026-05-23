/**
 * src/tools/index.ts - Aggregates all domain tool factories.
 * Will eventually replace tool.ts + tool-factories.ts + all tool-<domain>.ts files.
 *
 * Currently only exports tools that have been fully migrated from the monolith.
 * The top-level tool.ts still uses pickLegacyTools for non-migrated domains.
 */

export { createMqttTools } from "./mqtt.js";
export { createSimpleOperationTool, buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";
