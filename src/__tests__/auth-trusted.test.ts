import { describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

describe("auth and trusted tools", () => {
  it("trusted-domain sync tool sends the full domains array as sync_trusted_domain payload", async () => {
    const calls: Array<{ deviceId: string; op: string; payload?: Record<string, unknown> }> = [];
    const bridge = {
      listDevices() {
        return [];
      },
      getDevice() {
        return null;
      },
      async callDevice(params: {
        deviceId: string;
        op: string;
        payload?: Record<string, unknown>;
      }) {
        calls.push(params);
        return { type: "sync_trusted_domain_response", status: "success" };
      },
    };

    const tool = createClawWRTTools({ bridge: bridge as never }).find(
      (entry) => entry.name === "clawwrt_sync_trusted_domains",
    );

    const result = await tool?.execute?.("tool-2", {
      deviceId: "dev-2",
      domains: ["example.com", "login.example.net"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      deviceId: "dev-2",
      op: "sync_trusted_domain",
      payload: {
        domains: ["example.com", "login.example.net"],
      },
    });
    expect((result as { content?: Array<{ text?: string }> }).content?.[0]?.text).toContain(
      "Synced 2 trusted domains",
    );
  });
});
