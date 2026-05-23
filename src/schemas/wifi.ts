import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField, WifiConfigDataField, BandField } from "./common.js";

export const SetWifiInfoSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    data: WifiConfigDataField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const ScanWifiSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    band: BandField,
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const SetWifiRelaySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    ssid: Type.String({ minLength: 1 }),
    key: Type.Optional(Type.String()),
    band: BandField,
    encryption: Type.Optional(Type.String()),
    bssid: Type.Optional(Type.String()),
    apply: Type.Optional(Type.Boolean()),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);

export const DeleteWifiRelaySchema = Type.Object(
  {
    deviceId: DeviceIdField,
    apply: Type.Optional(Type.Boolean({ description: "Apply changes immediately." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
