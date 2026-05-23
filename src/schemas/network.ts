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
