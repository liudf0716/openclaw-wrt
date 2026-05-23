/**
 * Shared helper functions extracted from tool-monolith.ts.
 * Used by domain tool files in src/tools/ during the migration.
 * These will eventually move into their respective domain modules
 * or into tool-parsers.ts/tool-validators.ts.
 */

import { isIPv4 } from "node:net";
import type { JsonRecord, DeviceSnapshot, BpfJsonTable } from "../tool-types.js";
import { normalizeBpfAddress as parserNormalizeBpfAddress } from "../tool-parsers.js";

// Re-export parsers that tools frequently need
export { normalizeMac as parserNormalizeMac } from "../tool-parsers.js";
export { normalizeBpfAddress as parserNormalizeBpfAddress } from "../tool-parsers.js";

// ============================================================================
// Generic helpers
// ============================================================================

export function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function getSnapshotDisplayName(snapshot: DeviceSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  const legacyDeviceName = asObject(snapshot)?.deviceName;
  return snapshot.alias ?? (typeof legacyDeviceName === "string" ? legacyDeviceName : undefined);
}

export function getClientsFromResponse(response: JsonRecord): unknown[] {
  if (Array.isArray(response.clients)) return response.clients;
  const data = asObject(response.data);
  return Array.isArray(data?.clients) ? data.clients : [];
}

export function buildToolResult(text: string, details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text }],
    details: details as Record<string, unknown>,
  };
}

export function logToolInvocation(logger: { info?: (msg: string) => void } | undefined, name: string, rawParams?: unknown): void {
  logger?.info?.(`openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`);
}

// ============================================================================
// Token / port / address helpers
// ============================================================================

export function generateSecureToken(): string {
  const { randomBytes } = require("node:crypto");
  return randomBytes(24).toString("hex");
}

export function getTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requireTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

export function parsePortString(value: string, label: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`${label} must be a valid port (1-65535), got: ${value}`);
  return port;
}

export function assertValidServerAddr(serverAddr: string): void {
  if (!serverAddr || !serverAddr.trim()) throw new Error("server_addr is required");
}

// ============================================================================
// XFRPC helpers
// ============================================================================

export function getXfrpcTcpServicesFromResponse(response: unknown): JsonRecord[] {
  const obj = asObject(response);
  if (!obj) return [];
  const data = asObject(obj.data);
  const services = data?.services ?? obj.services;
  if (!Array.isArray(services)) return [];
  return services.filter((entry): entry is JsonRecord => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));
}

export function getXfrpcTcpServiceRemotePort(service: JsonRecord): number | undefined {
  const remotePort = service.remote_port ?? service.remotePort;
  if (typeof remotePort === "number") return remotePort;
  if (typeof remotePort === "string") {
    const parsed = Number.parseInt(remotePort, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function getFrpsStatusToken(response: JsonRecord): string | undefined {
  const data = asObject(response.data);
  const token = data?.token ?? response.token;
  return getTrimmedString(token);
}

export function getFrpsStatusPort(response: JsonRecord): string | undefined {
  const data = asObject(response.data);
  const portValue = response.port ?? data?.port ?? data?.bindPort ?? data?.listen_port;
  if (typeof portValue === "number" && Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535) {
    return String(portValue);
  }
  if (typeof portValue === "string") {
    const trimmed = portValue.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) return trimmed;
  }
  return undefined;
}

export function getFrpsStatusPublicIp(response: JsonRecord): string | undefined {
  const data = asObject(response.data);
  const publicIp = data?.publicIp ?? data?.public_ip ?? response.publicIp ?? response.public_ip;
  return getTrimmedString(publicIp);
}

export function getXfrpcCommonConfigFromResponse(response: unknown): JsonRecord {
  const obj = asObject(response);
  if (!obj) return {};
  const data = asObject(obj.data);
  return data ?? obj;
}

// ============================================================================
// BPF helpers
// ============================================================================

export function summarizeBpfJsonResponse(
  response: JsonRecord,
  table: BpfJsonTable,
  deviceId: string,
): string {
  const data = asObject(response.data);
  const entries = Array.isArray(data?.entries) ? data.entries : Array.isArray(data?.items) ? data.items : [];
  const count = entries.length;
  return `Fetched ${table} BPF stats for ${deviceId}${count > 0 ? ` (${count} entries)` : ""}.`;
}

// ============================================================================
// WireGuard helpers
// ============================================================================

export function collectNestedJsonObjects(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 6) return [];
  if (!value || typeof value !== "object") return [];
  const obj = value as JsonRecord;
  const results: JsonRecord[] = [obj];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      results.push(...collectNestedJsonObjects(v, depth + 1));
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          results.push(...collectNestedJsonObjects(item, depth + 1));
        }
      }
    }
  }
  return results;
}

