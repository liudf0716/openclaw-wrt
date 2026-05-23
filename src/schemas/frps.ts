import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk/core";
import { DeviceIdField } from "./common.js";

export const DeployFrpsSchema = Type.Object(
  {
    port: Type.Integer({
      minimum: 1,
      maximum: 65535,
      description:
        "FRPS listen port. Default: 7070. Use this default unless the user explicitly specifies a different port.",
    }),
    token: Type.Optional(Type.String({
      description:
        "Authentication token. Optional. If omitted, the tool auto-generates a secure token. If the user explicitly provides a token, use theirs instead.",
    })),
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
