import { describe, expect, it } from "vitest";
import { resolveSessionStoreKeys } from "../index.js";

describe("resolveSessionStoreKeys", () => {
  it("writes both raw and agent-scoped keys for plugin-owned subagent sessions", () => {
    expect(resolveSessionStoreKeys("openclaw-wrt:device-events:dev-1")).toEqual([
      "openclaw-wrt:device-events:dev-1",
      "agent:main:openclaw-wrt:device-events:dev-1",
    ]);
  });

  it("preserves already-normalized agent session keys", () => {
    expect(resolveSessionStoreKeys("agent:main:openclaw-wrt:device-events:dev-1")).toEqual([
      "agent:main:openclaw-wrt:device-events:dev-1",
    ]);
  });
});
