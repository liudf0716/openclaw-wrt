/**
 * MAC address, BPF address, and general string/port validation utilities.
 */

// ============================================================================
// MAC / BPF
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
// String / port / address helpers
// ============================================================================

/**
 * Return a trimmed string if the input is a non-empty string, otherwise undefined.
 */
export function getTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Require a non-empty trimmed string or throw.
 */
export function requireTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

/**
 * Parse a port string (1-65535) or throw.
 */
export function parsePortString(value: string, label: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`${label} must be a valid port (1-65535), got: ${value}`);
  return port;
}

/**
 * Assert that a server address string is non-empty.
 */
export function assertValidServerAddr(serverAddr: string): void {
  if (!serverAddr || !serverAddr.trim()) throw new Error("server_addr is required");
}
