# VPN Deployment - Routing Engine

This module manages traffic steering after the WireGuard tunnel is established. All CIDR-based routing operations use `apfree_wifidog_*` API tools — **no shell commands needed**.

## Routing Modes

| Mode | Use Case | Risk |
|------|----------|------|
| `selective` | Route specific IPs/CIDRs through VPN | ✅ Safe — only listed destinations use VPN |
| `full_tunnel` | Route all traffic through VPN | ⚠️ Dangerous — requires `excludeIps` to prevent lockout |

> **⚠️ ALWAYS START WITH `selective` MODE.** Only switch to `full_tunnel` after validating the tunnel with selective routes and confirming `excludeIps` are correct.

---

## Selective Routing (Recommended Default)

Route only specific destination IPs/CIDRs through the VPN tunnel. All other traffic uses the normal default gateway.

```text
Tool: apfree_wifidog_set_vpn_routes
Parameters:
  deviceId: "<router_device_id>"
  data:
    mode: "selective"
    routes: ["1.2.3.4/32", "5.6.7.0/24", "8.8.8.8/32"]
```

### Real-World Example

Route traffic to three specific servers through VPN:

```text
apfree_wifidog_set_vpn_routes
  mode: "selective"
  routes:
    - "203.0.113.10/32"    # Application server A
    - "198.51.100.0/24"    # Partner network
    - "8.8.8.8/32"         # Google DNS (for DNS-over-VPN)
```

**What happens internally** (see `handleSetVpnRoutes` in wifi_vpn.go):

1. Flushes all existing proto-static routes on `wg0`.
2. For each CIDR in `routes`, runs: `ip route add <CIDR> dev wg0 proto static`.
3. Returns count of added/failed routes.

---

## Full Tunnel Mode

> **⚠️ CRITICAL: Read this entire section before using `full_tunnel` mode.**

Route ALL traffic through VPN, except for explicitly excluded IPs.

```text
Tool: apfree_wifidog_set_vpn_routes
Parameters:
  deviceId: "<router_device_id>"
  data:
    mode: "full_tunnel"
    exclude_ips: ["<vps_public_ip>"]
```

### Mandatory `exclude_ips`

You **MUST** include at minimum:

| IP to Exclude | Reason |
|----------------|--------|
| VPS public IP | Prevents routing loop (WG endpoint traffic must NOT go through VPN) |

### What Happens Internally

1. Detects the current default gateway via `ip route show default`.
2. For each `exclude_ips` entry, adds a host route via the **original gateway** (not through wg0): `ip route add <IP>/32 via <original_gw> proto static`.
3. Adds split-default routes: `0.0.0.0/1` and `128.0.0.0/1` through `wg0`.

The split-default trick (`0.0.0.0/1` + `128.0.0.0/1`) overrides the default route without replacing it, allowing recovery if the VPN goes down.

### Anti-Lockout Checklist

Before enabling `full_tunnel`:

- [ ] WireGuard tunnel is UP and handshake confirmed
- [ ] `exclude_ips` contains the VPS public IP
- [ ] Selective routing has been tested first
- [ ] You have a recovery plan (console/IPMI access or scheduled revert)

---

## Verify Routes

```text
Tool: apfree_wifidog_get_vpn_routes
Parameters:
  deviceId: "<router_device_id>"
```

Returns all `proto static` routes on `wg0`, showing exactly which CIDRs are being steered through the VPN.

## Clear All Routes

```text
Tool: apfree_wifidog_delete_vpn_routes
Parameters:
  deviceId: "<router_device_id>"
  data:
    flush_all: true
```

This removes all VPN routes and restores normal routing. Use this as an **emergency recovery** if full-tunnel mode causes issues.

## Remove Specific Routes

```text
Tool: apfree_wifidog_delete_vpn_routes
Parameters:
  deviceId: "<router_device_id>"
  data:
    routes: ["1.2.3.4/32"]
```

---

## Domain-Based Routing (Advanced)

For domain-based steering (e.g., "route youtube.com through VPN"), the resolution must happen **on the router**, not on the VPS. This workflow currently requires router-side UCI/shell configuration via `apfree_wifidog_execute_shell` because there is no dedicated high-level API tool for domain routing yet.

### Why Router-Side Resolution

- The router sees the actual DNS answers used by LAN clients.
- CDN IPs change frequently; router-local DNS keeps the destination set fresh.
- No need to push stale `/32` routes from the VPS.

### Implementation Pattern (OpenWrt)

**For fw4 / nftset** (newer OpenWrt):

```bash
# Add domain to dnsmasq nftset
uci add_list dhcp.@dnsmasq[0].nftset='/youtube.com/4#inet#fw4#vpn_domains'
uci add_list dhcp.@dnsmasq[0].nftset='/netflix.com/4#inet#fw4#vpn_domains'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

**For fw3 / ipset** (older OpenWrt):

```bash
# Use ipset-based equivalent
uci add_list dhcp.@dnsmasq[0].ipset='/youtube.com/vpn_domains'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

Then configure firewall marking and policy routing so matched traffic exits via `wg0`. This requires:

1. Firewall rule to mark packets matching the `vpn_domains` set.
2. `ip rule` to route marked packets via a custom routing table.
3. Custom routing table with default route through `wg0`.

### Recommended Agent Workflow for Domain Routing

1. Verify tunnel is up via `apfree_wifidog_get_wireguard_vpn_status`.
2. Configure `dnsmasq` domain mapping on the router via `apfree_wifidog_execute_shell`.
3. Configure firewall marking and policy routing via `apfree_wifidog_execute_shell`.
4. Use `apfree_wifidog_get_vpn_routes` to verify base tunnel routes.

> **Note**: Domain-based routing is the only VPN workflow that requires shell access. All CIDR-based routing is fully covered by the `apfree_wifidog_*` API.

### Verification

```bash
# dnsmasq config contains domain set rules
uci show dhcp | grep -E 'nftset|ipset'

# policy routing rules exist
ip rule show

# route table for marked traffic
ip route show table all | grep wg0
```

### Caveats

- DNS-over-HTTPS or DNS-over-TLS on clients can bypass router-local DNS.
- Browser apps may use multiple domains and CDNs.
- `dnsmasq` only manages destination IP membership; actual steering requires firewall marking.
