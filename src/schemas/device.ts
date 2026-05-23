import { Type } from "@sinclair/typebox";
import { stringEnum } from "openclaw/plugin-sdk/core";
import { DeviceIdField, TimeoutField, JsonObjectField } from "./common.js";

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

export const UpdateDeviceInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    deviceInfo: JsonObjectField,
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
