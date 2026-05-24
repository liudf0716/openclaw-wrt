/**
 * Shared helper functions extracted from tool-monolith.ts.
 * Used by domain tool files in src/tools/ during the migration.
 *
 * Functions that were previously duplicated here AND in tool-parsers.ts
 * have been consolidated into tool-parsers.ts. This file re-exports them
 * for backward compatibility and contains only the unique helpers.
 */

import { randomBytes } from "node:crypto";
import type { JsonRecord } from "../tool-types.js";
import {
  asObject,
} from "../tool-parsers.js";

// ============================================================================
// Re-exports from tool-parsers.ts (consolidated canonical source)
// ============================================================================

export {
  asObject,
  getSnapshotDisplayName,
  getClientsFromResponse,
  buildToolResult,
  collectNestedJsonObjects,
  extractWireguardConfigSnapshot,
  findServerPeerPublicKeyForTunnelIp,
  mapWireguardInterfacePayload,
  mapWireguardPeerPayload,
  summarizeBpfJsonResponse,
} from "../tool-parsers.js";

export { normalizeMac as parserNormalizeMac } from "../tool-parsers.js";
export { normalizeBpfAddress as parserNormalizeBpfAddress } from "../tool-parsers.js";

// ============================================================================
// Logging
// ============================================================================

export function logToolInvocation(logger: { info?: (msg: string) => void } | undefined, name: string, rawParams?: unknown): void {
  logger?.info?.(`openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`);
}

// ============================================================================
// Token / port / address helpers
// ============================================================================

export function generateSecureToken(): string {
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
// XFRPC / FRPS helpers
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
