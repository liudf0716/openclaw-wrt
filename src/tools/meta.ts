/**
 * Meta/aggregate tools: claw_wifi_hello and clawwrt (low-level fallback).
 * These two tools are special - they're not domain-specific operations.
 * claw_wifi_hello returns a greeting with device status.
 * clawwrt is the low-level fallback tool.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolFactoryDeps } from "./_factory.js";
import { logToolInvocation, buildToolResult } from "./_helpers.js";
import { getDevicesListViaChawrtd, callDeviceOp } from "../tool-chawrtd.js";

export function createMetaTools(deps: ToolFactoryDeps): AnyAgentTool[] {
  return [
    {
      name: "claw_wifi_hello",
      label: "Claw WiFi Hello",
      description:
        "当用户打招呼（如 Hello, 你好, hello 龙虾wifi）、询问龙虾WiFi (Claw WiFi) 具有哪些功能或需要使用示例 (Prompts) 时调用。此工具会确认 Agent 身份，展示功能目录并提供一系列引导示例。",
      parameters: { type: "object" as const, properties: {} },
      execute: async () => {
        logToolInvocation(deps.logger, "claw_wifi_hello");

        // Get device list for status display
        // getDevicesListViaChawrtd already resolves full snapshots for each device
        let deviceSection = "";
        try {
          const devices = await getDevicesListViaChawrtd();
          if (devices.length > 0) {
            const lines: string[] = [];
            for (const d of devices) {
              const deviceId = typeof d.deviceId === "string" ? d.deviceId : "unknown";
              const alias = typeof d.alias === "string" && d.alias.trim() ? d.alias.trim() : "";
              const suffix = alias ? `（${alias}）` : "";
              let detail = "";
              const connectedAt = typeof d.connectedAtMs === "number" ? d.connectedAtMs : undefined;
              const lastSeen = typeof d.lastSeenAtMs === "number" ? d.lastSeenAtMs : undefined;
              if (connectedAt) {
                const hours = Math.floor((Date.now() - connectedAt) / 3_600_000);
                const hLabel = hours >= 24 ? `${Math.floor(hours / 24)}d${hours % 24}h` : `${hours}h`;
                detail += `  接入时长 ${hLabel}`;
              }
              if (lastSeen) {
                const agoSec = Math.floor((Date.now() - lastSeen) / 1000);
                detail += ` · 最近活跃 ${agoSec}s ago`;
              }
              if (typeof d.remoteAddress === "string") {
                detail += ` · IP ${d.remoteAddress}`;
              }
              if (typeof d.authMode === "number") {
                detail += ` · auth=${d.authMode}`;
              }
              lines.push(`- 🟢 \`${deviceId}\`${suffix}${detail}`);
            }
            deviceSection = `\n\n## 📡 在线路由器（连接快照）\n${lines.join("\n")}`;
          }
        } catch {
          // ignore device list errors
        }

        const text = [
          "🦞 你好！我是龙虾WiFi管家，可以帮你管理龙虾WiFi路由器。",
          deviceSection,
          "## 🛠️ 快捷功能导航",
          "- 设备状态/信息 → `clawwrt_get_status`, `clawwrt_get_sys_info`",
          "- WiFi 设置 → `clawwrt_set_wifi_info`, `clawwrt_scan_wifi`",
          "- VPN 配置 → `clawwrt_set_wireguard_vpn`, `clawwrt_get_wireguard_vpn_status`",
          "- 流量监控 → `clawwrt_bpf_json`, `clawwrt_get_l7_active_stats`",
          "- 客户端管理 → `clawwrt_get_clients`, `clawwrt_auth_client`",
          "- 防火墙规则 → `clawwrt_bpf_add`, `clawwrt_bpf_update`",
          "- 网络设置 → `clawwrt_set_br_lan`, `clawwrt_speedtest`",
          "- 内网穿透 → `clawwrt_add_xfrpc_tcp_service`, `openclaw_deploy_frps`",
          "",
          "示例 Prompts：",
          "- '查看所有在线路由器状态'",
          "- '扫描附近的 WiFi 网络'",
          "- '查看当前连接的客户端'",
          "- '配置 WireGuard VPN'",
          "- '运行网络速度测试'",
          "- '添加内网穿透服务'",
        ]
          .filter(Boolean)
          .join("\n");
        return buildToolResult(text, {});
      },
    },
    {
      name: "clawwrt",
      label: "OpenClaw WRT Fallback",
      description:
        "Low-level fallback tool for openclaw-wrt. Prefer the more specific clawwrt_* tools when they match the user intent.",
      parameters: {
        type: "object" as const,
        properties: {
          action: {
            type: "string" as const,
            enum: ["list_devices", "get_device", "call"] as const,
            description: "Action to perform: list_devices, get_device, or call.",
          },
          deviceId: {
            type: "string" as const,
            minLength: 1,
            description: "Target openclaw-wrt device_id.",
          },
          op: {
            type: "string" as const,
            minLength: 1,
            description: "Exact openclaw-wrt operation name.",
          },
          payload: {
            type: "object" as const,
            description: "Additional JSON fields to include with the device request.",
          },
        },
        required: ["action" as const],
        additionalProperties: false,
      },
      execute: async (_toolCallId, rawParams) => {
        logToolInvocation(deps.logger, "clawwrt", rawParams);
        const args = rawParams as { action: string; deviceId?: string; op?: string; payload?: Record<string, unknown> };

        switch (args.action) {
          case "list_devices": {
            const devices = await getDevicesListViaChawrtd();
            return buildToolResult(`Found ${devices.length} connected device(s).`, { devices });
          }
          case "get_device": {
            if (!args.deviceId) throw new Error("deviceId is required for get_device");
            const device = await getDeviceViaChawrtd(args.deviceId);
            return buildToolResult(`Device ${args.deviceId} is ${device ? "connected" : "not connected"}.`, { device });
          }
          case "call": {
            if (!args.deviceId) throw new Error("deviceId is required for call");
            if (!args.op) throw new Error("op is required for call");
            const response = await callDeviceOp({
              bridge: deps.bridge,
              deviceId: args.deviceId,
              op: args.op,
              payload: args.payload,
            });
            return buildToolResult(`Device ${args.deviceId} responded to ${args.op}.`, { response });
          }
          default:
            throw new Error(`Unknown action: ${args.action}. Valid actions: list_devices, get_device, call`);
        }
      },
    },
  ];
}
