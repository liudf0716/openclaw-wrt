import { Type } from "@sinclair/typebox";
import { DeviceIdField, TimeoutField } from "./common.js";

export const SetMqttServerSchema = Type.Object(
  {
    deviceId: DeviceIdField,
    hostname: Type.Optional(Type.String({ minLength: 1, description: "MQTT server hostname." })),
    port: Type.Optional(Type.String({ minLength: 1, description: "MQTT server port." })),
    username: Type.Optional(Type.String({ minLength: 1, description: "MQTT username." })),
    password: Type.Optional(Type.String({ minLength: 1, description: "MQTT password." })),
    useSsl: Type.Optional(Type.Boolean({ description: "Whether to enable MQTT TLS/SSL." })),
    timeoutMs: TimeoutField,
  },
  { additionalProperties: false },
);
