---
name: wireguard-deployment
description: VPS and cloud-host WireGuard server deployment guide for OpenClaw. Covers server setup, peer management, NAT/forwarding, route policy, and observability. Router/client setup is handled by clawwrt.
user-invocable: true
---

# WireGuard Server Deployment Guide

Build and operate the WireGuard server on an **OpenClaw VPS host** or other cloud Linux host so it can relay traffic for connected 龙虾WiFi routers. Router/client setup is handled separately by `clawwrt`.

This skill is server-side only. If you need a router/client WireGuard tunnel, use the `clawwrt` workflow. If you need a single host to act as both a WireGuard server and an upstream WireGuard client, treat that as two separate configurations and keep the server-side and client-side steps isolated.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  OpenClaw VPS / Cloud Host                                               │
│                                                                          │
│  WireGuard server (wg0)                                                  │
│  - peers from router/client side                                        │
│  - NAT / forwarding                                                       │
│  - selective / full-tunnel / domain route policy                         │
└──────────────────────────────────────────────────────────────────────────┘
```

## Module Structure

```text
wireguard-deployment/
├── server/          # VPS-side WireGuard installation, peers, NAT, and forwarding
├── routing-engine/  # Selective / full-tunnel / domain-based routing
├── policy/          # Security, anti-lockout, and operational rules
└── observability/   # Verification checklist and troubleshooting
```

## Quick Start (E2E Deployment)

### Phase 1: Server Setup (VPS)
1. **Automated Deployment**: Use `openclaw_deploy_wg_server` to install WireGuard, enable forwarding, and set up the `wg0` interface.
2. **Collect Public Key**: The tool will return the **Server PublicKey**. You will need this for the router configuration.

### Phase 2: Peer Registration (VPS)
1. **Generate Router Keys**: Use `clawwrt_generate_wireguard_keys` on the target router to get its **PublicKey**.
2. **Add Peer to Server**: Call `openclaw_add_wg_peer` on the VPS with the router's PublicKey and assigned tunnel IP (e.g., `10.0.0.2/32`).

### Phase 3: Client Configuration (Router)
1. **Push Config**: Use `clawwrt_set_wireguard_vpn` to configure the router. Use the Server PublicKey, VPS Public IP, and the assigned tunnel IP.
2. **Set Routes**: Apply routing policies via `clawwrt_set_vpn_routes` or `clawwrt_set_vpn_domain_routes`.

### Phase 4: Verification
1. **Check Status**: Use `clawwrt_get_wireguard_vpn_status` and `openclaw_get_wg_status` to confirm the tunnel is up.
2. **Ping Test**: Attempt bidirectional pings between the VPS tunnel IP and router tunnel IP.

> **⚠️ CRITICAL SAFETY RULE**: Never use `full_tunnel` mode without first adding the VPS public IP to `excludeIps`.

## API Tools Reference

| Tool | Purpose |
|------|---------|
| `openclaw_deploy_wg_server` | Install WG, enable forwarding, and setup wg0 on VPS |
| `openclaw_add_wg_peer` | Register a router peer on the VPS server |
| `openclaw_get_wg_status` | Check server-side tunnel and peer status |
| `clawwrt_generate_wireguard_keys` | Generate keypair on router (client side) |
| `clawwrt_set_wireguard_vpn` | Push client config to router |
| `clawwrt_get_wireguard_vpn_status` | Check router-side tunnel status |
| `clawwrt_set_vpn_domain_routes` | Add domain-based routes on router |
| `clawwrt_set_vpn_routes` | Add CIDR-based routes on router |


### 复杂方案提示词 (Complex Deployment Template)

如果您需要 Agent 处理完整的双向 VPN 方案，建议使用以下固定格式：

```text
请把这次 WG VPN 方案拆成两部分：
1. OpenClaw VPS/云主机侧的 WireGuard 服务器、中转、peer、防火墙（必须开启 UDP 端口）、NAT 和转发。
2. 龙虾WiFi 路由器侧的客户端配置、认证和路由设置，统一使用相关的 clawwrt_* 工具。

要求：
- 首先检查 VPS 侧是否安装服务端，未安装则先安装并开启对应的防火墙端口。
- 然后执行路由器侧的 key 生成和配置下发。
- 部署完成后，通过两端互 ping wg0 接口 IP 来验证隧道是否连通。
- 如果是多个龙虾WiFi 组网，请确保服务器端的 AllowedIPs 包含各子网，并提醒用户下发准确的静态路由以实现跨节点互通。
- 默认使用 selective 模式；full_tunnel 必须带 excludeIps。

请输出：
- VPS 侧和路由器侧的详细执行步骤
- 互 ping 验证结果预期
- 跨节点互通的路由规则说明
- 风险点和回滚方式
```
