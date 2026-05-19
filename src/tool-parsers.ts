/**
 * Data parsing and normalization functions for openclaw-wrt.
 * Handles MAC address normalization, timestamp parsing, portal configuration, and related utilities.
 */

import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import type {
  JsonRecord,
  DeviceSnapshot,
  ChawrtdDeviceSnapshot,
  PortalTemplate,
  PortalContent,
} from "./tool-types.js";
import { parseIPv4Cidr } from "./tool-validators.js";
import {
  renderPortalPageHtml,
  type PortalContent as PortalContentType,
} from "./portal-page-renderer.js";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a value is a non-array object.
 */
export function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/**
 * Get display name for a device from its snapshot (alias or legacy deviceName).
 */
export function getSnapshotDisplayName(snapshot: DeviceSnapshot | undefined): string | undefined {
  if (!snapshot) {
    return undefined;
  }
  const legacyDeviceName = asObject(snapshot)?.deviceName;
  return snapshot.alias ?? (typeof legacyDeviceName === "string" ? legacyDeviceName : undefined);
}

/**
 * Extract clients array from device response (handles both direct and nested data structures).
 */
export function getClientsFromResponse(response: JsonRecord): unknown[] {
  if (Array.isArray(response.clients)) {
    return response.clients;
  }
  const data = asObject(response.data);
  return Array.isArray(data?.clients) ? data.clients : [];
}

// ============================================================================
// MAC Address Processing
// ============================================================================

/**
 * Normalize MAC address: uppercase and convert dashes to colons.
 */
export function normalizeMac(input: string): string {
  return input.trim().toUpperCase().replace(/-/g, ":");
}

/**
 * Normalize BPF address based on table type (MAC, IPv4, or IPv6).
 */
export function normalizeBpfAddress(table: "ipv4" | "ipv6" | "mac", address: string): string {
  const trimmed = address.trim();
  if (table === "mac") {
    return normalizeMac(trimmed).toLowerCase();
  }
  return trimmed;
}

// ============================================================================
// Timestamp Processing
// ============================================================================

/**
 * Parse chawrtd timestamp (handles both millisecond and second unix timestamps, and ISO strings).
 */
export function parseChawrtdTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

/**
 * Format duration in milliseconds to a human-readable string (e.g., "2d 5h").
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ============================================================================
// Device Snapshot Parsing
// ============================================================================

/**
 * Parse a chawrtd device snapshot into normalized DeviceSnapshot format.
 * Returns null if the input is missing a required deviceId.
 */
export function parseChawrtdDeviceSnapshot(value: unknown): DeviceSnapshot | null {
  const rawEntry = asObject(value);
  if (!rawEntry) {
    return null;
  }

  const entry = rawEntry as ChawrtdDeviceSnapshot;
  const deviceId = typeof entry.device_id === "string" ? entry.device_id.trim() : "";
  if (!deviceId) {
    return null;
  }

  return {
    deviceId,
    connectedAtMs: parseChawrtdTimestamp(entry.connected_at),
    lastSeenAtMs: parseChawrtdTimestamp(entry.last_seen_at),
    remoteAddress: typeof entry.remote_addr === "string" ? entry.remote_addr : undefined,
    gateway: entry.gateway,
    deviceInfo: entry.device_info,
    authMode: typeof entry.auth_mode === "number" ? entry.auth_mode : undefined,
    alias: typeof entry.alias === "string" ? entry.alias : undefined,
  };
}

// ============================================================================
// WireGuard Configuration Parsing
// ============================================================================

/**
 * Recursively collect all nested JSON objects up to a maximum depth.
 */
export function collectNestedJsonObjects(value: unknown, depth = 0): JsonRecord[] {
  if (!value || typeof value !== "object" || depth > 5) {
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
 * Returns private key, addresses, and peer public key if found.
 */
export function extractWireguardConfigSnapshot(response: JsonRecord): {
  privateKey?: string;
  addresses: string[];
  peerPublicKey?: string;
} {
  const objects = collectNestedJsonObjects(response);

  let privateKey: string | undefined;
  let addresses: string[] = [];
  let peerPublicKey: string | undefined;

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
          break;
        }
      }
    }

    if (privateKey && addresses.length > 0 && peerPublicKey) {
      break;
    }
  }

  return { privateKey, addresses, peerPublicKey };
}

/**
 * Find the public key for a server peer given a specific tunnel IP.
 */
