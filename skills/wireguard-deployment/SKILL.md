---
name: wireguard-deployment
description: 龙虾WiFi WireGuard VPN 组网部署指南。涵盖 VPS 服务端部署、路由器客户端配置、peer 管理、NAT/转发、路由策略及状态验证。路由器侧操作由 clawwrt 工具集完成。
user-invocable: true
---

# WireGuard VPN 组网部署指南

在 **OpenClaw VPS / 云主机**上部署 WireGuard 服务端，龙虾WiFi路由器作为客户端接入，客户端之间的流量通过 VPS 中转。路由器侧配置由 `clawwrt` 工具集完成。

## 网络拓扑

```text
┌─────────────────────────────────────────────────────┐
│  OpenClaw VPS / 云主机                              │
│                                                     │
│  WireGuard 服务端 (wg0)                             │
│  - 接受路由器 peer 连接                             │
│  - NAT / IP 转发                                    │
│  - 支持分流 / 全隧道 / 域名路由策略                 │
└─────────────────────────────────────────────────────┘
              ↑ WireGuard 隧道
┌─────────────────────────────────────────────────────┐
│  龙虾WiFi 路由器（clawwrt 客户端）                  │
│  - 生成密钥对，作为 peer 注册到服务端               │
│  - 配置隧道 IP 及路由策略                           │
└─────────────────────────────────────────────────────┘
```

---

## 🚫 路由器 Shell 接口使用限制（全局规则，优先级最高）

> **此规则适用于整个部署流程的任何阶段，不得绕过。**

路由器运行在生产网络环境，**任意 shell 命令均可能直接修改内核路由表、网络接口或防火墙规则，一旦操作失误将立即造成网络中断，且无法远程恢复**。

### ❌ 严禁行为

- 未经用户同意，自行调用任何路由器 shell 接口（如 `clawwrt_run_shell`、`clawwrt_exec`、`clawwrt_ssh_exec` 或同类工具）。
- 使用 shell 命令替代已有专用工具（如用 `ip route add` 代替 `clawwrt_set_vpn_routes`）。
- 在未说明副作用的情况下向路由器推送 shell 脚本或一次性命令。

### ✅ 必须遵守的流程

每次需要使用路由器 shell 接口时，**必须按以下顺序执行，缺一不可**：

1. **向用户展示将要执行的完整命令**，说明其作用及可能的网络影响。
2. **发出断网风险警告**（使用下方标准警告语），等待用户明确确认后方可继续。
3. **仅执行已获批准的命令**，不得附加任何未告知的额外命令。
4. **执行后立即汇报结果**，若输出异常须立即停止并告知用户。

### 优先使用专用工具

下表列出了 shell 命令的推荐替代工具，**只要专用工具能满足需求，严禁改用 shell 命令**：

| 操作目标 | ❌ 禁止（Shell 命令） | ✅ 推荐（专用工具） |
|----------|----------------------|---------------------|
| 添加/删除路由 | `ip route add/del` | `clawwrt_set_vpn_routes` / `clawwrt_delete_vpn_routes` |
| WireGuard 接口配置 | `wg set` / `wg-quick` | `clawwrt_set_wireguard_vpn` |
| 生成密钥对 | `wg genkey` | `clawwrt_generate_wireguard_keys` |
| 查看隧道状态 | `wg show` | `clawwrt_get_wireguard_vpn_status` |
| 重置 WireGuard | `ip link del wg0` | `clawwrt_reset_wireguard_vpn` |
| 域名路由策略 | 手写 dnsmasq 规则 | `clawwrt_set_vpn_domain_routes` |

> 如果上述专用工具均无法满足需求，在申请用户授权使用 shell 接口之前，**必须先在对话中说明为何专用工具不够用**。

---

## ⚡ 工作流入口（收到任何 WireGuard VPN 请求后的第一步）

❌ **严禁**：收到请求后先向用户询问 VPS IP、密钥或设备信息等参数。

✅ **必须**：同时并行执行以下两步：
1. **调用 `openclaw_get_wg_status`** 检查 VPS 服务端当前状态。
2. **调用 `clawwrt_list_devices`** 获取当前在线的龙虾WiFi设备列表。

根据两步结果综合决策后续路径：

| 服务端状态 | 在线设备数 | 下一步 |
|------------|------------|--------|
| 未安装 / 未运行 | 任意 | → 展示在线设备列表 → 进入**第一阶段**部署服务端 |
| 已运行，peers 正常 | ≥ 1 | → 展示在线设备列表，告知当前 VPN 运行状态，询问是否为新设备添加 peer → 进入**第二阶段** |
| 已运行，但无 peer | ≥ 1 | → 展示在线设备列表，引导用户选择哪台设备作为 VPN 客户端 → 进入**第二阶段** |
| 任意 | 0 | → 告知用户：当前无龙虾WiFi设备在线，无法执行客户端配置。请先确保路由器已上电并连接到 OpenClaw |

