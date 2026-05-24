/**
 * FRPS server infrastructure tools: deploy, status, verify, reset, WireGuard server.
 * These are openclaw_* namespace tools that operate on the VPS via chawrtd.
 */

import { isIPv4 } from "node:net";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeployWgServerPeerParams,
  ResetWgServerParams,
} from "../tool-types.js";
import {
  callChawrtd,
  callDeviceOp,
  getDevicesListViaChawrtd,
} from "../chawrtd-client.js";
import { buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";
import {
  asObject,
  generateSecureToken,
  getTrimmedString,
  getFrpsStatusToken,
  getFrpsStatusPort,
  getFrpsStatusPublicIp,
  getXfrpcCommonConfigFromResponse,
  getXfrpcTcpServicesFromResponse,
  getXfrpcTcpServiceRemotePort,
} from "./_helpers.js";

export function createFrpsTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    // ---------------------------------------------------------------------------
    // openclaw_deploy_frps — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_deploy_frps",
      label: "OpenClaw Deploy FRPS",
      description:
        "Deploy intranet-penetration server: fetch latest version from GitHub, install as /usr/bin/nwct-server, configure systemd autostart. Token is auto-generated when omitted, and the tool performs a post-deploy status check with one retry if the returned token is empty.",
      parameters: SharedSchemas.DeployFrpsSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "openclaw_deploy_frps", rawParams);
        const args = rawParams as Static<typeof SharedSchemas.DeployFrpsSchema>;
        const deployPort = args.port;
        let token = getTrimmedString(args.token) ?? generateSecureToken();
        let response = await callChawrtd({
          path: "/v1/frps/deploy",
          method: "POST",
          body: {
            port: deployPort,
            token,
          },
        });
        let statusResponse = await callChawrtd({ path: "/v1/frps/status", method: "GET" });
        let effectiveToken = getFrpsStatusToken(statusResponse);
        if (!effectiveToken) {
          token = generateSecureToken();
          response = await callChawrtd({
            path: "/v1/frps/deploy",
            method: "POST",
            body: {
              port: deployPort,
              token,
            },
          });
          statusResponse = await callChawrtd({ path: "/v1/frps/status", method: "GET" });
          effectiveToken = getFrpsStatusToken(statusResponse);
        }

        return buildToolResult(
          `${response.summary ?? "FRPS deployment requested."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            response,
            token: effectiveToken ?? token,
            statusResponse,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_get_frps_status — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_get_frps_status",
      label: "OpenClaw Get FRPS Status",
      description:
        "Lightweight FRPS server-only status check. Use this when you only need the VPS-side service state, listening ports, or token/port config, or as a fallback when the aggregated full-status tool is unavailable.",
      parameters: Type.Object({}),
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_get_frps_status");
        const response = await callChawrtd({ path: "/v1/frps/status", method: "GET" });
        const text = `${response.summary ?? "FRPS status fetched."}${
          response.output ? `\n\n${response.output}` : ""
        }`;
        return buildToolResult(text, {
          status: "success",
          response,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_frps_full_status — custom (aggregated)
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_frps_full_status",
      label: "OpenClaw FRPS Full Status",
      description:
        "Aggregate intranet-penetration status across the VPS and all connected routers. Returns server status, public IP, device common config, TCP services, and any remote-port conflicts in one structured payload.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_frps_full_status");
        const [statusResponse, publicIpResponse, devices] = await Promise.all([
          callChawrtd({ path: "/v1/frps/status", method: "GET" }),
          callChawrtd({ path: "/v1/vps/public-ip", method: "GET" }),
          getDevicesListViaChawrtd(),
        ]);

        const serverStatus = asObject(statusResponse.data) ?? asObject(statusResponse) ?? {};
        const publicIp = getFrpsStatusPublicIp(publicIpResponse);
        const serverPort = getFrpsStatusPort(statusResponse);
        const serverToken = getFrpsStatusToken(statusResponse);
        const serverPortNumber = serverPort ? Number.parseInt(serverPort, 10) : undefined;

        const deviceReports = await Promise.all(
          devices.map(async (device) => {
            const [commonResponse, servicesResponse] = await Promise.all([
              callDeviceOp({
                deviceId: device.deviceId,
                op: "get_xfrpc_common",
                payload: {},
              }),
              callDeviceOp({
                deviceId: device.deviceId,
                op: "get_xfrpc_tcp_service",
                payload: {},
              }),
            ]);

            const commonConfig = getXfrpcCommonConfigFromResponse(commonResponse);
            const tcpServices = getXfrpcTcpServicesFromResponse(servicesResponse);
            const devicePort = getTrimmedString(commonConfig.server_port);
            const deviceToken = getTrimmedString(commonConfig.token);
            const localConflicts = tcpServices
              .map((service) => getXfrpcTcpServiceRemotePort(service))
              .filter((value): value is number => typeof value === "number")
              .filter((value, index, values) => values.indexOf(value) !== index || value === serverPortNumber);

            return {
              deviceId: device.deviceId,
              commonConfig,
              tcpServices,
              consistent:
                Boolean(devicePort) &&
                Boolean(deviceToken) &&
                devicePort === serverPort &&
                deviceToken === serverToken &&
                localConflicts.length === 0,
              conflicts: localConflicts.map((remotePort) => ({
                remote_port: remotePort,
              })),
            };
          }),
        );

        const conflicts = deviceReports.flatMap((deviceReport) =>
          deviceReport.conflicts.map((conflict) => ({
            deviceId: deviceReport.deviceId,
            remote_port: conflict.remote_port,
          })),
        );

        return buildToolResult("Aggregated FRPS status across server and routers.", {
          status: "success",
          serverStatus,
          publicIp,
          devices: deviceReports,
          conflicts,
          response: statusResponse,
          publicIpResponse,
        });
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_verify_frps — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_verify_frps",
      label: "OpenClaw Verify Intranet Penetration Service",
      description:
        "Verify intranet-penetration service readiness by checking whether the VPS is currently listening on the provided protocol and port. Returns a machine-checkable listener result, not an application-layer connectivity proof.",
      parameters: SharedSchemas.VerifyFrpsSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "openclaw_verify_frps", rawParams);
        const args = rawParams as Static<typeof SharedSchemas.VerifyFrpsSchema>;
        const response = await callChawrtd({
          path: "/v1/frps/verify",
          method: "POST",
          body: {
            protocol: args.protocol,
            port: args.port,
          },
        });

        return buildToolResult(
          `${response.summary ?? "Intranet-penetration service verification completed."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            response,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_reset_frps — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_reset_frps",
      label: "OpenClaw Reset FRPS",
      description:
        "Stop and disable nwct-server, remove config directory and systemd service file from the VPS. Binary is preserved for future deployments.",
      parameters: SharedSchemas.ResetFrpsSchema,
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_reset_frps");
        const response = await callChawrtd({ path: "/v1/frps/reset", method: "POST" });
        return buildToolResult(
          `${response.summary ?? "FRPS reset requested."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            response,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_reset_wg_server — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_reset_wg_server",
      label: "OpenClaw Reset WireGuard Server",
      description:
        "Reset VPS-side WireGuard server configuration by stopping wg-quick, removing interface config, and optionally removing server key files.",
      parameters: SharedSchemas.ResetWgServerSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "openclaw_reset_wg_server", rawParams);
        const args = rawParams as ResetWgServerParams;
        const iface = (args.interface ?? "wg0").trim() || "wg0";

        if (!/^[a-zA-Z0-9_.@-]+$/.test(iface)) {
          return buildToolResult("Invalid WireGuard interface name.", { status: "error" });
        }
        const removeKeys = args.removeKeys ?? true;
        const response = await callChawrtd({
          path: "/v1/wg/reset",
          method: "POST",
          body: {
            interface: iface,
            removeKeys,
          },
        });

        return buildToolResult(
          `${response.summary ?? "WireGuard reset requested."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            interface: iface,
            removeKeys,
            response,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_deploy_wg_server — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_deploy_wg_server",
      label: "OpenClaw Deploy WireGuard Server",
      description:
        "Automatically install WireGuard, enable IP forwarding, generate server keys, and configure wg0 with NAT on the VPS host. When peerBindings are provided, write all peer AllowedIPs into wg0.conf in the same deployment pass.",
      parameters: SharedSchemas.DeployWgServerSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const executionMarker = `openclaw_deploy_wg_server:${Date.now()}`;
        logToolInvocation(deps.logger, "openclaw_deploy_wg_server", { executionMarker, rawParams });
        const args = rawParams as {
          port?: number;
          tunnelIp?: string;
          egressInterface?: string;
          peerBindings?: DeployWgServerPeerParams[];
        };
        const port = args.port || 51820;
        const tunnelIp = args.tunnelIp || "10.0.0.1/24";
        if (!/^[\w.:/,\- ]+$/.test(tunnelIp)) {
          return buildToolResult(
            "Invalid tunnelIp format. Only alphanumeric and basic network punctuation allowed.",
            { status: "error" },
          );
        }
        if (!Array.isArray(args.peerBindings) || args.peerBindings.length === 0) {
          return buildToolResult(
            "WireGuard deployment requires peerBindings. Please collect every client's LAN CIDR first, then rerun openclaw_deploy_wg_server with the complete peerBindings list.",
            {
              status: "error",
              missingPeerBindings: true,
              requiredAction: "collect_client_lan_info",
            },
          );
        }

        const response = await callChawrtd({
          path: "/v1/wg/deploy",
          method: "POST",
          body: {
            port,
            tunnelIp,
            egressInterface: args.egressInterface,
            peerBindings: args.peerBindings,
          },
        });

        return buildToolResult(
          `${response.summary ?? "WireGuard deployment requested."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            executionMarker,
            response,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_get_wg_status — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_get_wg_status",
      label: "OpenClaw Get WireGuard Status",
      description: "Check WireGuard server runtime status, peers, and forwarding state.",
      parameters: Type.Object({}),
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_get_wg_status");
        const response = await callChawrtd({ path: "/v1/wg/status", method: "GET" });
        return buildToolResult(
          `${response.summary ?? "WireGuard status fetched."}${
            response.output ? `\n\n${response.output}` : ""
          }`,
          {
            status: "success",
            response,
          },
        );
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_get_wg_server_public_key — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_get_wg_server_public_key",
      label: "OpenClaw Get WireGuard Server Public Key",
      description:
        "Fetch the VPS WireGuard server public key from chawrtd so client setup can consume the exact deployed key without guessing.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_get_wg_server_public_key");
        try {
          const response = await callChawrtd({ path: "/v1/wg/status", method: "GET" });
          const serverData = asObject(asObject(response.data)?.server);
          const serverPublicKey = typeof serverData?.serverPublicKey === "string" ? serverData.serverPublicKey.trim() : "";
          if (!serverPublicKey) {
            return buildToolResult(
              `WireGuard server public key is unavailable from chawrtd. Re-run openclaw_deploy_wg_server if the server was reset or the key file was removed.`,
              {
                status: "error",
                missingServerPublicKey: true,
              },
            );
          }

          return buildToolResult(`Fetched WireGuard server public key from chawrtd.`, {
            status: "success",
            serverPublicKey,
          });
        } catch (error) {
          return buildToolResult(
            `Failed to read WireGuard server public key from chawrtd: ${error instanceof Error ? error.message : String(error)}`,
            {
              status: "error",
              missingServerPublicKey: true,
            },
          );
        }
      },
    },

    // ---------------------------------------------------------------------------
    // openclaw_get_vps_public_ip — custom
    // ---------------------------------------------------------------------------
    {
      name: "openclaw_get_vps_public_ip",
      label: "OpenClaw Get VPS Public IP",
      description:
        "Detect the current VPS public IPv4 address from chawrtd. If automatic detection fails or returns a non-IPv4 result, the tool reports a structured error so the agent can ask the user to confirm the VPS public IP or domain instead of guessing.",
      parameters: SharedSchemas.GetVpsPublicIpSchema,
      execute: async () => {
        logToolInvocation(deps.logger, "openclaw_get_vps_public_ip");
        try {
          const response = await callChawrtd({ path: "/v1/vps/public-ip", method: "GET" });
          const data = asObject(response.data);
          const publicIp = typeof data?.publicIp === "string" ? data.publicIp.trim() : "";
          if (!publicIp) {
            throw new Error("chawrtd returned an empty VPS public IP");
          }
          if (!isIPv4(publicIp)) {
            throw new Error(`chawrtd returned a non-IPv4 VPS public IP: ${publicIp}`);
          }

          return buildToolResult(`Detected VPS public IPv4 address from chawrtd: ${publicIp}.`, {
            status: "success",
            publicIp,
            source: "chawrtd /v1/vps/public-ip",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return buildToolResult(
            `Unable to detect the VPS public IP automatically via chawrtd: ${message}. Please ask the user to confirm the VPS public IP or domain, then continue with the confirmed value instead of guessing.`,
            {
              status: "error",
              requiresUserConfirmation: true,
              requiredAction: "confirm_vps_public_ip_or_domain",
              source: "chawrtd /v1/vps/public-ip",
              error: message,
            },
          );
        }
      },
    },
  ];
}
