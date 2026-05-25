import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClawWRTTools } from "../tool.js";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.stubGlobal("fetch", fetchMock);

describe("diagnostics tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends dhcp diagnose requests through chawrtd diagnose route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            service: "dnsmasq_dhcp",
            summary: { count: 1, success: 1, failure: 0, success_rate: 1, avg_latency_ms: 1 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const tool = createClawWRTTools({}).find((entry) => entry.name === "clawwrt_dhcp_diagnose");
    const result = await tool?.execute?.("tool-dhcp", {
      deviceId: "dev-1",
      interface: "br-lan",
      probeCount: 3,
      timeoutSec: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/device/dev-1/diagnose/dhcp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      interface: "br-lan",
      probe_count: 3,
      timeout_sec: 4,
    });
    const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
    expect(text).toContain("DHCP diagnose finished");
    expect(text).toContain("avg_latency_ms");
  });

  it("sends dns diagnose requests with multiple domains", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { service: "dnsmasq_dns", summary: { count: 2, success: 2, failure: 0, success_rate: 1, avg_latency_ms: 2 } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const tool = createClawWRTTools({}).find((entry) => entry.name === "clawwrt_dns_diagnose");
    await tool?.execute?.("tool-dns", {
      deviceId: "dev-1",
      dnsServer: "127.0.0.1",
      domains: ["captive.apple.com", "www.gstatic.com"],
      probeCount: 2,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/device/dev-1/diagnose/dns");
    expect(JSON.parse(String(init.body))).toMatchObject({
      dns_server: "127.0.0.1",
      domains: ["captive.apple.com", "www.gstatic.com"],
      probe_count: 2,
    });
  });

  it("sends http and https diagnose requests with path and port", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { service: "apfree_wifidog_http", summary: { count: 1, success: 1, failure: 0, success_rate: 1, avg_latency_ms: 1 } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const httpTool = createClawWRTTools({}).find((entry) => entry.name === "clawwrt_http_service_diagnose");
    await httpTool?.execute?.("tool-http", {
      deviceId: "dev-1",
      host: "127.0.0.1",
      port: 2060,
      path: "/",
      probeCount: 5,
    });

    const [, httpInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(httpInit.body))).toMatchObject({
      host: "127.0.0.1",
      port: 2060,
      path: "/",
      probe_count: 5,
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { service: "apfree_wifidog_https", summary: { count: 1, success: 1, failure: 0, success_rate: 1, avg_latency_ms: 20 } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const httpsTool = createClawWRTTools({}).find((entry) => entry.name === "clawwrt_https_service_diagnose");
    await httpsTool?.execute?.("tool-https", {
      deviceId: "dev-1",
      host: "127.0.0.1",
      port: 8443,
      path: "/",
      probeCount: 5,
    });

    const [httpsUrl, httpsInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(httpsUrl).toContain("/v1/device/dev-1/diagnose/https");
    expect(JSON.parse(String(httpsInit.body))).toMatchObject({
      host: "127.0.0.1",
      port: 8443,
      path: "/",
      probe_count: 5,
    });
  });
});