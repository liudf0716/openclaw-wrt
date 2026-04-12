---
name: vpn-deployment
description: Modular WireGuard VPN deployment guide for OpenWrt routers (client) and OpenClaw VPS (server). Covers tunnel setup, selective/full-tunnel routing, anti-lockout safety, and observability.
user-invocable: true
---

# WireGuard VPN Deployment Guide (Modular)

Build a WireGuard VPN tunnel between an **OpenWrt router** (client) and the **OpenClaw VPS host** (server), then steer selected traffic through the tunnel without breaking connectivity.

## Architecture

```text
┌──────────────────┐        WireGuard Tunnel        ┌──────────────────┐
│  OpenWrt Router   │◄══════════════════════════════►│  OpenClaw VPS    │
│  (Client)         │   10.0.0.2 ◄───► 10.0.0.1     │  (Server)        │
│                   │                                │                  │
│  clawwrt agent    │◄──── WebSocket (control) ─────►│  OpenClaw runtime│
│  UCI config       │                                │  wg-quick config │
└──────────────────┘                                └──────────────────┘
```

## Module Structure

```text
vpn-deployment/
├── server/          # VPS-side WireGuard installation and peer management
├── client/          # Router-side WireGuard setup via apfree_wifidog_* API
├── routing-engine/  # Selective / full-tunnel / domain-based routing
├── policy/          # Security, anti-lockout, and operational rules
└── observability/   # Verification checklist and troubleshooting
```

## Read Order

1. `server/README.md` — Install WireGuard on VPS, generate server keys, prepare `wg0.conf`
2. `client/README.md` — Generate router keys and configure tunnel via `apfree_wifidog_*` API
3. `routing-engine/README.md` — Apply selective or full-tunnel routing
4. `policy/README.md` — Security and anti-lockout rules
5. `observability/README.md` — Verify connectivity and troubleshoot

## Quick Start (End-to-End)

### Phase 1: Server Setup (on VPS)

1. Install WireGuard and generate server keys (see `server/README.md`).
2. Note the **server public key** and the **VPS public IP**.

### Phase 2: Client Setup (on Router via API)

3. Generate router keys:
   ```
   apfree_wifidog_generate_wireguard_keys
   ```
   Save the returned `data.public_key` for server peer config.

4. Add the router as a peer on the server's `wg0.conf`, then reload.

5. Configure the router tunnel:
   ```
   apfree_wifidog_set_wireguard_vpn
     interface.addresses: ["10.0.0.2/24"]
     peers[0].publicKey: "<server_public_key>"
     peers[0].endpointHost: "<vps_public_ip>"
     peers[0].endpointPort: 51820
     peers[0].allowedIps: ["10.0.0.0/24"]
     peers[0].persistentKeepalive: 25
     peers[0].routeAllowedIps: false
   ```

### Phase 3: Route Traffic (Selective Mode — SAFE DEFAULT)

6. Steer specific IPs through VPN:
   ```
   apfree_wifidog_set_vpn_routes
     mode: "selective"
     routes: ["1.2.3.4/32", "5.6.7.0/24"]
   ```

7. Verify with `apfree_wifidog_get_wireguard_vpn_status` and `apfree_wifidog_get_vpn_routes`.

> **⚠️ CRITICAL SAFETY RULE**: Always start with `selective` mode. Never use `full_tunnel` mode without first adding the VPS public IP and the OpenClaw WebSocket endpoint to `excludeIps`. Failing to do so will route the VPN's own control traffic through the tunnel, causing immediate loss of connectivity and agent disconnection.

## API Tools Reference

All router-side operations use `apfree_wifidog_*` tools (no shell required for core VPN workflow):

| Tool | Purpose |
|------|---------|
| `apfree_wifidog_generate_wireguard_keys` | Generate keypair on router, private key stays on device |
| `apfree_wifidog_get_wireguard_vpn` | Read current WireGuard configuration |
| `apfree_wifidog_set_wireguard_vpn` | Write WireGuard config and bring up tunnel |
| `apfree_wifidog_get_wireguard_vpn_status` | Runtime status (`wg show` output) |
| `apfree_wifidog_get_vpn_routes` | List active VPN routes |
| `apfree_wifidog_set_vpn_routes` | Add selective or full-tunnel routes |
| `apfree_wifidog_delete_vpn_routes` | Remove VPN routes |
