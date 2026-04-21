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

## Read Order

1. `server/README.md` — Install WireGuard on VPS, generate server keys, prepare `wg0.conf`
2. `routing-engine/README.md` — Apply selective or full-tunnel routing
3. `policy/README.md` — Security and anti-lockout rules
4. `observability/README.md` — Verify connectivity and troubleshoot

## Quick Start (E2E Deployment)

Follow these steps for a complete WireGuard deployment between **OpenClaw VPS host** and **龙虾WiFi routers**.

### Phase 1: Server Readiness Check (VPS)
1. **Check Installation**: Verify if the WireGuard package is installed on the VPS host. If not, install it.
2. **Firewall (CRITICAL)**: **MUST** open the WireGuard UDP listen port (default `51820/udp`) on the VPS host firewall (iptables/ufw) **AND** the cloud provider's security group/firewall. **Failure to do this will cause immediate connection timeout.**

### Phase 2: Server Peer Configuration (VPS)
1. Generate server keys.
2. Use `clawwrt_generate_wireguard_keys` on the router to get its **PublicKey**.
3. Add the router as a peer in the server's `wg0.conf` with a unique tunnel IP.
4. If building a **VPN LAN (Site-to-Site)** between multiple routers, repeat this for each router, assigning unique tunnel IPs within the same subnet.

### Phase 3: Client Deployment (Router)
1. Use `clawwrt_set_wireguard_vpn` to push the client config (private key, server endpoint, tunnel IP) to the router.
2. Apply routing policies via `clawwrt_set_vpn_routes` or `clawwrt_set_vpn_domain_routes`.

### Phase 4: Verification & Ping Test
1. Use `clawwrt_get_wireguard_vpn_status` to confirm the tunnel is up and handshakes are happening.
2. **Ping Test**: Attempt to ping the VPS `wg0` IP from the router, and vice versa, to confirm bidirectional communication.

### Phase 5: Multi-Node LAN Routing
1. To enable users behind different 龙虾WiFi routers to communicate with each other, you **MUST** ensure:
   - **AllowedIPs** on the server include the LAN subnets of the routers.
   - **Static Routes** are injected on each router or the server to point to the respective remote LANs.
   - Remind the user to verify these routing rules for inter-node connectivity.

> **⚠️ CRITICAL SAFETY RULE**: Never use `full_tunnel` mode without first adding the VPS public IP and any control-plane endpoint that must stay reachable to `excludeIps`.

## API Tools Reference

| Tool | Purpose |
|------|---------|
| `clawwrt_generate_wireguard_keys` | Generate keypair on router, private key stays on device |
| `clawwrt_get_wireguard_vpn` | Read current WireGuard configuration |
| `clawwrt_set_wireguard_vpn` | Write WireGuard config and bring up tunnel |
| `clawwrt_get_wireguard_vpn_status` | Runtime status (router handshake + server NAT check) |
| `clawwrt_get_vpn_routes` | List active VPN routes |
| `clawwrt_set_vpn_domain_routes` | Resolve domains to IPv4 and add `ip/32` routes on `wg0` |
| `clawwrt_set_vpn_routes` | Add selective or full-tunnel routes |
| `clawwrt_delete_vpn_routes` | Remove VPN routes |

## Suggested Prompt

Use this when you want the model to handle both sides of the VPN plan correctly:

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
