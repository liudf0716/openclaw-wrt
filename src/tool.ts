import { promises as fs, constants as fsConstants } from "node:fs";
import { isIPv4 } from "node:net";
import os from "node:os";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ClawWRTBridge, DeviceSnapshot } from "./manager.js";
import {
  PORTAL_TEMPLATE_VALUES,
  renderPortalPageHtml,
  type PortalContent as PortalContentType,
  type PortalTemplate as PortalTemplateType,
} from "./portal-page-renderer.js";

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function getClientsFromResponse(response: JsonRecord): unknown[] {
  if (Array.isArray(response.clients)) {
    return response.clients;
  }
  const data = asObject(response.data);
  return Array.isArray(data?.clients) ? data.clients : [];
}

function redactFrpsConfigContent(configContent: string): string {
  return configContent.replace(/^(auth\.token\s*=\s*).+$/gim, '$1"[REDACTED]"');
}

type ExecSyncRunner = (command: string, options?: unknown) => string | Uint8Array;

function detectServerEgressInterface(execSync: ExecSyncRunner): string {
  const probes = [
    "ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") {print $(i+1); exit}}'",
    "ip -4 route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") {print $(i+1); exit}}'",
  ];
  for (const probe of probes) {
    try {
      const value = String(execSync(probe, { encoding: "utf-8", timeout: 5000 })).trim();
      if (value) {
        return value;
      }
    } catch {
      // Ignore probe failures and continue with other strategies.
    }
  }
  return "";
}

function listServerInterfacesWithIp(execSync: ExecSyncRunner): string {
  try {
    const output = String(
      execSync("ip -o -4 addr show scope global 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
      }),
    ).trim();
    if (!output) {
      return "(no global IPv4 interface found)";
    }
    const lines = output
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 4)
      .map((parts) => `${parts[1]} ${parts[3]}`);
    return lines.length > 0 ? lines.join("\n") : "(no global IPv4 interface found)";
  } catch {
    return "(failed to list interfaces via `ip -o -4 addr show` )";
  }
}

function detectRecommendedServerInterface(execSync: ExecSyncRunner): string {
  try {
    const output = String(
      execSync("ip -o -4 addr show scope global up 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      }),
    ).trim();
    if (!output) {
      return "";
    }
    const lines = output.split("\n").map((line) => line.trim().split(/\s+/));
    for (const parts of lines) {
      if (parts.length < 4) {
        continue;
      }
      const iface = parts[1];
      if (!iface || iface === "lo") {
        continue;
      }
      if (/^[a-zA-Z0-9.\-_@]+$/.test(iface)) {
        return iface;
      }
    }
  } catch {
    // Ignore fallback detection errors.
  }
  return "";
}

const DeviceIdField = Type.String({
  minLength: 1,
  description: "Target openclaw-wrt device_id.",
});
const TimeoutField = Type.Optional(
  Type.Integer({
    minimum: 1000,
    maximum: 120_000,
    description: "Request timeout in milliseconds.",
  }),
);

const GenericToolSchema = Type.Object(
  {
    action: stringEnum(["list_devices", "get_device", "call"] as const, {
      description: "Action to perform: list_devices, get_device, or call.",
    }),
    deviceId: Type.Optional(DeviceIdField),
    op: Type.Optional(
      Type.String({ minLength: 1, description: "Exact openclaw-wrt operation name." }),
    ),
    payload: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: "Additional JSON fields to include with the device request.",
      }),
    ),
    timeoutMs: TimeoutField,
    expectResponse: Type.Optional(
      Type.Boolean({ description: "Override whether the request waits for a response." }),
    ),
  },
  { additionalProperties: false },
);

const DeviceOnlySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const ClientInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address." }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const AuthClientSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address to authorize." }),
    clientIp: Type.String({ minLength: 1, description: "Client IP address to authorize." }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const KickoffClientSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address to disconnect." }),
    clientIp: Type.Optional(
      Type.String({ minLength: 1, description: "Client IPv4 address if already known." }),
    ),
    gwId: Type.Optional(Type.String({ minLength: 1, description: "Gateway ID if already known." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const WifiConfigDataField = Type.Object(
  {
    ssid: Type.Optional(
      Type.String({ minLength: 1, description: "Wi-Fi SSID (network name) to set." }),
    ),
    radio: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Radio interface name (e.g., 'radio0', 'radio1').",
      }),
    ),
    interface: Type.Optional(
      Type.String({ minLength: 1, description: "Wireless interface name (e.g., 'wifnet0')." }),
    ),
    encryption: Type.Optional(
      Type.String({ description: "Encryption type (e.g., 'psk2', 'none')." }),
    ),
    key: Type.Optional(Type.String({ description: "Wi-Fi password/key." })),
    hidden: Type.Optional(Type.Boolean({ description: "Whether to hide the SSID." })),
  },
  { additionalProperties: true, description: "Wi-Fi configuration fields to update." },
);

const SetWifiInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    data: WifiConfigDataField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetAuthServerSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    hostname: Type.String({ minLength: 1, description: "Authentication server hostname." }),
    port: Type.Optional(Type.String({ minLength: 1, description: "Authentication server port." })),
    path: Type.Optional(Type.String({ minLength: 1, description: "Authentication server path." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const PortalTemplateField = stringEnum(PORTAL_TEMPLATE_VALUES, {
  description:
    "Portal page template. default:通用弹出页, welcome:品牌承接/品宣, business:企业/办公网络, cafe:餐饮场景, hotel:酒店宾客, terms:条款确认, voucher:券码口令输入, event:活动推广页. 不明确时默认用 default.",
});

const PortalContentSchema = Type.Object(
  {
    brandName: Type.Optional(Type.String({ minLength: 1, description: "Brand or venue name." })),
    networkName: Type.Optional(Type.String({ minLength: 1, description: "Wi-Fi network name." })),
    venueName: Type.Optional(Type.String({ minLength: 1, description: "Venue or location name." })),
    title: Type.Optional(Type.String({ minLength: 1, description: "Primary page title." })),
    body: Type.Optional(Type.String({ minLength: 1, description: "Primary supporting copy." })),
    buttonText: Type.Optional(Type.String({ minLength: 1, description: "Primary action label." })),
    footerText: Type.Optional(Type.String({ minLength: 1, description: "Footer support text." })),
    supportText: Type.Optional(
      Type.String({ minLength: 1, description: "Additional helper copy." }),
    ),
    voucherLabel: Type.Optional(
      Type.String({ minLength: 1, description: "Voucher or code field label." }),
    ),
    voucherHint: Type.Optional(
      Type.String({ minLength: 1, description: "Voucher input hint text." }),
    ),
    rules: Type.Optional(Type.Array(Type.String({ minLength: 1, description: "Rule item." }))),
    accentColor: Type.Optional(Type.String({ minLength: 1, description: "Primary accent color." })),
  },
  { additionalProperties: false },
);

const PublishPortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    html: Type.Optional(
      Type.String({ minLength: 1, description: "Optional complete portal HTML content." }),
    ),
    template: Type.Optional(PortalTemplateField),
    content: Type.Optional(PortalContentSchema),
    pageName: Type.Optional(
      Type.String({ minLength: 1, description: "Optional HTML file name for the portal page." }),
    ),
    webRoot: Type.Optional(
      Type.String({ minLength: 1, description: "Optional nginx web root override." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const GeneratePortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    template: Type.Optional(PortalTemplateField),
    content: Type.Optional(PortalContentSchema),
    pageName: Type.Optional(
      Type.String({ minLength: 1, description: "Optional HTML file name for the portal page." }),
    ),
    webRoot: Type.Optional(
      Type.String({ minLength: 1, description: "Optional nginx web root override." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetMqttServerSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    hostname: Type.Optional(Type.String({ minLength: 1, description: "MQTT server hostname." })),
    port: Type.Optional(Type.String({ minLength: 1, description: "MQTT server port." })),
    username: Type.Optional(Type.String({ minLength: 1, description: "MQTT username." })),
    password: Type.Optional(Type.String({ minLength: 1, description: "MQTT password." })),
    useSsl: Type.Optional(Type.Boolean({ description: "Whether to enable MQTT TLS/SSL." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetWebsocketServerSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    hostname: Type.Optional(
      Type.String({ minLength: 1, description: "WebSocket server hostname." }),
    ),
    port: Type.Optional(Type.String({ minLength: 1, description: "WebSocket server port." })),
    path: Type.Optional(Type.String({ minLength: 1, description: "WebSocket path (e.g., /ws)." })),
    useSsl: Type.Optional(Type.Boolean({ description: "Whether to enable WSS." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const WireguardInterfaceSchema = Type.Object(
  {
    privateKey: Type.Optional(
      Type.String({ minLength: 1, description: "WireGuard private key (maps to private_key)." }),
    ),
    listenPort: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 65535,
        description: "WireGuard listen port (maps to listen_port).",
      }),
    ),
    addresses: Type.Optional(
      Type.Array(
        Type.String({ minLength: 1, description: "Tunnel address CIDR, e.g. 10.0.0.1/24." }),
      ),
    ),
    mtu: Type.Optional(Type.Integer({ minimum: 68, maximum: 9000 })),
    fwmark: Type.Optional(Type.String({ minLength: 1 })),
  },
  {
    additionalProperties: true,
    description: "WireGuard interface settings for wg0.",
  },
);

const WireguardPeerSchema = Type.Object(
  {
    publicKey: Type.Optional(
      Type.String({ minLength: 1, description: "Peer public key (maps to public_key)." }),
    ),
    presharedKey: Type.Optional(
      Type.String({ minLength: 1, description: "Peer PSK (maps to preshared_key)." }),
    ),
    allowedIps: Type.Optional(
      Type.Array(
        Type.String({ minLength: 1, description: "Allowed CIDR list (maps to allowed_ips)." }),
      ),
    ),
    endpointHost: Type.Optional(Type.String({ minLength: 1, description: "Peer endpoint host." })),
    endpointPort: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 65535, description: "Peer endpoint port." }),
    ),
    persistentKeepalive: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 65535,
        description: "Keepalive interval seconds (maps to persistent_keepalive).",
      }),
    ),
    routeAllowedIps: Type.Optional(
      Type.Boolean({
        description:
          "Whether netifd should auto-create kernel routes from AllowedIPs (maps to route_allowed_ips). Set to false when managing routes explicitly via set_vpn_routes.",
      }),
    ),
  },
  {
    additionalProperties: true,
    description: "One WireGuard peer section for wireguard_wg0.",
  },
);

const SetWireguardVpnSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    interface: WireguardInterfaceSchema,
    peers: Type.Optional(Type.Array(WireguardPeerSchema)),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
const JsonObjectField = Type.Record(Type.String(), Type.Unknown(), {
  description: "Arbitrary JSON object payload.",
});

const StringArrayField = Type.Array(Type.String({ minLength: 1 }));
const BandField = optionalStringEnum(["2g", "5g"] as const, {
  description: "Wi-Fi band to scan: 2g or 5g.",
});
const BpfTableField = stringEnum(["ipv4", "ipv6", "mac"] as const, {
  description: "BPF table to target: ipv4, ipv6, or mac.",
});
const BpfJsonTableField = stringEnum(["ipv4", "ipv6", "mac", "sid", "l7"] as const, {
  description: "BPF JSON table to query: ipv4, ipv6, mac, sid, or l7.",
});

const UpdateDeviceInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    deviceInfo: JsonObjectField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const TmpPassSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({
      minLength: 1,
      description: "Client MAC address to temporarily allow.",
    }),
    timeout: Type.Optional(
      Type.Integer({ minimum: 1, description: "Temporary allow duration in seconds." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const ScanWifiSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    band: BandField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetWifiRelaySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    ssid: Type.String({ minLength: 1 }),
    key: Type.Optional(Type.String()),
    band: BandField,
    encryption: Type.Optional(Type.String()),
    bssid: Type.Optional(Type.String()),
    apply: Type.Optional(Type.Boolean()),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const DomainSyncSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    domains: StringArrayField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const TrustedMacSyncSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    macs: StringArrayField,
    values: Type.Optional(StringArrayField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const FirmwareUpgradeSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    url: Type.String({ minLength: 1, description: "Firmware image URL." }),
    force: Type.Optional(Type.Boolean({ description: "Force upgrade." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const DeleteWifiRelaySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    apply: Type.Optional(Type.Boolean({ description: "Apply changes immediately." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const ShellCommandSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    command: Type.String({ minLength: 1, maxLength: 4096 }),
    userConfirmed: Type.Boolean({
      description:
        "MUST be true to execute. You MUST first show the exact command to the user and receive an explicit confirmation ('yes'/'确认'/'执行' etc.) before setting this to true. Setting this to true without user confirmation is a security violation.",
    }),
    timeoutSeconds: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 120,
        description: "Device-side shell execution timeout in seconds.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfAddSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    address: Type.String({
      minLength: 1,
      description: "IPv4, IPv6, or MAC target to add to BPF monitoring.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfJsonSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfJsonTableField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfDeleteSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    address: Type.String({
      minLength: 1,
      description: "IPv4, IPv6, or MAC target to remove from BPF monitoring.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfFlushSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfUpdateSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    target: Type.String({
      minLength: 1,
      description: "IPv4, IPv6, or MAC target whose rate limits will be updated.",
    }),
    downrate: Type.Integer({
      minimum: 1,
      maximum: 10_000_000_000,
      description: "Download rate limit in bps.",
    }),
    uprate: Type.Integer({
      minimum: 1,
      maximum: 10_000_000_000,
      description: "Upload rate limit in bps.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const BpfUpdateAllSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    downrate: Type.Integer({
      minimum: 1,
      maximum: 10_000_000_000,
      description: "Download rate limit in bps for all entries in the table.",
    }),
    uprate: Type.Integer({
      minimum: 1,
      maximum: 10_000_000_000,
      description: "Upload rate limit in bps for all entries in the table.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetXfrpcCommonSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    enabled: Type.Optional(Type.String({ description: "'0' or '1'." })),
    loglevel: Type.Optional(Type.String({ description: "Log level, e.g., '7'." })),
    server_addr: Type.Optional(
      Type.String({
        description:
          "FRPS server public IP or domain. MUST be explicitly provided by the user. Do not guess or use local IP.",
      }),
    ),
    server_port: Type.Optional(Type.String({ description: "FRPS server port." })),
    token: Type.Optional(
      Type.String({
        description:
          "Authentication token. MUST be auto-generated by the Agent as a random string BEFORE calling this tool. NEVER ask the user for this value. If the user explicitly provides a token, use theirs instead.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const AddXfrpcTcpServiceSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    name: Type.String({ minLength: 1, description: "Unique service name string." }),
    enabled: Type.Optional(Type.String({ description: "'0' or '1'." })),
    local_ip: Type.Optional(Type.String({ description: "Local IP to forward." })),
    local_port: Type.Optional(Type.String({ description: "Local port to forward." })),
    remote_port: Type.Optional(Type.String({ description: "Remote port on FRPS server." })),
    start_time: Type.Optional(Type.String({ description: "Start time, default '0'." })),
    end_time: Type.Optional(Type.String({ description: "End time, default '0'." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const DeployFrpsSchema = Type.Object(
  {
    port: Type.Integer({ minimum: 1, maximum: 65535, description: "FRPS listen port. Default: 7070. Use this default unless the user explicitly specifies a different port." }),
    token: Type.Optional(
      Type.String({
        description:
          "Authentication token. MUST be auto-generated by the Agent as a random string BEFORE calling this tool. NEVER ask the user for this value. Passing an empty/missing token is FORBIDDEN — always supply a generated token.",
      }),
    ),
  },
  { additionalProperties: false },
);

const ResetFrpsSchema = Type.Object({}, { additionalProperties: false });

const ResetWireguardVpnSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    interface: Type.Optional(
      Type.String({ minLength: 1, description: "WireGuard interface name to reset. Defaults to wg0." }),
    ),
    flushRoutes: Type.Optional(
      Type.Boolean({
        description: "Whether to flush static routes bound to the WireGuard interface. Defaults to true.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetBrLanSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    ipaddr: Type.String({
      minLength: 7,
      description:
        "New LAN gateway IP address, e.g. 192.168.10.1. ⚠️ Changing this will disconnect all LAN clients.",
    }),
    netmask: Type.Optional(
      Type.String({
        description: "Dotted-decimal netmask, e.g. 255.255.255.0. Defaults to 255.255.255.0 (/24) when omitted.",
      }),
    ),
    prefixLen: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 30,
        description: "CIDR prefix length (1-30). Takes precedence over netmask when both are provided.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetVpnRoutesSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    mode: stringEnum(["selective", "full_tunnel"] as const, {
      description:
        "Routing mode: selective (individual CIDR routes) or full_tunnel (all traffic through VPN).",
    }),
    routes: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          description: "CIDR destination to route through VPN, e.g. 1.2.3.0/24.",
        }),
      ),
    ),
    excludeIps: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          description:
            "IPs to exclude from full tunnel routing (e.g. VPS public IP to prevent routing loop).",
        }),
      ),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const SetVpnDomainRoutesSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    domains: Type.Array(
      Type.String({
        minLength: 1,
        description: "Domain name to resolve into IPv4 /32 routes through wg0.",
      }),
    ),
    interface: Type.Optional(
      Type.String({ minLength: 1, description: "WireGuard interface name, defaults to wg0." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const DeleteVpnRoutesSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    flushAll: Type.Optional(
      Type.Boolean({ description: "Flush all VPN routes at once instead of deleting individual." }),
    ),
    routes: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          description: "Individual CIDR routes to delete, e.g. 1.2.3.0/24.",
        }),
      ),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const DeployWgServerSchema = Type.Object(
  {
    port: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 65535,
        description: "WireGuard UDP listen port. Default 51820.",
      }),
    ),
    tunnelIp: Type.Optional(
      Type.String({ description: "Server tunnel IP with mask. Default 10.0.0.1/24." }),
    ),
    egressInterface: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional VPS WAN interface used by MASQUERADE PostUp/PostDown rules (e.g. eth0). When omitted, auto-detected.",
      }),
    ),
  },
  { additionalProperties: false },
);

const AddWgPeerSchema = Type.Object(
  {
    publicKey: Type.String({ minLength: 1, description: "Peer public key." }),
    allowedIps: Type.Array(
      Type.String({
        minLength: 1,
        description: "Allowed IPs for this peer, e.g. ['10.0.0.2/32'].",
      }),
    ),
    endpoint: Type.Optional(Type.String({ description: "Optional peer endpoint." })),
  },
  { additionalProperties: false },
);

const WireguardMeshDeviceBindingSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    tunnelIp: Type.String({
      minLength: 1,
      description: "Router WireGuard tunnel IP CIDR on VPS side, e.g. 10.0.0.2/32.",
    }),
    peerPublicKey: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Router peer public key used for VPS side peer reconciliation.",
      }),
    ),
    lanCidr: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Optional override for detected br-lan CIDR, e.g. 192.168.10.0/24.",
      }),
    ),
  },
  { additionalProperties: false },
);

const ReconcileWireguardLanMeshSchema = Type.Object(
  {
    nodes: Type.Optional(
      Type.Array(WireguardMeshDeviceBindingSchema, {
        minItems: 2,
        description:
          "Optional explicit device bindings. When omitted, the tool auto-discovers online devices and only reconciles LAN routes.",
      }),
    ),
    updateServerPeers: Type.Optional(
      Type.Boolean({
        description:
          "When true, upsert VPS peer AllowedIPs to include tunnelIp + LAN CIDR for each non-conflicting node.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const CheckLanConflictSchema = Type.Object(
  {
    newDeviceId: DeviceIdField,
    existingDeviceIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "IDs of devices already in the WireGuard mesh. When omitted, all other online devices are used automatically.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const JoinWireguardLanMeshSchema = Type.Object(
  {
    newDeviceId: DeviceIdField,
    tunnelIp: Type.String({
      minLength: 1,
      description: "WireGuard tunnel IP CIDR for the new device, e.g. 10.0.0.3/32.",
    }),
    peerPublicKey: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "New device WireGuard public key. Required for VPS peer AllowedIPs update when updateServerPeers is true.",
      }),
    ),
    existingDeviceIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "IDs of devices already in the mesh. When omitted, all other online devices are used automatically.",
      }),
    ),
    updateServerPeers: Type.Optional(
      Type.Boolean({
        description:
          "When true (default), update VPS peer AllowedIPs to include the new device tunnelIp and LAN CIDR.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const PlanWireguardClientRoutesSchema = Type.Object(
  {
    deviceIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description:
        "Selected device IDs to include in WireGuard client route planning. The tool fetches each device's br-lan CIDR, checks overlaps, and calculates per-device selective routes.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const VerifyWireguardConnectivitySchema = Type.Object(
  {
    deviceIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "Explicit list of device IDs to verify. When omitted, all online devices are checked.",
      }),
    ),
    pingTargets: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description:
          "Tunnel IPs to ping from the VPS side (e.g. [\"10.0.0.2\", \"10.0.0.3\"]). Skipped when omitted.",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const FullMeshDeployNodeSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    tunnelIp: Type.String({
      minLength: 1,
      description: "Tunnel IP/CIDR assigned to this router on the VPS side, e.g. 10.0.0.2/32.",
    }),
    lanCidr: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Optional override for br-lan CIDR. Auto-detected from device status if omitted.",
      }),
    ),
  },
  { additionalProperties: false },
);

