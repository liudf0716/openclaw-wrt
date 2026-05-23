import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField } from "./common.js";

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