### 在线设备展示

调用 `clawwrt_list_devices` 后，以表格形式展示设备ID、最近在线时间和网关IP，询问用户选择目标设备（支持多选；用户无法识别设备ID时可通过网关IP辨认）。

---

## 部署流程

### 第零阶段：重置（可选）

> 适用场景：用户要求清除现有 WireGuard 配置、重新部署，或排查隧道故障。

⚠️ **重置为不可逆操作，执行前必须向用户展示目标设备并获得明确确认。**

1. **确认重置范围**：调用 `clawwrt_list_devices` 展示在线设备，询问用户需要重置哪台或哪几台路由器的客户端配置。
   > 引导语示例：「当前在线设备如下，请确认需要重置 WireGuard 配置的路由器（可多选）：」
2. **重置服务端**：调用 `openclaw_reset_wg_server`，清除 VPS 侧 `wg0` 接口、服务端密钥及 IP 转发配置。
3. **重置客户端**：对用户确认的每台设备调用 `clawwrt_reset_wireguard_vpn`，清除该路由器的 WireGuard 配置及隧道路由。

---

### 第一阶段：部署服务端（VPS）

❌ **严禁**：调用 `openclaw_deploy_wg_server` 前向用户询问任何参数，直接使用工具默认值自动部署。

> ☁️ **云平台安全组提醒**
>
> 若 VPS 托管在阿里云、腾讯云、AWS、Azure 等云平台，**必须在云控制台的安全组/防火墙规则中手动放行 UDP 51820 端口**（入站方向，来源 `0.0.0.0/0`），否则路由器将无法穿透云平台网络层与服务端建立隧道。VPS 系统内的防火墙规则由工具自动处理，无需手动操作。
>
> 请向用户确认：**是否已在云平台控制台放行 UDP 51820？** 确认后再继续。

1. **自动部署**：调用 `openclaw_deploy_wg_server`，自动完成 WireGuard 安装、IP 转发开启及 `wg0` 接口初始化。
2. **获取公钥**：工具返回**服务端公钥（Server PublicKey）**，后续路由器配置需要用到，请记录并告知用户。

---

### 第二阶段：注册 Peer（VPS 侧）

> **设备选择（必须先确认）**：若已在入口步骤获取在线设备列表，直接复用结果；否则先调用 `clawwrt_list_devices` 并引导用户指定目标设备。
>
> 多台设备时，逐台执行以下步骤，为每台分配**独立的隧道 IP**（如 `10.0.0.2/32`、`10.0.0.3/32`），避免 IP 冲突。

1. **生成路由器密钥**：在目标路由器（按用户确认的 deviceId）上调用 `clawwrt_generate_wireguard_keys`，获取该路由器的**客户端公钥**。
2. **向服务端注册 peer**：调用 `openclaw_add_wg_peer`，传入客户端公钥及 `allowedIps`，将路由器注册为服务端 peer。
   - **仅隧道互通**（默认）：`allowedIps = ["10.0.0.2/32"]`
   - **需要 LAN 子网互通**：`allowedIps = ["10.0.0.2/32", "192.168.1.0/24"]`，将该路由器的 LAN 段一并声明，VPS 才能将目标为该 LAN 的包转发给此 peer。

---

### 第三阶段：配置客户端（路由器侧）

> **设备确认**：基于第二阶段用户已确认的设备列表，依次对每台设备操作。每次操作前明确告知用户：「正在配置设备：<deviceId>（网关：<gateway>）」，避免混淆。

1. **推送隧道配置**：对目标设备调用 `clawwrt_set_wireguard_vpn`，传入服务端公钥、VPS 公网 IP 及该设备的隧道 IP。
   - ⚠️ **严禁**：同时设置 `route_allowed_ips: 1` 与 `allowed_ips: 0.0.0.0/0`，否则会导致路由环路断连。务必设置 `route_allowed_ips: 0`，通过 `clawwrt_set_vpn_routes` 手动管理路由。
2. **配置路由策略**：调用 `clawwrt_set_vpn_routes` 或 `clawwrt_set_vpn_domain_routes` 应用分流或域名路由策略。
   - **当 WireGuard 在线设备数 ≥ 2 时**：必须自动触发第五阶段的“LAN 子网自动互通流程”，为每台路由器下发指向其他路由器 LAN 段的隧道路由。
3. **批量进度报告**：若配置多台设备，每完成一台向用户报告进度，如「✅ device-abc123 配置完成（1/2）」，完成所有设备后汇总结果。

---

### 第四阶段：验证连通性

