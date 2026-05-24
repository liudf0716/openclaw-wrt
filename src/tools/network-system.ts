/**
 * Network system tools: LAN config, speedtest, shell execution.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import * as SharedSchemas from "../tool-schemas.js";
import type {
  JsonRecord,
  DeviceOnlyParams,
  SetBrLanParams,
  RunSpeedtestParams,
  ShellCommandParams,
} from "../tool-types.js";
import { callDeviceOp, getDeviceViaChawrtd } from "../chawrtd-client.js";
import { createSimpleOperationTool, buildToolResult, logToolInvocation, type ToolFactoryDeps } from "./_factory.js";

export function createNetworkSystemTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    // ---------------------------------------------------------------------------
    // clawwrt_get_br_lan — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_br_lan",
      label: "OpenClaw WRT Get BR-LAN",
      description:
        "Get the router's br-lan (LAN) IP address, netmask, and computed CIDR (e.g. 192.168.1.0/24). Use this to inspect LAN subnet assignments before WireGuard planning or to detect subnet conflicts.",
      op: "get_br_lan",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched br-lan CIDR for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_set_br_lan — custom (destructive, needs explicit user confirmation)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_set_br_lan",
      label: "OpenClaw WRT Set BR-LAN",
      description:
        "Change the router's br-lan LAN IP address and subnet. ⚠️ DESTRUCTIVE: changing the LAN IP will disconnect all LAN clients and re-issue DHCP leases. MUST obtain explicit user confirmation before calling this tool.",
      parameters: SharedSchemas.SetBrLanSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_set_br_lan", rawParams);
        const args = rawParams as SetBrLanParams;
        const deviceId = args.deviceId.trim();
        const payload: Record<string, unknown> = { ipaddr: args.ipaddr.trim() };
        if (typeof args.netmask === "string") payload.netmask = args.netmask.trim();
        if (typeof args.prefixLen === "number") payload.prefix_len = args.prefixLen;

        const result = await callDeviceOp({
          deviceId,
          op: "set_br_lan",
          payload,
          timeoutMs: args.timeoutMs,
        });

        const data = result as Record<string, unknown>;
        return buildToolResult(
          `br-lan updated on ${deviceId}: ipaddr=${data.ipaddr}, cidr=${data.cidr}. Network reload triggered.`,
          data,
        );
      },
    },

    // ---------------------------------------------------------------------------
    // clawwrt_speedtest — simple op with payload builder
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_speedtest",
      label: "OpenClaw WRT Speedtest",
      description: "Run an internet speed test (ping, download, upload) on the router.",
      op: "speedtest",
      parameters: SharedSchemas.RunSpeedtestSchema,
      buildPayload: (rawParams) => {
        const args = rawParams as RunSpeedtestParams & { deviceId: string; serverId?: string; timeoutMs?: number };
        return {
          deviceId: args.deviceId.trim(),
          payload: args.serverId ? { server_id: args.serverId } : undefined,
          timeoutMs: args.timeoutMs ?? 120_000,
        };
      },
      summarize: (_response, rawParams) => {
        const args = rawParams as { deviceId: string };
        return `Completed speedtest on ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_get_speedtest_servers — simple op
    // ---------------------------------------------------------------------------
    createSimpleOperationTool({
      ...deps,
      name: "clawwrt_get_speedtest_servers",
      label: "OpenClaw WRT Speedtest Servers",
      description: "List available nearby speedtest.net servers for performance testing.",
      op: "get_speedtest_servers",
      summarize: (_response, rawParams) => {
        const args = rawParams as DeviceOnlyParams;
        return `Fetched speedtest servers for ${args.deviceId}.`;
      },
    }),

    // ---------------------------------------------------------------------------
    // clawwrt_execute_shell — custom (requires user confirmation)
    // ---------------------------------------------------------------------------
    {
      name: "clawwrt_execute_shell",
      label: "OpenClaw WRT Execute Shell",
      description:
        "Execute a raw shell command on the router. STRICT RULES: (1) NEVER call this tool to implement any Wi-Fi/router feature — always use the dedicated clawwrt_* API tools instead. (2) ONLY call this tool when the user has EXPLICITLY typed a shell command or said something like '执行命令'/'run command'/'shell'. (3) ALWAYS show the exact command to the user and WAIT for explicit approval BEFORE calling this tool. Calling without user approval is FORBIDDEN.",
      parameters: SharedSchemas.ShellCommandSchema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        logToolInvocation(deps.logger, "clawwrt_execute_shell", rawParams);
        const args = rawParams as ShellCommandParams;
        if (args.userConfirmed !== true) {
          return buildToolResult(
            `⚠️ Shell 命令需要用户确认后才能执行。\n\n` +
            `即将在设备 ${args.deviceId.trim()} 上执行以下命令：\n\`\`\`\n${args.command}\n\`\`\`\n\n` +
            `请向用户展示以上命令，并等待用户明确回复"确认"/"yes"/"执行"后，再以 userConfirmed=true 重新调用本工具。`,
            { pendingApproval: true, command: args.command, deviceId: args.deviceId.trim() },
          );
        }
        const device = await getDeviceViaChawrtd(args.deviceId.trim());
        if (!device) {
          throw new Error(`Device ${args.deviceId.trim()} not found or offline`);
        }
        const payload: JsonRecord = { command: args.command };
        if (typeof args.timeoutSeconds === "number") {
          payload.timeout = args.timeoutSeconds;
        }
        const response = await callDeviceOp({
          deviceId: args.deviceId.trim(),
          op: "shell",
          payload,
          timeoutMs: args.timeoutMs,
        });
        return buildToolResult(`Shell 命令已在 ${args.deviceId.trim()} 上执行。`, { response });
      },
    },
  ];
}
