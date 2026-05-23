import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField, StringArrayField } from "./common.js";

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