调用 **`clawwrt_verify_wireguard_connectivity`**，一次完成所有验证：
- 自动枚举在线设备（或通过 `deviceIds` 指定），批量检查每台路由器握手时间和流量统计。
- 检查 VPS 侧 IP 转发和 SNAT/MASQUERADE 规则状态。
- 通过 `pingTargets` 传入隧道 IP 列表，从 VPS 侧执行 ping 验证端到端可达性。

```json
{
  "pingTargets": ["10.0.0.2", "10.0.0.3"]
}
```

返回结果包含：服务端状态、每台设备握手状态、ping 测试结果及警告汇总。

---

### 第五阶段：LAN 子网自动互通（多设备强制）

> 触发条件：只要 WireGuard 在线龙虾WiFi设备数达到 2 台及以上，即必须自动执行此阶段。目标是让 `wifi1...wifin` 的 LAN 用户互通，流量统一经 VPS 中转。

#### 数据流示意

```
192.168.1.100
  → [路由器A wg0 隧道]
    → VPS (IP转发: peer A allowed_ips 含 192.168.1.0/24,  peer B allowed_ips 含 192.168.2.0/24)
      → [路由器B wg0 隧道]
        → 192.168.2.100
```

#### Step A：LAN 冲突检查 — 调用 `clawwrt_check_lan_conflict`

```json
{ "newDeviceId": "<new-device>", "existingDeviceIds": ["<device-a>", "<device-b>"] }
```

- `existingDeviceIds` 可省略，工具自动发现所有其他在线设备。
- 返回 `hasConflict: false` → 直接进入 Step B。
- 返回 `hasConflict: true` → 停止，向用户展示 `conflicts` 列表，引导修改新设备 LAN IP：
  1. ⚠️ **向用户展示以下警告并等待明确确认**：「⚠️ 修改 br-lan IP 将导致该路由器 LAN 侧所有客户端断线，DHCP 将重新分配 IP。请确认是否继续？」
  2. 用户确认后调用 `clawwrt_set_br_lan`（如改为 `192.168.10.1`）。
  3. 重新调用 `clawwrt_check_lan_conflict`，直至 `hasConflict: false`。

#### Step B：增量互通下发 — 调用 `clawwrt_join_wireguard_lan_mesh`

```json
{
  "newDeviceId": "<new-device>",
  "tunnelIp": "10.0.0.N/32",
  "peerPublicKey": "<new-device-pub-key>",
  "existingDeviceIds": ["<device-a>", "<device-b>"],
  "updateServerPeers": true
}
```

- `existingDeviceIds` 可省略，自动发现。
- `peerPublicKey` 省略时跳过 VPS peer AllowedIPs 更新（`serverPeerUpdate: skipped`）。
- 工具自动完成：
  1. 通过 `get_br_lan` 获取新设备及所有已有设备 LAN CIDR；
  2. 用 `openclaw_add_wg_peer` 更新 VPS peer AllowedIPs（新设备）；
  3. 用 `set_vpn_routes` 向新设备下发所有已有设备 LAN 路由；
  4. 对每台已有设备：读取现有路由 → 追加新设备 LAN CIDR → `set_vpn_routes` 全量写回。
- 返回 `results` 含各步骤状态；`existingDeviceRoutes` 中有任何 `error` 时，需人工排查对应设备。

> **全量重算降级**：如需修复路由不一致，改调 `clawwrt_reconcile_wireguard_lan_mesh`（`updateServerPeers: true`），该工具会重新采集所有设备 br-lan 并全量重下发，但不提供冲突修复引导。

**验证与结果汇报（Step B 完成后）**

- 逐台调用 `clawwrt_get_wireguard_vpn_status` 检查握手状态（预期握手时间 < 2 分钟）。
- 选择至少两组跨网段地址做互 ping 验证。
- 若 ping 不通，优先排查：VPS peer `allowed_ips` 是否包含对应 LAN 段；路由器侧路由是否生效（可用 `clawwrt_get_vpn_routes` 确认）。

---

## ⚠️ 防断连规则（必须遵守）

违反以下规则可能导致与路由器 WebSocket 连接断开，造成无法远程恢复：

1. **始终从分流模式（`selective`）开始**：仅路由特定 IP/CIDR，不要一开始就使用全隧道。
2. **全隧道模式前必须排除 VPS 公网 IP**：使用 `full_tunnel` 前，务必先将 VPS 公网 IP 加入 `excludeIps`，防止 WebSocket 连接路由到隧道内形成环路。
3. **严禁未经授权使用 shell 接口**：路由器 shell 命令可直接修改内核路由，一旦出错即断网且无法远程恢复。每次使用前必须展示完整命令、发出标准警告并获得用户明确同意（详见「路由器 Shell 接口使用限制」章节）。
4. **紧急恢复**：若因全隧道或误操作导致断连，可重启路由器（内核路由不持久化，重启后自动清除），或重连后执行 `clawwrt_delete_vpn_routes`（参数 `flush_all: true`）清除所有隧道路由。

