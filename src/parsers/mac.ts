/**
 * MAC address and BPF address processing utilities.
 */

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
