/**
 * XFRPC and FRPS response parsing utilities.
 */

import type { JsonRecord } from "../tool-types.js";
import { asObject } from "./response.js";
import { getTrimmedString } from "./mac.js";

// ============================================================================
// XFRPC helpers
// ============================================================================

/**
 * Extract TCP services array from an XFRPC response.
 */
export function getXfrpcTcpServicesFromResponse(response: unknown): JsonRecord[] {
  const obj = asObject(response);
  if (!obj) return [];
  const data = asObject(obj.data);
  const services = data?.services ?? obj.services;
  if (!Array.isArray(services)) return [];
  return services.filter((entry): entry is JsonRecord => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));
}

/**
 * Extract remote port from an XFRPC TCP service record.
 */
export function getXfrpcTcpServiceRemotePort(service: JsonRecord): number | undefined {
  const remotePort = service.remote_port ?? service.remotePort;
  if (typeof remotePort === "number") return remotePort;
  if (typeof remotePort === "string") {
    const parsed = Number.parseInt(remotePort, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Extract common config from an XFRPC response.
 */
export function getXfrpcCommonConfigFromResponse(response: unknown): JsonRecord {
  const obj = asObject(response);
  if (!obj) return {};
  const data = asObject(obj.data);
  return data ?? obj;
}

// ============================================================================
// FRPS status helpers
// ============================================================================

/**
 * Extract auth token from FRPS status response.
 */
export function getFrpsStatusToken(response: JsonRecord): string | undefined {
  const data = asObject(response.data);
  const token = data?.token ?? response.token;
  return getTrimmedString(token);
}

/**
 * Extract listen port from FRPS status response.
 */
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

/**
 * Extract public IP from FRPS status response.
 */
export function getFrpsStatusPublicIp(response: JsonRecord): string | undefined {
  const data = asObject(response.data);
  const publicIp = data?.publicIp ?? data?.public_ip ?? response.publicIp ?? response.public_ip;
  return getTrimmedString(publicIp);
}
