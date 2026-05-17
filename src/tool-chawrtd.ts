/**
 * HTTP communication with chawrtd gateway and device operation functions.
 * Handles device discovery, status queries, and operation calls.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ResolvedClawWRTConfig } from "./config.js";
import type {
  JsonRecord,
  ClawWRTBridge,
  DeviceSnapshot,
  ChawrtdToolResult,
  PortalTemplate,
  PortalContent,
} from "./tool-types.js";
import {
  asObject,
  getSnapshotDisplayName,
  parseChawrtdDeviceSnapshot,
  parseChawrtdTimestamp,
  buildToolResult,
  resolvePortalWebRoot,
  buildPortalPageName,
} from "./tool-parsers.js";
import {
  renderPortalPageHtml,
  type PortalTemplate as PortalTemplateType,
  type PortalContent as PortalContentType,
} from "./portal-page-renderer.js";

// ============================================================================
// Global State Management
// ============================================================================

let activeToolLogger:
  | {
      info?: (message: string) => void;
      warn?: (message: string) => void;
      error?: (message: string) => void;
      debug?: (message: string) => void;
    }
  | undefined;

let activeClawWRTConfig: ResolvedClawWRTConfig | undefined;
let activeBridgeFallback: ClawWRTBridge | undefined;

/**
 * Set the active configuration for chawrtd operations.
 */
export function setActiveClawWRTConfig(config: ResolvedClawWRTConfig | undefined): void {
  activeClawWRTConfig = config;
}

/**
 * Set the active bridge for fallback operations.
 */
export function setActiveBridgeFallback(bridge: ClawWRTBridge | undefined): void {
  activeBridgeFallback = bridge;
}

/**
 * Set the active logger.
 */
export function setActiveToolLogger(
  logger:
    | {
        info?: (message: string) => void;
        warn?: (message: string) => void;
        error?: (message: string) => void;
        debug?: (message: string) => void;
      }
    | undefined,
): void {
  activeToolLogger = logger;
}

/**
 * Log tool invocation with optional parameters.
 */
function logToolInvocation(
  logger:
    | {
        info?: (message: string) => void;
        warn?: (message: string) => void;
        error?: (message: string) => void;
        debug?: (message: string) => void;
      }
    | undefined,
  name: string,
  rawParams?: unknown,
): void {
  (logger ?? activeToolLogger)?.info?.(
    `openclaw-wrt: tool invoked name=${name} rawParams=${JSON.stringify(rawParams ?? {})}`,
  );
}

// ============================================================================
// WireGuard Protected Routes File Management
// ============================================================================

const WIREGUARD_PROTECTED_ROUTE_PLAN_FILE = path.join(
  os.tmpdir(),
  "openclaw-wrt-wireguard-protected-routes.json",
);

export function getWireguardProtectedRoutesPlanFile(): string {
  return WIREGUARD_PROTECTED_ROUTE_PLAN_FILE;
}

// ============================================================================
// Chawrtd HTTP Communication
// ============================================================================

const DEFAULT_CHAWRTD_BASE_URL = "http://127.0.0.1:8001";

/**
 * Get the chawrtd base URL from config or default.
 */
