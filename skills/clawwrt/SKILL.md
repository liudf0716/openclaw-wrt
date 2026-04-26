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

---

## 🔒 Shell 接口安全策略（最高优先级）

### 核心原则
**所有路由器功能操作必须通过 `clawwrt_*` API 接口完成，严禁绕过 API 直接调用 Shell。**

### `clawwrt_execute_shell` 使用条件（必须同时满足）

1. **用户显式请求**：用户输入中必须包含明确的 shell/命令执行意图，例如：
   - "执行命令 `xxx`"
   - "run shell command"
   - "帮我跑一下这个命令"
   - 用户直接提供了一条 shell 命令字符串并要求执行

2. **用户明确 Approve**：调用前必须向用户展示完整命令内容，并收到明确确认（"确认"/"yes"/"执行"等）后才能调用。

### ❌ 绝对禁止的行为

| 场景 | 错误做法 | 正确做法 |
|------|----------|----------|
| 踢下线客户端 | `clawwrt_execute_shell` 执行 `wdctlx reset <mac>` | `clawwrt_kickoff_client` |
| 查看 WiFi 客户端列表 | shell 执行 `wdctlx status` | `clawwrt_get_clients` |
| 配置 WiFi 参数 | shell 执行 `uci set wireless...` | `clawwrt_set_wifi_config` |
| 配置 xfrpc | shell 修改配置文件 | `clawwrt_set_xfrpc_common` / `clawwrt_add_xfrpc_tcp_service` |
| 任何 API 已覆盖的操作 | `clawwrt_execute_shell` | 对应的 `clawwrt_*` 工具 |

### 判断流程

```
用户请求路由器操作
      ↓
是否有对应的 clawwrt_* API 工具？
  ├─ 是 → 直接调用 API 工具，禁止用 shell
  └─ 否 → 用户是否显式要求执行 shell 命令？
            ├─ 否 → 告知用户该操作暂不支持，禁止用 shell
            └─ 是 → 展示命令 → 等待用户 Approve → 调用 clawwrt_execute_shell
```

