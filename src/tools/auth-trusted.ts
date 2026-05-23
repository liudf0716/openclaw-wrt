/**
 * Auth server and trusted domains/MAC tools: get/set auth server, sync trusted domains/wildcard/MAC.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  SetAuthServerParams,
  DomainSyncParams,
  TrustedMacSyncParams,
} from "../tool-types.js";
import { normalizeMac } from "../tool-parsers.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";

export function createAuthTrustedTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_auth_serv",
      label: "OpenClaw WRT Get Auth Server",
      description: "Get the current captive portal authentication server configuration.",
      op: "get_auth_serv",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched auth server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_set_auth_serv",
      label: "OpenClaw WRT Set Auth Server",
      description: "Set the captive portal authentication server hostname, port, and path.",
      op: "set_auth_serv",
      parameters: SharedSchemas.SetAuthServerSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetAuthServerParams;
        const payload: JsonRecord = { hostname: args.hostname };
        if (args.port !== undefined) {
          payload.port = args.port;
        }
        if (typeof args.path === "string") {
          payload.path = args.path;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetAuthServerParams;
        return `Updated auth server for ${args.deviceId} to ${args.hostname}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_trusted_domains",
      label: "OpenClaw WRT Trusted Domains",
      description: "Get the trusted domain whitelist for captive portal bypass.",
      op: "get_trusted_domains",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted domains for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_sync_trusted_domains",
      label: "OpenClaw WRT Sync Trusted Domains",
      description: "Replace the trusted domain whitelist with the provided full domain list.",
      op: "sync_trusted_domain",
      parameters: SharedSchemas.DomainSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DomainSyncParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { domains: args.domains },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as DomainSyncParams;
        return `Synced ${args.domains.length} trusted domains on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_trusted_wildcard_domains",
      label: "OpenClaw WRT Trusted Wildcard Domains",
      description: "Get the trusted wildcard domain whitelist.",
      op: "get_trusted_wildcard_domains",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted wildcard domains for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_sync_trusted_wildcard_domains",
      label: "OpenClaw WRT Sync Trusted Wildcard Domains",
      description: "Replace the trusted wildcard domain whitelist with the provided full list.",
      op: "sync_trusted_wildcard_domains",
      parameters: SharedSchemas.DomainSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DomainSyncParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { domains: args.domains },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as DomainSyncParams;
        return `Synced ${args.domains.length} trusted wildcard domains on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_trusted_mac",
      label: "OpenClaw WRT Trusted MACs",
      description: "Get the trusted MAC whitelist.",
      op: "get_trusted_mac",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted MACs for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_sync_trusted_mac",
      label: "OpenClaw WRT Sync Trusted MACs",
      description: "Replace the trusted MAC whitelist with the provided full MAC list.",
      op: "sync_trusted_mac",
      parameters: SharedSchemas.TrustedMacSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as TrustedMacSyncParams;
        const macs = args.macs.map((value) => normalizeMac(value).toLowerCase());
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            macs,
            values: args.values ?? Array(macs.length).fill("1"),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as TrustedMacSyncParams;
        return `Synced ${args.macs.length} trusted MACs on ${args.deviceId}.`;
      },
    }),
  ];
}
