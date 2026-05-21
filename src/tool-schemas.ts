/**
 * TypeBox schema definitions for openclaw-wrt tool.
 * Contains all parameter schemas for device operations, portal configuration, and VPN management.
 */

import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/core";
import {
  PORTAL_TEMPLATE_VALUES,
  type PortalContent as PortalContentType,
  type PortalTemplate as PortalTemplateType,
} from "./portal-page-renderer.js";

// ============================================================================
// Basic Field Definitions
// ============================================================================

export const DeviceIdField = Type.String({
  minLength: 1,
  description: "Target openclaw-wrt device_id.",
});

export const TimeoutField = Type.Optional(
  Type.Integer({
    minimum: 1000,
    maximum: 120_000,
    description: "Request timeout in milliseconds.",
  }),
);

export const WifiConfigDataField = Type.Object(
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

export const PortalTemplateField = stringEnum(PORTAL_TEMPLATE_VALUES, {
  description:
    "Portal page template. default:通用弹出页, welcome:品牌承接/品宣, business:企业/办公网络, cafe:餐饮场景, hotel:酒店宾客, terms:条款确认, voucher:券码口令输入, event:活动推广页. 不明确时默认用 default.",
});

export const PortalContentSchema = Type.Object(
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

export const JsonObjectField = Type.Record(Type.String(), Type.Unknown(), {
  description: "Arbitrary JSON object payload.",
});

export const StringArrayField = Type.Array(Type.String({ minLength: 1 }));

export const BandField = optionalStringEnum(["2g", "5g"] as const, {
  description: "Wi-Fi band to scan: 2g or 5g.",
});

export const BpfTableField = stringEnum(["ipv4", "ipv6", "mac"] as const, {
  description: "BPF table to target: ipv4, ipv6, or mac.",
});

export const BpfJsonTableField = stringEnum(["ipv4", "ipv6", "mac", "sid", "l7"] as const, {
  description: "BPF JSON table to query: ipv4, ipv6, mac, sid, or l7.",
});

export const XfrpcServiceNameField = Type.String({
  minLength: 1,
  pattern: "^[A-Za-z0-9_]+$",
  description: "Service name. Use letters, numbers, and underscore only.",
});

export const WireguardInterfaceSchema = Type.Object(
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

export const WireguardPeerSchema = Type.Object(
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

// ============================================================================
// Tool Schemas
// ============================================================================

export const GenericToolSchema = Type.Object(
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

export const DeviceOnlySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const ClientInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address." }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const AuthClientSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address to authorize." }),
    clientIp: Type.String({ minLength: 1, description: "Client IP address to authorize." }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const KickoffClientSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    clientMac: Type.String({ minLength: 1, description: "Client MAC address to disconnect." }),
    clientIp: Type.Optional(
      Type.String({ minLength: 1, description: "Client IPv4 address if already known." }),
    ),
    gwId: Type.String({ minLength: 1, description: "Gateway ID for the target gateway." }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const SetWifiInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    data: WifiConfigDataField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const SetAuthServerSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    hostname: Type.String({ minLength: 1, description: "Authentication server hostname." }),
    port: Type.Optional(Type.String({ minLength: 1, description: "Authentication server port." })),
    path: Type.Optional(Type.String({ minLength: 1, description: "Authentication server path." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const PublishPortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    filePath: Type.String({
      minLength: 1,
      description:
        "Absolute file path to the portal HTML file produced by clawwrt_generate_portal_page (details.filePath). The file will be read and published to the router.",
    }),
    pageName: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Output file name under nginx web root. Use details.pageName from clawwrt_generate_portal_page, or omit to auto-generate.",
      }),
    ),
    webRoot: Type.Optional(
      Type.String({ minLength: 1, description: "Optional nginx web root override." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const GeneratePortalPageSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    template: Type.Optional(PortalTemplateField),
    content: Type.Optional(PortalContentSchema),
    pageName: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional suggested file name. Returned as details.pageName and details.filePath for use in clawwrt_publish_portal_page.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const SetMqttServerSchema = Type.Object(
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

export const SetWireguardVpnSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    interface: WireguardInterfaceSchema,
    peers: Type.Optional(Type.Array(WireguardPeerSchema)),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const UpdateDeviceInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    deviceInfo: JsonObjectField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const TmpPassSchema = Type.Object(
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

export const ScanWifiSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    band: BandField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const SetWifiRelaySchema = Type.Object(
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

export const DomainSyncSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    domains: StringArrayField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const TrustedMacSyncSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    macs: StringArrayField,
    values: Type.Optional(StringArrayField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DeleteWifiRelaySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    apply: Type.Optional(Type.Boolean({ description: "Apply changes immediately." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const ShellCommandSchema = Type.Object(
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

export const BpfAddSchema = Type.Object(
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

export const BpfJsonSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfJsonTableField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const BpfDeleteSchema = Type.Object(
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

export const BpfFlushSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    table: Type.Optional(BpfTableField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const BpfUpdateSchema = Type.Object(
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

export const BpfUpdateAllSchema = Type.Object(
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

export const SetXfrpcCommonSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    enabled: Type.Optional(Type.String({ description: "'0' or '1'." })),
    loglevel: Type.Optional(Type.String({ description: "Log level, e.g., '7'." })),
    server_addr: Type.String({
      description:
        "FRPS server public IP or domain. MUST be explicitly provided by the user. Do not guess or use local IP.",
    }),
    server_port: Type.String({ description: "FRPS server port." }),
    token: Type.String({
      description:
        "Authentication token. MUST be auto-generated by the Agent as a random string BEFORE calling this tool. NEVER ask the user for this value. If the user explicitly provides a token, use theirs instead.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const AddXfrpcTcpServiceSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    name: XfrpcServiceNameField,
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

export const GetXfrpcTcpServiceSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    name: Type.Optional(XfrpcServiceNameField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DelXfrpcTcpServiceSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    name: Type.Optional(XfrpcServiceNameField),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DisableXfrpcTcpServiceSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    name: XfrpcServiceNameField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DeployFrpsSchema = Type.Object(
  {
    port: Type.Integer({
      minimum: 1,
      maximum: 65535,
      description:
        "FRPS listen port. Default: 7070. Use this default unless the user explicitly specifies a different port.",
    }),
    token: Type.Optional(
      Type.String({
        description:
          "Authentication token. MUST be auto-generated by the Agent as a random string BEFORE calling this tool. NEVER ask the user for this value. Passing an empty/missing token is FORBIDDEN — always supply a generated token.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ResetFrpsSchema = Type.Object({}, { additionalProperties: false });

export const VerifyFrpsSchema = Type.Object(
  {
    protocol: stringEnum(["tcp", "udp"] as const, {
      description: "Protocol to verify on the VPS listener, e.g. tcp or udp.",
    }),
    port: Type.Integer({
      minimum: 1,
      maximum: 65535,
      description: "Protocol port to verify on the VPS listener.",
    }),
  },
  { additionalProperties: false },
);

export const GetVpsPublicIpSchema = Type.Object({}, { additionalProperties: false });

export const ResetWireguardVpnSchema = Type.Object(
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

export const SetBrLanSchema = Type.Object(
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

export const SetVpnRoutesSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    mode: stringEnum(["selective"] as const, {
      description:
        "Routing mode: selective (individual CIDR routes managed through explicit static routes).",
    }),
    routePlanFile: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Optional JSON file path generated by clawwrt_collect_wireguard_protected_routes. When provided in selective mode, the tool reads routes for the target device from this file.",
      }),
    ),
    routes: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          description: "CIDR destination to route through VPN, e.g. 1.2.3.0/24.",
        }),
      ),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DeployWgServerSchema = Type.Object(
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
    peerBindings: Type.Optional(
      Type.Array(
        Type.Object(
          {
            deviceId: DeviceIdField,
            peerPublicKey: Type.String({
              minLength: 1,
              description: "Peer WireGuard public key.",
            }),
            tunnelIp: Type.String({
              minLength: 1,
              description: "Peer tunnel IP CIDR on the VPS side, e.g. 10.0.0.2/32.",
            }),
            lanCidr: Type.String({
              minLength: 1,
              description: "Peer br-lan CIDR from lan collection, e.g. 192.168.10.0/24.",
            }),
            endpoint: Type.Optional(
              Type.String({
                minLength: 1,
                description: "Optional peer endpoint host:port.",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          description:
            "Optional peer bindings from LAN collection. When provided, the tool writes all peer AllowedIPs into wg0.conf in one deployment pass.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export const CollectWireguardProtectedRoutesSchema = Type.Object(
  {
    deviceIds: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description:
        "Selected device IDs to include in the WireGuard protected-route file. The tool fetches each device's br-lan CIDR and includes the shared wg0 subnet for each device.",
    }),
    serverTunnelIp: Type.String({
      minLength: 1,
      description:
        "Server-side WireGuard tunnel CIDR, e.g. 10.0.0.1/24. The network portion is added to every device's protected routes.",
    }),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const VerifyWireguardConnectivitySchema = Type.Object(
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

export const ResetWgServerSchema = Type.Object(
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

export const RunSpeedtestSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    serverId: Type.Optional(Type.String({ description: "Optional specific speedtest server ID." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const FirmwareUpgradeSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    url: Type.String({ minLength: 1, description: "Firmware image URL." }),
    force: Type.Optional(Type.Boolean({ description: "Force upgrade." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
