/**
 * Data parsing and normalization functions for openclaw-wrt.
 *
 * This file is a re-export entry point. Canonical implementations live in:
 *   - parsers/mac.ts      — MAC and BPF address normalization
 *   - parsers/wireguard.ts — WireGuard config extraction and payload mapping
 *   - parsers/portal.ts   — Portal page path resolution and name sanitization
 *   - parsers/response.ts — Response formatting, timestamp parsing, snapshot parsing
 *
 * All exports are preserved here for backward compatibility with existing imports.
 */

// Re-export from sub-modules
export { normalizeMac, normalizeBpfAddress } from "./parsers/mac.js";
export {
  collectNestedJsonObjects,
  extractWireguardConfigSnapshot,
  findServerPeerPublicKeyForTunnelIp,
  mapWireguardInterfacePayload,
  mapWireguardPeerPayload,
} from "./parsers/wireguard.js";
export {
  extractNginxRootFromConfig,
  sanitizePortalHtmlRoot,
  sanitizePortalPageName,
  buildPortalPageName,
  resolvePortalWebRoot,
  PORTAL_WEB_ROOT_CANDIDATES,
} from "./parsers/portal.js";
export {
  asObject,
  getSnapshotDisplayName,
  getClientsFromResponse,
  formatDuration,
  parseChawrtdTimestamp,
  parseChawrtdDeviceSnapshot,
  summarizeBpfJsonResponse,
  getCategoryEmoji,
  buildToolResult,
  generateSecureToken,
  logToolInvocation,
} from "./parsers/response.js";
export {
  getTrimmedString,
  requireTrimmedString,
  parsePortString,
  assertValidServerAddr,
} from "./parsers/mac.js";
export {
  getXfrpcTcpServicesFromResponse,
  getXfrpcTcpServiceRemotePort,
  getXfrpcCommonConfigFromResponse,
  getFrpsStatusToken,
  getFrpsStatusPort,
  getFrpsStatusPublicIp,
} from "./parsers/xfrpc.js";
