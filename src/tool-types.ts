/**
 * Type definitions for openclaw-wrt tool module.
 * Includes all interface and type definitions for device management, WireGuard VPN,
 * portal pages, and BPF operations.
 */

import type { Static } from "@sinclair/typebox";
import type {
  GenericToolSchema,
  DeviceOnlySchema,
  ClientInfoSchema,
  AuthClientSchema,
  KickoffClientSchema,
  UpdateDeviceInfoSchema,
  SetAuthServerSchema,
  PublishPortalPageSchema,
  GeneratePortalPageSchema,
  SetMqttServerSchema,
  SetWireguardVpnSchema,
  TmpPassSchema,
  SetWifiInfoSchema,
  ScanWifiSchema,
  SetWifiRelaySchema,
  DomainSyncSchema,
  TrustedMacSyncSchema,
  ShellCommandSchema,
  BpfAddSchema,
  BpfJsonSchema,
  BpfDeleteSchema,
  BpfFlushSchema,
  BpfUpdateSchema,
  BpfUpdateAllSchema,
  SetVpnRoutesSchema,
  ResetWireguardVpnSchema,
  SetBrLanSchema,
  DhcpDiagnoseSchema,
  DnsDiagnoseSchema,
  WebServiceDiagnoseSchema,
  ResetWgServerSchema,
  VerifyFrpsSchema,
  GetXfrpcTcpServiceSchema,
  DelXfrpcTcpServiceSchema,
  DisableXfrpcTcpServiceSchema,
  DeployWgServerSchema,
  CollectWireguardProtectedRoutesSchema,
  VerifyWireguardConnectivitySchema,
  RunSpeedtestSchema,
} from "./tool-schemas.js";

// ============================================================================
// Core JSON and utility types
// ============================================================================

export type JsonRecord = Record<string, unknown>;

export type Logger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

export type ExecFileSyncRunner = (
  file: string,
  args?: readonly string[],
  options?: unknown,
) => string | Uint8Array;

// ============================================================================
// Bridge and Device types
// ============================================================================

export type ClawWRTBridge = unknown;

export type DeviceSnapshot = {
  deviceId: string;
  connectedAtMs: number;
  lastSeenAtMs: number;
  remoteAddress?: string;
  gateway?: unknown;
  deviceInfo?: unknown;
  authMode?: number;
  alias?: string;
};

export type ChawrtdDeviceSnapshot = {
  device_id?: string;
  connected_at?: string;
  last_seen_at?: string;
  remote_addr?: string;
  gateway?: unknown;
  device_info?: unknown;
  auth_mode?: number | string;
  alias?: string;
};

export type ChawrtdToolResult = {
  summary?: string;
  output?: string;
  data?: JsonRecord;
  error?: string;
};

// ============================================================================
// WireGuard types
// ============================================================================

export type WireguardProtectedRoutePlan = {
  deviceId: string;
  deviceName?: string;
  lanCidr: string;
  routes: string[];
};

export type WireguardProtectedRoutePlanFile = {
  version: 1;
  generatedAt: string;
  serverTunnelIp: string;
  serverTunnelCidr: string;
  deviceIds: string[];
  devices: Array<{
    deviceId: string;
    deviceName?: string;
    lanCidr?: string;
    error?: string;
  }>;
  failedDevices: Array<{
    deviceId: string;
    deviceName?: string;
    lanCidr?: string;
    error?: string;
  }>;
  conflicts: Array<{
    leftDeviceId: string;
    leftLanCidr: string;
    rightDeviceId: string;
    rightLanCidr: string;
  }>;
  blockedDeviceIds: string[];
  hasConflict: boolean;
  routePlans: WireguardProtectedRoutePlan[];
};

export type IPv4CidrInfo = {
  input: string;
  normalized: string;
  network: number;
  broadcast: number;
  prefix: number;
};

// ============================================================================
// Portal page types
// ============================================================================

export type PortalTemplate =
  | "default"
  | "welcome"
  | "business"
  | "cafe"
  | "hotel"
  | "terms"
  | "voucher"
  | "event";

