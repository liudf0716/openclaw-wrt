/**
 * WireGuard configuration parsing and payload mapping utilities.
 */

import type { JsonRecord } from "../tool-types.js";

// ============================================================================
// Helpers
// ============================================================================

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

// ============================================================================
// WireGuard Configuration Parsing
// ============================================================================

/**
 * Recursively collect all nested JSON objects up to a maximum depth.
 */
export function collectNestedJsonObjects(value: unknown, depth = 0): JsonRecord[] {
  if (!value || typeof value !== "object" || depth > 6) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNestedJsonObjects(entry, depth + 1));
  }

  const objectValue = value as JsonRecord;
  return [
    objectValue,
    ...Object.values(objectValue).flatMap((entry) => collectNestedJsonObjects(entry, depth + 1)),
  ];
}

/**
 * Extract WireGuard configuration snapshot from nested response data.
 */
export function extractWireguardConfigSnapshot(response: JsonRecord): {
  privateKey?: string;
  addresses: string[];
  peerPublicKey?: string;
  peerAllowedIps: string[];
  peerEndpoint?: string;
  peerPresharedKey?: string;
} {
  const objects = collectNestedJsonObjects(response);

  let privateKey: string | undefined;
  let addresses: string[] = [];
  let peerPublicKey: string | undefined;
  let peerAllowedIps: string[] = [];
  let peerEndpoint: string | undefined;
  let peerPresharedKey: string | undefined;

  for (const entry of objects) {
    if (!privateKey) {
      const candidate =
        typeof entry.private_key === "string"
          ? entry.private_key
          : typeof entry.privateKey === "string"
            ? entry.privateKey
            : undefined;
      if (candidate?.trim()) {
        privateKey = candidate.trim();
      }
    }

    if (addresses.length === 0) {
      const rawAddresses =
        Array.isArray(entry.addresses)
          ? entry.addresses
          : typeof entry.address === "string"
            ? [entry.address]
            : Array.isArray(entry.address)
              ? entry.address
              : [];
      const normalizedAddresses = rawAddresses
        .filter((candidate): candidate is string => typeof candidate === "string")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      if (normalizedAddresses.length > 0) {
        addresses = normalizedAddresses;
      }
    }

    if (!peerPublicKey && Array.isArray(entry.peers) && entry.peers.length > 0) {
      for (const peer of entry.peers) {
        const peerObject = asObject(peer);
        if (!peerObject) {
          continue;
        }
        const candidate =
          typeof peerObject.public_key === "string"
            ? peerObject.public_key
            : typeof peerObject.publicKey === "string"
              ? peerObject.publicKey
              : undefined;
        if (candidate?.trim()) {
          peerPublicKey = candidate.trim();
          const rawAllowedIps = Array.isArray(peerObject.allowed_ips)
            ? peerObject.allowed_ips
            : Array.isArray(peerObject.allowedIps)
              ? peerObject.allowedIps
              : [];
          peerAllowedIps = rawAllowedIps.filter((a): a is string => typeof a === "string");
          if (typeof peerObject.endpoint === "string" && peerObject.endpoint) {
            peerEndpoint = peerObject.endpoint;
          }
          if (typeof peerObject.preshared_key === "string" && peerObject.preshared_key) {
            peerPresharedKey = peerObject.preshared_key;
          } else if (typeof peerObject.presharedKey === "string" && peerObject.presharedKey) {
            peerPresharedKey = peerObject.presharedKey;
          }
          break;
        }
      }
    }

    if (privateKey && addresses.length > 0 && peerPublicKey) {
      break;
    }
  }

  return { privateKey, addresses, peerPublicKey, peerAllowedIps, peerEndpoint, peerPresharedKey };
}

/**
 * Find the public key for a server peer given a specific tunnel IP.
 */
export function findServerPeerPublicKeyForTunnelIp(
  peers: Array<{ publicKey?: string; allowedIps: string[] }>,
  tunnelIp: string,
): string | undefined {
  const targetIp = tunnelIp.split("/")[0]?.trim();
  if (!targetIp) return undefined;

  for (const peer of peers) {
    for (const allowedIp of peer.allowedIps) {
      const networkIp = allowedIp.split("/")[0]?.trim();
      if (networkIp === targetIp && peer.publicKey) return peer.publicKey;
    }
  }

  return undefined;
}

/**
 * Map camelCase WireGuard interface parameters to snake_case for device operations.
 */
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

/**
 * Map camelCase WireGuard peer parameters to snake_case for device operations.
 */
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