export function getChawrtdBaseUrl(config?: ResolvedClawWRTConfig): string {
  return ((config ?? activeClawWRTConfig)?.chawrtdEventStream?.baseUrl ?? DEFAULT_CHAWRTD_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * Call a chawrtd HTTP endpoint with timeout and error handling.
 */
export async function callChawrtd(params: {
  config?: ResolvedClawWRTConfig;
  path: string;
  method?: "GET" | "POST";
  body?: JsonRecord;
  timeoutMs?: number;
}): Promise<ChawrtdToolResult> {
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 180_000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getChawrtdBaseUrl(params.config)}${params.path}`, {
      method: params.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as ChawrtdToolResult;
    if (!response.ok) {
      const message =
        typeof payload?.error === "string" && payload.error
          ? payload.error
          : `chawrtd request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`chawrtd request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ============================================================================
// Device Discovery and Status
// ============================================================================

/**
 * Get list of all connected devices via chawrtd or bridge.
 */
export async function getDevicesListViaChawrtd(config?: ResolvedClawWRTConfig): Promise<DeviceSnapshot[]> {
  const bridge = activeBridgeFallback as
    | {
        listDevices?: () => Array<{ deviceId?: string } & Partial<DeviceSnapshot>>;
        getDevice?: (deviceId: string) => DeviceSnapshot | null;
      }
    | undefined;
  if (!config && typeof bridge?.listDevices === "function") {
    const listedDevices = bridge.listDevices();
    if (typeof bridge.getDevice !== "function") {
      return listedDevices.filter((entry): entry is DeviceSnapshot => Boolean(entry?.deviceId));
    }
    const getDevice = bridge.getDevice;
    const resolvedDevices = await Promise.all(
      listedDevices.map(async (entry) => {
        const deviceId = entry?.deviceId?.trim();
        if (!deviceId) {
          return null;
        }
        return (await getDevice(deviceId)) ?? (entry as DeviceSnapshot);
      }),
    );
    return resolvedDevices.filter((entry): entry is DeviceSnapshot => entry !== null);
  }
  try {
    const response = await callChawrtd({
      config,
      path: "/v1/devices",
      method: "GET",
    });
    const data = asObject(response.data);
    const devices = Array.isArray(data?.devices) ? data.devices : [];
    return devices
      .map((entry) => parseChawrtdDeviceSnapshot(entry))
      .filter((entry): entry is DeviceSnapshot => entry !== null);
  } catch (error) {
    console.error("Failed to get devices list from chawrtd:", error);
    return [];
  }
}

/**
 * Get a specific device snapshot via chawrtd or bridge.
 */
export async function getDeviceViaChawrtd(
  deviceId: string,
  config?: ResolvedClawWRTConfig,
): Promise<DeviceSnapshot | null> {
  const bridge = activeBridgeFallback as
    | { getDevice?: (deviceId: string) => DeviceSnapshot | null }
    | undefined;
  if (!config && typeof bridge?.getDevice === "function") {
    return bridge.getDevice(deviceId);
  }
  try {
    const response = await callChawrtd({
      config,
      path: `/v1/device/${deviceId}`,
      method: "GET",
    });
    return parseChawrtdDeviceSnapshot(response.data ?? response);
  } catch (error) {
    console.error(`Failed to get device ${deviceId} from chawrtd:`, error);
    return null;
  }
}

/**
 * Ensure a device is connected, throw an error if not.
 */
export async function ensureDevice(
  deviceId: string,
  config?: ResolvedClawWRTConfig,
): Promise<DeviceSnapshot> {
  const device = await getDeviceViaChawrtd(deviceId, config);
  if (!device) {
    throw new Error(`device not connected: ${deviceId}`);
  }
  return device;
}

/**
 * Extract the gateway ID from a device snapshot (assumes single gateway).
 */
export function getSingleGatewayId(device: DeviceSnapshot): string | undefined {
  const gateways = Array.isArray(device.gateway) ? device.gateway : [];
  if (gateways.length !== 1) {
    return undefined;
  }
  const gateway = gateways[0];
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) {
    return undefined;
  }
  const gwId = (gateway as JsonRecord).gw_id;
  return typeof gwId === "string" && gwId.trim() ? gwId.trim() : undefined;
}

// ============================================================================
// Device Operations
// ============================================================================

/**
 * Call a device operation via bridge or chawrtd.
 */
export async function callDeviceOp(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceId: string;
  op: string;
  payload?: JsonRecord;
  timeoutMs?: number;
  expectResponse?: boolean;
}): Promise<JsonRecord> {
  logToolInvocation(undefined, "callDeviceOp", {
    deviceId: params.deviceId,
    op: params.op,
    payload: params.payload,
  });
  const bridge = (params.bridge ?? activeBridgeFallback) as
    | {
        callDevice?: (input: {
          deviceId: string;
          op: string;
          payload?: JsonRecord;
          timeoutMs?: number;
          expectResponse?: boolean;
        }) => Promise<JsonRecord>;
      }
    | undefined;
  if (!params.config && typeof bridge?.callDevice === "function") {
    return await bridge.callDevice({
      deviceId: params.deviceId,
      op: params.op,
      payload: params.payload,
      timeoutMs: params.timeoutMs,
      expectResponse: params.expectResponse,
    });
  }
  return await callDeviceOpViaChawrtd({
    config: params.config,
    deviceId: params.deviceId,
    op: params.op,
    payload: params.payload,
    timeoutMs: params.timeoutMs,
  });
}

/**
 * Call a device operation via the chawrtd gateway.
 */
export async function callDeviceOpViaChawrtd(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceId: string;
  op: string;
  payload?: JsonRecord;
  timeoutMs?: number;
}): Promise<JsonRecord> {
  logToolInvocation(undefined, "callDeviceOpViaChawrtd", {
    deviceId: params.deviceId,
    op: params.op,
    payload: params.payload,
  });

  try {
    const response = await callChawrtd({
      config: params.config,
      path: `/v1/device/${params.deviceId}/${params.op}`,
      method: "POST",
      body: params.payload ?? {},
      timeoutMs: params.timeoutMs,
    });

    if (response.error) {
      throw new Error(response.error);
    }

    return response.data ?? response;
  } catch (error) {
    throw error;
  }
}

/**
 * Restart xfrpc service on a device.
 */
export async function restartXfrpcService(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceId: string;
  timeoutMs?: number;
}): Promise<JsonRecord> {
  return await callDeviceOp({
    bridge: params.bridge,
    config: params.config,
    deviceId: params.deviceId,
    op: "restart_xfrpc",
    timeoutMs: params.timeoutMs,
  });
}

// ============================================================================
// Portal Page Operations
// ============================================================================

/**
 * Publish a captive portal page to a device.
 */
export async function publishPortalPage(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceId: string;
  html?: string;
  template?: PortalTemplate;
  content?: PortalContent;
  pageName?: string;
  webRoot?: string;
  timeoutMs?: number;
}): Promise<{
  pageName: string;
  root: string;
  filePath: string;
  response: JsonRecord;
}> {
  logToolInvocation(undefined, "publishPortalPage", {
    deviceId: params.deviceId,
    template: params.template,
    pageName: params.pageName,
    webRoot: params.webRoot,
  });
  const pageName = buildPortalPageName(params.deviceId, params.pageName);
  const root = await resolvePortalWebRoot(params.webRoot);
  const filePath = path.join(root, pageName);
  const html =
    params.html?.trim() ||
    renderPortalPageHtml({
      deviceId: params.deviceId,
      template: params.template,
      content: params.content,
    });

  await fs.writeFile(filePath, html, "utf8");

  const response = await callDeviceOp({
    bridge: params.bridge,
    config: params.config,
    deviceId: params.deviceId,
    op: "set_local_portal",
    payload: { portal: pageName },
    timeoutMs: params.timeoutMs,
    expectResponse: true,
  });

  return { pageName, root, filePath, response };
}

// ============================================================================
// Client Operations
// ============================================================================

/**
 * Look up a client by MAC address in the device's client list.
 */
export async function lookupClientByMac(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceId: string;
  clientMac: string;
  timeoutMs?: number;
}): Promise<JsonRecord | null> {
  logToolInvocation(undefined, "lookupClientByMac", {
    deviceId: params.deviceId,
    clientMac: params.clientMac,
  });
  const response = await callDeviceOp({
    bridge: params.bridge,
    config: params.config,
    deviceId: params.deviceId,
    op: "get_clients",
    timeoutMs: params.timeoutMs,
  });

  // Import the normalizeMac function locally to avoid circular dependencies
  const { getClientsFromResponse, normalizeMac } = await import("./tool-parsers.js");
  const clients = getClientsFromResponse(response);
  const normalized = normalizeMac(params.clientMac);
  const found = clients.find((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const mac = (entry as JsonRecord).mac;
    return typeof mac === "string" && normalizeMac(mac) === normalized;
  });
  return found && typeof found === "object" && !Array.isArray(found) ? (found as JsonRecord) : null;
}

// ============================================================================
// WireGuard Operations
// ============================================================================

/**
 * Read WireGuard protected route plan file.
 */
export async function readWireguardProtectedRoutePlanFile(routePlanFile: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(routePlanFile, "utf8");
    const parsed = JSON.parse(raw) as JsonRecord;
    if (parsed?.version !== 1 || !Array.isArray(parsed.routePlans)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Collect WireGuard protected route plans from multiple devices.
 */
export async function collectWireguardProtectedRoutePlans(params: {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  deviceIds: string[];
  serverTunnelIp: string;
  timeoutMs?: number;
}): Promise<any> {
  const { parseIPv4Cidr, cidrOverlaps } = await import("./tool-validators.js");

  const deviceIds = [...new Set(params.deviceIds.map((id) => id.trim()).filter(Boolean))];
  if (deviceIds.length === 0) {
    throw new Error("At least one deviceId is required.");
  }

  const serverTunnel = parseIPv4Cidr(params.serverTunnelIp.trim());
  if (!serverTunnel) {
    throw new Error(`Invalid serverTunnelIp CIDR: ${params.serverTunnelIp}`);
  }

  const onlineDevices = new Map(
    (await getDevicesListViaChawrtd(params.config)).map(
      (entry) => [entry.deviceId.trim(), entry] as const,
    ),
  );

  const devices: Array<{
    deviceId: string;
    deviceName?: string;
    lanCidr?: string;
    error?: string;
  }> = [];

  for (const deviceId of deviceIds) {
    try {
      const result = await callDeviceOp({
        bridge: params.bridge,
        config: params.config,
        deviceId,
        op: "get_br_lan",
        timeoutMs: params.timeoutMs,
      });
      const cidr = (result as JsonRecord)?.cidr;
      const parsed = typeof cidr === "string" ? parseIPv4Cidr(cidr) : null;
      devices.push({
        deviceId,
        deviceName: getSnapshotDisplayName(onlineDevices.get(deviceId)),
        lanCidr: parsed?.normalized,
        error: parsed ? undefined : `missing_or_invalid_cidr: ${typeof cidr === "string" ? cidr : "(none)"}`,
      });
    } catch (error) {
      devices.push({
        deviceId,
        deviceName: getSnapshotDisplayName(onlineDevices.get(deviceId)),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const validDevices = devices.filter(
    (entry): entry is typeof entry & { lanCidr: string } =>
      typeof entry.lanCidr === "string" && !entry.error,
  );

  const conflicts: Array<{
    leftDeviceId: string;
    leftLanCidr: string;
    rightDeviceId: string;
    rightLanCidr: string;
  }> = [];
  const blockedDeviceIds = new Set<string>();

  for (let i = 0; i < validDevices.length; i += 1) {
    for (let j = i + 1; j < validDevices.length; j += 1) {
      const left = validDevices[i]!;
      const right = validDevices[j]!;
      const parsedLeft = parseIPv4Cidr(left.lanCidr);
      const parsedRight = parseIPv4Cidr(right.lanCidr);
      if (!parsedLeft || !parsedRight || !cidrOverlaps(parsedLeft, parsedRight)) {
        continue;
      }

      conflicts.push({
        leftDeviceId: left.deviceId,
        leftLanCidr: left.lanCidr,
        rightDeviceId: right.deviceId,
        rightLanCidr: right.lanCidr,
      });
      blockedDeviceIds.add(left.deviceId);
      blockedDeviceIds.add(right.deviceId);
    }
  }

  const routePlans =
    conflicts.length > 0
      ? []
      : validDevices.map((entry) => {
          const routes: string[] = [];
          const seenRoutes = new Set<string>();
          const pushRoute = (route: string) => {
            const normalized = route.trim();
            if (!normalized || seenRoutes.has(normalized)) {
              return;
            }
            seenRoutes.add(normalized);
            routes.push(normalized);
          };

          pushRoute(serverTunnel.normalized);
          for (const candidate of validDevices) {
            if (candidate.deviceId === entry.deviceId) {
              continue;
            }
            pushRoute(candidate.lanCidr);
          }

          return {
            deviceId: entry.deviceId,
            deviceName: entry.deviceName,
            lanCidr: entry.lanCidr,
            routes,
          };
        });

  const failedDevices = devices.filter((entry) => entry.error);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    serverTunnelIp: params.serverTunnelIp.trim(),
    serverTunnelCidr: serverTunnel.normalized,
    deviceIds,
    devices,
    failedDevices,
    conflicts,
    blockedDeviceIds: [...blockedDeviceIds],
    hasConflict: conflicts.length > 0,
    routePlans,
  };
}
