/**
 * XFRPC intranet penetration tools.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  GetXfrpcTcpServiceParams,
  DelXfrpcTcpServiceParams,
  DisableXfrpcTcpServiceParams,
} from "../tool-types.js";
import {
  callChawrtd,
  callDeviceOp,
  restartXfrpcService,
} from "../tool-chawrtd.js";
import { createSimpleOperationTool, buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";
import {
  asObject,
  getTrimmedString,
  requireTrimmedString,
  parsePortString,
  assertValidServerAddr,
  getXfrpcTcpServicesFromResponse,
  getXfrpcTcpServiceRemotePort,
  getFrpsStatusToken,
  getFrpsStatusPort,
  getFrpsStatusPublicIp,
  getXfrpcCommonConfigFromResponse,
} from "./_helpers.js";

// ============================================================================
// Internal helpers
// ============================================================================

async function resolveXfrpcCommonSettings(params: { timeoutMs?: number }): Promise<{
  serverAddr: string;
  serverPort: string;
  token: string;
}> {
  const statusResponse = await callChawrtd({ path: "/v1/frps/status", method: "GET", timeoutMs: params.timeoutMs });

  const serverAddr = getFrpsStatusPublicIp(statusResponse);
  const serverPort = getFrpsStatusPort(statusResponse);
  const token = getFrpsStatusToken(statusResponse);

  if (!serverAddr) {
    throw new Error("unable to resolve server_addr from chawrtd public IP");
  }
  if (!serverPort) {
    throw new Error("unable to resolve server_port from FRPS status");
  }
  if (!token) {
    throw new Error("unable to resolve token from FRPS status");
  }

  return { serverAddr, serverPort, token };
}

// ============================================================================
// Exported factory
// ============================================================================

export function createXfrpcTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    // ---------------------------------------------------------------------------
    // clawwrt_get_xfrpc_common_config — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_xfrpc_common_config",
      label: "OpenClaw WRT XFRPC Common Config",
      description: "Get XFRPC common (global) configuration from the router.",
      op: "get_xfrpc_common_config",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched XFRPC common config for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_get_xfrpc_common — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_xfrpc_common",
      label: "OpenClaw WRT XFRPC Common",
      description: "Get XFRPC common (global) configuration from the router.",
      op: "get_xfrpc_common",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched XFRPC common config for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_get_xfrpc_tcp_service — simple op with payload builder
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_xfrpc_tcp_service",
      label: "OpenClaw WRT XFRPC TCP Service",
      description: "Get configuration for a specific XFRPC TCP service by name, or all TCP services if no name is provided.",
      op: "get_xfrpc_tcp_service",
      parameters: SharedSchemas.GetXfrpcTcpServiceSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as GetXfrpcTcpServiceParams;
        const payload: JsonRecord = {};
        if (args.name !== undefined) {
          payload.name = args.name;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as GetXfrpcTcpServiceParams;
        return args.name ? `Fetched XFRPC TCP service '${args.name}' for ${args.deviceId}.` : `Fetched all XFRPC TCP services for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_del_xfrpc_tcp_service — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_del_xfrpc_tcp_service",
      label: "OpenClaw WRT Delete XFRPC TCP Service",
      description: "Delete a specific XFRPC TCP service by name, or all TCP services if no name is provided.",
      parameters: SharedSchemas.DelXfrpcTcpServiceSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_del_xfrpc_tcp_service", rawParams);
        const args = rawParams as DelXfrpcTcpServiceParams;
        const mutationResponse = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "del_xfrpc_tcp_service",
          payload: { name: args.name || "" },
          timeoutMs: args.timeoutMs,
        });
        const restartResponse = await restartXfrpcService({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(
          args.name
            ? `Deleted XFRPC TCP service '${args.name}' on ${args.deviceId} and restarted XFRPC.`
            : `Deleted all XFRPC TCP services on ${args.deviceId} and restarted XFRPC.`,
          {
            mutationResponse,
            restartResponse,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_disable_xfrpc_tcp_service — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_disable_xfrpc_tcp_service",
      label: "OpenClaw WRT Disable XFRPC TCP Service",
      description: "Disable a specific XFRPC TCP service by name (sets enabled=0).",
      parameters: SharedSchemas.DisableXfrpcTcpServiceSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_disable_xfrpc_tcp_service", rawParams);
        const args = rawParams as DisableXfrpcTcpServiceParams;
        const mutationResponse = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "disable_xfrpc_tcp_service",
          payload: { name: args.name },
          timeoutMs: args.timeoutMs,
        });
        const restartResponse = await restartXfrpcService({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Disabled XFRPC TCP service '${args.name}' on ${args.deviceId} and restarted XFRPC.`, {
          mutationResponse,
          restartResponse,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_disable_xfrpc_service — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_disable_xfrpc_service",
      label: "OpenClaw WRT Disable XFRPC Service",
      description: "Disable the global XFRPC service on the router (sets enabled=0 in common).",
      parameters: SharedSchemas.DeviceOnlySchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_disable_xfrpc_service", rawParams);
        const args = rawParams as DeviceOnlyParams;
        const mutationResponse = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "disable_xfrpc_service",
          timeoutMs: args.timeoutMs,
        });
        const restartResponse = await restartXfrpcService({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Disabled global XFRPC service on ${args.deviceId} and restarted XFRPC.`, {
          mutationResponse,
          restartResponse,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_set_xfrpc_common — custom (auto-resolves settings from chawrtd)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_set_xfrpc_common",
      label: "OpenClaw WRT Set XFRPC Common",
      description:
        "Set XFRPC common configuration on the router. The tool auto-resolves server address, server port, and token from chawrtd, so the caller only needs the target device and optional enabled/loglevel settings.",
      parameters: SharedSchemas.SetXfrpcCommonSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_set_xfrpc_common", rawParams);
        const args = rawParams as { deviceId: string; enabled?: string; loglevel?: string; timeoutMs?: number };
        const { serverAddr, serverPort, token } = await resolveXfrpcCommonSettings({ timeoutMs: args.timeoutMs });
        assertValidServerAddr(serverAddr);
        parsePortString(serverPort, "server_port");
        const payload: JsonRecord = {};
        if (args.enabled !== undefined) {
          payload.enabled = args.enabled;
        }
        if (args.loglevel !== undefined) {
          payload.loglevel = args.loglevel;
        }
        payload.server_addr = serverAddr;
        payload.server_port = serverPort;
        payload.token = token;
        const mutationResponse = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "set_xfrpc_common",
          payload,
          timeoutMs: args.timeoutMs,
        });
        const restartResponse = await restartXfrpcService({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Updated XFRPC common config on ${args.deviceId} and restarted XFRPC.`, {
          mutationResponse,
          restartResponse,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_add_xfrpc_tcp_service — custom (checks remote_port conflicts)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_add_xfrpc_tcp_service",
      label: "OpenClaw WRT Add XFRPC TCP Service",
      description: "Add a TCP intranet penetration service to the router.",
      parameters: SharedSchemas.AddXfrpcTcpServiceSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_add_xfrpc_tcp_service", rawParams);
        const args = rawParams as {
          deviceId: string;
          name: string;
          enabled?: string;
          local_ip?: string;
          local_port?: string;
          remote_port?: string;
          start_time?: string;
          end_time?: string;
          timeoutMs?: number;
        };
        const payload: JsonRecord = { name: args.name };
        if (args.enabled !== undefined) {
          payload.enabled = args.enabled;
        }
        if (args.local_ip !== undefined) {
          payload.local_ip = args.local_ip;
        }
        if (args.local_port !== undefined) {
          payload.local_port = args.local_port;
        }
        if (args.remote_port !== undefined) {
          const remotePortText = requireTrimmedString(args.remote_port, "remote_port");
          const remotePort = parsePortString(remotePortText, "remote_port");
          const existingResponse = asObject(
            await callDeviceOp({
              bridge: deps.bridge,
              deviceId: args.deviceId.trim(),
              op: "get_xfrpc_tcp_service",
              payload: {},
              timeoutMs: args.timeoutMs,
            }),
          );
          const existingServices = getXfrpcTcpServicesFromResponse(existingResponse ?? {});
          const conflict = existingServices.some((service) => getXfrpcTcpServiceRemotePort(service) === remotePort);
          if (conflict) {
            throw new Error(`remote_port ${remotePort} already in use on this device`);
          }
          payload.remote_port = remotePortText;
        }
        if (args.start_time !== undefined) {
          payload.start_time = args.start_time;
        }
        if (args.end_time !== undefined) {
          payload.end_time = args.end_time;
        }
        const mutationResponse = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "add_xfrpc_tcp_service",
          payload,
          timeoutMs: args.timeoutMs,
        });
        const restartResponse = await restartXfrpcService({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Added XFRPC TCP service '${args.name}' on ${args.deviceId} and restarted XFRPC.`, {
          mutationResponse,
          restartResponse,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_restart_xfrpc — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_restart_xfrpc",
      label: "OpenClaw WRT Restart XFRPC",
      description:
        "Restart router XFRPC intranet penetration client service by running /etc/init.d/xfrpc restart.",
      op: "restart_xfrpc",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Restarted XFRPC service on ${args.deviceId}.`;
      },
    }),
  ];
}
