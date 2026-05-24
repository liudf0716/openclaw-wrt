/**
 * Shared tool factory functions for creating standardized tool definitions.
 * Used by all domain tool modules to produce AnyAgentTool instances.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type { ClawWRTBridge, Logger, JsonRecord, DeviceOnlyParams } from "../tool-types.js";
import { callDeviceOp } from "../chawrtd-client.js";
import { buildToolResult as _buildToolResult } from "../tool-parsers.js";

// ============================================================================
// Helpers — re-exported from canonical sources
// ============================================================================

function logToolInvocation(logger: Logger | undefined, name: string, rawParams?: unknown): void {
  logger?.info?.(
    `openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`,
  );
}

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
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.parameters ?? SharedSchemas.DeviceOnlySchema,
    execute: async (_toolCallId, rawParams) => {
      logToolInvocation(params.logger, params.name, rawParams);
      const fallbackArgs = rawParams as DeviceOnlyParams;
      const built = params.buildPayload?.(rawParams) ?? {
        deviceId: fallbackArgs.deviceId ? fallbackArgs.deviceId.trim() : "",
        timeoutMs: fallbackArgs.timeoutMs,
      };
      const response = await callDeviceOp({
        bridge: params.bridge,
        deviceId: built.deviceId,
        op: params.op,
        payload: built.payload,
        timeoutMs: built.timeoutMs,
        expectResponse: built.expectResponse ?? params.expectResponse,
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
