# VPN Deployment - Policy

This module defines deployment, security, and anti-lockout policy for WireGuard VPN usage between OpenWrt routers and the OpenClaw VPS.

## Anti-Lockout Rules (MANDATORY)

These rules **must** be followed in every VPN deployment to prevent loss of connectivity:

1. **Always start with `selective` mode.** Never deploy `full_tunnel` as the first routing mode.
2. **Never set `route_allowed_ips: 1` with `allowed_ips: 0.0.0.0/0`** in `apfree_wifidog_set_wireguard_vpn`. This will redirect all traffic including the VPN tunnel itself.
3. **Always include VPS public IP in `exclude_ips`** when using `full_tunnel` mode.
4. **Test tunnel connectivity** with `apfree_wifidog_get_wireguard_vpn_status` before applying any routes.
5. **Keep `apfree_wifidog_delete_vpn_routes` (flush_all: true) ready** as emergency recovery.

## Key Security Rules

- Generate client keys **on the router** via `apfree_wifidog_generate_wireguard_keys`. Never generate keys externally and transfer private keys.
- Never expose private keys in logs, chat, or tickets.
- Open only the required server UDP port (default `51820/udp`).
- Prefer the smallest CIDR set practical — selective routing minimizes attack surface.
- Rotate keys periodically and whenever compromise is suspected.

## Operational Policy

| Rule | Rationale |
|------|-----------|
| Use `selective` mode by default | Minimizes blast radius; only intended traffic traverses VPN |
| Switch to `full_tunnel` only after validation | Requires confirmed handshake + correct `excludeIps` |
| Re-apply routes after reboot/tunnel restart | VPN routes are kernel-only and do not persist across reboots |
| Track owner and intent for each route set | Change accountability — know why each CIDR is routed |
| Use API tools over shell commands | `apfree_wifidog_*` tools handle UCI and error recovery; shell is only needed for domain routing |

## API-First Principle

For all core VPN operations, use the dedicated API tools instead of shell:

| Operation | Use This API Tool | NOT This |
|-----------|-------------------|----------|
| Generate keys | `apfree_wifidog_generate_wireguard_keys` | `wg genkey` via shell |
| Configure tunnel | `apfree_wifidog_set_wireguard_vpn` | Manual UCI commands |
| Check status | `apfree_wifidog_get_wireguard_vpn_status` | `wg show` via shell |
| Add routes | `apfree_wifidog_set_vpn_routes` | `ip route add` via shell |
| Remove routes | `apfree_wifidog_delete_vpn_routes` | `ip route del` via shell |

**Exception**: Domain-based routing (`dnsmasq` + `nftset`/`ipset` + policy routing) currently requires `apfree_wifidog_execute_shell` as no dedicated API exists yet.

## Optional Hardening

- Add WireGuard `PresharedKey` for additional forward-secrecy protection.
- Restrict server firewall source IP ranges where feasible.
- Separate management traffic from user tunnel traffic when possible.
- Use `persistent_keepalive: 25` for routers behind NAT.
