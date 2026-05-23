/**
 * Client management tools: list clients, get client info, authorize, kickoff, temporary pass.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  ClientInfoParams,
  AuthClientParams,
  KickoffClientParams,
  TmpPassParams,
} from "../tool-types.js";
import {
  callDeviceOp,
  ensureDevice,
  lookupClientByMac,
} from "../chawrtd-client.js";
import { normalizeMac } from "../tool-parsers.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";
import {
  buildToolResult,
  logToolInvocation,
  getClientsFromResponse,
} from "./_helpers.js";

export function createClientTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_clients",
      label: "OpenClaw WRT Clients",
      description: "List currently authenticated clients on a router.",
      op: "get_clients",
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        const count = getClientsFromResponse(response).length;
        return `Fetched ${count} clients from ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_get_client_info",
      label: "OpenClaw WRT Client Info",
      description: "Get detailed information for one authenticated client by MAC address.",
      parameters: SharedSchemas.ClientInfoSchema,
      execute: async (_toolCallId, rawParams) => {
        logToolInvocation(deps.logger, "clawwrt_get_client_info", rawParams);
        const args = rawParams as ClientInfoParams;
        const normalizedMac = normalizeMac(args.clientMac);
        const response = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "get_client_info",
          payload: { mac: normalizedMac },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Fetched client info for ${normalizedMac} on ${args.deviceId}.`, {
          response,
        });
      },
    },
    {
      name: "clawwrt_auth_client",
      label: "OpenClaw WRT Auth Client",
      description:
        "Authorize one client by MAC and IP through the router-side ClawWRT API. Use this for captive portal login and AI-driven approval.",
      parameters: SharedSchemas.AuthClientSchema,
      execute: async (_toolCallId, rawParams) => {
        logToolInvocation(deps.logger, "clawwrt_auth_client", rawParams);
        const args = rawParams as AuthClientParams;
        const clientMac = normalizeMac(args.clientMac);
        const clientIp = args.clientIp.trim();
        const response = await callDeviceOp({
          bridge: deps.bridge,
          deviceId: args.deviceId.trim(),
          op: "auth_client",
          payload: {
            client_ip: clientIp,
            client_mac: clientMac,
          },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Authorized client ${clientMac} on ${args.deviceId}.`, {
          response,
          resolved: { clientIp, clientMac },
        });
      },
    },
    {
      name: "clawwrt_kickoff_client",
      label: "OpenClaw WRT Kickoff Client",
      description:
        "Disconnect an authenticated client by MAC address. If client IP is omitted, the tool looks it up from get_clients. gwId is required.",
      parameters: SharedSchemas.KickoffClientSchema,
      execute: async (_toolCallId, rawParams) => {
        logToolInvocation(deps.logger, "clawwrt_kickoff_client", rawParams);
        const args = rawParams as KickoffClientParams;
        const deviceId = args.deviceId.trim();
        const device = await ensureDevice(deviceId);
        const clientMac = normalizeMac(args.clientMac);
        const explicitClientIp = args.clientIp?.trim();
        const client = explicitClientIp
          ? null
          : await lookupClientByMac({
            bridge: deps.bridge,
            deviceId,
            clientMac,
            timeoutMs: args.timeoutMs,
          });
        const resolvedClientMac =
          typeof client?.mac === "string" && client.mac.trim() ? client.mac.trim() : clientMac;
        const clientIp =
          explicitClientIp ||
          (typeof client?.ip === "string" && client.ip.trim() ? client.ip.trim() : undefined);
        if (!clientIp) {
          throw new Error(`client IP not found for ${clientMac}; provide clientIp explicitly`);
        }
        const gwId = args.gwId.trim();
        const response = await callDeviceOp({
          bridge: deps.bridge,
          deviceId,
          op: "kickoff",
          payload: {
            client_ip: clientIp,
            client_mac: resolvedClientMac,
            gw_id: gwId,
          },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Kickoff requested for ${clientMac} on ${deviceId}.`, {
          response,
          resolved: { clientIp, gwId, clientMac: resolvedClientMac },
        });
      },
    },
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_tmp_pass_client",
      label: "OpenClaw WRT Temporary Pass Client",
      description: "Temporarily allow one client MAC to bypass captive portal authentication.",
      op: "tmp_pass_client",
      parameters: SharedSchemas.TmpPassSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as TmpPassParams;
        const payload: JsonRecord = {
          client_mac: normalizeMac(args.clientMac).toLowerCase(),
        };
        if (typeof args.timeout === "number") {
          payload.timeout = args.timeout;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
          expectResponse: true,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as TmpPassParams;
        return `Temporary pass requested for ${normalizeMac(args.clientMac)} on ${args.deviceId}.`;
      },
    }),
  ];
}
