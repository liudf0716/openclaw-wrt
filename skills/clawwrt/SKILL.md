---
name: openclaw-wrt
description: Guide tool usage for managing OpenClaw WRT, ClawWRT, and 龙虾WiFi routers, gateways, and captive portal devices.
user-invocable: false
---

# OpenClaw WRT Tool Guidance

You have access to a suite of tools for managing and monitoring network routers, Wi-Fi access points, gateways, and captive portals.

Use this skill whenever the user is asking about OpenClaw WRT, ClawWRT, or 龙虾WiFi router/device operations, including process handling, client control, Wi-Fi configuration, captive portal auth, BPF monitoring, or WireGuard VPN management.

If the user mentions phrases like "龙虾WiFi", "路由器进程", "设备处理", "网关处理", or "OpenClaw 路由器", treat that as a request to use the `clawwrt_*` API tools in this skill. **Exception:** If the user is just saying hello (e.g., "Hello", "你好", "hello 龙虾wifi"), use the `claw-wifi-welcome-guide` skill and its `claw_wifi_hello` tool instead.

When a user asks to manage, list, configure, or query routers (路由器), devices (设备), gateways (网关), Wi-Fi (无线网络), network clients (终端/客户端), or captive portal pages, you must use the `clawwrt_*` tools.

Prefer the specific `clawwrt_*` tools over the low-level `clawwrt` tool for router management.

## ⚠️ 任务专属工作流委派（优先级高于本 Skill 的通用规则）

以下任务有独立的专属 Skill，**必须完全遵循该 Skill 的流程**，禁止回退到本 Skill 的通用路由器操作逻辑：

| 用户意图 | 专属 Skill | 第一步 |
|---------|-----------|--------|
| 内网穿透 / 穿透 / 映射端口 / 远程访问路由器 / xfrpc 配置 | `frps-deployment` | 立即调用 `openclaw_get_frps_status`，禁止先列设备 |
| WireGuard VPN 部署 / 组网 / VPN 隧道 | `wireguard-deployment` | 遵循该 Skill 的入口步骤 |

❌ **禁止**：收到上述任务请求时先调用 `clawwrt_list_devices` 或询问路由器信息。必须先执行专属 Skill 指定的服务端检查步骤。


## Captive Portal Page Workflow

For portal page generation and template selection, use the dedicated portal skill in `skills/portal-pages/SKILL.md`.

These portal pages are typically shown after a client has already connected to Wi-Fi, so the copy should read as a welcome, notice, or confirmation page rather than a network-setup gate.

`clawwrt_publish_portal_page` still owns the router-side publishing step. It writes the generated HTML into the host nginx web directory as a device-specific file, then calls the router-side `set_local_portal` flow so ApFree WiFiDog serves that page to Wi-Fi clients.


## Additional operations via low-level `clawwrt`

When a user explicitly asks for any of the following operations, call the low-level tool with `action=call` and `op` set to the exact operation name:

- `get_ipsec_vpn`, `set_ipsec_vpn`, `get_ipsec_vpn_status`.

