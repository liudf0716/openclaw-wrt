/**
 * Shared tool factory functions for creating standardized tool definitions.
 * Used by all domain tool modules to produce AnyAgentTool instances.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type { ClawWRTBridge, Logger, JsonRecord, DeviceOnlyParams } from "../tool-types.js";
import { callDeviceOp } from "../chawrtd-client.js";
import { buildToolResult as _buildToolResult, logToolInvocation } from "../tool-parsers.js";

// ============================================================================
// Helpers — re-exported from canonical sources
// ============================================================================

const buildToolResult = _buildToolResult;

// ============================================================================
// Factory Parameters Type
// ============================================================================

export type ToolFactoryDeps = {
  bridge?: ClawWRTBridge;
  logger?: Logger;
};

// ============================================================================
// createSimpleOperationTool
// ============================================================================

/**
 * Create a tool that performs a single device operation via callDeviceOp.
 * Covers the majority of tools that are "send op → get response → summarize" pattern.
 */
export function createSimpleOperationTool(params: {
  bridge?: ClawWRTBridge;
  logger?: Logger;
  name: string;
  label: string;
  description: string;
  op: string;
  parameters?: AnyAgentTool["parameters"];
  expectResponse?: boolean;
  buildPayload?: (rawParams: unknown) => {
    deviceId: string;
    payload?: JsonRecord;
    timeoutMs?: number;
    expectResponse?: boolean;
  };
  summarize?: (response: JsonRecord, rawParams: unknown) => string;
  /** Optional progress message emitted before the device op call. */
  onStart?: (rawParams: unknown) => string;
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.parameters ?? SharedSchemas.DeviceOnlySchema,
    execute: async (_toolCallId, rawParams, signal, onUpdate) => {
      logToolInvocation(params.logger, params.name, rawParams);
      const fallbackArgs = rawParams as DeviceOnlyParams;
      const built = params.buildPayload?.(rawParams) ?? {
        deviceId: fallbackArgs.deviceId ? fallbackArgs.deviceId.trim() : "",
        timeoutMs: fallbackArgs.timeoutMs,
      };
      // Emit optional progress message before the call
      if (params.onStart && onUpdate) {
        const msg = params.onStart(rawParams);
        onUpdate({
          content: [{ type: "text", text: msg }],
          details: { phase: "starting" },
        });
      }
      const response = await callDeviceOp({
        deviceId: built.deviceId,
        op: params.op,
        payload: built.payload,
        timeoutMs: built.timeoutMs,
        expectResponse: built.expectResponse ?? params.expectResponse,
        signal,
      });
      const summary =
        params.summarize?.(response, rawParams) ??
        `Device ${built.deviceId} responded to ${params.op}.`;
      const responseJson = JSON.stringify(response);
      const text = `${summary}\n\nDevice response data:\n${responseJson}`;
      return buildToolResult(text, { response });
    },
  };
}

export { buildToolResult, logToolInvocation };
