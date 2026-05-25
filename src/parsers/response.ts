/**
 * Response formatting and utility functions.
 */

import { randomBytes } from "node:crypto";
import type { JsonRecord } from "../tool-types.js";

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
export function getSnapshotDisplayName(snapshot: { alias?: string; deviceName?: unknown } | undefined): string | undefined {
  if (!snapshot) {
    return undefined;
  }
  const legacyDeviceName = asObject(snapshot)?.deviceName;
  return snapshot.alias ?? (typeof legacyDeviceName === "string" ? legacyDeviceName : undefined);
}

/**
 * Extract clients array from device response.
 */
export function getClientsFromResponse(response: JsonRecord): unknown[] {
  if (Array.isArray(response.clients)) {
    return response.clients;
  }
  const data = asObject(response.data);
  return Array.isArray(data?.clients) ? data.clients : [];
}

/**
 * Format duration in milliseconds to a human-readable string.
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

/**
 * Parse chawrtd timestamp.
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
 * Parse a chawrtd device snapshot into normalized DeviceSnapshot format.
 */
export function parseChawrtdDeviceSnapshot(value: unknown): {
  deviceId: string;
  connectedAtMs: number;
  lastSeenAtMs: number;
  remoteAddress?: string;
  gateway?: unknown;
  deviceInfo?: unknown;
  authMode?: number;
  alias?: string;
} | null {
  const rawEntry = asObject(value);
  if (!rawEntry) {
    return null;
  }

  const entry = rawEntry as {
    device_id?: string;
    connected_at?: unknown;
    last_seen_at?: unknown;
    remote_addr?: string;
    gateway?: unknown;
    device_info?: unknown;
    auth_mode?: number;
    alias?: string;
  };
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
// Crypto / Token
// ============================================================================

/**
 * Generate a cryptographically secure hex token (24 bytes = 48 hex chars).
 */
export function generateSecureToken(): string {
  return randomBytes(24).toString("hex");
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log a tool invocation with its name and raw parameters.
 */
export function logToolInvocation(logger: { info?: (msg: string) => void } | undefined, name: string, rawParams?: unknown): void {
  logger?.info?.(`openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`);
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
  const data = asObject(response.data);
  const entries = Array.isArray(data?.entries)
    ? data.entries
    : Array.isArray(data?.items)
      ? data.items
      : [];
  const count = entries.length;
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
