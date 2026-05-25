/**
 * Network performance diagnose tools: DHCP, DNS, HTTP, and HTTPS.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  DhcpDiagnoseParams,
  DnsDiagnoseParams,
  JsonRecord,
  WebServiceDiagnoseParams,
} from "../tool-types.js";
import { callDeviceDiagnose } from "../chawrtd-client.js";
import { buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";

function toStringArray(values?: string[]): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const filtered = values.map((value) => value.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered : undefined;
}

function buildResultText(action: string, deviceId: string, response: JsonRecord): string {
  const summary = response.summary as JsonRecord | undefined;
  const metrics =
    summary && typeof summary === "object"
      ? [
          typeof summary.success_rate === "number" ? `success_rate=${summary.success_rate}` : null,
          typeof summary.avg_latency_ms === "number" ? `avg_latency_ms=${summary.avg_latency_ms}` : null,
          typeof summary.p95_latency_ms === "number" ? `p95_latency_ms=${summary.p95_latency_ms}` : null,
        ]
          .filter((entry): entry is string => typeof entry === "string")
          .join(", ")
      : "";

  return `${action} completed on ${deviceId}.${metrics ? ` ${metrics}.` : ""}\n\nDevice response data:\n${JSON.stringify(response)}`;
}

function createDiagnoseTool(params: {
  deps: ToolFactoryDeps;
  name: string;
  label: string;
  description: string;
  kind: "dhcp" | "dns" | "http" | "https";
  parameters: AnyAgentTool["parameters"];
  buildPayload: (rawParams: unknown) => JsonRecord;
  summarize: (rawParams: unknown) => string;
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.parameters,
    execute: async (_toolCallId, rawParams) => {
      logToolInvocation(params.deps.logger, params.name, rawParams);
      const deviceId = (rawParams as { deviceId?: string }).deviceId?.trim() ?? "";
      const response = await callDeviceDiagnose({
        deviceId,
        kind: params.kind,
        payload: params.buildPayload(rawParams),
        timeoutMs: (rawParams as { timeoutMs?: number }).timeoutMs,
      });
      return buildToolResult(buildResultText(params.summarize(rawParams), deviceId, response), {
        response,
      });
    },
  };
}

export function createDiagnosticsTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    createDiagnoseTool({
      deps,
      name: "clawwrt_dhcp_diagnose",
      label: "OpenClaw WRT DHCP Diagnose",
      description:
        "Run a DHCP performance diagnose against the router. Useful for checking lease offer/ack timing and intermittent DHCP loss.",
      kind: "dhcp",
      parameters: SharedSchemas.DhcpDiagnoseSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DhcpDiagnoseParams;
        const payload: JsonRecord = {};
        if (typeof args.interface === "string") payload.interface = args.interface.trim();
        if (typeof args.dhcpServer === "string") payload.dhcp_server = args.dhcpServer.trim();
        if (typeof args.timeoutSec === "number") payload.timeout_sec = args.timeoutSec;
        if (typeof args.probeCount === "number") payload.probe_count = args.probeCount;
        if (typeof args.probeIntervalMs === "number") payload.probe_interval_ms = args.probeIntervalMs;
        return payload;
      },
      summarize: (rawParams) => {
        const args = rawParams as DhcpDiagnoseParams;
        return `DHCP diagnose finished for ${args.deviceId}`;
      },
    }),
    createDiagnoseTool({
      deps,
      name: "clawwrt_dns_diagnose",
      label: "OpenClaw WRT DNS Diagnose",
      description:
        "Run a DNS performance diagnose against the router. Use this to measure DNS response rate, latency, and per-domain behavior.",
      kind: "dns",
      parameters: SharedSchemas.DnsDiagnoseSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DnsDiagnoseParams;
        const payload: JsonRecord = {};
        if (typeof args.dnsServer === "string") payload.dns_server = args.dnsServer.trim();
        if (typeof args.domain === "string") payload.domain = args.domain.trim();
        const domains = toStringArray(args.domains);
        if (domains) payload.domains = domains;
        if (typeof args.timeoutSec === "number") payload.timeout_sec = args.timeoutSec;
        if (typeof args.probeCount === "number") payload.probe_count = args.probeCount;
        if (typeof args.probeIntervalMs === "number") payload.probe_interval_ms = args.probeIntervalMs;
        return payload;
      },
      summarize: (rawParams) => {
        const args = rawParams as DnsDiagnoseParams;
        return `DNS diagnose finished for ${args.deviceId}`;
      },
    }),
    createDiagnoseTool({
      deps,
      name: "clawwrt_http_service_diagnose",
      label: "OpenClaw WRT Portal HTTP Diagnose",
      description:
        "Run HTTP performance diagnose for the router's apfree-wifidog captive portal authentication service. This measures portal auth endpoint latency (default port 2060), not generic LAN web services.",
      kind: "http",
      parameters: SharedSchemas.WebServiceDiagnoseSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as WebServiceDiagnoseParams;
        const payload: JsonRecord = {};
        if (typeof args.host === "string") payload.host = args.host.trim();
        if (typeof args.port === "number") payload.port = args.port;
        if (typeof args.path === "string") payload.path = args.path.trim();
        if (typeof args.timeoutSec === "number") payload.timeout_sec = args.timeoutSec;
        if (typeof args.probeCount === "number") payload.probe_count = args.probeCount;
        if (typeof args.probeIntervalMs === "number") payload.probe_interval_ms = args.probeIntervalMs;
        return payload;
      },
      summarize: (rawParams) => {
        const args = rawParams as WebServiceDiagnoseParams;
        return `apfree-wifidog portal HTTP diagnose finished for ${args.deviceId}`;
      },
    }),
    createDiagnoseTool({
      deps,
      name: "clawwrt_https_service_diagnose",
      label: "OpenClaw WRT Portal HTTPS Diagnose",
      description:
        "Run HTTPS performance diagnose for the router's apfree-wifidog captive portal authentication service. This measures portal auth endpoint latency and TLS overhead (default port 8443), not generic HTTPS services.",
      kind: "https",
      parameters: SharedSchemas.WebServiceDiagnoseSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as WebServiceDiagnoseParams;
        const payload: JsonRecord = {};
        if (typeof args.host === "string") payload.host = args.host.trim();
        if (typeof args.port === "number") payload.port = args.port;
        if (typeof args.path === "string") payload.path = args.path.trim();
        if (typeof args.timeoutSec === "number") payload.timeout_sec = args.timeoutSec;
        if (typeof args.probeCount === "number") payload.probe_count = args.probeCount;
        if (typeof args.probeIntervalMs === "number") payload.probe_interval_ms = args.probeIntervalMs;
        return payload;
      },
      summarize: (rawParams) => {
        const args = rawParams as WebServiceDiagnoseParams;
        return `apfree-wifidog portal HTTPS diagnose finished for ${args.deviceId}`;
      },
    }),
  ];
}