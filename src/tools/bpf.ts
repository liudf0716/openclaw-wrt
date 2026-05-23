/**
 * BPF monitoring tools: add/remove/flush/update targets, query stats, L7 protocol catalog.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  DeviceOnlyParams,
  BpfAddParams,
  BpfJsonParams,
  BpfDeleteParams,
  BpfFlushParams,
  BpfUpdateParams,
  BpfUpdateAllParams,
  BpfJsonTable,
} from "../tool-types.js";
import { normalizeBpfAddress } from "../tool-parsers.js";
import { createSimpleOperationTool, type ToolFactoryDeps } from "./_factory.js";
import { summarizeBpfJsonResponse } from "./_helpers.js";

export function createBpfTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_add",
      label: "OpenClaw WRT BPF Add",
      description: "Add an IPv4, IPv6, or MAC target to the device's BPF traffic monitoring table.",
      op: "bpf_add",
      parameters: SharedSchemas.BpfAddSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfAddParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            address: normalizeBpfAddress(table, args.address),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfAddParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Added ${args.address} to the ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_json",
      label: "OpenClaw WRT BPF Stats",
      description:
        "Query BPF traffic monitoring statistics for one table (`ipv4`, `ipv6`, `mac`, `sid`, or `l7`).",
      op: "bpf_json",
      parameters: SharedSchemas.BpfJsonSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfJsonParams;
        const table = (args.table ?? "mac") as BpfJsonTable;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
          },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as BpfJsonParams;
        const table = (args.table ?? "mac") as BpfJsonTable;
        return summarizeBpfJsonResponse(response, table, args.deviceId);
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_l7_active_stats",
      label: "OpenClaw WRT L7 Active Stats",
      description:
        "Get active L7 protocol traffic speed and volume statistics (SID view) for the current device.",
      op: "bpf_json",
      parameters: SharedSchemas.DeviceOnlySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { table: "sid" },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return summarizeBpfJsonResponse(response, "sid", args.deviceId);
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_l7_protocol_catalog",
      label: "OpenClaw WRT L7 Protocol Catalog",
      description:
        "List the L7 protocol library currently supported by the device, including domain signatures when available.",
      op: "bpf_json",
      parameters: SharedSchemas.DeviceOnlySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { table: "l7" },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return summarizeBpfJsonResponse(response, "l7", args.deviceId);
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_del",
      label: "OpenClaw WRT BPF Delete",
      description:
        "Remove an IPv4, IPv6, or MAC target from the device's BPF traffic monitoring table.",
      op: "bpf_del",
      parameters: SharedSchemas.BpfDeleteSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfDeleteParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            address: normalizeBpfAddress(table, args.address),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfDeleteParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Removed ${args.address} from the ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_flush",
      label: "OpenClaw WRT BPF Flush",
      description: "Clear all entries from one BPF monitoring table.",
      op: "bpf_flush",
      parameters: SharedSchemas.BpfFlushSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfFlushParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table: args.table ?? "mac",
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfFlushParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Flushed ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_update",
      label: "OpenClaw WRT BPF Update",
      description: "Update downrate/uprate limits for one BPF monitored target.",
      op: "bpf_update",
      parameters: SharedSchemas.BpfUpdateSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfUpdateParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            target: normalizeBpfAddress(table, args.target),
            downrate: args.downrate,
            uprate: args.uprate,
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfUpdateParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Updated ${table} BPF rate limits for ${args.target} on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_bpf_update_all",
      label: "OpenClaw WRT BPF Update All",
      description: "Update downrate/uprate limits for all entries in one BPF table.",
      op: "bpf_update_all",
      parameters: SharedSchemas.BpfUpdateAllSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfUpdateAllParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table: args.table ?? "mac",
            downrate: args.downrate,
            uprate: args.uprate,
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfUpdateAllParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Updated ${table} BPF rate limits for all monitored entries on ${args.deviceId}.`;
      },
    }),
  ];
}
