/**
 * WireGuard client-side tools: VPN config, status, routes, keys, connectivity.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIPv4 } from "node:net";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  SetWireguardVpnParams,
  ResetWireguardVpnParams,
  SetVpnRoutesParams,
  WireguardProtectedRoutePlanFile,
} from "../tool-types.js";
import {
  parseIPv4Cidr,
  deriveWireGuardPublicKeyFromPrivateKey,
  cidrOverlaps,
} from "../tool-validators.js";
import { execFileSync } from "node:child_process";
import {
  callDeviceOp,
  callChawrtd,
  getDefaultChawrtdClient,
  getDevicesListViaChawrtd,
} from "../chawrtd-client.js";
import { createSimpleOperationTool, buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";
import {
  asObject,
  extractWireguardConfigSnapshot,
  findServerPeerPublicKeyForTunnelIp,
  getSnapshotDisplayName,
  mapWireguardInterfacePayload,
  mapWireguardPeerPayload,
} from "../tool-parsers.js";

// ============================================================================
// Constants
// ============================================================================

const WIREGUARD_PROTECTED_ROUTE_PLAN_FILE = path.join(
  os.tmpdir(),
  "openclaw-wrt-wireguard-protected-routes.json",
);

// ============================================================================
// Route plan file operations (extracted from ChawrtdClient)
// ============================================================================

function getProtectedRoutePlanFile(): string {
  return WIREGUARD_PROTECTED_ROUTE_PLAN_FILE;
}

async function readWireguardProtectedRoutePlanFile(routePlanFile?: string): Promise<JsonRecord | null> {
  const file = routePlanFile ?? getProtectedRoutePlanFile();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as JsonRecord;
    if (parsed?.version !== 1 || !Array.isArray(parsed.routePlans)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function collectWireguardProtectedRoutePlans(params: {
  deviceIds: string[];
  serverTunnelIp: string;
  timeoutMs?: number;
}): Promise<JsonRecord> {
  const client = getDefaultChawrtdClient();

  const deviceIds = [...new Set(params.deviceIds.map((id) => id.trim()).filter(Boolean))];
  if (deviceIds.length === 0) throw new Error("At least one deviceId is required.");

  const serverTunnel = parseIPv4Cidr(params.serverTunnelIp.trim());
  if (!serverTunnel) throw new Error(`Invalid serverTunnelIp CIDR: ${params.serverTunnelIp}`);

  const onlineDevices = new Map(
    (await client.listDevices()).map((entry) => [entry.deviceId.trim(), entry] as const),
  );

  const devices: Array<{ deviceId: string; deviceName?: string; lanCidr?: string; error?: string }> = [];

  const deviceResults = await Promise.all(
    deviceIds.map(async (deviceId) => {
      try {
        const result = await client.callDeviceOp({ deviceId, op: "get_br_lan", timeoutMs: params.timeoutMs });
        const cidr = (result as JsonRecord)?.cidr;
        const parsed = typeof cidr === "string" ? parseIPv4Cidr(cidr) : null;
        return {
          deviceId,
          deviceName: getSnapshotDisplayName(onlineDevices.get(deviceId)),
          lanCidr: parsed?.normalized,
          error: parsed ? undefined : `missing_or_invalid_cidr: ${typeof cidr === "string" ? cidr : "(none)"}`,
        };
      } catch (error) {
        return {
          deviceId,
          deviceName: getSnapshotDisplayName(onlineDevices.get(deviceId)),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  devices.push(...deviceResults);

  const validDevices = devices.filter(
    (e): e is typeof e & { lanCidr: string } => typeof e.lanCidr === "string" && !e.error,
  );

  const conflicts: Array<{ leftDeviceId: string; leftLanCidr: string; rightDeviceId: string; rightLanCidr: string }> = [];
  const blockedDeviceIds = new Set<string>();

  for (let i = 0; i < validDevices.length; i++) {
    for (let j = i + 1; j < validDevices.length; j++) {
      const left = validDevices[i]!;
      const right = validDevices[j]!;
      const parsedLeft = parseIPv4Cidr(left.lanCidr);
      const parsedRight = parseIPv4Cidr(right.lanCidr);
      if (!parsedLeft || !parsedRight || !cidrOverlaps(parsedLeft, parsedRight)) continue;
      conflicts.push({
        leftDeviceId: left.deviceId, leftLanCidr: left.lanCidr,
        rightDeviceId: right.deviceId, rightLanCidr: right.lanCidr,
      });
      blockedDeviceIds.add(left.deviceId);
      blockedDeviceIds.add(right.deviceId);
    }
  }

  const routePlans = conflicts.length > 0
    ? []
    : validDevices.map((entry) => {
        const routes: string[] = [];
        const seenRoutes = new Set<string>();
        const pushRoute = (route: string) => {
          const normalized = route.trim();
          if (!normalized || seenRoutes.has(normalized)) return;
          seenRoutes.add(normalized);
          routes.push(normalized);
        };
        pushRoute(serverTunnel.normalized);
        for (const candidate of validDevices) {
          if (candidate.deviceId === entry.deviceId) continue;
          pushRoute(candidate.lanCidr);
        }
        return { deviceId: entry.deviceId, deviceName: entry.deviceName, lanCidr: entry.lanCidr, routes };
      });

  const failedDevices = devices.filter((e) => e.error);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    serverTunnelIp: params.serverTunnelIp.trim(),
    serverTunnelCidr: serverTunnel.normalized,
    deviceIds,
    devices,
    failedDevices,
    conflicts,
    blockedDeviceIds: [...blockedDeviceIds],
    hasConflict: conflicts.length > 0,
    routePlans,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

async function loadWireguardRoutePlanOrThrow(
  routePlanFile: string,
): Promise<WireguardProtectedRoutePlanFile> {
  const routePlan = await readWireguardProtectedRoutePlanFile(routePlanFile) as WireguardProtectedRoutePlanFile | null;
  if (!routePlan) {
    throw new Error(`routePlanFile is invalid or unreadable: ${routePlanFile}`);
  }
  return routePlan;
}

// ============================================================================
// WireGuard Verify Helpers
// ============================================================================
type ServerVerifyResult = {
  serverSummary: string;
  snatOk: boolean;
  ipForwardOk: boolean;
  serverConfiguredPublicKey?: string;
  serverKeyCheck?: {
    status: "ok" | "mismatch" | "error" | "skipped";
    configuredPublicKey?: string;
    derivedPublicKey?: string;
    error?: string;
  };
  serverPeerConfig: Array<{ publicKey: string | undefined; allowedIps: string[] }>;
  serverReportLines: string[];
  pingResults: Array<{
    target: string;
    reachable: boolean;
    output: string;
    confidence?: "confirmed" | "inconclusive" | "failed";
    message?: string;
  }>;
};

async function verifyServerSide(pingTargets: string[], timeoutMs?: number): Promise<ServerVerifyResult> {
  const result: ServerVerifyResult = {
    serverSummary: "unavailable",
    snatOk: false,
    ipForwardOk: false,
    serverPeerConfig: [],
    serverReportLines: [],
    pingResults: [],
  };

  try {
    const verifyResponse = await callChawrtd({
      path: "/v1/wg/verify",
      method: "POST",
      body: { pingTargets },
      timeoutMs,
    });
    result.serverSummary = verifyResponse.output?.trim() || verifyResponse.summary || "unavailable";

    const verifyData = asObject(verifyResponse.data);
    const serverData = asObject(verifyData?.server);
    if (serverData) {
      if (typeof serverData.wgShow === "string" && serverData.wgShow.trim()) {
        result.serverSummary = serverData.wgShow.trim();
      }
      if (typeof serverData.snatOk === "boolean") result.snatOk = serverData.snatOk;
      if (typeof serverData.ipForwardOk === "boolean") result.ipForwardOk = serverData.ipForwardOk;
      if (typeof serverData.serverPublicKey === "string" && serverData.serverPublicKey.trim()) {
        result.serverConfiguredPublicKey = serverData.serverPublicKey.trim();
      }

      const keyCheckRaw = asObject(serverData.keyCheck);
      if (keyCheckRaw) {
        const status = typeof keyCheckRaw.status === "string" ? keyCheckRaw.status.trim() : "";
        if (["ok", "mismatch", "error", "skipped"].includes(status)) {
          result.serverKeyCheck = {
            status: status as "ok" | "mismatch" | "error" | "skipped",
            configuredPublicKey: typeof keyCheckRaw.configuredPublicKey === "string" ? keyCheckRaw.configuredPublicKey : undefined,
            derivedPublicKey: typeof keyCheckRaw.derivedPublicKey === "string" ? keyCheckRaw.derivedPublicKey : undefined,
            error: typeof keyCheckRaw.error === "string" ? keyCheckRaw.error : undefined,
          };
        }
      }

      if (Array.isArray(serverData.reportLines)) {
        result.serverReportLines = serverData.reportLines.filter(
          (entry: unknown): entry is string => typeof entry === "string" && (entry as string).trim().length > 0,
        );
      }

      const peerConfigRaw = serverData.peerConfig;
      if (Array.isArray(peerConfigRaw)) {
        result.serverPeerConfig = peerConfigRaw
          .map((entry: unknown) => {
            const peer = asObject(entry);
            if (!peer) return null;
            const publicKey = typeof peer.publicKey === "string" && peer.publicKey.trim() ? peer.publicKey.trim() : undefined;
            const allowedIps = Array.isArray(peer.allowedIps)
              ? peer.allowedIps.filter((c: unknown): c is string => typeof c === "string").map((c: string) => c.trim()).filter(Boolean)
              : [];
            return { publicKey, allowedIps };
          })
          .filter((e): e is { publicKey: string | undefined; allowedIps: string[] } => e !== null && e.allowedIps.length > 0);
      }
    }

    result.pingResults = Array.isArray(verifyData?.pingResults)
      ? verifyData.pingResults
          .map((entry: unknown) => {
            const row = asObject(entry);
            if (!row) return null;
            const target = typeof row.target === "string" ? row.target : "";
            if (!target) return null;
            const reachable = typeof row.reachable === "boolean" ? row.reachable : false;
            const output = typeof row.output === "string" ? row.output : "";
            const confidenceRaw = typeof row.confidence === "string" ? row.confidence : "";
            const confidence = ["confirmed", "inconclusive", "failed"].includes(confidenceRaw)
              ? (confidenceRaw as "confirmed" | "inconclusive" | "failed")
              : undefined;
            const message = typeof row.message === "string" ? row.message : undefined;
            const parsed: { target: string; reachable: boolean; output: string; confidence?: "confirmed" | "inconclusive" | "failed"; message?: string } = { target, reachable, output };
            if (confidence) parsed.confidence = confidence;
            if (message) parsed.message = message;
            return parsed;
          })
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
      : [];
  } catch (error) {
    result.serverSummary = `Server probe error via chawrtd: ${error instanceof Error ? error.message : String(error)}`;
    result.serverKeyCheck = { status: "error", error: error instanceof Error ? error.message : String(error) };
  }

  return result;
}

type DeviceVerifyResult = {
  deviceId: string;
  handshakeAge?: string;
  rxBytes?: number;
  txBytes?: number;
  tunnelIp?: string;
  keyCheck?: {
    status: "ok" | "mismatch" | "error" | "skipped";
    reason?: string;
    derivedClientPublicKey?: string;
    configuredServerPeerPublicKey?: string;
    configuredRouterPeerPublicKey?: string;
    actualServerPublicKey?: string;
  };
  error?: string;
};

async function verifyDeviceRouterSide(
  deviceId: string,
  serverPeerConfig: Array<{ publicKey: string | undefined; allowedIps: string[] }>,
  serverConfiguredPublicKey: string | undefined,
  timeoutMs?: number,
): Promise<DeviceVerifyResult> {
  // execFileSync is imported at module level

  const status = await callDeviceOp({ deviceId, op: "get_wireguard_vpn_status", timeoutMs });
  const peer = (status as JsonRecord)?.peers as JsonRecord[] | undefined;
  const first = Array.isArray(peer) ? peer[0] : undefined;
  const result: DeviceVerifyResult = {
    deviceId,
    handshakeAge: (first as JsonRecord | undefined)?.last_handshake_time as string | undefined,
    rxBytes: (first as JsonRecord | undefined)?.receive_bytes as number | undefined,
    txBytes: (first as JsonRecord | undefined)?.transmit_bytes as number | undefined,
  };

  try {
    const configResponse = await callDeviceOp({ deviceId, op: "get_wireguard_vpn", timeoutMs });
    const snapshot = extractWireguardConfigSnapshot(asObject(configResponse) ?? {});
    const tunnelIp = snapshot.addresses
      .map((entry) => entry.split("/")[0]?.trim())
      .find((entry): entry is string => Boolean(entry && isIPv4(entry)));
    result.tunnelIp = tunnelIp;

    if (!snapshot.privateKey) {
      result.keyCheck = { status: "skipped", reason: "router private key unavailable in get_wireguard_vpn response" };
    } else {
      const derivedClientPublicKey = deriveWireGuardPublicKeyFromPrivateKey(snapshot.privateKey, execFileSync);
      const configuredServerPeerPublicKey = tunnelIp ? findServerPeerPublicKeyForTunnelIp(serverPeerConfig, tunnelIp) : undefined;
      const configuredRouterPeerPublicKey = snapshot.peerPublicKey;
      const mismatchReasons: string[] = [];

      if (configuredServerPeerPublicKey && configuredServerPeerPublicKey !== derivedClientPublicKey) {
        mismatchReasons.push("server peer public key does not match the router private key derived public key");
      }
      if (serverConfiguredPublicKey && configuredRouterPeerPublicKey && configuredRouterPeerPublicKey !== serverConfiguredPublicKey) {
        mismatchReasons.push("router configured server public key does not match the VPS actual server public key");
      }

      result.keyCheck = mismatchReasons.length === 0
        ? { status: "ok", derivedClientPublicKey, configuredServerPeerPublicKey, configuredRouterPeerPublicKey, actualServerPublicKey: serverConfiguredPublicKey }
        : { status: "mismatch", reason: mismatchReasons.join("; "), derivedClientPublicKey, configuredServerPeerPublicKey, configuredRouterPeerPublicKey, actualServerPublicKey: serverConfiguredPublicKey };
    }
  } catch (error) {
    result.keyCheck = { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }

  return result;
}

function buildWireguardReport(
  server: ServerVerifyResult,
  deviceResults: DeviceVerifyResult[],
  deviceIds: string[],
): { report: string; warnings: string[] } {
  let report = `## WireGuard Connectivity Report\n\n`;
  report += `### Server Side\n`;
  const renderedServerLines = server.serverReportLines.length > 0
    ? server.serverReportLines
    : [
        `- IP Forwarding: ${server.ipForwardOk ? "✅ enabled" : "❌ disabled"}`,
        `- SNAT/MASQUERADE: ${server.snatOk ? "✅ present" : "❌ missing"}`,
        ...(server.serverKeyCheck
          ? server.serverKeyCheck.status === "ok"
            ? ["- Server key pair: ✅ private/public key match"]
            : server.serverKeyCheck.status === "mismatch"
              ? ["- Server key pair: ❌ configured public key does not match the derived public key from server_private.key"]
              : server.serverKeyCheck.status === "error"
                ? [`- Server key pair: ❌ check failed (${server.serverKeyCheck.error})`]
                : []
          : []),
      ];
  report += renderedServerLines.length > 0 ? `${renderedServerLines.join("\n")}\n` : `- Server-side details unavailable\n`;
  report += `\`\`\`\n${server.serverSummary}\n\`\`\`\n\n`;

  report += `### Router Status (${deviceIds.length} device(s))\n`;
  for (const r of deviceResults) {
    if (r.error) {
      report += `- ${r.deviceId}: ❌ ${r.error}\n`;
    } else {
      const handshake = r.handshakeAge ?? "unknown";
      const traffic = `rx=${r.rxBytes ?? 0} tx=${r.txBytes ?? 0}`;
      const tunnel = r.tunnelIp ? ` tunnel=${r.tunnelIp}` : "";
      const keyStatus = r.keyCheck?.status === "ok" ? " key=✅"
        : r.keyCheck?.status === "mismatch" ? ` key=❌ ${r.keyCheck.reason ?? "mismatch"}`
        : r.keyCheck?.status === "error" ? ` key=❌ ${r.keyCheck.reason ?? "check failed"}`
        : r.keyCheck?.status === "skipped" ? ` key=⚠️ ${r.keyCheck.reason ?? "skipped"}`
        : "";
      report += `- ${r.deviceId}:${tunnel} handshake=${handshake} ${traffic}${keyStatus}\n`;
    }
  }

  const warnings: string[] = [];
  if (!server.ipForwardOk) warnings.push("IP forwarding disabled on server");
  if (!server.snatOk) warnings.push("SNAT/MASQUERADE rule missing on server");
  if (server.serverKeyCheck?.status === "mismatch") warnings.push("server private/public key pair mismatch");
  else if (server.serverKeyCheck?.status === "error") warnings.push(`server key pair check failed: ${server.serverKeyCheck.error}`);
  for (const r of deviceResults) {
    if (r.error) warnings.push(`${r.deviceId}: ${r.error}`);
    if (r.keyCheck?.status === "mismatch") warnings.push(`${r.deviceId}: ${r.keyCheck.reason ?? "WireGuard key mismatch detected"}`);
    else if (r.keyCheck?.status === "error") warnings.push(`${r.deviceId}: key check failed: ${r.keyCheck.reason}`);
  }

  return { report, warnings };
}

// ============================================================================
// Exported factory
// ============================================================================

export function createWireguardTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    // ---------------------------------------------------------------------------
    // clawwrt_get_wireguard_vpn — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_wireguard_vpn",
      label: "OpenClaw WRT Get WireGuard VPN",
      description: "Get WireGuard VPN configuration (single tunnel mode: wg0).",
      op: "get_wireguard_vpn",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched WireGuard VPN config for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_set_wireguard_vpn — simple op with payload builder
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_set_wireguard_vpn",
      label: "OpenClaw WRT Set WireGuard VPN",
      description:
        "Set WireGuard VPN configuration for a single tunnel (wg0), including interface and peers.",
      op: "set_wireguard_vpn",
      parameters: SharedSchemas.SetWireguardVpnSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWireguardVpnParams;
        const interfacePayload = mapWireguardInterfacePayload(asObject(args.interface) ?? {});
        const peersPayload = (args.peers ?? []).map((entry) =>
          mapWireguardPeerPayload(asObject(entry) ?? {}),
        );

        return {
          deviceId: args.deviceId.trim(),
          payload: {
            interface: interfacePayload,
            peers: peersPayload,
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWireguardVpnParams;
        return `Updated WireGuard VPN config for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_reset_wireguard_vpn — orchestrated op
    // ---------------------------------------------------------------------------
  {
      name: "clawwrt_reset_wireguard_vpn",
      label: "OpenClaw WRT Reset WireGuard VPN",
      description:
        "Reset router-side WireGuard VPN configuration (default interface wg0), including peer definitions and tunnel routes. After reset succeeds, this tool can optionally trigger reload_network_async.",
      parameters: SharedSchemas.ResetWireguardVpnSchema,
      execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal, onUpdate?: (partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) => {
        logToolInvocation(deps.logger, "clawwrt_reset_wireguard_vpn", rawParams);
        const args = rawParams as ResetWireguardVpnParams;
        const deviceId = args.deviceId.trim();

        onUpdate?.({
          content: [{ type: "text", text: `🔄 正在重置 ${deviceId} 的 WireGuard VPN 配置...` }],
          details: { phase: "resetting" },
        });

        const payload: JsonRecord = {};
        if (typeof args.interface === "string") {
          payload.interface = args.interface;
        }
        if (typeof args.flushRoutes === "boolean") {
          payload.flush_routes = args.flushRoutes;
        }

        const resetResponse = await callDeviceOp({
          deviceId,
          op: "reset_wireguard_vpn",
          payload,
          timeoutMs: args.timeoutMs,
          signal,
        });

        const triggerReloadNetworkAsync = args.reloadNetworkAsync !== false;
        let reloadNetworkAsyncScheduled = false;
        let reloadNetworkAsyncResponse: JsonRecord | null = null;
        let reloadNetworkAsyncError: string | null = null;

        if (triggerReloadNetworkAsync) {
          onUpdate?.({
            content: [{ type: "text", text: `🔄 正在触发网络重载...` }],
            details: { phase: "reloading" },
          });
          try {
            reloadNetworkAsyncResponse = await callDeviceOp({
              deviceId,
              op: "reload_network_async",
              timeoutMs: args.timeoutMs,
              expectResponse: false,
              signal,
            });
            reloadNetworkAsyncScheduled = true;
          } catch (error) {
            reloadNetworkAsyncError = error instanceof Error ? error.message : String(error);
          }
        }

        const summary = `Reset WireGuard VPN config on ${deviceId}.`;
        const resetJson = JSON.stringify(resetResponse);
        let text = `${summary}\n\nDevice response data:\n${resetJson}`;
        if (triggerReloadNetworkAsync) {
          if (reloadNetworkAsyncScheduled) {
            text += "\n\nTriggered reload_network_async after reset.";
          } else {
            text += `\n\nWARNING: reset succeeded but reload_network_async scheduling failed: ${reloadNetworkAsyncError ?? "unknown error"}`;
          }
        } else {
          text += "\n\nSkipped reload_network_async because reloadNetworkAsync=false.";
        }

        return buildToolResult(text, {
          response: resetResponse,
          reloadNetworkAsync: {
            requested: triggerReloadNetworkAsync,
            scheduled: reloadNetworkAsyncScheduled,
            response: reloadNetworkAsyncResponse,
            error: reloadNetworkAsyncError,
          },
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_get_wireguard_vpn_status — custom (router + server status)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_get_wireguard_vpn_status",
      label: "OpenClaw WRT Get WireGuard VPN Status",
      description:
        "Get runtime WireGuard status from both the router (peer handshake/traffic) and the local OpenClaw server (tunnel presence).",
      parameters: SharedSchemas.DeviceOnlySchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_get_wireguard_vpn_status", rawParams);
        const args = rawParams as DeviceOnlyParams;
        const deviceId = args.deviceId.trim();

        // 1. Fetch status from router
        let routerStatus: JsonRecord | null = null;
        let routerError: string | null = null;
        try {
          routerStatus = await callDeviceOp({
            deviceId,
            op: "get_wireguard_vpn_status",
            timeoutMs: args.timeoutMs,
          });
        } catch (error) {
          routerError = error instanceof Error ? error.message : String(error);
        }

        // 2. Fetch status from local server (if available/applicable)
        let serverStatus: string = "unavailable";
        let snatMissing = true;
        let ipForwardEnabled = false;
        let probesSuccessful = false;

        try {
          const response = await callChawrtd({ path: "/v1/wg/status", method: "GET" });
          const serverData = asObject(asObject(response.data)?.server);
          if (serverData) {
            const reportLines = Array.isArray(serverData.reportLines)
              ? serverData.reportLines.filter((line): line is string => typeof line === "string")
              : [];
            serverStatus =
              reportLines.length > 0
                ? reportLines.join("\n")
                : typeof response.output === "string"
                  ? response.output.trim() || "unavailable"
                  : "unavailable";
            if (typeof serverData.snatOk === "boolean") {
              snatMissing = !serverData.snatOk;
            }
            if (typeof serverData.ipForwardOk === "boolean") {
              ipForwardEnabled = serverData.ipForwardOk;
            }
          } else {
            serverStatus =
              typeof response.output === "string" ? response.output.trim() || "unavailable" : "unavailable";
          }
          probesSuccessful = true;
        } catch (error) {
          serverStatus = `Error fetching server status from chawrtd: ${error instanceof Error ? error.message : String(error)}`;
        }

        const summary = `Fetched WireGuard VPN status for ${deviceId}.`;
        let text =
          `${summary}\n\n` +
          `--- ROUTER SIDE (${deviceId}) ---\n` +
          (routerError ? `Error: ${routerError}` : JSON.stringify(routerStatus, null, 2)) +
          `\n\n--- SERVER SIDE (OpenClaw Server) ---\n` +
          serverStatus;

        if (probesSuccessful) {
          if (snatMissing) {
            text +=
              "\n\nWARNING: SNAT (MASQUERADE) rule might be missing on the server side. Full tunnel traffic may not reach the internet.";
          }
          if (!ipForwardEnabled) {
            text += "\nWARNING: IP forwarding is disabled on the server side.";
          }
        }

        return buildToolResult(text, {
          router: routerStatus ?? { error: routerError },
          server: serverStatus,
          serverChecks: { snatMissing, ipForwardEnabled },
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_generate_wireguard_keys — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_generate_wireguard_keys",
      label: "OpenClaw WRT Generate WireGuard Keys",
      description:
        "Generate a WireGuard key pair on the router. The private key is written directly to UCI (network.wg0.private_key) and never leaves the device. Only the public key is returned. Use this BEFORE set_wireguard_vpn to avoid sending private keys over the network.",
      op: "generate_wireguard_keys",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Generated WireGuard keys on ${args.deviceId}. Public key returned; private key stored locally.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_get_vpn_routes — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_vpn_routes",
      label: "OpenClaw WRT Get VPN Routes",
      description:
        "Get current VPN routing table entries (ip route show dev wg0 proto static). Shows which traffic is being steered through the WireGuard tunnel.",
      op: "get_vpn_routes",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched VPN routes for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_set_vpn_routes — custom (selective mode with route plan file support)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_set_vpn_routes",
      label: "OpenClaw WRT Set VPN Routes",
      description:
        "Set VPN routing rules to steer traffic through the WireGuard tunnel. Selective mode preserves any existing wg0 static routes and merges them with the requested CIDRs.",
      parameters: SharedSchemas.SetVpnRoutesSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_set_vpn_routes", rawParams);
        const args = rawParams as SetVpnRoutesParams;
        const deviceId = args.deviceId.trim();

        if (args.mode === "selective") {
          let requestedRoutes: string[] | null = null;
          const routePlanFile = typeof args.routePlanFile === "string" ? args.routePlanFile.trim() : "";
          if (routePlanFile) {
            const routePlanFileData = await loadWireguardRoutePlanOrThrow(routePlanFile);
            const routePlan = routePlanFileData.routePlans.find((entry: { deviceId: string }) => entry.deviceId === deviceId);
            if (!routePlan) {
              throw new Error(`routePlanFile does not contain routes for device ${deviceId}: ${routePlanFile}`);
            }
            requestedRoutes = routePlan.routes;
            logToolInvocation(deps.logger, "clawwrt_set_vpn_routes", {
              deviceId,
              routePlanFile,
              requestedRoutes,
            });
          } else if (Array.isArray(args.routes)) {
            requestedRoutes = args.routes;
          }

          if (!Array.isArray(requestedRoutes) || requestedRoutes.length === 0) {
            throw new Error(`missing routes for selective mode on ${deviceId}`);
          }

          const currentRoutesResponse = await callDeviceOp({
            deviceId,
            op: "get_vpn_routes",
            timeoutMs: args.timeoutMs,
          });
          const currentRoutesRaw = asObject(currentRoutesResponse)?.routes;
          if (!Array.isArray(currentRoutesRaw)) {
            throw new Error(`get_vpn_routes returned no routes array for ${deviceId}; refusing to overwrite selective routes`);
          }

          const normalizeRouteTarget = (route: unknown): string => {
            if (typeof route === "string") {
              return route.trim();
            }
            const routeObject = asObject(route);
            const dest =
              typeof routeObject?.dest === "string"
                ? routeObject.dest
                : typeof routeObject?.destination === "string"
                  ? routeObject.destination
                  : "";
            return dest.trim();
          };

          const mergedRoutes: string[] = [];
          const seenRoutes = new Set<string>();
          const pushRoute = (route: string) => {
            const normalized = route.trim();
            if (!normalized || seenRoutes.has(normalized)) {
              return;
            }
            seenRoutes.add(normalized);
            mergedRoutes.push(normalized);
          };

          for (const route of currentRoutesRaw) {
            pushRoute(normalizeRouteTarget(route));
          }
          for (const route of requestedRoutes) {
            pushRoute(route);
          }

          if (mergedRoutes.length === 0) {
            throw new Error(`No VPN routes available for ${deviceId}`);
          }

          logToolInvocation(deps.logger, "clawwrt_set_vpn_routes", {
            deviceId,
            currentRoutes: currentRoutesRaw,
            mergedRoutes,
          });

          const response = await callDeviceOp({
            deviceId,
            op: "set_vpn_routes",
            payload: {
              mode: args.mode,
              routes: mergedRoutes,
            },
            timeoutMs: args.timeoutMs,
          });
          return buildToolResult(`Set VPN routes (${args.mode} mode) on ${deviceId}.`, {
            response,
            routes: mergedRoutes,
          });
        }

        throw new Error(`unsupported route mode for ${deviceId}: ${String(args.mode)}`);
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_collect_wireguard_protected_routes — custom
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_collect_wireguard_protected_routes",
      label: "OpenClaw WRT Collect WireGuard Protected Routes",
      description:
        "Collect each router's br-lan CIDR, combine all peer LAN CIDRs with the shared wg0 tunnel subnet, and save the resulting per-device route plan to a JSON file for clawwrt_set_vpn_routes.",
      parameters: SharedSchemas.CollectWireguardProtectedRoutesSchema,
      execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal, onUpdate?: (partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) => {
        logToolInvocation(deps.logger, "clawwrt_collect_wireguard_protected_routes", rawParams);
        const args = rawParams as {
          deviceIds: string[];
          serverTunnelIp: string;
          timeoutMs?: number;
        };

        onUpdate?.({
          content: [{ type: "text", text: `📡 正在收集 ${args.deviceIds.length} 台设备的 LAN CIDR...` }],
          details: { phase: "collecting", deviceCount: args.deviceIds.length },
        });

        const routePlanFile = WIREGUARD_PROTECTED_ROUTE_PLAN_FILE;
        const routePlanFileData = await collectWireguardProtectedRoutePlans({
          deviceIds: args.deviceIds,
          serverTunnelIp: args.serverTunnelIp,
          timeoutMs: args.timeoutMs,
        }) as { hasConflict: boolean; routePlans: Array<{ deviceId: string }>; [key: string]: unknown };

        onUpdate?.({
          content: [{ type: "text", text: `✅ 路由计划已生成，正在保存...` }],
          details: { phase: "saving", routePlanFile },
        });

        await fs.writeFile(routePlanFile, JSON.stringify(routePlanFileData, null, 2), "utf8");

        const summary = routePlanFileData.hasConflict
          ? `WireGuard protected route plan saved to ${routePlanFile}, but LAN conflicts were detected. Resolve conflicts before using it.`
          : `WireGuard protected route plan saved to ${routePlanFile} for ${routePlanFileData.routePlans.length} device(s).`;

        return buildToolResult(summary, {
          routePlanFile,
          ...routePlanFileData,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_verify_wireguard_connectivity — custom (very complex)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_verify_wireguard_connectivity",
      label: "OpenClaw WRT Verify WireGuard Connectivity",
      description:
        "Batch-verify WireGuard connectivity across all (or specified) online routers. For each device, fetches router-side handshake/traffic status, validates key consistency against the VPS-side peer config when possible, and checks server-side wg/NAT/forwarding state. Optionally pings tunnel IPs from the VPS to confirm end-to-end reachability. Returns a consolidated report.",
      parameters: SharedSchemas.VerifyWireguardConnectivitySchema,
      execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal, onUpdate?: (partial: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void) => {
        logToolInvocation(deps.logger, "clawwrt_verify_wireguard_connectivity", rawParams);
        const args = rawParams as {
          deviceIds?: string[];
          pingTargets?: string[];
          timeoutMs?: number;
        };

        // Resolve device list
        const deviceIds =
          Array.isArray(args.deviceIds) && args.deviceIds.length > 0
            ? args.deviceIds.map((d) => d.trim())
            : (await getDevicesListViaChawrtd()).map((d) => d.deviceId.trim());

        if (deviceIds.length === 0) {
          throw new Error("No online devices found. Ensure routers are connected to OpenClaw.");
        }

        // Emit initial progress
        onUpdate?.({
          content: [{ type: "text", text: `🔍 正在验证 VPS 侧 WireGuard 状态...` }],
          details: { phase: "server", progress: { current: 0, total: deviceIds.length } },
        });

        // Server-side verification (single call)
        const server = await verifyServerSide(args.pingTargets ?? [], args.timeoutMs);

        // Per-device router-side verification (sequential to avoid overloading devices)
        const deviceResults: DeviceVerifyResult[] = [];
        for (let i = 0; i < deviceIds.length; i++) {
          if (signal?.aborted) throw new Error("aborted");
          const deviceId = deviceIds[i];

          onUpdate?.({
            content: [{
              type: "text",
              text: `⏳ 正在验证设备 ${i + 1}/${deviceIds.length}: ${deviceId}...`,
            }],
            details: {
              phase: "device",
              progress: { current: i + 1, total: deviceIds.length, deviceId },
              completed: deviceResults.map((r) => ({
                deviceId: r.deviceId,
                ok: !r.error,
              })),
            },
          });

          try {
            const result = await verifyDeviceRouterSide(
              deviceId,
              server.serverPeerConfig,
              server.serverConfiguredPublicKey,
              args.timeoutMs,
            );
            deviceResults.push(result);
          } catch (error) {
            deviceResults.push({
              deviceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Build consolidated report
        const { report, warnings } = buildWireguardReport(server, deviceResults, deviceIds);

        // Append ping test section
        let fullReport = report;
        if (server.pingResults.length > 0) {
          fullReport += `\n### Ping Tests\n`;
          for (const p of server.pingResults) {
            const pingState =
              p.reachable || p.confidence === "confirmed"
                ? "✅ reachable"
                : p.confidence === "inconclusive"
                  ? "⚠️ inconclusive"
                  : "❌ unreachable";
            const pingDetail = p.message ?? p.output.split("\n").at(-2) ?? p.output;
            fullReport += `- ${p.target}: ${pingState} — ${pingDetail}\n`;
          }
        }
        for (const p of server.pingResults) {
          if (!p.reachable && p.confidence !== "inconclusive") {
            warnings.push(`ping ${p.target}: unreachable`);
          }
        }

        return buildToolResult(fullReport, {
          server: {
            snatOk: server.snatOk,
            ipForwardOk: server.ipForwardOk,
            wgShow: server.serverSummary,
            keyCheck: server.serverKeyCheck,
          },
          devices: deviceResults,
          pingResults: server.pingResults,
          warnings,
        });
      },
    },
  ];
}
