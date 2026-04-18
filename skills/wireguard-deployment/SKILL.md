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

## Quick Start (Server Side)

### Phase 1: Gather Inputs From Router Side

1. Get the router public key from the `clawwrt` workflow.
2. Decide the tunnel IP plan and whether this server will run selective, full-tunnel, or domain-based routing.
3. Note the **VPS public IP** and the router tunnel subnet.

### Phase 2: Server Setup (on VPS)

3. Install WireGuard and generate server keys (see `server/README.md`).
4. Add the router as a peer on the server's `wg0.conf`, then reload.
5. Open the WireGuard UDP listen port on the VPS firewall, and if the host is in a cloud environment, also open the same UDP port in the cloud provider security group / network firewall.

### Phase 3: Apply Routing Policy

5. Steer specific IPs through VPN using selective routes, or use `clawwrt_set_vpn_domain_routes` for domain-to-IPv4 mapping when you need name-based steering.
6. Use `full_tunnel` only with `excludeIps` that keep the VPN control path reachable.

### Phase 4: Verify and Recover

7. Verify with `clawwrt_get_wireguard_vpn_status` and `clawwrt_get_vpn_routes`.
8. Keep `clawwrt_delete_vpn_routes` ready for rollback if a route change breaks connectivity.

> **⚠️ CRITICAL SAFETY RULE**: Never use `full_tunnel` mode without first adding the VPS public IP and any control-plane endpoint that must stay reachable to `excludeIps`. Failing to do so will route the VPN's own control traffic through the tunnel, causing immediate loss of connectivity.

> **⚠️ FIREWALL RULE**: The server's UDP listen port must be reachable from the Internet. For the default WireGuard port, open `51820/udp` on the VPS host firewall and on the cloud provider firewall or security group if one is in front of the host.

## API Tools Reference

Use the `clawwrt_*` tools on the router/client side and use this skill for the VPS/server side.

| Tool | Purpose |
|------|---------|
| `clawwrt_generate_wireguard_keys` | Generate keypair on router, private key stays on device |
| `clawwrt_get_wireguard_vpn` | Read current WireGuard configuration |
| `clawwrt_set_wireguard_vpn` | Write WireGuard config and bring up tunnel |
| `clawwrt_get_wireguard_vpn_status` | Runtime status (`wg show` output) |
| `clawwrt_get_vpn_routes` | List active VPN routes |
| `clawwrt_set_vpn_domain_routes` | Resolve domains to IPv4 and add `ip/32` routes on `wg0` |
| `clawwrt_set_vpn_routes` | Add selective or full-tunnel routes |
| `clawwrt_delete_vpn_routes` | Remove VPN routes |

## Suggested Prompt

Use this when you want the model to handle both sides of the VPN plan correctly:

```text
请把这次 WG VPN 方案拆成两部分：
1. 龙虾WiFi 路由器侧的客户端配置和认证/路由动作，统一走 clawwrt_*；
2. OpenClaw VPS/云主机侧的 WireGuard 服务器、中转、peer、NAT、转发和路由策略，统一走 wireguard-deployment。

要求：
- VPS 侧只负责 server/peer/NAT/forwarding/policy，不要把 router/client 步骤混进来。
- router/client 侧不要手写 shell，优先使用 clawwrt_generate_wireguard_keys、clawwrt_set_wireguard_vpn、clawwrt_set_vpn_routes、clawwrt_set_vpn_domain_routes。
- 默认使用 selective 模式；full_tunnel 必须带 excludeIps，避免把控制流量绕进隧道。
- 如果要做域名路由，把域名解析成 IPv4 /32 路由并下发到 wg0。

请输出：
- VPS 侧需要执行的步骤
- router/client 侧需要执行的步骤
- 需要的 peer、AllowedIPs、endpoint、routeAllowedIps、excludeIps
- 风险点和回滚方式
```
