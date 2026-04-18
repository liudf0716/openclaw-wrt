# VPN Deployment - Routing Engine

This module manages traffic steering on the WireGuard server after the tunnel is established. All CIDR-based routing operations use `clawwrt_*` API tools — **no shell commands needed**.

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
Tool: clawwrt_set_vpn_routes
Parameters:
  deviceId: "<server_device_id>"
  data:
    mode: "selective"
    routes: ["1.2.3.4/32", "5.6.7.0/24", "8.8.8.8/32"]
```

### Real-World Example

Route traffic to three specific servers through VPN:

```text
clawwrt_set_vpn_routes
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
Tool: clawwrt_set_vpn_routes
Parameters:
  deviceId: "<server_device_id>"
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
Tool: clawwrt_get_vpn_routes
Parameters:
  deviceId: "<server_device_id>"
```

Returns all `proto static` routes on `wg0`, showing exactly which CIDRs are being steered through the VPN.

## Clear All Routes

```text
Tool: clawwrt_delete_vpn_routes
Parameters:
  deviceId: "<server_device_id>"
  data:
    flush_all: true
```

This removes all VPN routes and restores normal routing. Use this as an **emergency recovery** if full-tunnel mode causes issues.

## Remove Specific Routes

```text
Tool: clawwrt_delete_vpn_routes
Parameters:
  deviceId: "<server_device_id>"
  data:
    routes: ["1.2.3.4/32"]
```

---

## Domain-Based Routing (Advanced)

For domain-based steering (e.g., "route youtube.com through VPN"), use the dedicated API tool on the server host instead of shell-based dnsmasq/ipset wiring.

```text
Tool: clawwrt_set_vpn_domain_routes
Parameters:
  deviceId: "<server_device_id>"
  data:
    domains: ["youtube.com", "netflix.com"]
    interface: "wg0"
```

### What the API Does

1. Resolves each domain to IPv4 addresses on the server side.
2. Deduplicates the resolved IPv4 values across the input domain list.
3. Installs each IPv4 as an `ip/32` static route on `wg0`.
4. Returns the resolved routes and any domains that could not be resolved.

### Recommended Agent Workflow for Domain Routing

1. Verify the tunnel is up via `clawwrt_get_wireguard_vpn_status`.
2. Call `clawwrt_set_vpn_domain_routes` with the domains you want to steer.
3. Use `clawwrt_get_vpn_routes` to verify the resulting `wg0` routes.

### Caveats

- The current API resolves IPv4 addresses only and writes `ip/32` routes.
- DNS-over-HTTPS or DNS-over-TLS on downstream clients can still bypass the intended steering if the resolver path is outside the server control plane.
- If a domain returns multiple A records, each distinct IPv4 is added as a separate route.
