import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField } from "./common.js";

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

export const RunSpeedtestSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    serverId: Type.Optional(Type.String({ description: "Optional specific speedtest server ID." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DhcpDiagnoseSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    interface: Type.Optional(
      Type.String({ minLength: 1, description: "Interface to probe. Defaults to br-lan." }),
    ),
    dhcpServer: Type.Optional(
      Type.String({ minLength: 1, description: "Target DHCP server IP. Defaults to 255.255.255.255." }),
    ),
    timeoutSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 30, description: "Per-probe timeout in seconds. Defaults to 3." }),
    ),
    probeCount: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Number of probes to run. Defaults to 5." }),
    ),
    probeIntervalMs: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 5000, description: "Delay between probes in milliseconds. Defaults to 0." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DnsDiagnoseSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    dnsServer: Type.Optional(
      Type.String({ minLength: 1, description: "Target DNS server IP. Defaults to 127.0.0.1." }),
    ),
    domain: Type.Optional(
      Type.String({ minLength: 1, description: "Single DNS name to query." }),
    ),
    domains: Type.Optional(
      Type.Array(Type.String({ minLength: 1, description: "One DNS name to query." }), {
        description: "Ordered DNS names to probe in a round-robin cycle.",
      }),
    ),
    timeoutSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 30, description: "Per-query timeout in seconds. Defaults to 3." }),
    ),
    probeCount: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Number of queries to run. Defaults to 5." }),
    ),
    probeIntervalMs: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 5000, description: "Delay between queries in milliseconds. Defaults to 0." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const WebServiceDiagnoseSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    host: Type.Optional(Type.String({ minLength: 1, description: "Target host. Defaults to 127.0.0.1." })),
    port: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 65535, description: "Target port. Defaults to the configured HTTP/HTTPS port." }),
    ),
    path: Type.Optional(Type.String({ minLength: 1, description: "Request path. Defaults to /." })),
    timeoutSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 30, description: "Per-request timeout in seconds. Defaults to 3." }),
    ),
    probeCount: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Number of requests to run. Defaults to 5." }),
    ),
    probeIntervalMs: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 5000, description: "Delay between requests in milliseconds. Defaults to 0." }),
    ),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