export type PortalContent = {
  brandName?: string;
  networkName?: string;
  venueName?: string;
  title?: string;
  body?: string;
  buttonText?: string;
  footerText?: string;
  supportText?: string;
  voucherLabel?: string;
  voucherHint?: string;
  rules?: string[];
  accentColor?: string;
};

// ============================================================================
// BPF types
// ============================================================================

export type BpfJsonTable = "ipv4" | "ipv6" | "mac" | "sid" | "l7";

export type BpfTable = "ipv4" | "ipv6" | "mac";

// ============================================================================
// Tool parameter types (derived from schemas)
// ============================================================================

export type GenericToolParams = Static<typeof GenericToolSchema>;
export type DeviceOnlyParams = Static<typeof DeviceOnlySchema>;
export type ClientInfoParams = Static<typeof ClientInfoSchema>;
export type AuthClientParams = Static<typeof AuthClientSchema>;
export type KickoffClientParams = Static<typeof KickoffClientSchema>;
export type UpdateDeviceInfoParams = Static<typeof UpdateDeviceInfoSchema>;
export type SetAuthServerParams = Static<typeof SetAuthServerSchema>;
export type PublishPortalPageParams = Static<typeof PublishPortalPageSchema>;
export type GeneratePortalPageParams = Static<typeof GeneratePortalPageSchema>;
export type SetMqttServerParams = Static<typeof SetMqttServerSchema>;
export type SetWireguardVpnParams = Static<typeof SetWireguardVpnSchema>;
export type TmpPassParams = Static<typeof TmpPassSchema>;
export type SetWifiInfoParams = Static<typeof SetWifiInfoSchema>;
export type ScanWifiParams = Static<typeof ScanWifiSchema>;
export type SetWifiRelayParams = Static<typeof SetWifiRelaySchema>;
export type DomainSyncParams = Static<typeof DomainSyncSchema>;
export type TrustedMacSyncParams = Static<typeof TrustedMacSyncSchema>;
export type ShellCommandParams = Static<typeof ShellCommandSchema>;
export type BpfAddParams = Static<typeof BpfAddSchema>;
export type BpfJsonParams = Static<typeof BpfJsonSchema>;
export type BpfDeleteParams = Static<typeof BpfDeleteSchema>;
export type BpfFlushParams = Static<typeof BpfFlushSchema>;
export type BpfUpdateParams = Static<typeof BpfUpdateSchema>;
export type BpfUpdateAllParams = Static<typeof BpfUpdateAllSchema>;
export type SetVpnRoutesParams = Static<typeof SetVpnRoutesSchema>;
export type ResetWireguardVpnParams = Static<typeof ResetWireguardVpnSchema>;
export type SetBrLanParams = Static<typeof SetBrLanSchema>;
export type ResetWgServerParams = Static<typeof ResetWgServerSchema>;
export type VerifyFrpsParams = Static<typeof VerifyFrpsSchema>;
export type GetXfrpcTcpServiceParams = Static<typeof GetXfrpcTcpServiceSchema>;
export type DelXfrpcTcpServiceParams = Static<typeof DelXfrpcTcpServiceSchema>;
export type DisableXfrpcTcpServiceParams = Static<typeof DisableXfrpcTcpServiceSchema>;
export type DeployWgServerPeerParams = Static<
  NonNullable<(typeof DeployWgServerSchema)["properties"]["peerBindings"]>
>[number];
export type CollectWireguardProtectedRoutesParams = Static<
  typeof CollectWireguardProtectedRoutesSchema
>;
export type VerifyWireguardConnectivityParams = Static<
  typeof VerifyWireguardConnectivitySchema
>;
export type RunSpeedtestParams = Static<typeof RunSpeedtestSchema>;
export type DhcpDiagnoseParams = Static<typeof DhcpDiagnoseSchema>;
export type DnsDiagnoseParams = Static<typeof DnsDiagnoseSchema>;
export type WebServiceDiagnoseParams = Static<typeof WebServiceDiagnoseSchema>;