export function extractWireguardConfigSnapshot(response: JsonRecord): {
  privateKey: string;
  addresses: string[];
  peerPublicKey: string;
  peerAllowedIps: string[];
  peerEndpoint: string;
  peerPresharedKey: string;
} {
  const objects = collectNestedJsonObjects(response);
  let privateKey = "";
  let addresses: string[] = [];
  let peerPublicKey = "";
  let peerAllowedIps: string[] = [];
  let peerEndpoint = "";
  let peerPresharedKey = "";

  for (const obj of objects) {
    if (typeof obj.private_key === "string" && obj.private_key) privateKey = obj.private_key;
    if (typeof obj.privateKey === "string" && obj.privateKey && !privateKey) privateKey = obj.privateKey;
    if (Array.isArray(obj.addresses)) addresses = obj.addresses.filter((a): a is string => typeof a === "string");
    if (Array.isArray(obj.addresses) && obj.addresses.length === 0 && typeof obj.address === "string") addresses = [obj.address];
    if (typeof obj.public_key === "string" && obj.public_key) peerPublicKey = obj.public_key;
    if (typeof obj.publicKey === "string" && obj.publicKey && !peerPublicKey) peerPublicKey = obj.publicKey;
    if (Array.isArray(obj.allowed_ips)) peerAllowedIps = obj.allowed_ips.filter((a): a is string => typeof a === "string");
    if (Array.isArray(obj.allowedIps) && obj.allowedIps.length > 0 && peerAllowedIps.length === 0) peerAllowedIps = obj.allowedIps.filter((a): a is string => typeof a === "string");
    if (typeof obj.endpoint === "string" && obj.endpoint) peerEndpoint = obj.endpoint;
    if (typeof obj.preshared_key === "string" && obj.preshared_key) peerPresharedKey = obj.preshared_key;
    if (typeof obj.presharedKey === "string" && obj.presharedKey && !peerPresharedKey) peerPresharedKey = obj.presharedKey;
  }

  return { privateKey, addresses, peerPublicKey, peerAllowedIps, peerEndpoint, peerPresharedKey };
}

export function findServerPeerPublicKeyForTunnelIp(
  serverPeerConfig: Array<{ publicKey: string | undefined; allowedIps: string[] }>,
  tunnelIp: string,
): string | undefined {
  const targetIp = tunnelIp.split("/")[0]?.trim();
  if (!targetIp) return undefined;
  for (const peer of serverPeerConfig) {
    for (const allowedIp of peer.allowedIps) {
      const networkIp = allowedIp.split("/")[0]?.trim();
      if (networkIp === targetIp && peer.publicKey) return peer.publicKey;
    }
  }
  return undefined;
}

export function mapWireguardInterfacePayload(input: JsonRecord): JsonRecord {
  const output: JsonRecord = { ...input };

  const privateKeyCandidate =
    output.private_key === undefined && typeof input.privateKey === "string"
      ? input.privateKey.trim()
      : typeof output.private_key === "string"
        ? output.private_key.trim()
        : undefined;
  if (
    privateKeyCandidate &&
    privateKeyCandidate !== "GENERATED_ON_DEVICE" &&
    privateKeyCandidate !== "[GENERATED_ON_DEVICE]"
  ) {
    output.private_key = privateKeyCandidate;
  } else {
    delete output.private_key;
  }
  if (output.listen_port === undefined && typeof input.listenPort === "number") {
    output.listen_port = input.listenPort;
  }

  delete output.privateKey;
  delete output.listenPort;

  return output;
}

export function mapWireguardPeerPayload(input: JsonRecord): JsonRecord {
  const output: JsonRecord = { ...input };

  if (output.public_key === undefined && typeof input.publicKey === "string") {
    output.public_key = input.publicKey;
  }
  if (output.preshared_key === undefined && typeof input.presharedKey === "string") {
    output.preshared_key = input.presharedKey;
  }
  output.allowed_ips = ["0.0.0.0/0"];
  if (output.endpoint_host === undefined && typeof input.endpointHost === "string") {
    output.endpoint_host = input.endpointHost;
  }
  if (output.endpoint_port === undefined && typeof input.endpointPort === "number") {
    output.endpoint_port = input.endpointPort;
  }
  if (output.persistent_keepalive === undefined && typeof input.persistentKeepalive === "number") {
    output.persistent_keepalive = input.persistentKeepalive;
  }
  output.route_allowed_ips = "0";

  delete output.publicKey;
  delete output.presharedKey;
  delete output.allowedIps;
  delete output.endpointHost;
  delete output.endpointPort;
  delete output.persistentKeepalive;
  delete output.routeAllowedIps;

  return output;
}

export { isIPv4 };
