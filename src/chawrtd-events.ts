import { createRequire } from "node:module";
import type { ResolvedClawWRTConfig } from "./config.js";

const require = createRequire(import.meta.url);

type UndiciAgentLike = {
  close?: () => Promise<void> | void;
};

function createSseDispatcher(): unknown {
  try {
    const undici = require("undici") as {
      Agent?: new (options?: Record<string, unknown>) => UndiciAgentLike;
    };
    if (typeof undici.Agent === "function") {
      return new undici.Agent({ bodyTimeout: 0, headersTimeout: 0 });
    }
  } catch {
    // Keep using global fetch defaults when undici runtime is unavailable.
  }
  return undefined;
}

export type ChawrtdDeviceEvent = {
  deviceId?: string;
  alias?: string;
  time?: number;
  op?: string;
  data?: Record<string, unknown>;
};

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
};

type EventHandler = (event: ChawrtdDeviceEvent) => void | Promise<void>;
type RequestInitWithDispatcher = Omit<RequestInit, "dispatcher"> & { dispatcher?: unknown };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseEventBlock(block: string): ChawrtdDeviceEvent | null {
  // Fast path: find "data:" fields using indexOf to avoid split/join allocation.
  let dataPayload = "";
  let pos = 0;
  while (pos < block.length) {
    const lineStart = pos;
    const lineEnd = block.indexOf("\n", pos);
    pos = lineEnd >= 0 ? lineEnd + 1 : block.length;
    const line = lineEnd >= 0 ? block.slice(lineStart, lineEnd) : block.slice(lineStart);
    if (!line || line.charCodeAt(0) === 58 /* ':' */) {
      continue;
    }
    const sep = line.indexOf(":");
    const field = sep >= 0 ? line.slice(0, sep) : line;
    if (field === "data") {
      const rawValue = sep >= 0 ? line.slice(sep + 1) : "";
      const value = rawValue.charCodeAt(0) === 32 /* ' ' */ ? rawValue.slice(1) : rawValue;
      if (dataPayload) {
        dataPayload += "\n" + value;
      } else {
        dataPayload = value;
      }
    }
  }

  if (!dataPayload) {
    return null;
  }

  const payloadText = dataPayload;
  try {
    const parsed = JSON.parse(payloadText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      deviceId: typeof parsed.device_id === "string" ? parsed.device_id : undefined,
      alias: typeof parsed.alias === "string" ? parsed.alias : undefined,
      time: typeof parsed.time === "number" && Number.isFinite(parsed.time) ? parsed.time : undefined,
      op: typeof parsed.op === "string" ? parsed.op : undefined,
      data: parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : undefined,
    };
  } catch {
    return null;
  }
}

export class ChawrtdEventStreamClient {
  private readonly logger: Logger;
  private readonly onEvent: EventHandler;
  private readonly config: ResolvedClawWRTConfig;
  // Keep SSE reads alive indefinitely; default undici body timeout is too short for quiet streams.
  private readonly streamDispatcher = createSseDispatcher();
  // TextDecoder is stateless; reuse across reconnects.
  private readonly decoder = new TextDecoder();
  private controller: AbortController | null = null;
  private running = false;

  constructor(params: { logger: Logger; onEvent: EventHandler; config: ResolvedClawWRTConfig }) {
    this.logger = params.logger;
    this.onEvent = params.onEvent;
    this.config = params.config;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let backoffMs = this.config.chawrtdEventStream.reconnectMinMs;
    const maxBackoffMs = this.config.chawrtdEventStream.reconnectMaxMs;

    while (this.running && !signal.aborted) {
      try {
        this.logger.info(
          `openclaw-wrt: connecting to chawrtd event stream url=${this.config.chawrtdEventStream.baseUrl}${this.config.chawrtdEventStream.path}`,
        );
        const requestInit: RequestInitWithDispatcher = {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal,
          ...(this.streamDispatcher ? { dispatcher: this.streamDispatcher } : {}),
        };

        const response = await fetch(
          `${this.config.chawrtdEventStream.baseUrl}${this.config.chawrtdEventStream.path}`,
          requestInit as RequestInit,
        );

        if (!response.ok || !response.body) {
          throw new Error(`stream request failed with status ${response.status}`);
        }

        this.logger.info("openclaw-wrt: connected to chawrtd event stream");
        backoffMs = this.config.chawrtdEventStream.reconnectMinMs;

        const reader = response.body.getReader();
        let buffer = "";

        while (this.running && !signal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += this.decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = parseEventBlock(block);
            if (event) {
              this.logger.debug?.(
                `openclaw-wrt: parsed chawrtd event deviceId=${event.deviceId ?? "<missing>"} op=${event.op ?? "<missing>"}`,
              );
              if (event.data && Object.keys(event.data).length > 0) {
                this.logger.debug?.(
                  `openclaw-wrt: parsed chawrtd event payload keys=${Object.keys(event.data).join(",")}`,
                );
              }
              await this.onEvent(event);
            } else {
              this.logger.debug?.("openclaw-wrt: ignored non-data SSE block from chawrtd stream");
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (signal.aborted || !this.running) {
          return;
        }
        this.logger.warn(`openclaw-wrt: event stream disconnected: ${String(error)}`);
      }

      if (!this.running || signal.aborted) {
        return;
      }

      await sleep(backoffMs, signal).catch(() => undefined);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }
}
