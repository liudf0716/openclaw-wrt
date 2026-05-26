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
 * Extract WireGuard configuration snapshot from nested response data.
 * Uses iterative depth-first traversal to avoid collecting all objects upfront.
 */
export function extractWireguardConfigSnapshot(response: JsonRecord): {
  privateKey?: string;
  addresses: string[];
  peerPublicKey?: string;
  peerAllowedIps: string[];
  peerEndpoint?: string;
  peerPresharedKey?: string;
} {
  let privateKey: string | undefined;
  let addresses: string[] = [];
  let peerPublicKey: string | undefined;
  let peerAllowedIps: string[] = [];
  let peerEndpoint: string | undefined;
  let peerPresharedKey: string | undefined;

  const MAX_DEPTH = 6;

  // Iterative depth-first traversal using an explicit stack.
  // Each entry is [value, depth].
  const stack: Array<[unknown, number]> = [[response, 0]];

  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;

    if (!current || typeof current !== "object" || depth > MAX_DEPTH) {
      continue;
    }

    // Process arrays by pushing elements onto the stack.
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push([current[i], depth + 1]);
      }
      continue;
    }

    const obj = current as JsonRecord;

    // Extract fields from this object.
    if (!privateKey) {
      const candidate =
        typeof obj.private_key === "string"
          ? obj.private_key
          : typeof obj.privateKey === "string"
            ? obj.privateKey
            : undefined;
      if (candidate?.trim()) {
        privateKey = candidate.trim();
      }
    }

    if (addresses.length === 0) {
      const rawAddresses =
        Array.isArray(obj.addresses)
          ? obj.addresses
          : typeof obj.address === "string"
            ? [obj.address]
            : Array.isArray(obj.address)
              ? obj.address
              : [];
      const normalizedAddresses = rawAddresses
        .filter((candidate): candidate is string => typeof candidate === "string")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      if (normalizedAddresses.length > 0) {
        addresses = normalizedAddresses;
      }
    }

    if (!peerPublicKey && Array.isArray(obj.peers) && obj.peers.length > 0) {
      for (const peer of obj.peers) {
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

    // Early exit: all fields found.
    if (privateKey && addresses.length > 0 && peerPublicKey) {
      break;
    }

    // Push child objects onto the stack (reversed for correct DFS order).
    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i--) {
      stack.push([obj[keys[i]], depth + 1]);
    }
  }

  return { privateKey, addresses, peerPublicKey, peerAllowedIps, peerEndpoint, peerPresharedKey };
}

/**
 * @deprecated Use extractWireguardConfigSnapshot directly for better performance.
 * Kept for backward compatibility. Recursively collects all nested objects.
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
