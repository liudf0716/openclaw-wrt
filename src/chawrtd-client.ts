/**
 * ChawrtdClient: Encapsulates HTTP communication with the chawrtd gateway
 * and device operations. Replaces the module-level global state pattern
 * in tool-chawrtd.ts with an explicit dependency container.
 *
 * During migration, tool-chawrtd.ts retains backward-compatible wrapper
 * functions that delegate to a default ChawrtdClient instance. Once all
 * tool domains use ChawrtdClient directly, the wrappers and module-level
 * state can be removed.
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
  Logger,
} from "./tool-types.js";
import {
  asObject,
  getSnapshotDisplayName,
  parseChawrtdDeviceSnapshot,
  buildToolResult,
  resolvePortalWebRoot,
  buildPortalPageName,
} from "./tool-parsers.js";

const DEFAULT_CHAWRTD_BASE_URL = "http://127.0.0.1:8001";

export class ChawrtdClient {
  private readonly baseUrl: string;
  private readonly logger?: Logger;
  private readonly config?: ResolvedClawWRTConfig;
  private readonly bridge?: ClawWRTBridge;

  constructor(opts: {
    config?: ResolvedClawWRTConfig;
    bridge?: ClawWRTBridge;
    logger?: Logger;
  }) {
    this.config = opts.config;
    this.bridge = opts.bridge;
    this.logger = opts.logger;
    this.baseUrl = (
      opts.config?.chawrtdEventStream?.baseUrl ?? DEFAULT_CHAWRTD_BASE_URL
    ).replace(/\/+$/, "");
  }

  // ==========================================================================
  // HTTP Communication
  // ==========================================================================

  async call(params: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  }): Promise<ChawrtdToolResult> {
    const controller = new AbortController();
    const timeoutMs = params.timeoutMs ?? 180_000;
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${params.path}`, {
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

  // ==========================================================================
  // Device Discovery
  // ==========================================================================

  async listDevices(): Promise<DeviceSnapshot[]> {
    const bridge = this.bridge as
      | {
          listDevices?: () => Array<{ deviceId?: string } & Partial<DeviceSnapshot>>;
          getDevice?: (deviceId: string) => DeviceSnapshot | null;
        }
      | undefined;

    if (!this.config && typeof bridge?.listDevices === "function") {
      const listedDevices = bridge.listDevices();
      if (typeof bridge.getDevice !== "function") {
        return listedDevices.filter((entry): entry is DeviceSnapshot => Boolean(entry?.deviceId));
      }
      const getDevice = bridge.getDevice;
      const resolvedDevices = await Promise.all(
        listedDevices.map(async (entry) => {
          const deviceId = entry?.deviceId?.trim();
          if (!deviceId) return null;
          return (await getDevice(deviceId)) ?? (entry as DeviceSnapshot);
        }),
      );
      return resolvedDevices.filter((entry): entry is DeviceSnapshot => entry !== null);
    }

    try {
      const response = await this.call({ path: "/v1/devices", method: "GET" });
      const dataWrapped = asObject(response.data);
      const topLevel = asObject(response);
      const devices = Array.isArray(dataWrapped?.devices)
        ? dataWrapped.devices
        : Array.isArray(topLevel?.devices)
          ? topLevel.devices
          : [];
      return devices
        .map((entry) => parseChawrtdDeviceSnapshot(entry))
        .filter((entry): entry is DeviceSnapshot => entry !== null);
    } catch (error) {
      console.error("Failed to get devices list from chawrtd:", error);
      return [];
    }
  }

  async getDevice(deviceId: string): Promise<DeviceSnapshot | null> {
    const bridge = this.bridge as
      | { getDevice?: (deviceId: string) => DeviceSnapshot | null }
      | undefined;
    if (!this.config && typeof bridge?.getDevice === "function") {
      return bridge.getDevice(deviceId);
    }
    try {
      const response = await this.call({ path: `/v1/device/${deviceId}`, method: "GET" });
      return parseChawrtdDeviceSnapshot(response.data ?? response);
    } catch (error) {
      console.error(`Failed to get device ${deviceId} from chawrtd:`, error);
      return null;
    }
  }

  async ensureDevice(deviceId: string): Promise<DeviceSnapshot> {
    const device = await this.getDevice(deviceId);
    if (!device) throw new Error(`device not connected: ${deviceId}`);
    return device;
  }

  // ==========================================================================
  // Device Operations
  // ==========================================================================

  async callDeviceOp(params: {
    deviceId: string;
    op: string;
    payload?: JsonRecord;
    timeoutMs?: number;
    expectResponse?: boolean;
  }): Promise<JsonRecord> {
    this.logger?.info?.(
      `openclaw-wrt: tool invoked name=callDeviceOp rawParams=${JSON.stringify({ deviceId: params.deviceId, op: params.op, payload: params.payload })}`,
    );

    const bridge = this.bridge as
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

    if (!this.config && typeof bridge?.callDevice === "function") {
      return await bridge.callDevice({
        deviceId: params.deviceId,
        op: params.op,
        payload: params.payload,
        timeoutMs: params.timeoutMs,
        expectResponse: params.expectResponse,
      });
    }

    return this.callDeviceOpViaChawrtd(params);
  }

  async callDeviceOpViaChawrtd(params: {
    deviceId: string;
    op: string;
    payload?: JsonRecord;
    timeoutMs?: number;
  }): Promise<JsonRecord> {
    this.logger?.info?.(
      `openclaw-wrt: tool invoked name=callDeviceOpViaChawrtd rawParams=${JSON.stringify({ deviceId: params.deviceId, op: params.op })}`,
    );

    const response = await this.call({
      path: `/v1/device/${params.deviceId}/${params.op}`,
      method: "POST",
      body: params.payload ?? {},
      timeoutMs: params.timeoutMs,
    });

    if (response.error) throw new Error(response.error);
    return response.data ?? response;
  }

  async restartXfrpcService(deviceId: string, timeoutMs?: number): Promise<JsonRecord> {
    return this.callDeviceOp({ deviceId, op: "restart_xfrpc", timeoutMs });
  }

  // ==========================================================================
  // Portal Page Operations
  // ==========================================================================

  async getVpsPublicIp(timeoutMs?: number): Promise<string | null> {
    try {
      const response = await this.call({
        path: "/v1/vps/public-ip",
        method: "GET",
        timeoutMs: timeoutMs ?? 10_000,
      });
      const dataObj = asObject(response.data);
      const publicIp = dataObj?.publicIp;
      if (typeof publicIp === "string" && publicIp.trim()) return publicIp.trim();
      return null;
    } catch (error) {
      console.warn("Failed to get VPS public IP from chawrtd:", error);
      return null;
    }
  }

  async publishPortalPage(params: {
    deviceId: string;
    html: string;
    pageName?: string;
    webRoot?: string;
    timeoutMs?: number;
  }): Promise<{ pageName: string; root: string; filePath: string; response: JsonRecord }> {
    const pageName = buildPortalPageName(params.deviceId, params.pageName);
    const root = await resolvePortalWebRoot(params.webRoot);
    const filePath = path.join(root, pageName);
    const html = params.html.trim();
    if (!html) throw new Error("publishPortalPage requires non-empty html");

    await fs.writeFile(filePath, html, "utf8");

    const shouldFetchPublicIp = !this.bridge && this.config;
    let portalUrl = pageName;
    if (shouldFetchPublicIp) {
      const publicIp = await this.getVpsPublicIp(params.timeoutMs);
      if (publicIp) portalUrl = `http://${publicIp}/${pageName}`;
    }

    const response = await this.callDeviceOp({
      deviceId: params.deviceId,
      op: "set_local_portal",
      payload: { portal: portalUrl },
      timeoutMs: params.timeoutMs,
      expectResponse: true,
    });

    return { pageName, root, filePath, response };
  }

  // ==========================================================================
  // Client Operations
  // ==========================================================================

  async lookupClientByMac(params: {
    deviceId: string;
    clientMac: string;
    timeoutMs?: number;
  }): Promise<JsonRecord | null> {
    const { getClientsFromResponse, normalizeMac } = await import("./tool-parsers.js");
    const response = await this.callDeviceOp({
      deviceId: params.deviceId,
      op: "get_clients",
      timeoutMs: params.timeoutMs,
    });
    const clients = getClientsFromResponse(response);
    const normalized = normalizeMac(params.clientMac);
    const found = clients.find((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const mac = (entry as JsonRecord).mac;
      return typeof mac === "string" && normalizeMac(mac) === normalized;
    });
    return found && typeof found === "object" && !Array.isArray(found) ? (found as JsonRecord) : null;
  }

  // ==========================================================================
  // WireGuard Operations
  // ==========================================================================

  static getProtectedRoutePlanFile(): string {
    return path.join(os.tmpdir(), "openclaw-wrt-wireguard-protected-routes.json");
  }

  async readProtectedRoutePlanFile(routePlanFile?: string): Promise<JsonRecord | null> {
    const file = routePlanFile ?? ChawrtdClient.getProtectedRoutePlanFile();
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as JsonRecord;
      if (parsed?.version !== 1 || !Array.isArray(parsed.routePlans)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async collectProtectedRoutePlans(params: {
    deviceIds: string[];
    serverTunnelIp: string;
    timeoutMs?: number;
  }): Promise<JsonRecord> {
    const { parseIPv4Cidr, cidrOverlaps } = await import("./tool-validators.js");

    const deviceIds = [...new Set(params.deviceIds.map((id) => id.trim()).filter(Boolean))];
    if (deviceIds.length === 0) throw new Error("At least one deviceId is required.");

    const serverTunnel = parseIPv4Cidr(params.serverTunnelIp.trim());
    if (!serverTunnel) throw new Error(`Invalid serverTunnelIp CIDR: ${params.serverTunnelIp}`);

    const onlineDevices = new Map(
      (await this.listDevices()).map((entry) => [entry.deviceId.trim(), entry] as const),
    );

    const devices: Array<{ deviceId: string; deviceName?: string; lanCidr?: string; error?: string }> = [];

    for (const deviceId of deviceIds) {
      try {
        const result = await this.callDeviceOp({ deviceId, op: "get_br_lan", timeoutMs: params.timeoutMs });
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
      (e): e is typeof e & { lanCidr: string } => typeof e.lanCidr === "string" && !e.error,
    );

    const conflicts: Array<{ leftDeviceId: string; leftLanCidr: string; rightDeviceId: string; rightLanCidr: string }> = [];
    const blockedDeviceIds = new Set<string>();

    for (let i = 0; i < validDevices.length; i++) {
      for (let j = i + 1; j < validDevices.length; j++) {
        const left = validDevices[i]!;
        const right = validDevices[j]!;
        const parsedLeft = parseIPv4Cidr(left.lanCidr);
        const parsedRight = parseIPv4Cidr(right.lanCidr);
        if (!parsedLeft || !parsedRight || !cidrOverlaps(parsedLeft, parsedRight)) continue;
        conflicts.push({
          leftDeviceId: left.deviceId, leftLanCidr: left.lanCidr,
          rightDeviceId: right.deviceId, rightLanCidr: right.lanCidr,
        });
        blockedDeviceIds.add(left.deviceId);
        blockedDeviceIds.add(right.deviceId);
      }
    }

    const routePlans = conflicts.length > 0
      ? []
      : validDevices.map((entry) => {
          const routes: string[] = [];
          const seenRoutes = new Set<string>();
          const pushRoute = (route: string) => {
            const normalized = route.trim();
            if (!normalized || seenRoutes.has(normalized)) return;
            seenRoutes.add(normalized);
            routes.push(normalized);
          };
          pushRoute(serverTunnel.normalized);
          for (const candidate of validDevices) {
            if (candidate.deviceId === entry.deviceId) continue;
            pushRoute(candidate.lanCidr);
          }
          return { deviceId: entry.deviceId, deviceName: entry.deviceName, lanCidr: entry.lanCidr, routes };
        });

    const failedDevices = devices.filter((e) => e.error);

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
}

export function getSingleGatewayId(device: DeviceSnapshot): string | undefined {
  const gateways = Array.isArray(device.gateway) ? device.gateway : [];
  if (gateways.length !== 1) return undefined;
  const gateway = gateways[0];
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) return undefined;
  const gwId = (gateway as JsonRecord).gw_id;
  return typeof gwId === "string" && gwId.trim() ? gwId.trim() : undefined;
}
