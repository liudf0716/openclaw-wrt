/**
 * ChawrtdClient: HTTP communication layer for the chawrtd gateway.
 *
 * Handles device discovery, device operations, and HTTP transport.
 * Business logic (portal publishing, client lookup, WireGuard route plans)
 * lives in domain-specific tool files that use this client.
 *
 * A module-level singleton with backward-compatible wrapper functions
 * is provided for tool files that import named functions directly.
 */

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
  parseChawrtdDeviceSnapshot,
} from "./tool-parsers.js";

const DEFAULT_CHAWRTD_BASE_URL = "http://127.0.0.1:8001";

/**
 * Redact sensitive fields (keys, tokens, passwords) from a payload object for safe logging.
 * Returns a shallow copy with sensitive values replaced by "[REDACTED]".
 */
function redactSensitiveFields(payload?: JsonRecord): JsonRecord | undefined {
  if (!payload) return undefined;
  const SENSITIVE_KEYS = /key|token|password|secret|private/i;
  const redacted: JsonRecord = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && SENSITIVE_KEYS.test(k)) {
      redacted[k] = "[REDACTED]";
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

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
  // Accessors
  // ==========================================================================

  hasBridge(): boolean {
    return Boolean(this.bridge);
  }

  // ==========================================================================
  // HTTP Communication
  // ==========================================================================

  async call(params: {
    path: string;
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<ChawrtdToolResult> {
    const controller = new AbortController();
    const timeoutMs = params.timeoutMs ?? 180_000;
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    // Forward external abort signal to internal controller
    if (params.signal) {
      if (params.signal.aborted) {
        clearTimeout(timeoutHandle);
        throw new Error("aborted");
      }
      params.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

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
      this.logger?.warn?.(`Failed to get devices list from chawrtd: ${String(error)}`);
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
      this.logger?.warn?.(`Failed to get device ${deviceId} from chawrtd: ${String(error)}`);
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
    signal?: AbortSignal;
  }): Promise<JsonRecord> {
    this.logger?.info?.(
      `openclaw-wrt: tool invoked name=callDeviceOp rawParams=${JSON.stringify({ deviceId: params.deviceId, op: params.op, payload: redactSensitiveFields(params.payload) })}`,
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

    return this.callDeviceOpViaChawrtd({ ...params, signal: params.signal });
  }

  async callDeviceDiagnose(params: {
    deviceId: string;
    kind: "dhcp" | "dns" | "http" | "https";
    payload?: JsonRecord;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<JsonRecord> {
    const bridge = this.bridge as
      | {
          callDeviceDiagnose?: (input: {
            deviceId: string;
            kind: "dhcp" | "dns" | "http" | "https";
            payload?: JsonRecord;
            timeoutMs?: number;
          }) => Promise<JsonRecord>;
        }
      | undefined;

    if (!this.config && typeof bridge?.callDeviceDiagnose === "function") {
      return await bridge.callDeviceDiagnose({
        deviceId: params.deviceId,
        kind: params.kind,
        payload: params.payload,
        timeoutMs: params.timeoutMs,
      });
    }

    const response = await this.call({
      path: `/v1/device/${params.deviceId}/diagnose/${params.kind}`,
      method: "POST",
      body: params.payload ?? {},
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });

    if (response.error) throw new Error(response.error);
    return response.data ?? response;
  }

  async callDeviceOpViaChawrtd(params: {
    deviceId: string;
    op: string;
    payload?: JsonRecord;
    timeoutMs?: number;
    signal?: AbortSignal;
    expectResponse?: boolean;
  }): Promise<JsonRecord> {
    this.logger?.info?.(
      `openclaw-wrt: tool invoked name=callDeviceOpViaChawrtd rawParams=${JSON.stringify({ deviceId: params.deviceId, op: params.op })}`,
    );

    const body: JsonRecord = {
      ...(params.payload ?? {}),
    };
    if (params.expectResponse === false) {
      body.__expect_response = false;
    }

    const response = await this.call({
      path: `/v1/device/${params.deviceId}/${params.op}`,
      method: "POST",
      body,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
    });

    if (response.error) throw new Error(response.error);
    return response.data ?? response;
  }

  // ==========================================================================
  // Client Operations
  // ==========================================================================

}

function getSingleGatewayId(device: DeviceSnapshot): string | undefined {
  const gateways = Array.isArray(device.gateway) ? device.gateway : [];
  if (gateways.length !== 1) return undefined;
  const gateway = gateways[0];
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) return undefined;
  const gwId = (gateway as JsonRecord).gw_id;
  return typeof gwId === "string" && gwId.trim() ? gwId.trim() : undefined;
}

// ============================================================================
// Module-level singleton (backward compatibility)
// ============================================================================

let _defaultClient: ChawrtdClient | undefined;

export function getDefaultChawrtdClient(): ChawrtdClient {
  if (!_defaultClient) {
    _defaultClient = new ChawrtdClient({});
  }
  return _defaultClient;
}

function setDefaultChawrtdClient(client: ChawrtdClient): void {
  _defaultClient = client;
}

// Backward-compatible wrapper functions (delegate to default client)
// These allow domain files to import functions instead of using the class directly.

export function setActiveBridgeFallback(bridge: ClawWRTBridge | undefined): void {
  // Recreate the default client with the new bridge
  const existing = _defaultClient;
  _defaultClient = new ChawrtdClient({
    bridge,
    config: existing?.['config'] as ResolvedClawWRTConfig | undefined,
    logger: existing?.['logger'] as Logger | undefined,
  });
}

export function setActiveClawWRTConfig(config: ResolvedClawWRTConfig | undefined): void {
  const existing = _defaultClient;
  _defaultClient = new ChawrtdClient({
    config,
    bridge: existing?.['bridge'] as ClawWRTBridge | undefined,
    logger: existing?.['logger'] as Logger | undefined,
  });
}

function setActiveToolLogger(logger: Logger | undefined): void {
  const existing = _defaultClient;
  _defaultClient = new ChawrtdClient({
    logger,
    config: existing?.['config'] as ResolvedClawWRTConfig | undefined,
    bridge: existing?.['bridge'] as ClawWRTBridge | undefined,
  });
}

export async function callChawrtd(params: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ChawrtdToolResult> {
  return getDefaultChawrtdClient().call(params);
}

export async function getDevicesListViaChawrtd(config?: ResolvedClawWRTConfig): Promise<DeviceSnapshot[]> {
  return getDefaultChawrtdClient().listDevices();
}

export async function getDeviceViaChawrtd(
  deviceId: string,
  config?: ResolvedClawWRTConfig,
): Promise<DeviceSnapshot | null> {
  return getDefaultChawrtdClient().getDevice(deviceId);
}

export async function ensureDevice(
  deviceId: string,
  config?: ResolvedClawWRTConfig,
): Promise<DeviceSnapshot> {
  return getDefaultChawrtdClient().ensureDevice(deviceId);
}

export async function callDeviceOp(params: {
  deviceId: string;
  op: string;
  payload?: JsonRecord;
  timeoutMs?: number;
  expectResponse?: boolean;
  signal?: AbortSignal;
}): Promise<JsonRecord> {
  return getDefaultChawrtdClient().callDeviceOp({
    deviceId: params.deviceId,
    op: params.op,
    payload: params.payload,
    timeoutMs: params.timeoutMs,
    expectResponse: params.expectResponse,
    signal: params.signal,
  });
}

export async function callDeviceDiagnose(params: {
  deviceId: string;
  kind: "dhcp" | "dns" | "http" | "https";
  payload?: JsonRecord;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<JsonRecord> {
  return getDefaultChawrtdClient().callDeviceDiagnose({
    deviceId: params.deviceId,
    kind: params.kind,
    payload: params.payload,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
}

async function callDeviceOpViaChawrtd(params: {
  deviceId: string;
  op: string;
  payload?: JsonRecord;
  timeoutMs?: number;
  expectResponse?: boolean;
}): Promise<JsonRecord> {
  return getDefaultChawrtdClient().callDeviceOpViaChawrtd(params);
}

function getChawrtdBaseUrl(config?: ResolvedClawWRTConfig): string {
  const base = config?.chawrtdEventStream?.baseUrl ?? "http://127.0.0.1:8001";
  return base.replace(/\/+$/, "");
}