const FullMeshDeploySchema = Type.Object(
  {
    nodes: Type.Array(FullMeshDeployNodeSchema, {
      minItems: 1,
      description: "List of routers to configure. Each needs a deviceId and a unique tunnelIp.",
    }),
    serverPublicKey: Type.String({
      minLength: 1,
      description: "VPS WireGuard server public key (from openclaw_deploy_wg_server output).",
    }),
    serverEndpoint: Type.String({
      minLength: 1,
      description: "VPS public IP or hostname with port, e.g. 43.143.232.185:51820.",
    }),
    fullTunnel: Type.Optional(
      Type.Boolean({
        description:
          "When true, configures each router in full-tunnel mode (0.0.0.0/1 + 128.0.0.0/1) and automatically adds a VPS /32 direct route. Defaults to false (selective/mesh-only).",
      }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

const ResetWgServerSchema = Type.Object(
  {
    interface: Type.Optional(
      Type.String({ minLength: 1, description: "WireGuard interface name to reset. Defaults to wg0." }),
    ),
    removeKeys: Type.Optional(
      Type.Boolean({
        description: "Whether to remove server key files under /etc/wireguard. Defaults to true.",
      }),
    ),
  },
  { additionalProperties: false },
);

const RunSpeedtestSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    serverId: Type.Optional(Type.String({ description: "Optional specific speedtest server ID." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

type GenericToolParams = Static<typeof GenericToolSchema>;
type DeviceOnlyParams = Static<typeof DeviceOnlySchema>;
type ClientInfoParams = Static<typeof ClientInfoSchema>;
type AuthClientParams = Static<typeof AuthClientSchema>;
type KickoffClientParams = Static<typeof KickoffClientSchema>;
type UpdateDeviceInfoParams = Static<typeof UpdateDeviceInfoSchema>;
type SetAuthServerParams = Static<typeof SetAuthServerSchema>;
type PortalTemplate = PortalTemplateType;
type PortalContentParams = PortalContentType;
type PublishPortalPageParams = Static<typeof PublishPortalPageSchema>;
type GeneratePortalPageParams = Static<typeof GeneratePortalPageSchema>;
type SetMqttServerParams = Static<typeof SetMqttServerSchema>;
type SetWebsocketServerParams = Static<typeof SetWebsocketServerSchema>;
type SetWireguardVpnParams = Static<typeof SetWireguardVpnSchema>;
type TmpPassParams = Static<typeof TmpPassSchema>;
type SetWifiInfoParams = Static<typeof SetWifiInfoSchema>;
type ScanWifiParams = Static<typeof ScanWifiSchema>;
type SetWifiRelayParams = Static<typeof SetWifiRelaySchema>;
type DomainSyncParams = Static<typeof DomainSyncSchema>;
type TrustedMacSyncParams = Static<typeof TrustedMacSyncSchema>;
type ShellCommandParams = Static<typeof ShellCommandSchema>;
type BpfAddParams = Static<typeof BpfAddSchema>;
type BpfJsonParams = Static<typeof BpfJsonSchema>;
type BpfDeleteParams = Static<typeof BpfDeleteSchema>;
type BpfFlushParams = Static<typeof BpfFlushSchema>;
type BpfUpdateParams = Static<typeof BpfUpdateSchema>;
type BpfUpdateAllParams = Static<typeof BpfUpdateAllSchema>;
type SetVpnRoutesParams = Static<typeof SetVpnRoutesSchema>;
type SetVpnDomainRoutesParams = Static<typeof SetVpnDomainRoutesSchema>;
type DeleteVpnRoutesParams = Static<typeof DeleteVpnRoutesSchema>;
type ResetWireguardVpnParams = Static<typeof ResetWireguardVpnSchema>;
type SetBrLanParams = Static<typeof SetBrLanSchema>;
type ResetWgServerParams = Static<typeof ResetWgServerSchema>;
type ReconcileWireguardLanMeshParams = Static<typeof ReconcileWireguardLanMeshSchema>;
type CheckLanConflictParams = Static<typeof CheckLanConflictSchema>;
type JoinWireguardLanMeshParams = Static<typeof JoinWireguardLanMeshSchema>;
type PlanWireguardClientRoutesParams = Static<typeof PlanWireguardClientRoutesSchema>;

type BpfJsonTable = "ipv4" | "ipv6" | "mac" | "sid" | "l7";

const PORTAL_WEB_ROOT_CANDIDATES = [
  "/usr/share/nginx/html",
  "/var/www/html",
  "/www",
  "/srv/http",
  "/usr/local/www/nginx/html",
  "/usr/local/www",
];

function normalizeMac(input: string): string {
  return input.trim().toUpperCase().replace(/-/g, ":");
}

function normalizeBpfAddress(table: "ipv4" | "ipv6" | "mac", address: string): string {
  const trimmed = address.trim();
  if (table === "mac") {
    return normalizeMac(trimmed).toLowerCase();
  }
  return trimmed;
}

type IPv4CidrInfo = {
  input: string;
  normalized: string;
  network: number;
  broadcast: number;
  prefix: number;
};

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function parseIPv4Cidr(input: string): IPv4CidrInfo | null {
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

function parseIPv4WithMask(ip: string, mask: string): IPv4CidrInfo | null {
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

function cidrOverlaps(left: IPv4CidrInfo, right: IPv4CidrInfo): boolean {
  return left.network <= right.broadcast && right.network <= left.broadcast;
}

function collectPossibleCidrs(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return value.includes("/") ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPossibleCidrs(entry));
  }
  if (typeof value === "object") {
    return Object.values(value as JsonRecord).flatMap((entry) => collectPossibleCidrs(entry));
  }
  return [];
}

function extractLanCidrFromStatusResponse(response: JsonRecord): string | null {
  const candidates = [
    response,
    asObject(response.data),
    asObject(asObject(response.data)?.data),
  ].filter((entry): entry is JsonRecord => Boolean(entry));

  for (const source of candidates) {
    const brLan = (source as JsonRecord).br_lan ?? (source as JsonRecord).brLan;
    const cidrs = collectPossibleCidrs(brLan)
      .map((entry) => parseIPv4Cidr(entry)?.normalized)
      .filter((entry): entry is string => Boolean(entry));
    if (cidrs.length > 0) {
      return cidrs[0];
    }

    const interfaces = (source as JsonRecord).interfaces;
    if (Array.isArray(interfaces)) {
      for (const iface of interfaces) {
        const ifaceObj = asObject(iface);
        if (!ifaceObj) {
          continue;
        }
        const ifaceName =
          (typeof ifaceObj?.name === "string" ? ifaceObj.name : undefined) ??
          (typeof ifaceObj?.ifname === "string" ? ifaceObj.ifname : undefined) ??
          (typeof ifaceObj?.interface === "string" ? ifaceObj.interface : undefined);
        if (!ifaceName || !ifaceName.toLowerCase().includes("br-lan")) {
          continue;
        }
        const ifaceCidrs = collectPossibleCidrs(ifaceObj)
          .map((entry) => parseIPv4Cidr(entry)?.normalized)
          .filter((entry): entry is string => Boolean(entry));
        if (ifaceCidrs.length > 0) {
          return ifaceCidrs[0];
        }
        if (typeof ifaceObj.ipaddr === "string" && typeof ifaceObj.netmask === "string") {
          const parsed = parseIPv4WithMask(ifaceObj.ipaddr, ifaceObj.netmask);
          if (parsed) {
            return parsed.normalized;
          }
        }
      }
    }
  }

  return null;
}

function buildWireguardPeerBlock(params: {
  publicKey: string;
  allowedIps: string[];
  endpoint?: string;
}): string {
  const endpointLine = params.endpoint ? `\nEndpoint = ${params.endpoint}` : "";
  return `\n[Peer]\nPublicKey = ${params.publicKey}\nAllowedIPs = ${params.allowedIps.join(", ")}${endpointLine}\n`;
}

function isValidWireGuardPublicKey(key: string): boolean {
  // WireGuard keys are 32-byte values encoded as 44-character base64 (with trailing =).
  return /^[A-Za-z0-9+/]{43}=$/.test(key.trim());
}

function upsertWireguardPeerConfig(params: {
  existingConfig: string;
  publicKey: string;
  allowedIps: string[];
  endpoint?: string;
}) {
  if (!isValidWireGuardPublicKey(params.publicKey)) {
    throw new Error(`Invalid WireGuard public key format: ${params.publicKey.substring(0, 12)}…`);
  }
  const lines = params.existingConfig.split(/\r?\n/);
  const sections: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === "[Peer]") {
      if (current.length > 0) {
        sections.push(current);
      }
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current);
  }

  const interfaceSections: string[] = [];
  const peerSections: string[] = [];
  for (const sectionLines of sections) {
    const joined = sectionLines.join("\n").trim();
    if (!joined) {
      continue;
    }
    if (joined.startsWith("[Peer]")) {
      peerSections.push(joined);
    } else {
      interfaceSections.push(joined);
    }
  }

  const peerRegex = /^PublicKey\s*=\s*(.+)$/m;
  const normalizedKey = params.publicKey.trim();
  const filteredPeers = peerSections.filter((section) => {
    const match = section.match(peerRegex);
    const key = match?.[1]?.trim();
    return key !== normalizedKey;
  });
  const hadExisting = filteredPeers.length !== peerSections.length;
  filteredPeers.push(
    buildWireguardPeerBlock({
      publicKey: normalizedKey,
      allowedIps: params.allowedIps,
      endpoint: params.endpoint,
    }).trim(),
  );

  const merged = [...interfaceSections, ...filteredPeers].join("\n\n").trimEnd() + "\n";
  return {
    updatedConfig: merged,
    action: hadExisting ? "updated" : "added",
  } as const;
}

async function upsertWireguardPeerOnServer(params: {
  publicKey: string;
  allowedIps: string[];
  endpoint?: string;
}) {
  console.info("upsertWireguardPeerOnServer", params);
  const { execFileSync, execSync } = await import("node:child_process");
  const confPath = "/etc/wireguard/wg0.conf";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-wg-peer-"));

  try {
    const existingConf = execSync(`sudo cat ${confPath}`, { encoding: "utf-8" });
    const { updatedConfig, action } = upsertWireguardPeerConfig({
      existingConfig: existingConf,
      publicKey: params.publicKey,
      allowedIps: params.allowedIps,
      endpoint: params.endpoint,
    });

    const tempFile = path.join(tempDir, "wg0.conf");
    await fs.writeFile(tempFile, updatedConfig, "utf8");
    await fs.chmod(tempFile, 0o600);
    execSync(`sudo install -o root -g root -m 600 ${tempFile} ${confPath}`, {
      encoding: "utf-8",
    });

    const strippedConf = execFileSync("sudo", ["wg-quick", "strip", "wg0"], {
      encoding: "utf-8",
    });
    execFileSync("sudo", ["wg", "syncconf", "wg0", "/dev/stdin"], {
      encoding: "utf-8",
      input: strippedConf,
    });

    return { status: "success" as const, action };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function mapWireguardInterfacePayload(input: JsonRecord): JsonRecord {
  const output: JsonRecord = { ...input };

  if (output.private_key === undefined && typeof input.privateKey === "string") {
    output.private_key = input.privateKey;
  }
  if (output.listen_port === undefined && typeof input.listenPort === "number") {
    output.listen_port = input.listenPort;
  }

  delete output.privateKey;
  delete output.listenPort;

  return output;
}

function mapWireguardPeerPayload(input: JsonRecord): JsonRecord {
  const output: JsonRecord = { ...input };

  if (output.public_key === undefined && typeof input.publicKey === "string") {
    output.public_key = input.publicKey;
  }
  if (output.preshared_key === undefined && typeof input.presharedKey === "string") {
    output.preshared_key = input.presharedKey;
  }
  if (output.allowed_ips === undefined) {
    output.allowed_ips = Array.isArray(input.allowedIps) ? input.allowedIps : ["0.0.0.0/0"];
  }
  if (output.endpoint_host === undefined && typeof input.endpointHost === "string") {
    output.endpoint_host = input.endpointHost;
  }
  if (output.endpoint_port === undefined && typeof input.endpointPort === "number") {
    output.endpoint_port = input.endpointPort;
  }
  if (output.persistent_keepalive === undefined && typeof input.persistentKeepalive === "number") {
    output.persistent_keepalive = input.persistentKeepalive;
  }
  if (output.route_allowed_ips === undefined && typeof input.routeAllowedIps === "boolean") {
    output.route_allowed_ips = input.routeAllowedIps ? "1" : "0";
  }

  delete output.publicKey;
  delete output.presharedKey;
  delete output.allowedIps;
  delete output.endpointHost;
  delete output.endpointPort;
  delete output.persistentKeepalive;
  delete output.routeAllowedIps;

  return output;
}

function summarizeBpfJsonResponse(
  response: JsonRecord,
  table: BpfJsonTable,
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

function sanitizePortalHtmlRoot(root: string): string {
  return path.resolve(root.trim());
}

async function resolvePortalWebRoot(explicitRoot?: string): Promise<string> {
  const envRoot =
    process.env.OPENCLAW_WRT_PORTAL_WEB_ROOT?.trim() ?? process.env.OPENCLAW_WRT_WEB_ROOT?.trim();
  const candidates = [explicitRoot?.trim(), envRoot, ...PORTAL_WEB_ROOT_CANDIDATES].filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );

  for (const candidate of candidates) {
    const resolved = sanitizePortalHtmlRoot(candidate);
    if (explicitRoot?.trim() === candidate || envRoot === candidate) {
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
    `unable to locate a writable nginx web root; set OPENCLAW_WRT_PORTAL_WEB_ROOT or pass webRoot (checked: ${PORTAL_WEB_ROOT_CANDIDATES.join(", ")})`,
  );
}

function sanitizePortalPageName(input: string): string {
  const baseName = path.basename(input.trim());
  const cleaned = baseName.replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "");
}

function buildPortalPageName(deviceId: string, explicitPageName?: string): string {
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

function ensureDevice(bridge: ClawWRTBridge, deviceId: string): DeviceSnapshot {
  const device = bridge.getDevice(deviceId);
  if (!device) {
    throw new Error(`device not connected: ${deviceId}`);
  }
  return device;
}

function getSingleGatewayId(device: DeviceSnapshot): string | undefined {
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

async function callDeviceOp(params: {
  bridge: ClawWRTBridge;
  deviceId: string;
  op: string;
  payload?: JsonRecord;
  timeoutMs?: number;
  expectResponse?: boolean;
}) {
  console.info(`callDeviceOp deviceId=${params.deviceId} op=${params.op}`, params.payload);
  return await params.bridge.callDevice({
    deviceId: params.deviceId,
    op: params.op,
    payload: params.payload,
    timeoutMs: params.timeoutMs,
    expectResponse: params.expectResponse,
  });
}

async function publishPortalPage(params: {
  bridge: ClawWRTBridge;
  deviceId: string;
  html?: string;
  template?: PortalTemplate;
  content?: PortalContentParams;
  pageName?: string;
  webRoot?: string;
  timeoutMs?: number;
}) {
  console.info(`publishPortalPage deviceId=${params.deviceId} template=${params.template}`, {
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
    deviceId: params.deviceId,
    op: "set_local_portal",
    payload: { portal: pageName },
    timeoutMs: params.timeoutMs,
    expectResponse: true,
  });

  return { pageName, root, filePath, response };
}

async function lookupClientByMac(params: {
  bridge: ClawWRTBridge;
  deviceId: string;
  clientMac: string;
  timeoutMs?: number;
}): Promise<JsonRecord | null> {
  console.info(`lookupClientByMac deviceId=${params.deviceId} clientMac=${params.clientMac}`);
  const response = await callDeviceOp({
    bridge: params.bridge,
    deviceId: params.deviceId,
    op: "get_clients",
    timeoutMs: params.timeoutMs,
  });
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

function buildToolResult(text: string, details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function createSimpleOperationTool(params: {
  bridge: ClawWRTBridge;
  name: string;
  label: string;
  description: string;
  op: string;
  parameters?: AnyAgentTool["parameters"];
  expectResponse?: boolean;
  buildPayload?: (rawParams: unknown) => {
    deviceId: string;
    payload?: JsonRecord;
    timeoutMs?: number;
    expectResponse?: boolean;
  };
  summarize?: (response: JsonRecord, rawParams: unknown) => string;
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.parameters ?? DeviceOnlySchema,
    execute: async (_toolCallId, rawParams) => {
      console.info(`Executing tool: ${params.name}`, rawParams);
      const fallbackArgs = rawParams as DeviceOnlyParams;
      const built = params.buildPayload?.(rawParams) ?? {
        deviceId: fallbackArgs.deviceId ? fallbackArgs.deviceId.trim() : "",
        timeoutMs: fallbackArgs.timeoutMs,
      };
      const response = await callDeviceOp({
        bridge: params.bridge,
        deviceId: built.deviceId,
        op: params.op,
        payload: built.payload,
        timeoutMs: built.timeoutMs,
        expectResponse: built.expectResponse ?? params.expectResponse,
      });
      const summary =
        params.summarize?.(response, rawParams) ??
        `Device ${built.deviceId} responded to ${params.op}.`;
      const responseJson = JSON.stringify(response);
      const text = `${summary}\n\nDevice response data:\n${responseJson}`;
      return buildToolResult(text, { response });
    },
  };
}

function createPublishPortalPageTool(bridge: ClawWRTBridge): AnyAgentTool {
  return {
    name: "clawwrt_publish_portal_page",
    label: "OpenClaw WRT Publish Portal Page",
    description: "Publish a captive portal HTML page to the device-specific portal file.",
    parameters: PublishPortalPageSchema,
    execute: async (_toolCallId, rawParams) => {
      console.info("Executing tool: clawwrt_publish_portal_page", rawParams);
      const args = rawParams as PublishPortalPageParams;
      const deviceId = args.deviceId.trim();
      const result = await publishPortalPage({
        bridge,
        deviceId,
        html: args.html,
        template: args.template,
        content: args.content,
        pageName: args.pageName,
        webRoot: args.webRoot,
        timeoutMs: args.timeoutMs,
      });

      return buildToolResult(
        `Published portal page ${result.pageName} for ${deviceId} and updated local portal routing.`,
        {
          deviceId,
          pageName: result.pageName,
          webRoot: result.root,
          filePath: result.filePath,
          template: args.template ?? null,
          response: result.response,
        },
      );
    },
  };
}

function createGeneratePortalPageTool(bridge: ClawWRTBridge): AnyAgentTool {
  return {
    name: "clawwrt_generate_portal_page",
    label: "OpenClaw WRT Generate Portal Page",
    description:
      "Generate a captive portal HTML page and publish it to the device-specific portal file.",
    parameters: GeneratePortalPageSchema,
    execute: async (_toolCallId, rawParams) => {
      console.info("Executing tool: clawwrt_generate_portal_page", rawParams);
      const args = rawParams as GeneratePortalPageParams;
      const deviceId = args.deviceId.trim();
      const result = await publishPortalPage({
        bridge,
        deviceId,
        template: args.template,
        content: args.content,
        pageName: args.pageName,
        webRoot: args.webRoot,
        timeoutMs: args.timeoutMs,
      });

      return buildToolResult(
        `Generated and published portal page ${result.pageName} for ${deviceId}.`,
        {
          deviceId,
          pageName: result.pageName,
          webRoot: result.root,
          filePath: result.filePath,
          template: args.template ?? "default",
          response: result.response,
        },
      );
    },
  };
}

function createGenericTool(bridge: ClawWRTBridge): AnyAgentTool {
  return {
    name: "clawwrt",
    label: "OpenClaw WRT",
    description:
      "Low-level fallback tool for openclaw-wrt. Prefer the more specific clawwrt_* tools when they match the user intent.",
    parameters: GenericToolSchema,
    execute: async (_toolCallId, rawParams) => {
      console.info("Executing tool: clawwrt", rawParams);
      const toolParams = rawParams as GenericToolParams;
      if (toolParams.action === "list_devices") {
        const devices = bridge.listDevices();
        return buildToolResult(`Connected devices: ${devices.length}`, { devices });
      }

      const deviceId = toolParams.deviceId?.trim();
      if (!deviceId) {
        throw new Error("deviceId required");
      }

      if (toolParams.action === "get_device") {
        const device = ensureDevice(bridge, deviceId);
        return buildToolResult(`Device ${deviceId} is connected.`, { device });
      }

      const op = toolParams.op?.trim();
      if (!op) {
        throw new Error("op required for action=call");
      }

      const response = await callDeviceOp({
        bridge,
        deviceId,
        op,
        payload: toolParams.payload,
        timeoutMs: toolParams.timeoutMs,
        expectResponse: toolParams.expectResponse,
      });

      return buildToolResult(`Device ${deviceId} responded to ${op}.`, { response });
    },
  };
}

function createListDevicesTool(bridge: ClawWRTBridge): AnyAgentTool {
  return {
    name: "clawwrt_list_devices",
    label: "OpenClaw WRT Devices",
    description:
      "List all currently connected online routers, wireless routers, or OpenWrt devices managed by openclaw-wrt.",
    parameters: Type.Object(
      {
        dummy_field: Type.Optional(
          Type.String({
            description: "Ignore this field. It exists to prevent empty parameter objects.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async () => {
      console.info("Executing tool: clawwrt_list_devices");
      const devices = bridge.listDevices();

      const deviceStrings = devices
        .map((d) => `- ${d.alias || "WiFi"} (ID: ${d.deviceId})`)
        .join("\n");
      const textOutput = `当前 ${devices.length} 台设备在线：\n\n${deviceStrings}`;

      return buildToolResult(textOutput, { devices });
    },
  };
}

function createGetDeviceTool(bridge: ClawWRTBridge): AnyAgentTool {
  return {
    name: "clawwrt_get_device",
    label: "OpenClaw WRT Device",
    description:
      "Get the current connection snapshot for one online router or wireless router. This is a quick connectivity view, not the full runtime detail report.",
    parameters: Type.Object({ deviceId: DeviceIdField }, { additionalProperties: false }),
    execute: async (_toolCallId, rawParams) => {
      console.info("Executing tool: clawwrt_get_device", rawParams);
      const args = rawParams as { deviceId: string };
      const device = ensureDevice(bridge, args.deviceId.trim());
      return buildToolResult(`Device ${device.deviceId} is connected.`, { device });
    },
  };
}

export function createClawWRTTools(params: { bridge: ClawWRTBridge }): AnyAgentTool[] {
  const { bridge } = params;

  return [
    createListDevicesTool(bridge),
    createGetDeviceTool(bridge),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_status",
      label: "OpenClaw WRT Status",
      description:
        "Get detailed runtime status and health information for an online router or wireless router. Prefer this when the user asks for router details or current router status.",
      op: "get_status",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched status for device ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_sys_info",
      label: "OpenClaw WRT System Info",
      description:
        "Get detailed router system information such as model, platform, memory, storage, uptime, and resource usage for an online router.",
      op: "get_sys_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched system info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_device_info",
      label: "OpenClaw WRT Device Info",
      description:
        "Get configured router metadata such as site, label, location, and other saved device information for an online router.",
      op: "get_device_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched device info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_update_device_info",
      label: "OpenClaw WRT Update Device Info",
      description: "Update device metadata such as site, label, location, or custom fields.",
      op: "update_device_info",
      parameters: UpdateDeviceInfoSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as UpdateDeviceInfoParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { device_info: args.deviceInfo },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as UpdateDeviceInfoParams;
        return `Updated device info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_clients",
      label: "OpenClaw WRT Clients",
      description: "List currently authenticated clients on a router.",
      op: "get_clients",
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        const count = getClientsFromResponse(response).length;
        return `Fetched ${count} clients from ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_get_client_info",
      label: "OpenClaw WRT Client Info",
      description: "Get detailed information for one authenticated client by MAC address.",
      parameters: ClientInfoSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_get_client_info", rawParams);
        const args = rawParams as ClientInfoParams;
        const normalizedMac = normalizeMac(args.clientMac);
        const response = await callDeviceOp({
          bridge,
          deviceId: args.deviceId.trim(),
          op: "get_client_info",
          payload: { mac: normalizedMac },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Fetched client info for ${normalizedMac} on ${args.deviceId}.`, {
          response,
        });
      },
    },
    {
      name: "clawwrt_auth_client",
      label: "OpenClaw WRT Auth Client",
      description:
        "Authorize one client by MAC and IP through the router-side ClawWRT API. Use this for captive portal login and AI-driven approval.",
      parameters: AuthClientSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_auth_client", rawParams);
        const args = rawParams as AuthClientParams;
        const clientMac = normalizeMac(args.clientMac);
        const clientIp = args.clientIp.trim();
        const response = await callDeviceOp({
          bridge,
          deviceId: args.deviceId.trim(),
          op: "auth_client",
          payload: {
            client_ip: clientIp,
            client_mac: clientMac,
          },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Authorized client ${clientMac} on ${args.deviceId}.`, {
          response,
          resolved: { clientIp, clientMac },
        });
      },
    },
    {
      name: "clawwrt_kickoff_client",
      label: "OpenClaw WRT Kickoff Client",
      description:
        "Disconnect an authenticated client by MAC address. If client IP is omitted, the tool looks it up from get_clients. If the router has exactly one gateway, gwId is inferred automatically.",
      parameters: KickoffClientSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_kickoff_client", rawParams);
        const args = rawParams as KickoffClientParams;
        const deviceId = args.deviceId.trim();
        const device = ensureDevice(bridge, deviceId);
        const clientMac = normalizeMac(args.clientMac);
        const explicitClientIp = args.clientIp?.trim();
        const client = explicitClientIp
          ? null
          : await lookupClientByMac({
              bridge,
              deviceId,
              clientMac,
              timeoutMs: args.timeoutMs,
            });
        const resolvedClientMac =
          typeof client?.mac === "string" && client.mac.trim() ? client.mac.trim() : clientMac;
        const clientIp =
          explicitClientIp ||
          (typeof client?.ip === "string" && client.ip.trim() ? client.ip.trim() : undefined);
        if (!clientIp) {
          throw new Error(`client IP not found for ${clientMac}; provide clientIp explicitly`);
        }
        const gwId = args.gwId?.trim() || getSingleGatewayId(device);
        if (!gwId) {
          throw new Error("gwId required when the device has multiple gateways");
        }
        const response = await callDeviceOp({
          bridge,
          deviceId,
          op: "kickoff",
          payload: {
            client_ip: clientIp,
            client_mac: resolvedClientMac,
            gw_id: gwId,
          },
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Kickoff requested for ${clientMac} on ${deviceId}.`, {
          response,
          resolved: { clientIp, gwId, clientMac: resolvedClientMac },
        });
      },
    },
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_tmp_pass_client",
      label: "OpenClaw WRT Temporary Pass Client",
      description: "Temporarily allow one client MAC to bypass captive portal authentication.",
      op: "tmp_pass_client",
      parameters: TmpPassSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as TmpPassParams;
        const payload: JsonRecord = {
          client_mac: normalizeMac(args.clientMac).toLowerCase(),
        };
        if (typeof args.timeout === "number") {
          payload.timeout = args.timeout;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
          expectResponse: true,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as TmpPassParams;
        return `Temporary pass requested for ${normalizeMac(args.clientMac)} on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_wifi_info",
      label: "OpenClaw WRT WiFi Info",
      description: "Get the router's Wi-Fi and radio configuration.",
      op: "get_wifi_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched Wi-Fi info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_wifi_info",
      label: "OpenClaw WRT Set WiFi Info",
      description:
        "Update Wi-Fi configuration on the router, such as changing SSID (network name), password, encryption type, or hiding the network. Use this tool when the user asks to modify, change, or update Wi-Fi settings including SSID.",
      op: "set_wifi_info",
      parameters: SetWifiInfoSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWifiInfoParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { data: args.data },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWifiInfoParams;
        return `Applied Wi-Fi config changes to ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_scan_wifi",
      label: "OpenClaw WRT Scan WiFi",
      description: "Scan nearby Wi-Fi networks, optionally filtered to 2.4 GHz or 5 GHz.",
      op: "scan_wifi",
      parameters: ScanWifiSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as ScanWifiParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: args.band ? { band: args.band } : undefined,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as ScanWifiParams;
        return `Completed Wi-Fi scan for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_wifi_relay",
      label: "OpenClaw WRT Set WiFi Relay",
      description: "Configure the router to join an upstream Wi-Fi as relay/STA.",
      op: "set_wifi_relay",
      parameters: SetWifiRelaySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWifiRelayParams;
        const payload: JsonRecord = { ssid: args.ssid };
        if (typeof args.key === "string") {
          payload.key = args.key;
        }
        if (typeof args.band === "string") {
          payload.band = args.band;
        }
        if (typeof args.encryption === "string") {
          payload.encryption = args.encryption;
        }
        if (typeof args.bssid === "string") {
          payload.bssid = args.bssid;
        }
        if (typeof args.apply === "boolean") {
          payload.apply = args.apply;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWifiRelayParams;
        return `Configured Wi-Fi relay for ${args.deviceId} using SSID ${args.ssid}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_add",
      label: "OpenClaw WRT BPF Add",
      description: "Add an IPv4, IPv6, or MAC target to the device's BPF traffic monitoring table.",
      op: "bpf_add",
      parameters: BpfAddSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfAddParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            address: normalizeBpfAddress(table, args.address),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfAddParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Added ${args.address} to the ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_json",
      label: "OpenClaw WRT BPF Stats",
      description:
        "Query BPF traffic monitoring statistics for one table (`ipv4`, `ipv6`, `mac`, `sid`, or `l7`).",
      op: "bpf_json",
      parameters: BpfJsonSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfJsonParams;
        const table = (args.table ?? "mac") as BpfJsonTable;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
          },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as BpfJsonParams;
        const table = (args.table ?? "mac") as BpfJsonTable;
        return summarizeBpfJsonResponse(response, table, args.deviceId);
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_l7_active_stats",
      label: "OpenClaw WRT L7 Active Stats",
      description:
        "Get active L7 protocol traffic speed and volume statistics (SID view) for the current device.",
      op: "bpf_json",
      parameters: DeviceOnlySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { table: "sid" },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return summarizeBpfJsonResponse(response, "sid", args.deviceId);
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_l7_protocol_catalog",
      label: "OpenClaw WRT L7 Protocol Catalog",
      description:
        "List the L7 protocol library currently supported by the device, including domain signatures when available.",
      op: "bpf_json",
      parameters: DeviceOnlySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { table: "l7" },
          timeoutMs: args.timeoutMs ?? 30_000,
        };
      },
      summarize: (response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return summarizeBpfJsonResponse(response, "l7", args.deviceId);
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_del",
      label: "OpenClaw WRT BPF Delete",
      description:
        "Remove an IPv4, IPv6, or MAC target from the device's BPF traffic monitoring table.",
      op: "bpf_del",
      parameters: BpfDeleteSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfDeleteParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            address: normalizeBpfAddress(table, args.address),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfDeleteParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Removed ${args.address} from the ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_flush",
      label: "OpenClaw WRT BPF Flush",
      description: "Clear all entries from one BPF monitoring table.",
      op: "bpf_flush",
      parameters: BpfFlushSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfFlushParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table: args.table ?? "mac",
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfFlushParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Flushed ${table} BPF monitor table on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_update",
      label: "OpenClaw WRT BPF Update",
      description: "Update downrate/uprate limits for one BPF monitored target.",
      op: "bpf_update",
      parameters: BpfUpdateSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfUpdateParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table,
            target: normalizeBpfAddress(table, args.target),
            downrate: args.downrate,
            uprate: args.uprate,
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfUpdateParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Updated ${table} BPF rate limits for ${args.target} on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_bpf_update_all",
      label: "OpenClaw WRT BPF Update All",
      description: "Update downrate/uprate limits for all entries in one BPF table.",
      op: "bpf_update_all",
      parameters: BpfUpdateAllSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as BpfUpdateAllParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            table: args.table ?? "mac",
            downrate: args.downrate,
            uprate: args.uprate,
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as BpfUpdateAllParams;
        const table = typeof args.table === "string" ? args.table : "mac";
        return `Updated ${table} BPF rate limits for all monitored entries on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_trusted_domains",
      label: "OpenClaw WRT Trusted Domains",
      description: "Get the trusted domain whitelist for captive portal bypass.",
      op: "get_trusted_domains",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted domains for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_sync_trusted_domains",
      label: "OpenClaw WRT Sync Trusted Domains",
      description: "Replace the trusted domain whitelist with the provided full domain list.",
      op: "sync_trusted_domain",
      parameters: DomainSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DomainSyncParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { domains: args.domains },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as DomainSyncParams;
        return `Synced ${args.domains.length} trusted domains on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_trusted_wildcard_domains",
      label: "OpenClaw WRT Trusted Wildcard Domains",
      description: "Get the trusted wildcard domain whitelist such as *.example.com.",
      op: "get_trusted_wildcard_domains",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted wildcard domains for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_sync_trusted_wildcard_domains",
      label: "OpenClaw WRT Sync Trusted Wildcard Domains",
      description: "Replace the trusted wildcard domain whitelist with the provided full list.",
      op: "sync_trusted_wildcard_domains",
      parameters: DomainSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DomainSyncParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: { domains: args.domains },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as DomainSyncParams;
        return `Synced ${args.domains.length} trusted wildcard domains on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_trusted_mac",
      label: "OpenClaw WRT Trusted MACs",
      description: "Get the trusted MAC whitelist.",
      op: "get_trusted_mac",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched trusted MACs for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_sync_trusted_mac",
      label: "OpenClaw WRT Sync Trusted MACs",
      description: "Replace the trusted MAC whitelist with the provided full MAC list.",
      op: "sync_trusted_mac",
      parameters: TrustedMacSyncSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as TrustedMacSyncParams;
        const macs = args.macs.map((value) => normalizeMac(value).toLowerCase());
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            macs,
            values: args.values ?? Array(macs.length).fill("1"),
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as TrustedMacSyncParams;
        return `Synced ${args.macs.length} trusted MACs on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_auth_serv",
      label: "OpenClaw WRT Get Auth Server",
      description: "Get the current captive portal authentication server configuration.",
      op: "get_auth_serv",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched auth server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_auth_serv",
      label: "OpenClaw WRT Set Auth Server",
      description: "Set the captive portal authentication server hostname, port, and path.",
      op: "set_auth_serv",
      parameters: SetAuthServerSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetAuthServerParams;
        const payload: JsonRecord = { hostname: args.hostname };
        if (args.port !== undefined) {
          payload.port = args.port;
        }
        if (typeof args.path === "string") {
          payload.path = args.path;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetAuthServerParams;
        return `Updated auth server for ${args.deviceId} to ${args.hostname}.`;
      },
    }),
    createGeneratePortalPageTool(bridge),
    createPublishPortalPageTool(bridge),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_mqtt_serv",
      label: "OpenClaw WRT Get MQTT Server",
      description: "Get the current MQTT server configuration for the device.",
      op: "get_mqtt_serv",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched MQTT server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_mqtt_serv",
      label: "OpenClaw WRT Set MQTT Server",
      description: "Set the MQTT server hostname, port, credentials, and TLS flag.",
      op: "set_mqtt_serv",
      parameters: SetMqttServerSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetMqttServerParams;
        const payload: JsonRecord = {};
        if (typeof args.hostname === "string") {
          payload.hostname = args.hostname;
        }
        if (args.port !== undefined) {
          payload.port = args.port;
        }
        if (typeof args.username === "string") {
          payload.username = args.username;
        }
        if (typeof args.password === "string") {
          payload.password = args.password;
        }
        if (typeof args.useSsl === "boolean") {
          payload.use_ssl = args.useSsl;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetMqttServerParams;
        return `Updated MQTT server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_websocket_serv",
      label: "OpenClaw WRT Get WebSocket Server",
      description: "Get the current WebSocket server configuration for the device.",
      op: "get_websocket_serv",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched WebSocket server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_websocket_serv",
      label: "OpenClaw WRT Set WebSocket Server",
      description: "Set the WebSocket server hostname, port, path, and TLS flag.",
      op: "set_websocket_serv",
      parameters: SetWebsocketServerSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWebsocketServerParams;
        const payload: JsonRecord = {};
        if (typeof args.hostname === "string") {
          payload.hostname = args.hostname;
        }
        if (args.port !== undefined) {
          payload.port = args.port;
        }
        if (typeof args.path === "string") {
          payload.path = args.path;
        }
        if (typeof args.useSsl === "boolean") {
          payload.use_ssl = args.useSsl;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWebsocketServerParams;
        return `Updated WebSocket server config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_wireguard_vpn",
      label: "OpenClaw WRT Get WireGuard VPN",
      description: "Get WireGuard VPN configuration (single tunnel mode: wg0).",
      op: "get_wireguard_vpn",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched WireGuard VPN config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_wireguard_vpn",
      label: "OpenClaw WRT Set WireGuard VPN",
      description:
        "Set WireGuard VPN configuration for a single tunnel (wg0), including interface and peers.",
      op: "set_wireguard_vpn",
      parameters: SetWireguardVpnSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetWireguardVpnParams;
        const interfacePayload = mapWireguardInterfacePayload(asObject(args.interface) ?? {});
        const peersPayload = (args.peers ?? []).map((entry) =>
          mapWireguardPeerPayload(asObject(entry) ?? {}),
        );

        return {
          deviceId: args.deviceId.trim(),
          payload: {
            data: {
              interface: interfacePayload,
              peers: peersPayload,
            },
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetWireguardVpnParams;
        return `Updated WireGuard VPN config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_reset_wireguard_vpn",
      label: "OpenClaw WRT Reset WireGuard VPN",
      description:
        "Reset router-side WireGuard VPN configuration (default interface wg0), including peer definitions and tunnel routes.",
      op: "reset_wireguard_vpn",
      parameters: ResetWireguardVpnSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as ResetWireguardVpnParams;
        const payload: JsonRecord = {};
        if (typeof args.interface === "string") {
          payload.interface = args.interface;
        }
        if (typeof args.flushRoutes === "boolean") {
          payload.flush_routes = args.flushRoutes;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload: { data: payload },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as ResetWireguardVpnParams;
        return `Reset WireGuard VPN config on ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_get_wireguard_vpn_status",
      label: "OpenClaw WRT Get WireGuard VPN Status",
      description:
        "Get runtime WireGuard status from both the router (peer handshake/traffic) and the local OpenClaw server (tunnel presence).",
      parameters: DeviceOnlySchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_get_wireguard_vpn_status", rawParams);
        const args = rawParams as DeviceOnlyParams;
        const deviceId = args.deviceId.trim();

        // 1. Fetch status from router
        let routerStatus: JsonRecord | null = null;
        let routerError: string | null = null;
        try {
          routerStatus = await callDeviceOp({
            bridge,
            deviceId,
            op: "get_wireguard_vpn_status",
            timeoutMs: args.timeoutMs,
          });
        } catch (error) {
          routerError = error instanceof Error ? error.message : String(error);
        }

        // 2. Fetch status from local server (if available/applicable)
        let serverStatus: string = "unavailable";
        let snatMissing = true;
        let ipForwardEnabled = false;
        let probesSuccessful = false;

        try {
          const { execSync } = await import("node:child_process");
          const wgOutput = execSync("wg show 2>&1 || echo 'wg not found/active'", {
            encoding: "utf-8",
            timeout: 5000,
          });
          const iptablesOutput = execSync("iptables -t nat -S POSTROUTING", {
            encoding: "utf-8",
            timeout: 5000,
          });
          snatMissing = !iptablesOutput.includes("-j MASQUERADE");
          const sysctlOutput = execSync("sysctl -n net.ipv4.ip_forward", {
            encoding: "utf-8",
            timeout: 2000,
          });
          ipForwardEnabled = sysctlOutput.trim() === "1";

          serverStatus =
            `--- WireGuard ---\n${wgOutput}\n` +
            `--- NAT Rules ---\n${iptablesOutput}\n` +
            `--- IP Forwarding ---\n${ipForwardEnabled ? "Enabled (1)" : "Disabled (0)"}`;
          probesSuccessful = true;
        } catch (error) {
          serverStatus = `Error fetching server status: ${error instanceof Error ? error.message : String(error)}`;
        }

        const summary = `Fetched WireGuard VPN status for ${deviceId}.`;
        let text =
          `${summary}\n\n` +
          `--- ROUTER SIDE (${deviceId}) ---\n` +
          (routerError ? `Error: ${routerError}` : JSON.stringify(routerStatus, null, 2)) +
          `\n\n--- SERVER SIDE (OpenClaw Server) ---\n` +
          serverStatus;

        if (probesSuccessful) {
          if (snatMissing) {
            text +=
              "\n\nWARNING: SNAT (MASQUERADE) rule might be missing on the server side. Full tunnel traffic may not reach the internet.";
          }
          if (!ipForwardEnabled) {
            text += "\nWARNING: IP forwarding is disabled on the server side.";
          }
        }

        return buildToolResult(text, {
          router: routerStatus ?? { error: routerError },
          server: serverStatus,
          serverChecks: { snatMissing, ipForwardEnabled },
        });
      },
    },
    {
      name: "clawwrt_verify_wireguard_connectivity",
      label: "OpenClaw WRT Verify WireGuard Connectivity",
      description:
        "Batch-verify WireGuard connectivity across all (or specified) online routers. For each device, fetches router-side handshake/traffic status and server-side wg/NAT/forwarding state. Optionally pings tunnel IPs from the VPS to confirm end-to-end reachability. Returns a consolidated report.",
      parameters: VerifyWireguardConnectivitySchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_verify_wireguard_connectivity", rawParams);
        const args = rawParams as {
          deviceIds?: string[];
          pingTargets?: string[];
          timeoutMs?: number;
        };
        const { execSync } = await import("node:child_process");

        // Resolve device list
        const deviceIds =
          Array.isArray(args.deviceIds) && args.deviceIds.length > 0
            ? args.deviceIds.map((d) => d.trim())
            : bridge.listDevices().map((d) => d.deviceId.trim());

        if (deviceIds.length === 0) {
          throw new Error("No online devices found. Ensure routers are connected to OpenClaw.");
        }

        // Server-side checks (once)
        let serverSummary = "unavailable";
        let snatOk = false;
        let ipForwardOk = false;
        try {
          const wgOut = execSync("sudo wg show 2>&1 || echo 'wg not found'", {
            encoding: "utf-8",
            timeout: 5000,
          });
          const natOut = execSync("sudo iptables -t nat -S POSTROUTING", {
            encoding: "utf-8",
            timeout: 5000,
          });
          const fwdOut = execSync("sysctl -n net.ipv4.ip_forward", {
            encoding: "utf-8",
            timeout: 2000,
          });
          snatOk = natOut.includes("-j MASQUERADE");
          ipForwardOk = fwdOut.trim() === "1";
          serverSummary = wgOut.trim();
        } catch (error) {
          serverSummary = `Server probe error: ${error instanceof Error ? error.message : String(error)}`;
        }

        // Per-device router-side checks
        const deviceResults: Array<{
          deviceId: string;
          handshakeAge?: string;
          rxBytes?: number;
          txBytes?: number;
          error?: string;
        }> = [];
        for (const deviceId of deviceIds) {
          try {
            const status = await callDeviceOp({
              bridge,
              deviceId,
              op: "get_wireguard_vpn_status",
              timeoutMs: args.timeoutMs,
            });
            const peer = (status as JsonRecord)?.peers as JsonRecord[] | undefined;
            const first = Array.isArray(peer) ? peer[0] : undefined;
            deviceResults.push({
              deviceId,
              handshakeAge: (first as JsonRecord | undefined)?.last_handshake_time as
                | string
                | undefined,
              rxBytes: (first as JsonRecord | undefined)?.receive_bytes as number | undefined,
              txBytes: (first as JsonRecord | undefined)?.transmit_bytes as number | undefined,
            });
          } catch (error) {
            deviceResults.push({
              deviceId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Optional ping tests from VPS
        const pingResults: Array<{ target: string; reachable: boolean; output: string }> = [];
        for (const target of args.pingTargets ?? []) {
          // Validate: must be a plain IPv4 address to prevent command injection
          if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(target)) {
            pingResults.push({ target, reachable: false, output: "skipped: invalid IPv4 address" });
            continue;
          }
          try {
            const out = execSync(`ping -c 3 -W 2 ${target}`, {
              encoding: "utf-8",
              timeout: 10000,
            });
            pingResults.push({ target, reachable: true, output: out.trim() });
          } catch (error) {
            const out = error instanceof Error ? error.message : String(error);
            pingResults.push({ target, reachable: false, output: out });
          }
        }

        // Build report
        let report = `## WireGuard Connectivity Report\n\n`;
        report += `### Server Side\n`;
        report += `- IP Forwarding: ${ipForwardOk ? "✅ enabled" : "❌ disabled"}\n`;
        report += `- SNAT/MASQUERADE: ${snatOk ? "✅ present" : "❌ missing"}\n`;
        report += `\`\`\`\n${serverSummary}\n\`\`\`\n\n`;

        report += `### Router Status (${deviceIds.length} device(s))\n`;
        for (const r of deviceResults) {
          if (r.error) {
            report += `- ${r.deviceId}: ❌ ${r.error}\n`;
          } else {
            const handshake = r.handshakeAge ?? "unknown";
            const traffic = `rx=${r.rxBytes ?? 0} tx=${r.txBytes ?? 0}`;
            report += `- ${r.deviceId}: handshake=${handshake} ${traffic}\n`;
          }
        }

        if (pingResults.length > 0) {
          report += `\n### Ping Tests\n`;
          for (const p of pingResults) {
            report += `- ${p.target}: ${p.reachable ? "✅ reachable" : "❌ unreachable"} — ${p.output.split("\n").at(-2) ?? p.output}\n`;
          }
        }

        const warnings: string[] = [];
        if (!ipForwardOk) warnings.push("IP forwarding disabled on server");
        if (!snatOk) warnings.push("SNAT/MASQUERADE rule missing on server");
        for (const r of deviceResults) {
          if (r.error) warnings.push(`${r.deviceId}: ${r.error}`);
        }
        for (const p of pingResults) {
          if (!p.reachable) warnings.push(`ping ${p.target}: unreachable`);
        }

        return buildToolResult(report, {
          server: { snatOk, ipForwardOk, wgShow: serverSummary },
          devices: deviceResults,
          pingResults,
          warnings,
        });
      },
    },
    {
      name: "clawwrt_deploy_wireguard_full_mesh",
      label: "OpenClaw WRT Deploy WireGuard Full Mesh",
      description:
        "Full end-to-end WireGuard mesh deployment in the correct order: (1) generate keys on each router, (2) register/upsert each peer on VPS, (3) push tunnel config to each router, (4) add VPS /32 protection route + selective LAN routes (or full-tunnel with excludeIp), (5) reconcile LAN mesh routes and update VPS peer AllowedIPs, (6) verify connectivity. Requires openclaw_deploy_wg_server to have been run already so that serverPublicKey is known.",
      parameters: FullMeshDeploySchema,
      execute: async (_toolCallId, rawParams) => {
        const args = rawParams as {
          nodes: Array<{ deviceId: string; tunnelIp: string; lanCidr?: string }>;
          serverPublicKey: string;
          serverEndpoint: string;
          fullTunnel?: boolean;
          timeoutMs?: number;
        };

        const steps: string[] = [];
        const log = (msg: string) => {
          steps.push(msg);
        };

        // Parse server endpoint to extract VPS public IP for anti-loop route
        const endpointHost = args.serverEndpoint.split(":")[0] ?? "";
        const isValidIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(endpointHost);

        type NodeResult = {
          deviceId: string;
          tunnelIp: string;
          peerPublicKey?: string;
          lanCidr?: string;
          error?: string;
        };
        const results: NodeResult[] = [];

        // Step 1 & 2: Per-device key generation + peer registration
        log("## Step 1+2: Generate keys and register peers");
        for (const node of args.nodes) {
          const deviceId = node.deviceId.trim();
          const tunnelIp = node.tunnelIp.trim();
          const entry: NodeResult = { deviceId, tunnelIp, lanCidr: node.lanCidr?.trim() };
          try {
            // Generate keys on router
            const keyResp = await callDeviceOp({
              bridge,
              deviceId,
              op: "generate_wireguard_keys",
              timeoutMs: args.timeoutMs,
            });
            const pubKey =
              ((keyResp as JsonRecord)?.public_key as string) ??
              ((keyResp as JsonRecord)?.publicKey as string) ??
              ((keyResp as JsonRecord)?.data as JsonRecord)?.public_key as string;
            if (!pubKey) {
              throw new Error("public_key not found in generate_wireguard_keys response");
            }
            entry.peerPublicKey = pubKey;
            log(`  ✅ ${deviceId}: public key obtained`);

            // Register/upsert peer on VPS
            const allowedIps = [tunnelIp];
            if (entry.lanCidr) {
              allowedIps.push(entry.lanCidr);
            }
            await upsertWireguardPeerOnServer({
              publicKey: pubKey,
              allowedIps,
            });
            log(`  ✅ ${deviceId}: peer upserted (allowedIps: ${allowedIps.join(", ")})`);
          } catch (error) {
            entry.error = error instanceof Error ? error.message : String(error);
            log(`  ❌ ${deviceId}: ${entry.error}`);
          }
          results.push(entry);
        }

        const okNodes = results.filter((r) => !r.error);

        // Step 3: Push tunnel config to each router
        log("\n## Step 3: Push tunnel config to routers");
        for (const node of okNodes) {
          try {
            await callDeviceOp({
              bridge,
              deviceId: node.deviceId,
              op: "set_wireguard_vpn",
              payload: {
                data: {
                  server_public_key: args.serverPublicKey,
                  server_endpoint: args.serverEndpoint,
                  tunnel_ip: node.tunnelIp,
                  route_allowed_ips: 0,
                  allowed_ips: "0.0.0.0/0",
                  keepalive: 25,
                },
              },
              timeoutMs: args.timeoutMs,
            });
            log(`  ✅ ${node.deviceId}: tunnel config pushed`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            node.error = msg;
            log(`  ❌ ${node.deviceId}: ${msg}`);
          }
        }

        const tunnelOkNodes = okNodes.filter((r) => !r.error);

        // Step 4: Routes — VPS /32 anti-loop + mesh LAN selective (or full-tunnel exclusion)
        log("\n## Step 4: Push routes");
        for (const node of tunnelOkNodes) {
          if (args.fullTunnel) {
            if (!isValidIp) {
              log(`  ⚠️  ${node.deviceId}: full-tunnel skipped — serverEndpoint must be an IPv4 address (not hostname) to set exclude_ips safely`);
              continue;
            }
            // Full-tunnel: must exclude VPS public IP to prevent loop
            try {
              await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "set_vpn_routes",
                payload: { data: { mode: "full_tunnel", exclude_ips: [endpointHost] } },
                timeoutMs: args.timeoutMs,
              });
              log(`  ✅ ${node.deviceId}: full-tunnel routes set (excludeIp=${endpointHost})`);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              log(`  ⚠️  ${node.deviceId}: full-tunnel set_vpn_routes warning: ${msg}`);
            }
          } else if (isValidIp) {
            // Selective: add VPS /32 protection route only; skip if no IP to protect
            try {
              await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "set_vpn_routes",
                payload: { data: { mode: "selective", routes: [`${endpointHost}/32`] } },
                timeoutMs: args.timeoutMs,
              });
              log(`  ✅ ${node.deviceId}: anti-loop VPS route set (${endpointHost}/32)`);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              log(`  ⚠️  ${node.deviceId}: set_vpn_routes warning: ${msg}`);
            }
          } else {
            log(`  ℹ️  ${node.deviceId}: skipping base routes — serverEndpoint is a hostname, VPS /32 anti-loop route cannot be added automatically`);
          }
        }

        // Step 5: Reconcile LAN mesh (also upserts VPS peer AllowedIPs with LAN CIDRs)
        log("\n## Step 5: Reconcile LAN mesh");
        try {
          const meshNodes = tunnelOkNodes.map((n) => ({
            deviceId: n.deviceId,
            tunnelIp: n.tunnelIp,
            peerPublicKey: n.peerPublicKey,
            lanCidr: n.lanCidr,
          }));
          // Re-use the reconcile logic by calling it directly
          const reconcileResult = await (async () => {
            const pseudoBridge = bridge;
            // Build candidates: fetch lanCidr for nodes that don't have it
            const resolved: Array<{
              deviceId: string;
              tunnelIp: string;
              peerPublicKey?: string;
              lanCidr?: string;
            }> = [];
            for (const n of meshNodes) {
              if (!n.lanCidr) {
                try {
                  const status = await callDeviceOp({
                    bridge: pseudoBridge,
                    deviceId: n.deviceId,
                    op: "get_status",
                    timeoutMs: args.timeoutMs,
                  });
                  const detected = extractLanCidrFromStatusResponse(status);
                  resolved.push({ ...n, lanCidr: detected ?? undefined });
                } catch {
                  resolved.push(n);
                }
              } else {
                resolved.push(n);
              }
            }
            return resolved;
          })();

          // Fan-out: for each node push all other nodes' LAN CIDRs.
          // Preserve VPS /32 anti-loop route set in Step 4 by prepending it when known.
          const validForMesh = reconcileResult.filter(
            (n): n is typeof n & { lanCidr: string } => typeof n.lanCidr === "string",
          );
          for (const node of validForMesh) {
            const otherLans = validForMesh
              .filter((o) => o.deviceId !== node.deviceId)
              .map((o) => o.lanCidr);
            if (otherLans.length === 0) {
              continue;
            }
            // Include VPS /32 anti-loop route so flush+re-add does not lose it.
            const meshRoutes = isValidIp ? [`${endpointHost}/32`, ...otherLans] : otherLans;
            try {
              await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "set_vpn_routes",
                payload: { data: { mode: "selective", routes: meshRoutes } },
                timeoutMs: args.timeoutMs,
              });
              log(`  ✅ ${node.deviceId}: mesh routes set → [${meshRoutes.join(", ")}]`);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              log(`  ⚠️  ${node.deviceId}: mesh routes warning: ${msg}`);
            }

            // Upsert VPS peer AllowedIPs to include LAN
            if (node.peerPublicKey) {
              try {
                await upsertWireguardPeerOnServer({
                  publicKey: node.peerPublicKey,
                  allowedIps: [node.tunnelIp, node.lanCidr],
                });
                log(`  ✅ ${node.deviceId}: VPS peer AllowedIPs updated with LAN`);
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                log(`  ⚠️  ${node.deviceId}: VPS peer update warning: ${msg}`);
              }
            }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log(`  ❌ mesh reconcile failed: ${msg}`);
        }

        // Step 6: Connectivity verification
        log("\n## Step 6: Verify connectivity");
        let verifyReport = "";
        try {
          const { execSync } = await import("node:child_process");
          let serverSummary = "unavailable";
          let snatOk = false;
          let ipForwardOk = false;
          try {
            const wgOut = String(
              execSync("sudo wg show 2>&1 || echo 'wg not found'", {
                encoding: "utf-8",
                timeout: 5000,
              }),
            ).trim();
            const natOut = String(
              execSync("sudo iptables -t nat -S POSTROUTING 2>/dev/null", {
                encoding: "utf-8",
                timeout: 5000,
              }),
            );
            const fwdOut = String(
              execSync("sysctl -n net.ipv4.ip_forward", { encoding: "utf-8", timeout: 2000 }),
            );
            snatOk = natOut.includes("-j MASQUERADE");
            ipForwardOk = fwdOut.trim() === "1";
            serverSummary = wgOut;
          } catch {}

          verifyReport += `Server: ipForward=${ipForwardOk ? "✅" : "❌"} snat=${snatOk ? "✅" : "❌"}\n`;
          verifyReport += `WG peers:\n${serverSummary}\n`;

          for (const node of tunnelOkNodes) {
            try {
              const status = await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "get_wireguard_vpn_status",
                timeoutMs: args.timeoutMs,
              });
              const peers = (status as JsonRecord)?.peers as JsonRecord[] | undefined;
              const first = Array.isArray(peers) ? peers[0] : undefined;
              const handshake = (first as JsonRecord | undefined)?.last_handshake_time ?? "unknown";
              verifyReport += `  ${node.deviceId}: handshake=${handshake}\n`;
            } catch (error) {
              verifyReport += `  ${node.deviceId}: ❌ ${error instanceof Error ? error.message : String(error)}\n`;
            }
          }
          log(verifyReport);
        } catch (error) {
          log(`  ❌ verification error: ${error instanceof Error ? error.message : String(error)}`);
        }

        const failedNodes = results.filter((r) => r.error);
        const summary =
          `\n## Summary\n` +
          `Configured: ${tunnelOkNodes.length}/${args.nodes.length} routers\n` +
          (failedNodes.length > 0
            ? `Failed: ${failedNodes.map((r) => `${r.deviceId}: ${r.error}`).join("; ")}\n`
            : "") +
          `Mode: ${args.fullTunnel ? "full-tunnel" : "selective/mesh"}\n`;

        return buildToolResult(steps.join("\n") + summary, {
          nodes: results,
          tunnelOkCount: tunnelOkNodes.length,
          totalCount: args.nodes.length,
          fullTunnel: args.fullTunnel ?? false,
        });
      },
    },
    {
      name: "clawwrt_setup_server_vpn_nat",
      label: "OpenClaw WRT Setup Server VPN NAT",
      description: "Automate server-side SNAT (MASQUERADE) configuration and enable IP forwarding.",
      parameters: Type.Object(
        {
          wanInterface: Type.Optional(
            Type.String({
              description: "Public WAN interface name (e.g., eth0). Auto-detected if omitted.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_setup_server_vpn_nat", rawParams);
        const args = rawParams as { wanInterface?: string };
        const { execSync } = await import("node:child_process");

        let wan = args.wanInterface?.trim();
        if (!wan) {
          wan = detectServerEgressInterface(execSync);
        }

        if (!wan || !/^[a-zA-Z0-9.\-_@]+$/.test(wan)) {
          const interfaces = listServerInterfacesWithIp(execSync);
          const recommended = detectRecommendedServerInterface(execSync);
          const recommendationLine = recommended
            ? `Recommended outbound interface (best guess): ${recommended}\n`
            : "";
          throw new Error(
            `Unable to determine WAN interface automatically.\n` +
              recommendationLine +
              `Detected VPS interfaces and IPv4:\n${interfaces}\n` +
              `Please ask user to choose the outbound interface and rerun with wanInterface set explicitly.`,
          );
        }

        const natRuleComment = "OPENCLAW_WG_wg0";
        const setupCommand = [
          `sudo sysctl -w net.ipv4.ip_forward=1`,
          `sudo iptables -t nat -C POSTROUTING -m comment --comment ${natRuleComment} -o ${wan} -j MASQUERADE || sudo iptables -t nat -A POSTROUTING -m comment --comment ${natRuleComment} -o ${wan} -j MASQUERADE`,
          `sudo iptables -C FORWARD -i wg0 -j ACCEPT || sudo iptables -A FORWARD -i wg0 -j ACCEPT`,
          `sudo iptables -C FORWARD -o wg0 -j ACCEPT || sudo iptables -A FORWARD -o wg0 -j ACCEPT`,
        ].join(" && ");

        const output = execSync(setupCommand, { encoding: "utf-8" });
        return buildToolResult(
          `Server-side VPN NAT configured using interface ${wan}.\n${output}`,
          {
            wanInterface: wan,
            output,
          },
        );
      },
    },
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_generate_wireguard_keys",
      label: "OpenClaw WRT Generate WireGuard Keys",
      description:
        "Generate a WireGuard key pair on the router. The private key is written directly to UCI (network.wg0.private_key) and never leaves the device. Only the public key is returned. Use this BEFORE set_wireguard_vpn to avoid sending private keys over the network.",
      op: "generate_wireguard_keys",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Generated WireGuard keys on ${args.deviceId}. Public key returned; private key stored locally.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_vpn_routes",
      label: "OpenClaw WRT Get VPN Routes",
      description:
        "Get current VPN routing table entries (ip route show dev wg0 proto static). Shows which traffic is being steered through the WireGuard tunnel.",
      op: "get_vpn_routes",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched VPN routes for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_vpn_domain_routes",
      label: "OpenClaw WRT Set VPN Domain Routes",
      description:
        "Resolve one or more domain names to IPv4 addresses and add each resolved address as an ip/32 static route through wg0.",
      op: "set_vpn_domain_routes",
      parameters: SetVpnDomainRoutesSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetVpnDomainRoutesParams;
        return {
          deviceId: args.deviceId.trim(),
          payload: {
            data: {
              domains: args.domains,
              interface: args.interface,
            },
          },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetVpnDomainRoutesParams;
        return `Resolved domain routes for ${args.domains.length} domain(s) on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_vpn_routes",
      label: "OpenClaw WRT Set VPN Routes",
      description:
        "Set VPN routing rules to steer traffic through the WireGuard tunnel. Selective mode routes specific CIDRs; full_tunnel mode routes all traffic (0.0.0.0/1 + 128.0.0.0/1) with exclude_ips to prevent routing loop for VPS IP.",
      op: "set_vpn_routes",
      parameters: SetVpnRoutesSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as SetVpnRoutesParams;
        const payload: JsonRecord = { mode: args.mode };
        if (Array.isArray(args.routes)) {
          payload.routes = args.routes;
        }
        if (Array.isArray(args.excludeIps)) {
          payload.exclude_ips = args.excludeIps;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload: { data: payload },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as SetVpnRoutesParams;
        return `Set VPN routes (${args.mode} mode) on ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_plan_wireguard_client_routes",
      label: "OpenClaw WRT Plan WireGuard Client Routes",
      description:
        "For selected routers, fetch each br-lan CIDR, detect overlapping LAN subnets, and calculate the per-router selective route list for clawwrt_set_vpn_routes. Each router's routes are all selected LAN CIDRs except its own.",
      parameters: PlanWireguardClientRoutesSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_plan_wireguard_client_routes", rawParams);
        const args = rawParams as PlanWireguardClientRoutesParams;
        const deviceIds = [
          ...new Set((Array.isArray(args.deviceIds) ? args.deviceIds : []).map((id) => id.trim()).filter(Boolean)),
        ];

        if (deviceIds.length === 0) {
          throw new Error("At least one deviceId is required.");
        }

        const onlineDevices = new Map(
          bridge.listDevices().map((entry) => [entry.deviceId.trim(), entry] as const),
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
              bridge,
              deviceId,
              op: "get_br_lan",
              timeoutMs: args.timeoutMs,
            });
            const cidr = (result as JsonRecord)?.cidr;
            const parsed = typeof cidr === "string" ? parseIPv4Cidr(cidr) : null;
            devices.push({
              deviceId,
              deviceName: onlineDevices.get(deviceId)?.alias,
              lanCidr: parsed?.normalized,
              error: parsed ? undefined : `missing_or_invalid_cidr: ${typeof cidr === "string" ? cidr : "(none)"}`,
            });
          } catch (error) {
            devices.push({
              deviceId,
              deviceName: onlineDevices.get(deviceId)?.alias,
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
            : validDevices.map((entry) => ({
                deviceId: entry.deviceId,
                deviceName: entry.deviceName,
                lanCidr: entry.lanCidr,
                routes: validDevices
                  .filter((candidate) => candidate.deviceId !== entry.deviceId)
                  .map((candidate) => candidate.lanCidr),
              }));

        const failedDevices = devices.filter((entry) => entry.error);
        const text =
          conflicts.length > 0
            ? `WireGuard client route plan blocked: LAN conflicts detected for ${blockedDeviceIds.size} device(s). Resolve the LAN overlap before configuring clients.`
            : `WireGuard client route plan ready for ${routePlans.length} device(s).`;

        return buildToolResult(text, {
          hasConflict: conflicts.length > 0,
          devices,
          failedDevices,
          conflicts,
          blockedDeviceIds: [...blockedDeviceIds],
          routePlans,
        });
      },
    },
    {
      name: "clawwrt_reconcile_wireguard_lan_mesh",
      label: "OpenClaw WRT Reconcile WireGuard LAN Mesh",
      description:
        "Auto-build LAN mesh routing for 2+ WireGuard routers. Collects each router br-lan CIDR, blocks conflicting subnets, upserts VPS peer AllowedIPs when possible, and pushes selective routes for every router to reach all other LANs through wg0.",
      parameters: ReconcileWireguardLanMeshSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_reconcile_wireguard_lan_mesh", rawParams);
        const args = rawParams as ReconcileWireguardLanMeshParams;
        const debugLogs: string[] = [];
        const dbg = (msg: string) => debugLogs.push(`[reconcile] ${msg}`);

        const providedNodes = Array.isArray(args.nodes) ? args.nodes : [];
        type MeshNodeInput = {
          deviceId: string;
          tunnelIp?: string;
          peerPublicKey?: string;
          lanCidr?: string;
        };

        dbg(`input: providedNodes=${providedNodes.length}, updateServerPeers=${args.updateServerPeers ?? true}, timeoutMs=${args.timeoutMs ?? "default"}`);

        const baseNodes =
          providedNodes.length > 0
            ? providedNodes.map((entry): MeshNodeInput => ({
                deviceId: entry.deviceId.trim(),
                tunnelIp: entry.tunnelIp.trim(),
                peerPublicKey: entry.peerPublicKey?.trim(),
                lanCidr: entry.lanCidr?.trim(),
              }))
            : bridge
                .listDevices()
                .map((entry): MeshNodeInput => ({ deviceId: entry.deviceId.trim() }));

        dbg(`baseNodes after source: ${baseNodes.map((n) => n.deviceId).join(", ")}`);

        const uniqueNodeMap = new Map<string, MeshNodeInput>();
        for (const node of baseNodes) {
          if (!node.deviceId) {
            dbg(`skipped node with empty deviceId`);
            continue;
          }
          if (!uniqueNodeMap.has(node.deviceId)) {
            uniqueNodeMap.set(node.deviceId, node);
          } else {
            dbg(`duplicate deviceId dropped: ${node.deviceId}`);
          }
        }
        const nodes = [...uniqueNodeMap.values()];
        dbg(`unique nodes: ${nodes.length} — ${nodes.map((n) => n.deviceId).join(", ")}`);

        if (nodes.length < 2) {
          throw new Error("at least two online devices (or two explicit nodes) are required");
        }

        const blocked: Array<{ deviceId: string; reason: string; lanCidr?: string }> = [];
        const candidates: Array<{
          deviceId: string;
          tunnel?: IPv4CidrInfo;
          lan: IPv4CidrInfo;
          peerPublicKey?: string;
        }> = [];

        // ── Phase 1: LAN CIDR collection ───────────────────────────────────
        dbg(`--- Phase 1: LAN CIDR collection (${nodes.length} nodes) ---`);
        for (const node of nodes) {
          let lanCidr = node.lanCidr ?? null;
          const lanSource = lanCidr ? "provided" : "auto-detect";
          if (!lanCidr) {
            dbg(`[${node.deviceId}] lanCidr not provided — calling get_status`);
            try {
              const status = await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "get_status",
                timeoutMs: args.timeoutMs,
              });
              lanCidr = extractLanCidrFromStatusResponse(status);
              dbg(`[${node.deviceId}] get_status ok — extracted lanCidr="${lanCidr ?? "(null)"}"`);
            } catch (error) {
              const reason = `failed_to_fetch_status: ${error instanceof Error ? error.message : String(error)}`;
              dbg(`[${node.deviceId}] get_status FAILED — ${reason}`);
              blocked.push({ deviceId: node.deviceId, reason });
              continue;
            }
          } else {
            dbg(`[${node.deviceId}] lanCidr provided="${lanCidr}"`);
          }

          const parsedLan = lanCidr ? parseIPv4Cidr(lanCidr) : null;
          if (!parsedLan) {
            const reason = "missing_or_invalid_br_lan_cidr";
            dbg(`[${node.deviceId}] parseIPv4Cidr("${lanCidr}") failed (source=${lanSource}) — blocked: ${reason}`);
            blocked.push({ deviceId: node.deviceId, reason, lanCidr: lanCidr ?? undefined });
            continue;
          }
          dbg(`[${node.deviceId}] parsedLan="${parsedLan.normalized}" (source=${lanSource})`);

          const parsedTunnel = node.tunnelIp ? parseIPv4Cidr(node.tunnelIp) : null;
          if (node.tunnelIp && !parsedTunnel) {
            const reason = "invalid_tunnel_ip_cidr";
            dbg(`[${node.deviceId}] parseIPv4Cidr(tunnelIp="${node.tunnelIp}") failed — blocked: ${reason}`);
            blocked.push({ deviceId: node.deviceId, reason, lanCidr: parsedLan.normalized });
            continue;
          }
          dbg(`[${node.deviceId}] parsedTunnel="${parsedTunnel?.normalized ?? "(none)"}", peerPublicKey="${node.peerPublicKey ? node.peerPublicKey.substring(0, 8) + "..." : "(none)"}"`);

          candidates.push({
            deviceId: node.deviceId,
            tunnel: parsedTunnel ?? undefined,
            lan: parsedLan,
            peerPublicKey: node.peerPublicKey,
          });
        }
        dbg(`Phase 1 done: candidates=${candidates.length}, blocked so far=${blocked.length}`);

        // ── Phase 2: Conflict detection ────────────────────────────────────
        dbg(`--- Phase 2: Conflict detection (${candidates.length} candidates) ---`);
        const conflictMap = new Map<string, Set<string>>();
        for (let i = 0; i < candidates.length; i += 1) {
          for (let j = i + 1; j < candidates.length; j += 1) {
            const left = candidates[i]!;
            const right = candidates[j]!;
            const overlaps = cidrOverlaps(left.lan, right.lan);
            dbg(`  cidrOverlaps(${left.deviceId}:${left.lan.normalized}, ${right.deviceId}:${right.lan.normalized}) = ${overlaps}`);
            if (!overlaps) {
              continue;
            }
            const leftSet = conflictMap.get(left.deviceId) ?? new Set<string>();
            leftSet.add(right.deviceId);
            conflictMap.set(left.deviceId, leftSet);
            const rightSet = conflictMap.get(right.deviceId) ?? new Set<string>();
            rightSet.add(left.deviceId);
            conflictMap.set(right.deviceId, rightSet);
          }
        }

        const accepted = candidates.filter((entry) => !conflictMap.has(entry.deviceId));
        for (const [deviceId, peers] of conflictMap.entries()) {
          const lan = candidates.find((entry) => entry.deviceId === deviceId)?.lan.normalized;
          blocked.push({
            deviceId,
            lanCidr: lan,
            reason: `conflicting_subnet_with:${[...peers].join(",")}`,
          });
        }
        dbg(`Phase 2 done: accepted=${accepted.length} [${accepted.map((n) => `${n.deviceId}(${n.lan.normalized})`).join(", ")}], newly blocked by conflict=${conflictMap.size}`);

        const routeUpdates: Array<{ deviceId: string; routes: string[]; status: "success" | "error"; error?: string }> = [];
        const serverPeerUpdates: Array<{
          deviceId: string;
          status: "updated" | "skipped" | "error";
          reason?: string;
          allowedIps?: string[];
        }> = [];

        // ── Phase 3: VPS peer AllowedIPs upsert ───────────────────────────
        dbg(`--- Phase 3: VPS peer AllowedIPs upsert (updateServerPeers=${args.updateServerPeers ?? true}) ---`);
        if (accepted.length >= 2 && args.updateServerPeers !== false) {
          for (const node of accepted) {
            if (!node.peerPublicKey) {
              dbg(`[${node.deviceId}] skip VPS upsert — no peerPublicKey`);
              serverPeerUpdates.push({ deviceId: node.deviceId, status: "skipped", reason: "missing_peer_public_key" });
              continue;
            }
            if (!node.tunnel) {
              dbg(`[${node.deviceId}] skip VPS upsert — no tunnelIp`);
              serverPeerUpdates.push({ deviceId: node.deviceId, status: "skipped", reason: "missing_tunnel_ip" });
              continue;
            }
            const allowedIps = [node.tunnel.normalized, node.lan.normalized];
            dbg(`[${node.deviceId}] upsertWireguardPeerOnServer publicKey=${node.peerPublicKey.substring(0, 8)}... allowedIps=${JSON.stringify(allowedIps)}`);
            try {
              await upsertWireguardPeerOnServer({ publicKey: node.peerPublicKey, allowedIps });
              dbg(`[${node.deviceId}] VPS upsert ok`);
              serverPeerUpdates.push({ deviceId: node.deviceId, status: "updated", allowedIps });
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              dbg(`[${node.deviceId}] VPS upsert FAILED — ${reason}`);
              serverPeerUpdates.push({ deviceId: node.deviceId, status: "error", reason, allowedIps });
            }
          }
        } else {
          dbg(`Phase 3 skipped: accepted=${accepted.length} (need >=2) or updateServerPeers=false`);
        }

        // ── Phase 4: Route push ────────────────────────────────────────────
        dbg(`--- Phase 4: Route push (${accepted.length} accepted nodes) ---`);
        if (accepted.length >= 2) {
          for (const node of accepted) {
            const newLanRoutes = accepted
              .filter((entry) => entry.deviceId !== node.deviceId)
              .map((entry) => entry.lan.normalized);
            dbg(`[${node.deviceId}] newLanRoutes from peers: ${JSON.stringify(newLanRoutes)}`);
            if (newLanRoutes.length === 0) {
              dbg(`[${node.deviceId}] no peer LAN routes — skip`);
              continue;
            }

            // Preserve existing /32 routes (e.g. VPS anti-loop) so reconcile does not wipe them.
            let preservedRoutes: string[] = [];
            dbg(`[${node.deviceId}] calling get_vpn_routes to find existing /32 routes to preserve`);
            try {
              const existing = await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "get_vpn_routes",
                timeoutMs: args.timeoutMs,
              });
              const existingRoutes = (existing as JsonRecord)?.routes;
              dbg(`[${node.deviceId}] get_vpn_routes raw routes type=${Array.isArray(existingRoutes) ? "array" : typeof existingRoutes}, length=${Array.isArray(existingRoutes) ? existingRoutes.length : "N/A"}`);
              if (Array.isArray(existingRoutes)) {
                const newLanSet = new Set(newLanRoutes);
                for (const r of existingRoutes as JsonRecord[]) {
                  const dest =
                    typeof r.dest === "string" ? r.dest : typeof r === "string" ? r : "";
                  const keep = dest && dest.endsWith("/32") && !newLanSet.has(dest);
                  dbg(`[${node.deviceId}]   existing route dest="${dest}" endsWith(/32)=${dest.endsWith("/32")} inNewLanSet=${newLanSet.has(dest)} → ${keep ? "PRESERVE" : "skip"}`);
                  if (keep) {
                    preservedRoutes.push(dest);
                  }
                }
              }
            } catch (err) {
              dbg(`[${node.deviceId}] get_vpn_routes FAILED (ignored, no /32 preserved) — ${err instanceof Error ? err.message : String(err)}`);
            }
            dbg(`[${node.deviceId}] preservedRoutes: ${JSON.stringify(preservedRoutes)}`);

            const routes = [...preservedRoutes, ...newLanRoutes];
            dbg(`[${node.deviceId}] calling set_vpn_routes mode=selective routes=${JSON.stringify(routes)}`);
            try {
              const setResult = await callDeviceOp({
                bridge,
                deviceId: node.deviceId,
                op: "set_vpn_routes",
                payload: { data: { mode: "selective", routes } },
                timeoutMs: args.timeoutMs,
              });
              dbg(`[${node.deviceId}] set_vpn_routes ok — response=${JSON.stringify(setResult)}`);
              routeUpdates.push({ deviceId: node.deviceId, routes, status: "success" });
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : String(error);
              dbg(`[${node.deviceId}] set_vpn_routes FAILED — ${errMsg}`);
              routeUpdates.push({ deviceId: node.deviceId, routes, status: "error", error: errMsg });
            }
          }
        } else {
          dbg(`Phase 4 skipped: accepted=${accepted.length} (need >=2)`);
        }

        const summaryLines = [
          `WG LAN mesh reconciliation finished.`,
          `accepted=${accepted.length}, blocked=${blocked.length}, routeUpdates=${routeUpdates.length}`,
        ];
        if (conflictMap.size > 0) {
          summaryLines.push("conflicts detected: conflicting devices were blocked from mesh routes");
        }
        if (accepted.length < 2) {
          summaryLines.push("not enough non-conflicting devices to build mesh routes");
        }

        return buildToolResult(summaryLines.join("\n"), {
          accepted: accepted.map((entry) => ({
            deviceId: entry.deviceId,
            lanCidr: entry.lan.normalized,
            tunnelIp: entry.tunnel?.normalized,
          })),
          blocked,
          routeUpdates,
          serverPeerUpdates,
          debugLogs,
        });
      },
    },
    {
      name: "clawwrt_check_lan_conflict",
      label: "OpenClaw WRT Check LAN Conflict",
      description:
        "Step A of LAN mesh onboarding: fetch the new device's br-lan CIDR and compare it against all existing mesh devices. Returns hasConflict=true with conflict details if any subnet overlaps, or hasConflict=false when safe to proceed to clawwrt_join_wireguard_lan_mesh. If conflicts exist, use clawwrt_set_br_lan to change the new device IP, then re-run this check.",
      parameters: CheckLanConflictSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_check_lan_conflict", rawParams);
        const args = rawParams as CheckLanConflictParams;
        const newDeviceId = args.newDeviceId.trim();

        const existingIds: string[] =
          Array.isArray(args.existingDeviceIds) && args.existingDeviceIds.length > 0
            ? args.existingDeviceIds.map((id) => id.trim()).filter((id) => id !== newDeviceId)
            : bridge
                .listDevices()
                .map((d) => d.deviceId.trim())
                .filter((id) => id !== newDeviceId);

        // Fetch new device br-lan
        let newDeviceCidr: string;
        try {
          const result = await callDeviceOp({
            bridge,
            deviceId: newDeviceId,
            op: "get_br_lan",
            timeoutMs: args.timeoutMs,
          });
          const cidr = (result as JsonRecord)?.cidr;
          if (typeof cidr !== "string" || !cidr) throw new Error("no cidr field in response");
          newDeviceCidr = cidr;
        } catch (error) {
          throw new Error(
            `Failed to get br-lan for new device ${newDeviceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const parsedNew = parseIPv4Cidr(newDeviceCidr);
        if (!parsedNew) {
          throw new Error(`Invalid CIDR from new device ${newDeviceId}: ${newDeviceCidr}`);
        }

        // Fetch existing devices' br-lan CIDRs
        const existingDevices: Array<{ deviceId: string; cidr: string; error?: string }> = [];
        for (const deviceId of existingIds) {
          try {
            const result = await callDeviceOp({
              bridge,
              deviceId,
              op: "get_br_lan",
              timeoutMs: args.timeoutMs,
            });
            const cidr = (result as JsonRecord)?.cidr;
            existingDevices.push({ deviceId, cidr: typeof cidr === "string" ? cidr : "(unknown)" });
          } catch (error) {
            existingDevices.push({
              deviceId,
              cidr: "(failed)",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Detect conflicts
        const conflicts: Array<{ deviceId: string; cidr: string }> = [];
        for (const existing of existingDevices) {
          const parsedExisting = parseIPv4Cidr(existing.cidr);
          if (!parsedExisting) continue;
          if (cidrOverlaps(parsedNew, parsedExisting)) {
            conflicts.push({ deviceId: existing.deviceId, cidr: existing.cidr });
          }
        }

        const hasConflict = conflicts.length > 0;
        const summary = hasConflict
          ? `LAN conflict detected: ${newDeviceId} (${newDeviceCidr}) overlaps with ${conflicts.map((c) => `${c.deviceId}(${c.cidr})`).join(", ")}. Use clawwrt_set_br_lan to change the new device IP, then re-run this check.`
          : `No LAN conflict: ${newDeviceId} (${newDeviceCidr}) is unique. Safe to proceed with clawwrt_join_wireguard_lan_mesh.`;

        return buildToolResult(summary, { newDeviceId, newDeviceCidr, existingDevices, conflicts, hasConflict });
      },
    },
    {
      name: "clawwrt_join_wireguard_lan_mesh",
      label: "OpenClaw WRT Join WireGuard LAN Mesh",
      description:
        "Step B of LAN mesh onboarding: incrementally connect a new device into the existing WireGuard LAN mesh. Requires clawwrt_check_lan_conflict to have returned hasConflict=false first. Updates VPS peer AllowedIPs for the new device, pushes all existing LAN CIDRs as routes to the new device, and appends the new device LAN CIDR to every existing device's routes.",
      parameters: JoinWireguardLanMeshSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_join_wireguard_lan_mesh", rawParams);
        const args = rawParams as JoinWireguardLanMeshParams;
        const newDeviceId = args.newDeviceId.trim();
        const updateServerPeers = args.updateServerPeers !== false;

        const existingIds: string[] =
          Array.isArray(args.existingDeviceIds) && args.existingDeviceIds.length > 0
            ? args.existingDeviceIds.map((id) => id.trim()).filter((id) => id !== newDeviceId)
            : bridge
                .listDevices()
                .map((d) => d.deviceId.trim())
                .filter((id) => id !== newDeviceId);

        // Fetch new device br-lan CIDR
        let newLanCidr: string;
        try {
          const result = await callDeviceOp({
            bridge,
            deviceId: newDeviceId,
            op: "get_br_lan",
            timeoutMs: args.timeoutMs,
          });
          const cidr = (result as JsonRecord)?.cidr;
          if (typeof cidr !== "string" || !cidr) throw new Error("no cidr field in response");
          newLanCidr = cidr;
        } catch (error) {
          throw new Error(
            `Failed to get br-lan for new device ${newDeviceId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        // Fetch all existing devices' LAN CIDRs
        const existingLanMap = new Map<string, string>(); // deviceId → cidr
        for (const deviceId of existingIds) {
          try {
            const result = await callDeviceOp({
              bridge,
              deviceId,
              op: "get_br_lan",
              timeoutMs: args.timeoutMs,
            });
            const cidr = (result as JsonRecord)?.cidr;
            if (typeof cidr === "string" && cidr) {
              existingLanMap.set(deviceId, cidr);
            }
          } catch {
            // skip unreachable devices
          }
        }

        type RouteUpdateEntry = { deviceId: string; status: "success" | "error"; routes: string[]; error?: string };
        const results: {
          serverPeerUpdate: { status: "updated" | "skipped" | "error"; reason?: string };
          newDeviceRoutes: { status: "success" | "error"; routes: string[]; error?: string };
          existingDeviceRoutes: RouteUpdateEntry[];
        } = {
          serverPeerUpdate: { status: "skipped" },
          newDeviceRoutes: { status: "success", routes: [] },
          existingDeviceRoutes: [],
        };

        // Step B-1: Update VPS peer AllowedIPs for new device
        if (updateServerPeers) {
          if (!args.peerPublicKey) {
            results.serverPeerUpdate = { status: "skipped", reason: "peerPublicKey not provided" };
          } else {
            const tunnelNorm = parseIPv4Cidr(args.tunnelIp)?.normalized ?? args.tunnelIp;
            const lanNorm = parseIPv4Cidr(newLanCidr)?.normalized ?? newLanCidr;
            try {
              await upsertWireguardPeerOnServer({ publicKey: args.peerPublicKey.trim(), allowedIps: [tunnelNorm, lanNorm] });
              results.serverPeerUpdate = { status: "updated" };
            } catch (error) {
              results.serverPeerUpdate = {
                status: "error",
                reason: error instanceof Error ? error.message : String(error),
              };
            }
          }
        } else {
          results.serverPeerUpdate = { status: "skipped", reason: "updateServerPeers=false" };
        }

        // Step B-2: Push all existing LAN CIDRs to new device, preserving its current routes
        const existingCidrs = [...existingLanMap.values()];
        let newDeviceCurrentRoutes: string[] = [];
        try {
          const existingOnNew = await callDeviceOp({
            bridge,
            deviceId: newDeviceId,
            op: "get_vpn_routes",
            timeoutMs: args.timeoutMs,
          });
          const existingRoutes = (existingOnNew as JsonRecord)?.routes;
          if (Array.isArray(existingRoutes)) {
            const existingCidrSet = new Set(existingCidrs);
            for (const r of existingRoutes as JsonRecord[]) {
              const dest = typeof r.dest === "string" ? r.dest : typeof r === "string" ? r : "";
              if (dest && !existingCidrSet.has(dest)) {
                newDeviceCurrentRoutes.push(dest);
              }
            }
          }
        } catch {
          // no prior routes to preserve
        }
        const newDeviceRoutes = [...newDeviceCurrentRoutes, ...existingCidrs];
        try {
          await callDeviceOp({
            bridge,
            deviceId: newDeviceId,
            op: "set_vpn_routes",
            payload: { data: { mode: "selective", routes: newDeviceRoutes } },
            timeoutMs: args.timeoutMs,
          });
          results.newDeviceRoutes = { status: "success", routes: newDeviceRoutes };
        } catch (error) {
          results.newDeviceRoutes = {
            status: "error",
            routes: newDeviceRoutes,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        // Step B-3: Append new device LAN CIDR to each existing device's routes
        const newLanNorm = parseIPv4Cidr(newLanCidr)?.normalized ?? newLanCidr;
        for (const [deviceId] of existingLanMap) {
          let currentRoutes: string[] = [];
          let getRoutesFailed = false;
          try {
            const existing = await callDeviceOp({
              bridge,
              deviceId,
              op: "get_vpn_routes",
              timeoutMs: args.timeoutMs,
            });
            const routes = (existing as JsonRecord)?.routes;
            if (Array.isArray(routes)) {
              for (const r of routes as JsonRecord[]) {
                const dest = typeof r.dest === "string" ? r.dest : typeof r === "string" ? r : "";
                if (dest && dest !== newLanNorm) currentRoutes.push(dest);
              }
            }
          } catch (err) {
            getRoutesFailed = true;
            results.existingDeviceRoutes.push({
              deviceId,
              status: "error",
              routes: [],
              error: `get_vpn_routes failed, skipped set to avoid wiping existing routes: ${err instanceof Error ? err.message : String(err)}`,
            });
          }

          if (getRoutesFailed) continue;

          const updatedRoutes = [...currentRoutes, newLanNorm];
          try {
            await callDeviceOp({
              bridge,
              deviceId,
              op: "set_vpn_routes",
              payload: { data: { mode: "selective", routes: updatedRoutes } },
              timeoutMs: args.timeoutMs,
            });
            results.existingDeviceRoutes.push({ deviceId, status: "success", routes: updatedRoutes });
          } catch (error) {
            results.existingDeviceRoutes.push({
              deviceId,
              status: "error",
              routes: updatedRoutes,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const okCount = results.existingDeviceRoutes.filter((r) => r.status === "success").length;
        const summary = [
          `${newDeviceId} joined LAN mesh: newLanCidr=${newLanCidr}`,
          `serverPeer=${results.serverPeerUpdate.status}`,
          `newDeviceRoutes=${results.newDeviceRoutes.status}(${existingCidrs.length} cidrs)`,
          `existingDeviceUpdates=${results.existingDeviceRoutes.length} (${okCount} ok)`,
        ].join(", ");

        return buildToolResult(summary, { newDeviceId, newLanCidr, ...results });
      },
    },
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_delete_vpn_routes",
      label: "OpenClaw WRT Delete VPN Routes",
      description:
        "Delete VPN routing rules. Use flushAll to remove all routes, or provide specific CIDR routes to remove individually.",
      op: "delete_vpn_routes",
      parameters: DeleteVpnRoutesSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as DeleteVpnRoutesParams;
        const payload: JsonRecord = {};
        if (typeof args.flushAll === "boolean") {
          payload.flush_all = args.flushAll;
        }
        if (Array.isArray(args.routes)) {
          payload.routes = args.routes;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload: { data: payload },
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as DeleteVpnRoutesParams;
        const method = args.flushAll ? "flushed all" : "deleted selected";
        return `Deleted VPN routes (${method}) on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_firmware_info",
      label: "OpenClaw WRT Firmware Info",
      description: "Get the router's firmware/build information.",
      op: "get_firmware_info",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched firmware info for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_network_interfaces",
      label: "OpenClaw WRT Network Interfaces",
      description: "Get network interface inventory and IP details using a native API call.",
      op: "get_network_interfaces",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched network interfaces for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_br_lan",
      label: "OpenClaw WRT Get BR-LAN",
      description:
        "Get the router's br-lan (LAN) IP address, netmask, and computed CIDR (e.g. 192.168.1.0/24). Use this to check LAN subnet before WireGuard mesh setup or detect subnet conflicts.",
      op: "get_br_lan",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched br-lan CIDR for ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_set_br_lan",
      label: "OpenClaw WRT Set BR-LAN",
      description:
        "Change the router's br-lan LAN IP address and subnet. ⚠️ DESTRUCTIVE: changing the LAN IP will disconnect all LAN clients and re-issue DHCP leases. MUST obtain explicit user confirmation before calling this tool.",
      parameters: SetBrLanSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_set_br_lan", rawParams);
        const args = rawParams as SetBrLanParams;
        const deviceId = args.deviceId.trim();
        const payload: Record<string, unknown> = { ipaddr: args.ipaddr.trim() };
        if (typeof args.netmask === "string") payload.netmask = args.netmask.trim();
        if (typeof args.prefixLen === "number") payload.prefix_len = args.prefixLen;

        const result = await callDeviceOp({
          bridge,
          deviceId,
          op: "set_br_lan",
          payload,
          timeoutMs: args.timeoutMs,
        });

        const data = result as Record<string, unknown>;
        return buildToolResult(
          `br-lan updated on ${deviceId}: ipaddr=${data.ipaddr}, cidr=${data.cidr}. Network reload triggered.`,
          data,
        );
      },
    },
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_firmware_upgrade",
      label: "OpenClaw WRT Firmware Upgrade",
      description: "Trigger a firmware upgrade (OTA) on the router using a URL.",
      op: "firmware_upgrade",
      parameters: FirmwareUpgradeSchema,
      summarize: (_response, rawParams) => {
        const args = rawParams as Static<typeof FirmwareUpgradeSchema>;
        return `Firmware upgrade requested for ${args.deviceId} from ${args.url}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_delete_wifi_relay",
      label: "OpenClaw WRT Delete WiFi Relay",
      description: "Remove Wi-Fi relay/STA configuration from the router.",
      op: "delete_wifi_relay",
      parameters: DeleteWifiRelaySchema,
      buildPayload: (rawParams) => {
        const args = rawParams as Static<typeof DeleteWifiRelaySchema>;
        return {
          deviceId: args.deviceId.trim(),
          payload: args.apply !== undefined ? { apply: args.apply } : undefined,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as Static<typeof DeleteWifiRelaySchema>;
        return `Requested Wi-Fi relay deletion on ${args.deviceId}.`;
      },
    }),
    {
      name: "clawwrt_execute_shell",
      label: "OpenClaw WRT Execute Shell",
      description:
        "Execute a raw shell command on the router. STRICT RULES: (1) NEVER call this tool to implement any Wi-Fi/router feature — always use the dedicated clawwrt_* API tools instead. (2) ONLY call this tool when the user has EXPLICITLY typed a shell command or said something like '执行命令'/'run command'/'shell'. (3) ALWAYS show the exact command to the user and WAIT for explicit approval BEFORE calling this tool. Calling without user approval is FORBIDDEN.",
      parameters: ShellCommandSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: clawwrt_execute_shell", rawParams);
        const args = rawParams as ShellCommandParams;
        if (args.userConfirmed !== true) {
          return buildToolResult(
            `⚠️ Shell 命令需要用户确认后才能执行。\n\n` +
            `即将在设备 ${args.deviceId.trim()} 上执行以下命令：\n\`\`\`\n${args.command}\n\`\`\`\n\n` +
            `请向用户展示以上命令，并等待用户明确回复"确认"/"yes"/"执行"后，再以 userConfirmed=true 重新调用本工具。`,
            { pendingApproval: true, command: args.command, deviceId: args.deviceId.trim() },
          );
        }
        const device = bridge.getDevice(args.deviceId.trim());
        if (!device) {
          throw new Error(`Device ${args.deviceId.trim()} not found or offline`);
        }
        const payload: JsonRecord = { command: args.command };
        if (typeof args.timeoutSeconds === "number") {
          payload.timeout = args.timeoutSeconds;
        }
        const response = await callDeviceOp({
          bridge,
          deviceId: args.deviceId.trim(),
          op: "shell",
          payload,
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Shell 命令已在 ${args.deviceId.trim()} 上执行。`, { response });
      },
    },
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_speedtest_servers",
      label: "OpenClaw WRT Speedtest Servers",
      description: "List available nearby speedtest.net servers for performance testing.",
      op: "get_speedtest_servers",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched speedtest servers for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_speedtest",
      label: "OpenClaw WRT Speedtest",
      description: "Run an internet speed test (ping, download, upload) on the router.",
      op: "speedtest",
      parameters: RunSpeedtestSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as { deviceId: string; serverId?: string; timeoutMs?: number };
        return {
          deviceId: args.deviceId.trim(),
          payload: args.serverId ? { server_id: args.serverId } : undefined,
          timeoutMs: args.timeoutMs ?? 120_000,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as { deviceId: string };
        return `Completed speedtest on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_reboot_device",
      label: "OpenClaw WRT Reboot Device",
      description:
        "Request a router reboot. The device should respond before rebooting, but it may disconnect immediately.",
      op: "reboot_device",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Reboot request sent to ${args.deviceId}. Treat this as best-effort and expect disconnect.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_get_xfrpc_config",
      label: "OpenClaw WRT XFRPC Config",
      description: "Get current XFRPC (intranet penetration) configuration from the router.",
      op: "get_xfrpc_config",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched XFRPC config for ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_set_xfrpc_common",
      label: "OpenClaw WRT Set XFRPC Common",
      description: "Set XFRPC common configuration (server address, port, token) on the router.",
      op: "set_xfrpc_common",
      parameters: SetXfrpcCommonSchema,
      buildPayload: (rawParams) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = rawParams as any;
        const payload: JsonRecord = {};
        if (args.enabled !== undefined) {
          payload.enabled = args.enabled;
        }
        if (args.loglevel !== undefined) {
          payload.loglevel = args.loglevel;
        }
        if (args.server_addr !== undefined) {
          payload.server_addr = args.server_addr;
        }
        if (args.server_port !== undefined) {
          payload.server_port = args.server_port;
        }
        if (args.token !== undefined) {
          payload.token = args.token;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = rawParams as any;
        return `Updated XFRPC common config on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_add_xfrpc_tcp_service",
      label: "OpenClaw WRT Add XFRPC TCP Service",
      description: "Add a TCP intranet penetration service to the router.",
      op: "add_xfrpc_tcp_service",
      parameters: AddXfrpcTcpServiceSchema,
      buildPayload: (rawParams) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = rawParams as any;
        const payload: JsonRecord = { name: args.name };
        if (args.enabled !== undefined) {
          payload.enabled = args.enabled;
        }
        if (args.local_ip !== undefined) {
          payload.local_ip = args.local_ip;
        }
        if (args.local_port !== undefined) {
          payload.local_port = args.local_port;
        }
        if (args.remote_port !== undefined) {
          payload.remote_port = args.remote_port;
        }
        if (args.start_time !== undefined) {
          payload.start_time = args.start_time;
        }
        if (args.end_time !== undefined) {
          payload.end_time = args.end_time;
        }
        return {
          deviceId: args.deviceId.trim(),
          payload,
          timeoutMs: args.timeoutMs,
        };
      },
      summarize: (_response, rawParams) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = rawParams as any;
        return `Added XFRPC TCP service '${args.name}' on ${args.deviceId}.`;
      },
    }),
    createSimpleOperationTool({
      bridge,
      name: "clawwrt_restart_xfrpc",
      label: "OpenClaw WRT Restart XFRPC",
      description:
        "Restart router XFRPC intranet penetration client service by running /etc/init.d/xfrpc restart.",
      op: "restart_xfrpc",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Restarted XFRPC service on ${args.deviceId}.`;
      },
    }),
    {
      name: "openclaw_deploy_frps",
      label: "OpenClaw Deploy FRPS",
      description:
        "Deploy intranet-penetration server: fetch latest version from GitHub, install as /usr/bin/nwct-server, configure systemd autostart. MUST be called with a non-empty token (auto-generated by Agent). Do NOT ask user for port or token — use default port 7070 and generate token automatically.",
      parameters: DeployFrpsSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: openclaw_deploy_frps", rawParams);
        const args = rawParams;
        const { execSync } = await import("node:child_process");

        const configDir = "/etc/nwct";
        const configPath = path.join(configDir, "nwct-server.toml");
        const servicePath = "/etc/systemd/system/nwct-server.service";
        let tempDir: string | undefined;

        let toml = `bindPort = ${args.port}\n`;
        if (args.token) {
          toml += `auth.token = ${JSON.stringify(args.token)}\n`;
        }

        let output = "";
        try {
          // 1. Ensure config directory
          execSync(`sudo mkdir -p ${configDir}`, { encoding: "utf-8" });
          tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wrt-nwct-"));
          const writeSecureTempFile = async (fileName: string, content: string) => {
            const tempPath = path.join(tempDir as string, fileName);
            await fs.writeFile(tempPath, content, "utf8");
            await fs.chmod(tempPath, 0o600);
            return tempPath;
          };

          const configTempPath = await writeSecureTempFile("nwct-server.toml", toml);
          execSync(`sudo install -o root -g root -m 600 ${configTempPath} ${configPath}`, {
            encoding: "utf-8",
          });

          // 2. Install binary if missing
          const binPath = "/usr/bin/nwct-server";
          let binExists = false;
          try {
            // Check if binary exists and is executable
            execSync(`test -x ${binPath}`, { encoding: "utf-8" });
            binExists = true;
            output += `nwct-server binary already exists at ${binPath}.\n`;
          } catch {
            output += "nwct-server binary not found. Downloading latest version from GitHub...\n";
            try {
              const archMap: Record<string, string> = {
                x64: "amd64",
                arm64: "arm64",
                arm: "arm",
              };
              const arch = archMap[process.arch] || "amd64";

              // Get latest version via GitHub API with timeout
              const latestJson = execSync(
                "curl -s --max-time 30 --connect-timeout 10 https://api.github.com/repos/fatedier/frp/releases/latest",
                { encoding: "utf-8", timeout: 35000 },
              );
              const latestInfo = JSON.parse(latestJson);
              const tagName = latestInfo.tag_name;
              if (!tagName) {
                throw new Error("Could not determine latest version from GitHub API.");
              }
              // Validate tagName before interpolating into shell commands.
              if (!/^v?\d+\.\d+\.\d+$/.test(tagName)) {
                throw new Error(`Unexpected tag format from GitHub API: ${tagName}`);
              }
              const safeArch = /^[a-z0-9]+$/.test(arch) ? arch : "amd64";

              const version = tagName.startsWith("v") ? tagName.substring(1) : tagName;
              const folderName = `frp_${version}_linux_${safeArch}`;
              const filename = `${folderName}.tar.gz`;
              const downloadUrl = `https://github.com/fatedier/frp/releases/download/${tagName}/${filename}`;

              output += `Target version: ${tagName}, Arch: ${safeArch}\nDownloading from: ${downloadUrl}\n`;

              execSync(`curl -L --max-time 120 --connect-timeout 10 -o /tmp/${filename} ${downloadUrl}`, { encoding: "utf-8", timeout: 125000 });
              execSync(`tar -C /tmp -zxvf /tmp/${filename}`, { encoding: "utf-8" });
              execSync(`sudo install -o root -g root -m 755 /tmp/${folderName}/frps ${binPath}`, {
                encoding: "utf-8",
              });
              execSync(`rm -rf /tmp/${filename} /tmp/${folderName}`, { encoding: "utf-8" });
              output +=
                "Binary installed successfully to /usr/bin/nwct-server and temporary files removed.\n";
            } catch (dlError) {
              output += `Error during binary download/install: ${dlError instanceof Error ? dlError.message : String(dlError)}\n`;
              output += "Please install the binary manually to /usr/bin/nwct-server or check network connectivity.\n";
              throw dlError;
            }
          }

          // 3. Create systemd service
          const serviceContent = `[Unit]
Description=Intranet Penetration Server (NWCT)
After=network.target

[Service]
Type=simple
ExecStart=${binPath} -c ${configPath}
Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
          const serviceTempPath = await writeSecureTempFile("nwct-server.service", serviceContent);
          execSync(`sudo install -o root -g root -m 644 ${serviceTempPath} ${servicePath}`, {
            encoding: "utf-8",
          });

          // 4. Reload and start
          execSync("sudo systemctl daemon-reload", { encoding: "utf-8" });
          execSync("sudo systemctl enable nwct-server", { encoding: "utf-8" });
          output += execSync("sudo systemctl restart nwct-server", { encoding: "utf-8" });
          output += "\nNWCT service successfully configured and restarted via systemd.";
        } catch (error) {
          return buildToolResult(
            `Deployment failed. Output: ${output}\nError: ${error instanceof Error ? error.message : String(error)}`,
            { status: "error", output },
          );
        } finally {
          if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }

        return buildToolResult(`Deployment success.\nConfig: ${configPath}\nOutput: ${output}`, {
          status: "success",
          configPath,
          toml,
        });
      },
    },
    {
      name: "openclaw_get_frps_status",
      label: "OpenClaw Get FRPS Status",
      description:
        "ENTRY POINT for all intranet-penetration tasks. Call this FIRST before asking the user anything. Returns service state, listening ports, and current token/port config. Use the result to decide next step: deploy if not installed, re-deploy if token is empty, or proceed to client config if already running.",
      parameters: Type.Object({}),
      execute: async () => {
        console.info("Executing tool: openclaw_get_frps_status");
        const { execSync } = await import("node:child_process");
        const configPath = "/etc/nwct/nwct-server.toml";

        let configExists = false;
        let configContent = "";
        try {
          configContent = execSync(`sudo cat ${configPath}`, { encoding: "utf-8" });
          configExists = true;
        } catch {}
        const redactedConfigContent = redactFrpsConfigContent(configContent);

        let serviceStatus = "Unknown";
        try {
          serviceStatus = execSync("systemctl is-active nwct-server || true", {
            encoding: "utf-8",
          }).trim();
        } catch {}

        let portsInfo = "";
        try {
          portsInfo = execSync("sudo ss -tulpn | grep nwct-server || true", {
            encoding: "utf-8",
          }).trim();
        } catch {}

        const details = `Service State: ${serviceStatus}\nConfig: ${configExists ? "Found" : "Not Found"}\nListening Ports:\n${portsInfo || "None"}\n\nConfig Content:\n${redactedConfigContent}`;

        return buildToolResult(details, {
          serviceStatus,
          configExists,
          configContent: redactedConfigContent,
          portsInfo,
        });
      },
    },
    {
      name: "openclaw_reset_frps",
      label: "OpenClaw Reset FRPS",
      description:
        "Stop and disable nwct-server, remove config directory and systemd service file from the VPS. Binary is preserved for future deployments.",
      parameters: ResetFrpsSchema,
      execute: async () => {
        console.info("Executing tool: openclaw_reset_frps");
        const { execSync } = await import("node:child_process");
        let output = "";
        try {
          execSync("sudo systemctl stop nwct-server || true", { encoding: "utf-8" });
          execSync("sudo systemctl disable nwct-server || true", { encoding: "utf-8" });
          output += "Stopped and disabled systemd service.\\n";

          execSync("sudo rm -f /etc/systemd/system/nwct-server.service", { encoding: "utf-8" });
          execSync("sudo systemctl daemon-reload", { encoding: "utf-8" });
          output += "Removed systemd service file.\\n";

          execSync("sudo rm -rf /etc/nwct", { encoding: "utf-8" });
          output += "Removed configuration directory. Binary preserved at /usr/bin/nwct-server for future deployments.\\n";

          return buildToolResult(output + "FRPS has been successfully reset.", {
            status: "success",
          });
        } catch (error) {
          return buildToolResult(
            `Reset failed. Output: ${output}\\nError: ${error instanceof Error ? error.message : String(error)}`,
            { status: "error" },
          );
        }
      },
    },
    {
      name: "openclaw_reset_wg_server",
      label: "OpenClaw Reset WireGuard Server",
      description:
        "Reset VPS-side WireGuard server configuration by stopping wg-quick, removing interface config, and optionally removing server key files.",
      parameters: ResetWgServerSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: openclaw_reset_wg_server", rawParams);
        const args = rawParams as ResetWgServerParams;
        const { execSync } = await import("node:child_process");
        const iface = (args.interface ?? "wg0").trim() || "wg0";
        const removeKeys = args.removeKeys ?? true;
        const natRuleComment = `OPENCLAW_WG_${iface}`;

        if (!/^[a-zA-Z0-9_.@-]+$/.test(iface)) {
          return buildToolResult("Invalid WireGuard interface name.", { status: "error" });
        }

        let output = "";
        try {
          let legacyEgressIf = "";
          try {
            const confContent = String(
              execSync(`sudo cat /etc/wireguard/${iface}.conf 2>/dev/null || true`, {
                encoding: "utf-8",
              }),
            );
            const match = confContent.match(/POSTROUTING\s+-o\s+([^\s;]+)\s+-j\s+MASQUERADE/);
            legacyEgressIf = match?.[1] ?? "";
          } catch {
            // Best-effort only.
          }

          execSync(`sudo systemctl stop wg-quick@${iface} || true`, { encoding: "utf-8" });
          execSync(`sudo systemctl disable wg-quick@${iface} || true`, { encoding: "utf-8" });
          execSync(`sudo wg-quick down ${iface} >/dev/null 2>&1 || true`, { encoding: "utf-8" });
          output += `Stopped and disabled wg-quick@${iface}.\n`;

          // Explicitly clean up NAT/FORWARD leftovers in case PostDown didn't run.
          execSync(
            `while sudo iptables -t nat -C POSTROUTING -m comment --comment ${natRuleComment} -j MASQUERADE 2>/dev/null; do sudo iptables -t nat -D POSTROUTING -m comment --comment ${natRuleComment} -j MASQUERADE; done`,
            { encoding: "utf-8" },
          );
          execSync(
            "while sudo iptables -C FORWARD -i wg0 -j ACCEPT 2>/dev/null; do sudo iptables -D FORWARD -i wg0 -j ACCEPT; done",
            { encoding: "utf-8" },
          );
          execSync(
            "while sudo iptables -C FORWARD -o wg0 -j ACCEPT 2>/dev/null; do sudo iptables -D FORWARD -o wg0 -j ACCEPT; done",
            { encoding: "utf-8" },
          );

          if (legacyEgressIf && /^[a-zA-Z0-9.\-_@]+$/.test(legacyEgressIf)) {
            execSync(
              `while sudo iptables -t nat -C POSTROUTING -o ${legacyEgressIf} -j MASQUERADE 2>/dev/null; do sudo iptables -t nat -D POSTROUTING -o ${legacyEgressIf} -j MASQUERADE; done`,
              { encoding: "utf-8" },
            );
            output += `Removed legacy MASQUERADE rules on ${legacyEgressIf}.\n`;
          }
          output += "Removed WireGuard NAT/FORWARD firewall rules.\n";

          execSync(`sudo rm -f /etc/wireguard/${iface}.conf`, { encoding: "utf-8" });
          output += `Removed /etc/wireguard/${iface}.conf.\n`;

          if (removeKeys) {
            execSync("sudo rm -f /etc/wireguard/server_private.key /etc/wireguard/server_public.key", {
              encoding: "utf-8",
            });
            output += "Removed server key files.\n";
          }

          execSync("sudo rm -f /etc/sysctl.d/99-wireguard.conf", { encoding: "utf-8" });
          output += "Removed WireGuard sysctl config file.\n";

          return buildToolResult(`WireGuard server reset success.\n${output}`, {
            status: "success",
            interface: iface,
            removeKeys,
          });
        } catch (error) {
          return buildToolResult(
            `WireGuard server reset failed. Output: ${output}\nError: ${error instanceof Error ? error.message : String(error)}`,
            {
              status: "error",
              interface: iface,
              removeKeys,
            },
          );
        }
      },
    },
    {
      name: "openclaw_deploy_wg_server",
      label: "OpenClaw Deploy WireGuard Server",
      description:
        "Automatically install WireGuard, enable IP forwarding, generate server keys, and configure wg0 with NAT on the VPS host.",
      parameters: DeployWgServerSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: openclaw_deploy_wg_server", rawParams);
        const args = rawParams as {
          port?: number;
          tunnelIp?: string;
          egressInterface?: string;
        };
        const { execSync } = await import("node:child_process");
        const port = args.port || 51820;
        const tunnelIp = args.tunnelIp || "10.0.0.1/24";
        if (!/^[\w.:/,\- ]+$/.test(tunnelIp)) {
          return buildToolResult(
            "Invalid tunnelIp format. Only alphanumeric and basic network punctuation allowed.",
            { status: "error" },
          );
        }
        let output = "";

        try {
          // 1. Install WireGuard tools
          output += "Checking/Installing WireGuard tools...\n";
          const installCmd = `
            if ! command -v wg >/dev/null; then
              if command -v apt-get >/dev/null; then
                sudo apt-get update && sudo apt-get install -y wireguard
              elif command -v dnf >/dev/null; then
                sudo dnf install -y epel-release elrepo-release && sudo dnf install -y kmod-wireguard wireguard-tools
              elif command -v pacman >/dev/null; then
                sudo pacman -S --noconfirm wireguard-tools
              else
                echo "Unsupported package manager. Please install wireguard-tools manually."
                exit 1
              fi
            fi
          `;
          execSync(installCmd, { encoding: "utf-8" });

          // 2. Enable IP forwarding
          output += "Enabling IPv4 forwarding...\n";
          execSync("sudo sysctl -w net.ipv4.ip_forward=1", { encoding: "utf-8" });
          execSync("echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-wireguard.conf", {
            encoding: "utf-8",
          });

          // 3. Generate server keys if missing
          const privKeyPath = "/etc/wireguard/server_private.key";
          const pubKeyPath = "/etc/wireguard/server_public.key";
          try {
            execSync(`sudo ls ${privKeyPath}`, { encoding: "utf-8" });
            output += "Server keys already exist.\n";
          } catch {
            output += "Generating server keys...\n";
            execSync(`sudo mkdir -p /etc/wireguard && sudo chmod 700 /etc/wireguard`, {
              encoding: "utf-8",
            });
            execSync(`wg genkey | sudo tee ${privKeyPath} | wg pubkey | sudo tee ${pubKeyPath}`, {
              encoding: "utf-8",
            });
            execSync(`sudo chmod 600 ${privKeyPath}`, { encoding: "utf-8" });
          }
          const serverPrivKey = execSync(`sudo cat ${privKeyPath}`, { encoding: "utf-8" }).trim();
          const serverPubKey = execSync(`sudo cat ${pubKeyPath}`, { encoding: "utf-8" }).trim();

          // 4. Detect egress interface (or use explicit override)
          const requestedEgress = args.egressInterface?.trim();
          const egressIf = requestedEgress || detectServerEgressInterface(execSync);
          if (!egressIf || !/^[a-zA-Z0-9.\-_@]+$/.test(egressIf)) {
            const interfaces = listServerInterfacesWithIp(execSync);
            const recommended = detectRecommendedServerInterface(execSync);
            const recommendationLine = recommended
              ? `Recommended outbound interface (best guess): ${recommended}\n`
              : "";
            return buildToolResult(
              `WireGuard deployment failed: unable to determine VPS WAN interface automatically.\n` +
                recommendationLine +
                `Detected VPS interfaces and IPv4:\n${interfaces}\n` +
                `Please ask user to choose the outbound interface, then rerun with egressInterface set (for example: \"eth0\").`,
              {
                status: "error",
                output,
                interfaces,
                recommendedInterface: recommended || undefined,
              },
            );
          }
          output += `Egress interface detected: ${egressIf}\n`;

          // 5. Create wg0.conf
          const confPath = "/etc/wireguard/wg0.conf";
          const natRuleComment = "OPENCLAW_WG_wg0";
          const confContent = `[Interface]
Address = ${tunnelIp}
ListenPort = ${port}
PrivateKey = ${serverPrivKey}
PostUp = iptables -t nat -A POSTROUTING -m comment --comment ${natRuleComment} -o ${egressIf} -j MASQUERADE; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -m comment --comment ${natRuleComment} -o ${egressIf} -j MASQUERADE; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT
`;
          const crypto = await import("node:crypto");
          const tempFile = `/tmp/wg0-${crypto.randomBytes(8).toString("hex")}.conf`;
          await fs.writeFile(tempFile, confContent, { encoding: "utf8", mode: 0o600 });
          execSync(`sudo install -o root -g root -m 600 ${tempFile} ${confPath}`, {
            encoding: "utf-8",
          });

          // 6. Open UDP port (best effort)
          output += "Attempting to open UDP port in firewall...\n";
          const fwCmd = `
            if systemctl is-active --quiet firewalld; then
              sudo firewall-cmd --permanent --add-port=${port}/udp
              sudo firewall-cmd --permanent --add-masquerade
              sudo firewall-cmd --reload
            elif command -v ufw >/dev/null && sudo ufw status | grep -q "active"; then
              sudo ufw allow ${port}/udp
            fi
          `;
          try {
            execSync(fwCmd, { encoding: "utf-8" });
          } catch {}

          // 7. Start service
          execSync("sudo systemctl enable wg-quick@wg0", { encoding: "utf-8" });
          execSync("sudo systemctl restart wg-quick@wg0", { encoding: "utf-8" });
          output += "WireGuard server successfully deployed and started.\n";

          return buildToolResult(
            `WireGuard deployment success.\nPublic Key: ${serverPubKey}\nOutput: ${output}`,
            {
              status: "success",
              serverPubKey,
              port,
              tunnelIp,
            },
          );
        } catch (error) {
          return buildToolResult(
            `WireGuard deployment failed: ${error instanceof Error ? error.message : String(error)}`,
            {
              status: "error",
              output,
            },
          );
        }
      },
    },
    {
      name: "openclaw_add_wg_peer",
      label: "OpenClaw Add WireGuard Peer",
      description:
        "Add or update a peer (router) in the VPS WireGuard server configuration and reload without downtime.",
      parameters: AddWgPeerSchema,
      execute: async (_toolCallId, rawParams) => {
        console.info("Executing tool: openclaw_add_wg_peer", rawParams);
        const args = rawParams;
        try {
          const result = await upsertWireguardPeerOnServer({
            publicKey: args.publicKey,
            allowedIps: args.allowedIps,
            endpoint: args.endpoint,
          });
          return buildToolResult(
            `Peer ${result.action} successfully.\nPublicKey: ${args.publicKey}`,
            {
            status: "success",
              action: result.action,
            },
          );
        } catch (error) {
          return buildToolResult(
            `Failed to add peer: ${error instanceof Error ? error.message : String(error)}`,
            { status: "error" },
          );
        }
      },
    },
    {
      name: "openclaw_get_wg_status",
      label: "OpenClaw Get WireGuard Status",
      description: "Check WireGuard server runtime status, peers, and forwarding state.",
      parameters: Type.Object({}),
      execute: async () => {
        console.info("Executing tool: openclaw_get_wg_status");
        const { execSync } = await import("node:child_process");
        try {
          const wgBinary = execSync("command -v wg", { encoding: "utf-8" }).trim();
          if (!wgBinary) {
            return buildToolResult("WireGuard is not installed on this device.", {
              status: "not_installed",
              installed: false,
            });
          }

          const wgShow = execSync("sudo wg show", { encoding: "utf-8" });
          const forwarding = execSync("sysctl net.ipv4.ip_forward", { encoding: "utf-8" }).trim();
          return buildToolResult(`WireGuard Status:\n${wgShow}\n\n${forwarding}`, {
            status: "success",
            installed: true,
            wgBinary,
            wgShow,
            forwarding,
          });
        } catch (error) {
          return buildToolResult(
            `Failed to get status: ${error instanceof Error ? error.message : String(error)}`,
            { status: "error" },
          );
        }
      },
    },
    {
      name: "claw_wifi_hello",
      label: "Claw WiFi Hello",
      description:
        "当用户打招呼（如 Hello, 你好, hello 龙虾wifi）、询问龙虾WiFi (Claw WiFi) 具有哪些功能或需要使用示例 (Prompts) 时调用。此工具会确认 Agent 身份，展示功能目录并提供一系列引导示例。",
      parameters: Type.Object({}),
      execute: async () => {
        console.info("Executing tool: claw_wifi_hello");
        let catalog = `# 龙虾WiFi (Claw WiFi) 功能清单与使用示例\n\n已识别龙虾WiFi 身份。以下是您可以使用的功能模块及其 Prompts 示例：\n`;

        for (const [, item] of Object.entries(PROMPT_EXAMPLES)) {
          catalog += `\n### ${item.label}\n`;
          item.prompts.forEach((p) => {
            catalog += `- ${p}\n`;
          });
        }

        catalog += `\n---\n您可以直接复制上述 Prompts 或根据需要进行修改。\n`;
        return buildToolResult(catalog, { status: "success", catalogReady: true });
      },
    },
    createGenericTool(bridge),
  ];
}

/**
 * 龙虾WiFi 功能示例库 (Encoded Prompt Examples)
 * 存储在代码中以节省 Skill Token，仅在调用 claw_wifi_hello 时动态返回。
 */
const PROMPT_EXAMPLES: Record<string, { label: string; prompts: string[] }> = {
  mgmt: {
    label: "1. 基础管理与状态监控",
    prompts: [
      '**查询状态**: "帮我看看现在有哪些路由器在线，并报告一下它们的运行状态和负载情况。"',
      "**设置 WiFi**: \"把房间 101 的路由器 SSID 改成 'Claw-Fast'，密码设置为 'claw123456'，记得开启 5G 频段。\"",
      '**强制下线**: "把 MAC 地址是 AA:BB:CC:DD:EE:FF 的那个客户端踢掉。"',
      '**限速管理**: "给正在下载的大流量用户（IP: 192.168.1.50）限速，下行带宽控制在 2Mbps。"',
    ],
  },
  nwct: {
    label: "2. 内网穿透 (NWCT)",
    prompts: [
      '**自动部署**: "我的 VPS 还没装内网穿透服务端，请帮我下载最新版并以 nwct-server 名义安装到 /usr/bin/，配置好 systemd 自启动。然后把 101 房间路由器的 SSH 映射到 6022 端口，并确认端口是否已经在 VPS 上监听了。"',
      '**状态自检**: "检查一下现在的内网穿透服务（nwct-server）是否正常？包括服务端进程、客户端连接，以及公网端口是否已经开启监听。"',
    ],
  },
  vpn: {
    label: "3. 全球组网 (WireGuard VPN)",
    prompts: [
      '**快速部署**: "帮我把这台龙虾WiFi 和 VPS 连起来。先在 VPS 上初始化 WG 服务端，然后生成路由器的密钥并完成对接，最后测试互 ping。"',
      '**添加节点**: "再帮我添加一台 102 房间的路由器到现有的 VPN 组网中，分配 IP 10.0.0.3。"',
      '**域名分流**: "配置好 VPN 后，让 google.com 的流量走隧道，其他的走本地。"',
      '**复杂双向部署**: "请把这次 WG VPN 方案拆成两部分：\\n1. OpenClaw VPS/云主机侧的 WireGuard 服务器、中转、peer、防火墙（必须开启 UDP 端口）、NAT 和转发。\\n2. 龙虾WiFi 路由器侧的客户端配置、认证和路由设置，统一使用相关的 clawwrt_* 工具。\\n\\n要求：\\n- 首先检查 VPS 侧是否安装服务端，未安装则先安装并开启对应的防火墙端口。\\n- 然后执行路由器侧的 key 生成和配置下发。\\n- 部署完成后，通过两端互 ping wg0 接口 IP 来验证隧道是否连通。\\n- 如果是多个龙虾WiFi 组网，请确保服务器端的 AllowedIPs 包含各子网，并提醒用户下发准确的静态路由以实现跨节点互通。\\n- 默认使用 selective 模式；full_tunnel 必须带 excludeIps。\\n\\n请输出：\\n- VPS 侧和路由器侧的详细执行步骤\\n- 互 ping 验证结果预期\\n- 跨节点互通的路由规则说明\\n- 风险点和回滚方式"',
    ],
  },
  portal: {
    label: "4. 商用门户页 (Captive Portal)",
    prompts: [
      "**生成咖啡厅页面**: \"帮我为 '瑞幸咖啡 101 店' 设计一个认证页面。模板选 cafe，标题写 '欢迎来到瑞幸'，内容写 '点击下方按钮即可享受极速网络'，再加上几条上网规则。\"",
      "**企业办公页面**: \"给公司会议室的路由器做一个 business 风格的页面。品牌名叫 '字节跳动'，网络名叫 'ByteDance-Guest'。\"",
      "**口令输入页**: \"为我的私人无线网络生成一个入口。使用 voucher 模板，提示用户输入进场密码，输入框的占位符写 '请输入今日暗号'。\"",
    ],
  },
  social: {
    label: "5. 社交推广与龙虾WiFi 品牌宣传",
    prompts: [
      '**个人介绍**: "帮我在社交平台发一个帖子介绍一下我自己，带上我现在运行的硬件平台、在线时长，以及我管理的龙虾WiFi 路由器的健康状态。适配微信/即刻/Twitter/B站风格。"',
      '**每日总结**: "帮我生成一个今日运行简报：今天服务了多少用户，跑了多少流量，测速表现如何，顺带推广一下龙虾WiFi 的 AI 配置和内网穿透特性。"',
      '**功能推广帖**: "帮我写一条推广龙虾WiFi AI Agent 配置功能的社交帖子，面向 OpenWrt 用户，突出零命令行、自然语言配置的优势。"',
      '**社区招募**: "帮我写一条引导用户扫码加入龙虾WiFi QQ 技术交流群的帖文，QQ群分别为424031785或者331230369。"',
      '**功能更新公告**: "帮我写一条关于龙虾WiFi 新增内网穿透功能的更新公告，适合发布在社交媒体和官网新闻栏，突出用户可以轻松访问家中设备的新能力。"',
      '**使用教程推广**: "帮我写一条社交媒体帖子，推广龙虾WiFi 的使用教程视频，内容是如何通过自然语言配置路由器实现智能家居控制。"',
      '**用户故事征集**: "帮我写一条社交媒体帖子，邀请用户分享他们使用龙虾WiFi 的故事和创意用法，鼓励大家在评论区互动。"',
      '**技术深潜文章**: "帮我写一篇适合发布在技术社区的长文，深入介绍龙虾WiFi 的架构设计、AI 配置原理，以及未来的功能规划。"',
    ],
  },
};
