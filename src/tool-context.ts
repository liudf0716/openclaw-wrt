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
import type { ClawWRTBridge, Logger, JsonRecord, DeviceSnapshot, ChawrtdToolResult } from "./tool-types.js";

// ============================================================================
// ToolContext Interface
// ============================================================================

export interface ToolContext {
  /** Optional bridge for SDK-level device communication (when running inside OpenClaw host). */
  bridge?: ClawWRTBridge;
  /** Resolved plugin configuration. */
  config?: ResolvedClawWRTConfig;
  /** Logger instance for tool invocation logging. */
  logger?: Logger;
}

// ============================================================================
// Shared helpers that operate on ToolContext
// ============================================================================

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
    text,
    details: details as Record<string, unknown>,
  };
}
