/**
 * Event notification formatting and delivery.
 *
 * Extracted from index.ts to keep the plugin entry point focused on
 * assembly + startup. This module owns the "device event → human-readable
 * notification → outbound delivery" pipeline.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationRoute = {
  channel: string;
  to: string;
};

export type DirectOutboundAdapter = {
  sendText?: (ctx: { cfg: unknown; to: string; text: string }) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Session key helpers
// ---------------------------------------------------------------------------

export function resolveSessionStoreKeys(sessionKey: string): string[] {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("agent:")) {
    return [trimmed];
  }
  return [trimmed, `agent:main:${trimmed}`];
}

// ---------------------------------------------------------------------------
// Notification routing
// ---------------------------------------------------------------------------

export function parseNotificationTarget(target: string | undefined): NotificationRoute | null {
  const trimmed = target?.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^([^:]+):(.+)$/);
  if (!match) {
    return null;
  }
  const channel = match[1]?.trim() ?? "";
  const to = match[2]?.trim() ?? "";
  if (!channel || !to) {
    return null;
  }
  return { channel, to };
}

// ---------------------------------------------------------------------------
// Direct outbound delivery
// ---------------------------------------------------------------------------

export async function deliverDeviceEventDirect(params: {
  cfg: unknown;
  loadAdapter: (channelId: string) => Promise<DirectOutboundAdapter | undefined>;
  route: NotificationRoute;
  message: string;
}) {
  const adapter = await params.loadAdapter(params.route.channel);
  if (!adapter?.sendText) {
    throw new Error(`Direct outbound sendText unavailable for channel ${params.route.channel}`);
  }
  return await adapter.sendText({
    cfg: params.cfg,
    to: params.route.to,
    text: params.message,
  });
}

// ---------------------------------------------------------------------------
// Event → message formatting
// ---------------------------------------------------------------------------

function formatEventTime(time?: number): string {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    return "";
  }
  const isoText = new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
  return `🕒 ${isoText} · `;
}

function parseConnectDurationMs(data: Record<string, unknown>): number | null {
  const raw = data.connect_duration_ms;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function parseDisconnectDurationMs(data: Record<string, unknown>): number | null {
  const raw = data.disconnect_duration_ms;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

/** Format a device push event as a human-readable notification message. */
export function formatDeviceEventMessage(
  deviceId: string,
  op: string,
  data: Record<string, unknown>,
  deviceAlias?: string,
  time?: number,
): string {
  const aliasSuffix = typeof deviceAlias === "string" && deviceAlias.trim() ? `（${deviceAlias.trim()}）` : "";
  const timePrefix = formatEventTime(time);
  switch (op) {
    case "client_connected": {
      const mac = typeof data.mac === "string" ? data.mac : (typeof data.client_mac === "string" ? data.client_mac : "unknown");
      const durationMs = parseConnectDurationMs(data);
      const durationSuffix = durationMs === null ? "" : `，连接耗时 ${durationMs}ms`;
      return `${timePrefix}📶 设备 \`${deviceId}\`${aliasSuffix} 上有新的 WiFi 客户端接入：MAC \`${mac}\`${durationSuffix}`;
    }
    case "client_ip_assigned": {
      const mac = typeof data.mac === "string" ? data.mac : (typeof data.client_mac === "string" ? data.client_mac : "unknown");
      const ip = typeof data.ip === "string" ? data.ip : (typeof data.client_ip === "string" ? data.client_ip : "unknown");
      const name = typeof data.name === "string" ? ` (${data.name})` : "";
      return `${timePrefix}🌐 设备 \`${deviceId}\`${aliasSuffix} 上的 DHCP 已分配 IP：MAC \`${mac}\`，IP \`${ip}\`${name}`;
    }
    case "client_disconnected": {
      const mac = typeof data.mac === "string" ? data.mac : (typeof data.client_mac === "string" ? data.client_mac : "unknown");
      const durationMs = parseDisconnectDurationMs(data);
      const durationSuffix = durationMs === null ? "" : `，断开耗时 ${durationMs}ms`;
      return `${timePrefix}🔌 设备 \`${deviceId}\`${aliasSuffix} 上的 WiFi 客户端已断开：MAC \`${mac}\`${durationSuffix}`;
    }
    case "net_link_up": {
      const iface = typeof data.interface === "string" ? data.interface : (typeof data.iface === "string" ? data.iface : "unknown");
      const dev = typeof data.device === "string" ? data.device : "";
      return `${timePrefix}🌐 设备 \`${deviceId}\`${aliasSuffix} 的网络链路已恢复：接口 \`${iface}\`${dev ? `，设备 \`${dev}\`` : ""}`;
    }
    case "net_link_down": {
      const iface = typeof data.interface === "string" ? data.interface : (typeof data.iface === "string" ? data.iface : "unknown");
      const dev = typeof data.device === "string" ? data.device : "";
      return `${timePrefix}🚫 设备 \`${deviceId}\`${aliasSuffix} 的网络链路已断开：接口 \`${iface}\`${dev ? `，设备 \`${dev}\`` : ""}`;
    }
    case "usb_storage_attached": {
      const product = typeof data.product === "string" ? data.product : "unknown";
      const devname = typeof data.devname === "string" ? data.devname : (typeof data.device === "string" ? data.device : "");
      return `${timePrefix}💽 设备 \`${deviceId}\`${aliasSuffix} 检测到 USB 存储已接入：产品 \`${product}\`${devname ? `，设备 \`${devname}\`` : ""}`;
    }
    case "usb_storage_detached": {
      const product = typeof data.product === "string" ? data.product : "unknown";
      const devname = typeof data.devname === "string" ? data.devname : (typeof data.device === "string" ? data.device : "");
      return `${timePrefix}🧷 设备 \`${deviceId}\`${aliasSuffix} 的 USB 存储已移除：产品 \`${product}\`${devname ? `，设备 \`${devname}\`` : ""}`;
    }
    default:
      return `${timePrefix}📡 来自设备 \`${deviceId}\`${aliasSuffix} 的事件 \`${op}\`：${JSON.stringify(data)}`;
  }
}

export function summarizeEventData(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  return keys.length > 0 ? keys.join(",") : "<empty>";
}
