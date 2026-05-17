/**
 * Validation helper functions for openclaw-wrt.
 * Includes IPv4 CIDR validation, WireGuard key validation, and related utilities.
 */

import { isIPv4 } from "node:net";
import type { IPv4CidrInfo, ExecFileSyncRunner } from "./tool-types.js";

// ============================================================================
// IPv4 Utilities
// ============================================================================

/**
 * Convert IPv4 address string to 32-bit unsigned integer.
 */
export function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

/**
 * Convert 32-bit unsigned integer back to IPv4 address string.
 */
export function intToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/**
 * Parse IPv4 CIDR notation (e.g., "192.168.1.0/24") into network info.
 * Returns null if the input is invalid.
 */
export function parseIPv4Cidr(input: string): IPv4CidrInfo | null {
  const trimmed = input.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    return null;
  }
  const [ip, prefixRaw] = parts;
  if (!isIPv4(ip)) {
    return null;
  }
  const prefix = Number.parseInt(prefixRaw, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }
  const ipInt = ipv4ToInt(ip);
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return {
    input: trimmed,
    normalized: `${intToIpv4(network)}/${prefix}`,
    network,
    broadcast,
    prefix,
  };
}

/**
 * Parse IPv4 address with dotted-decimal netmask (e.g., "192.168.1.0" and "255.255.255.0").
 * Returns null if either address is invalid or netmask is not a valid subnet mask.
 */
export function parseIPv4WithMask(ip: string, mask: string): IPv4CidrInfo | null {
  if (!isIPv4(ip) || !isIPv4(mask)) {
    return null;
  }
  const maskInt = ipv4ToInt(mask);
  const maskBinary = maskInt.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(maskBinary)) {
    return null;
  }
  const prefix = maskBinary.indexOf("0");
  const bits = prefix === -1 ? 32 : prefix;
  return parseIPv4Cidr(`${ip}/${bits}`);
}

/**
 * Check if two IPv4 CIDR blocks overlap.
 */
export function cidrOverlaps(left: IPv4CidrInfo, right: IPv4CidrInfo): boolean {
  return left.network <= right.broadcast && right.network <= left.broadcast;
}

// ============================================================================
// WireGuard Key Validation
// ============================================================================

/**
 * Validate WireGuard public key format.
 * Public keys are 32-byte values encoded as 44-character base64 (with trailing =).
 */
export function isValidWireGuardPublicKey(key: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(key.trim());
}

/**
 * Validate WireGuard private key format.
 * Private keys are 32-byte values encoded as 44-character base64 (with trailing =).
 */
export function isValidWireGuardPrivateKey(key: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(key.trim());
}

/**
 * Derive a WireGuard public key from a private key using the `wg pubkey` command.
 * Throws an error if the private key format is invalid or the derivation fails.
 */
export function deriveWireGuardPublicKeyFromPrivateKey(
  privateKey: string,
  execFileSync: ExecFileSyncRunner,
): string {
  const trimmed = privateKey.trim();
  if (!isValidWireGuardPrivateKey(trimmed)) {
    throw new Error("invalid WireGuard private key format");
  }

  const derived = String(
    execFileSync("wg", ["pubkey"], {
      input: `${trimmed}\n`,
      encoding: "utf-8",
      timeout: 5000,
    }),
  ).trim();

  if (!isValidWireGuardPublicKey(derived)) {
    throw new Error("failed to derive a valid WireGuard public key");
  }

  return derived;
}
