import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField, BpfTableField, BpfJsonTableField } from "./common.js";

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