export function findServerPeerPublicKeyForTunnelIp(
  peers: Array<{ publicKey?: string; allowedIps: string[] }>,
  tunnelIp: string,
): string | undefined {
  const targetIp = tunnelIp.trim();
  // Note: using dynamic import would require refactoring, so we check the format manually
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(targetIp)) {
    return undefined;
  }

  for (const peer of peers) {
    for (const allowedIp of peer.allowedIps) {
      const parsed = parseIPv4Cidr(allowedIp);
      if (!parsed || parsed.prefix !== 32) {
        continue;
      }
      const peerIp = allowedIp.split("/")[0]?.trim();
      if (peerIp === targetIp) {
        return peer.publicKey?.trim();
      }
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

// ============================================================================
// Portal Page Handling
// ============================================================================

/**
 * Extract the root directory from nginx configuration file.
 * Parses /etc/nginx/sites-enabled/default for the 'root' directive.
 */
export async function extractNginxRootFromConfig(): Promise<string | null> {
  const configPath = "/etc/nginx/sites-enabled/default";
  try {
    const content = await fs.readFile(configPath, "utf8");
    // Match 'root /path/to/directory;'
    const match = content.match(/^\s*root\s+([^;]+);/m);
    if (match && match[1]) {
      const root = match[1].trim();
      // Remove quotes if present
      const cleaned = root.replace(/^['"]|['"]$/g, "").trim();
      if (cleaned) {
        return cleaned;
      }
    }
  } catch {
    // Config file not readable, silently continue
  }
  return null;
}

/**
 * Candidate directories for nginx web root (in priority order).
 */
export const PORTAL_WEB_ROOT_CANDIDATES = [
  "/usr/share/nginx/html",
  "/var/www/html",
  "/www",
  "/srv/http",
  "/usr/local/www/nginx/html",
  "/usr/local/www",
];

/**
 * Sanitize and resolve portal HTML root directory path.
 */
export function sanitizePortalHtmlRoot(root: string): string {
  return path.resolve(root.trim());
}

/**
 * Sanitize portal page name (remove unsafe characters).
 */
export function sanitizePortalPageName(input: string): string {
  const baseName = path.basename(input.trim());
  const cleaned = baseName.replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "");
}

/**
 * Build a portal page name from device ID and optional explicit name.
 */
export function buildPortalPageName(deviceId: string, explicitPageName?: string): string {
  const requested = explicitPageName?.trim();
  if (requested) {
    const cleaned = sanitizePortalPageName(requested);
    if (cleaned) {
      return cleaned.endsWith(".html") ? cleaned : `${cleaned}.html`;
    }
  }

  const deviceSlug = deviceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!deviceSlug) {
    throw new Error("unable to derive portal page name from deviceId");
  }
  return `portal-${deviceSlug}.html`;
}

/**
 * Resolve the writable nginx web root directory.
 * Checks in order: nginx config, explicit override, environment variables, and candidate directories.
 */
export async function resolvePortalWebRoot(explicitRoot?: string): Promise<string> {
  const candidates: (string | null)[] = [
    await extractNginxRootFromConfig(), // Check nginx config first
    explicitRoot?.trim(),
    process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT?.trim(),
    process.env.OPENCLAW_WRT_WEB_ROOT?.trim(),
    ...PORTAL_WEB_ROOT_CANDIDATES,
  ];

  const filteredCandidates = candidates.filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );

  for (const candidate of filteredCandidates) {
    const resolved = sanitizePortalHtmlRoot(candidate);
    if (explicitRoot?.trim() === candidate) {
      await fs.mkdir(resolved, { recursive: true });
      return resolved;
    }
    try {
      await fs.access(resolved, fsConstants.W_OK);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(
    `unable to locate a writable nginx web root; checked nginx config, set OPENCLAW_WRT_PORTAL_WEB_ROOT, or pass webRoot (fallback candidates: ${PORTAL_WEB_ROOT_CANDIDATES.join(", ")})`,
  );
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Summarize BPF JSON response with entry count.
 */
export function summarizeBpfJsonResponse(
  response: JsonRecord,
  table: string,
  deviceId: string,
): string {
  const data = response.data;
  const count = Array.isArray(data)
    ? data.length
    : data && typeof data === "object"
      ? Object.keys(data as JsonRecord).length
      : 0;
  return `Fetched ${table} BPF stats for ${deviceId}${count > 0 ? ` (${count} entries)` : ""}.`;
}

/**
 * Get category emoji for tool display based on category key.
 */
export function getCategoryEmoji(key: string): string {
  switch (key) {
    case "mgmt":
      return "⚙️";
    case "wifi":
      return "📶";
    case "qos":
      return "⏳";
    case "nwct":
      return "🔌";
    case "vpn":
      return "🛡️";
    case "portal":
      return "🎨";
    case "social":
      return "📢";
    default:
      return "🔹";
  }
}

/**
 * Build a tool result object with text content and details.
 */
export function buildToolResult(text: string, details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}
