/**
 * ToolContext: Explicit dependency container for all tool factories.
 * Replaces module-level global state (activeToolLogger, activeClawWRTConfig, activeBridgeFallback).
 *
 * All tool factories receive a ToolContext instead of reading from globals.
 * This enables:
 * - Testability (inject mocks without module-state pollution)
 * - Concurrency safety (no shared mutable state)
 * - Explicit dependency graph
 */

import type { ResolvedClawWRTConfig } from "./config.js";
import type { ClawWRTBridge, Logger, JsonRecord } from "./tool-types.js";
import { ChawrtdClient } from "./chawrtd-client.js";

export interface ToolContext {
  /** Optional bridge for SDK-level device communication (when running inside OpenClaw host). */
  bridge?: ClawWRTBridge;
  /** Resolved plugin configuration. */
  config?: ResolvedClawWRTConfig;
  /** Logger instance for tool invocation logging. */
  logger?: Logger;
  /** ChawrtdClient instance for HTTP communication with chawrtd gateway. */
  chawrtd: ChawrtdClient;
}

/**
 * Create a ToolContext from the legacy params shape.
 */
export function createToolContext(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  logger?: Logger;
}): ToolContext {
  return {
    bridge: params.bridge,
    config: params.config,
    logger: params.logger,
    chawrtd: new ChawrtdClient({
      config: params.config,
      bridge: params.bridge,
      logger: params.logger,
    }),
  };
}

/**
 * Log a tool invocation event.
 */
export function logToolInvocation(ctx: ToolContext, name: string, rawParams?: unknown): void {
  ctx.logger?.info?.(
    `openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`,
  );
}

/**
 * Build a standardized tool result object with a summary string and detail payload.
 */
export function buildToolResult(text: string, details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text }],
    details: details as Record<string, unknown>,
  };
}
