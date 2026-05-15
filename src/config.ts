import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";

const DEFAULT_CHAWRTD_BASE_URL = "http://127.0.0.1:8001";
const DEFAULT_CHAWRTD_EVENT_STREAM_PATH = "/v1/events/stream";
const DEFAULT_CHAWRTD_EVENT_STREAM_RECONNECT_MIN_MS = 1000;
const DEFAULT_CHAWRTD_EVENT_STREAM_RECONNECT_MAX_MS = 15000;

export const ChawrtdEventStreamConfigSchema = Type.Object(
  {
    baseUrl: Type.Optional(
      Type.String({ minLength: 1, description: "chawrtd base URL, e.g. http://127.0.0.1:8001" }),
    ),
    path: Type.Optional(
      Type.String({ minLength: 1, description: "SSE event stream path, e.g. /v1/events/stream" }),
    ),
    reconnectMinMs: Type.Optional(
      Type.Integer({ minimum: 250, maximum: 60_000, description: "Initial reconnect backoff." }),
    ),
    reconnectMaxMs: Type.Optional(
      Type.Integer({ minimum: 1000, maximum: 120_000, description: "Maximum reconnect backoff." }),
    ),
  },
  { additionalProperties: false },
);

export const ClawWRTConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    chawrtdEventStream: Type.Optional(ChawrtdEventStreamConfigSchema),
  },
  { additionalProperties: false },
);

export type ResolvedChawrtdEventStreamConfig = {
  baseUrl: string;
  path: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
};

export type ResolvedClawWRTConfig = {
  enabled: boolean;
  chawrtdEventStream: ResolvedChawrtdEventStreamConfig;
};

function normalizeBaseUrl(input: string | undefined): string {
  const trimmed = input?.trim() || DEFAULT_CHAWRTD_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function normalizePath(input: string | undefined): string {
  const trimmed = input?.trim() || DEFAULT_CHAWRTD_EVENT_STREAM_PATH;
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  return `/${trimmed}`;
}

function asConfigObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readIntegerInRange(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function resolveChawrtdEventStreamConfig(value: unknown): ResolvedChawrtdEventStreamConfig {
  const parsed = Value.Check(ChawrtdEventStreamConfigSchema, value) ? value : asConfigObject(value);
  return {
    baseUrl: normalizeBaseUrl(readNonEmptyString(parsed?.baseUrl)),
    path: normalizePath(readNonEmptyString(parsed?.path)),
    reconnectMinMs:
      readIntegerInRange(parsed?.reconnectMinMs, 250, 60_000) ?? DEFAULT_CHAWRTD_EVENT_STREAM_RECONNECT_MIN_MS,
    reconnectMaxMs:
      readIntegerInRange(parsed?.reconnectMaxMs, 1000, 120_000) ?? DEFAULT_CHAWRTD_EVENT_STREAM_RECONNECT_MAX_MS,
  };
}

export function resolveClawWRTConfig(input: unknown): ResolvedClawWRTConfig {
  const parsed = Value.Check(ClawWRTConfigSchema, input) ? input : asConfigObject(input);

  return {
    enabled: readBoolean(parsed?.enabled) !== false,
    chawrtdEventStream: resolveChawrtdEventStreamConfig(parsed?.chawrtdEventStream),
  };
}

export function createClawWRTPluginConfigSchema(): OpenClawPluginConfigSchema {
  return {
    safeParse(value: unknown) {
      if (value === undefined) {
        return { success: true, data: resolveClawWRTConfig(undefined) };
      }
      const issues = [...Value.Errors(ClawWRTConfigSchema, value)];
      if (issues.length > 0) {
        return {
          success: false,
          error: {
            issues: issues.map((issue) => ({
              path: [],
              message: issue.message,
            })),
          },
        };
      }
      return { success: true, data: resolveClawWRTConfig(value) };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        chawrtdEventStream: {
          type: "object",
          additionalProperties: false,
          properties: {
            baseUrl: { type: "string" },
            path: { type: "string" },
            reconnectMinMs: { type: "integer", minimum: 250, maximum: 60000 },
            reconnectMaxMs: { type: "integer", minimum: 1000, maximum: 120000 },
          },
        },
      },
    },
  };
}
