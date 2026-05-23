import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField, XfrpcServiceNameField } from "./common.js";

export const SetXfrpcCommonSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    enabled: Type.Optional(Type.String({ description: "'0' or '1'." })),
    loglevel: Type.Optional(Type.String({ description: "Log level, e.g., '7'." })),
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
    remote_port: Type.Optional(Type.String({ description: "Remote port on FRPS server. Checked for 1-65535 range and same-device conflicts." })),
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
