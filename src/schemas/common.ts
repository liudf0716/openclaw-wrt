/**
 * Shared field definitions used across multiple schema domains.
 */

import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/core";
import {
  PORTAL_TEMPLATE_VALUES,
  type PortalContent as PortalContentType,
  type PortalTemplate as PortalTemplateType,
} from "../portal-page-renderer.js";

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
