# VPN Deployment - Observability

This module provides verification checks, troubleshooting procedures, and emergency recovery steps.

## Quick Verification Checklist

Run these checks in order after VPN setup. Use API tools first, shell only as fallback.

| Step | Tool / Command | Expected Result |
|------|---------------|-----------------|
| 1. Tunnel config exists | `apfree_wifidog_get_wireguard_vpn` | `interface.proto = wireguard`, peers listed |
| 2. Tunnel is up with handshake | `apfree_wifidog_get_wireguard_vpn_status` | `latest handshake` within last 2 minutes |
| 3. Routes are applied | `apfree_wifidog_get_vpn_routes` | Expected CIDRs listed as `proto static` on `wg0` |
| 4. Data plane works | `apfree_wifidog_get_wireguard_vpn_status` | RX/TX bytes increasing |
| 5. Server sees peer | `wg show wg0` (on VPS) | Peer listed with recent handshake |

## Common Symptoms and Fixes

| Symptom | Likely Cause | Diagnostic | Fix |
|---------|-------------|------------|-----|
| No handshake | Endpoint or firewall issue | `apfree_wifidog_get_wireguard_vpn_status` shows no handshake | Verify `endpoint_host`, `endpoint_port`, and server firewall (UDP 51820) |
| Handshake OK but no traffic | Routes missing | `apfree_wifidog_get_vpn_routes` returns empty | Re-apply routes via `apfree_wifidog_set_vpn_routes` |
| Full tunnel breaks connectivity | Missing `exclude_ips` | Agent loses connection after `set_vpn_routes` with `full_tunnel` | **See Emergency Recovery below** |
| Routes disappear after reboot | Routes are kernel-only | Routes gone after router reboot | Re-push routes via `apfree_wifidog_set_vpn_routes` after tunnel comes up |
| DNS not following tunnel | DNS server not in routes | DNS queries go via normal gateway | Add DNS server IP to selective routes (e.g., `8.8.8.8/32`) |
| WireGuard module missing | Missing kernel module | `wg show` fails | Install `kmod-wireguard` on OpenWrt |
| `ifup wg0` fails | Missing wireguard-tools | `ifup` returns error | Install `wireguard-tools` package |

## Emergency Recovery: Full-Tunnel Lockout

If `full_tunnel` mode was applied without proper `exclude_ips` and the agent is now unreachable:

### Option A: Physical/Serial Console Access

```bash
# On the router via serial console or local keyboard
ip route flush dev wg0 proto static
# This removes all VPN routes and restores normal routing
```

### Option B: Reboot the Router

VPN routes are kernel-only and do not persist across reboots. A simple reboot will restore normal routing. The WireGuard tunnel will come back up but without the problematic routes.

### Option C: Scheduled Auto-Recovery (Preventive)

Before applying `full_tunnel`, consider adding a cron job that auto-reverts routes if the agent becomes unreachable:

```bash
# Example: check every 2 minutes, flush VPN routes if no internet
echo '*/2 * * * * ping -c1 -W5 1.1.1.1 >/dev/null || ip route flush dev wg0 proto static' | crontab -
```

### Option D: Let clawwrt Agent Recover (if still running)

If the clawwrt agent is still running but the OpenClaw WebSocket is down, once the WebSocket reconnects, immediately run:

```text
apfree_wifidog_delete_vpn_routes
  data:
    flush_all: true
```

## Server-Side Debug Commands

```bash
# Check WireGuard interface and peers
wg show wg0

# Check recent logs
journalctl -u wg-quick@wg0 -n 100 --no-pager

# Verify forwarding is enabled
sysctl net.ipv4.ip_forward

# Check NAT rules
iptables -t nat -L POSTROUTING -v | grep wg0
```

## Router-Side Debug Commands (via API or shell)

Prefer API tools. Use shell (`apfree_wifidog_execute_shell`) only when API output is insufficient:

```bash
# Check WireGuard interface
ip link show wg0

# Check all routes through wg0
ip route show dev wg0

# Check default route (should still exist if selective mode)
ip route show default

# Test tunnel connectivity (ping VPN server)
ping -c 3 10.0.0.1
```

## Health Signals to Monitor

- **Last handshake age per peer**: should stay under 2 minutes with keepalive enabled
- **RX/TX bytes trend**: should increase over time when traffic is flowing
- **Route count**: number of `proto static` routes on `wg0`
- **Default route exists**: `ip route show default` should return a route (if it doesn't, full-tunnel may have broken things)
