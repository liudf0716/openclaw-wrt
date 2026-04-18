# VPN Deployment - Client

This module covers router-side WireGuard client configuration through `clawwrt_*` API tools. All core VPN operations are handled via the clawwrt agent's API — **no shell commands are needed for tunnel setup and route management**.

## Scope

- Generate router keys securely on device (via API)
- Configure WireGuard interface and peer (via API)
- Verify handshake and tunnel health (via API)

## Available API Tools

| Tool | Purpose |
|------|---------|
| `clawwrt_generate_wireguard_keys` | Generate keypair, private key stored in UCI |
| `clawwrt_get_wireguard_vpn` | Read current WireGuard config from UCI |
| `clawwrt_set_wireguard_vpn` | Write WireGuard config to UCI and bring up tunnel |
| `clawwrt_get_wireguard_vpn_status` | Runtime status (`wg show` output) |

## Step 1: Pre-Check Existing Config

Before making changes, check if a WireGuard tunnel already exists:

```text
Tool: clawwrt_get_wireguard_vpn
Parameters:
  deviceId: "<router_device_id>"
```

If the response shows an existing `interface` with `proto: wireguard`, a tunnel is already configured. Proceed with caution — `set_wireguard_vpn` will **replace** the entire config.

## Step 2: Generate Keys on Router

```text
Tool: clawwrt_generate_wireguard_keys
Parameters:
  deviceId: "<router_device_id>"
```

**What happens internally** (see `handleGenerateWireguardKeysOpenWrt` in wifi_vpn.go):

1. Runs `wg genkey` on the router to generate a private key.
2. Derives the public key via `wg pubkey`.
3. Stores the private key in UCI: `network.wg0.private_key`.
4. Commits UCI config.
5. Returns **only** `data.public_key` — the private key **never leaves the router**.

**Action**: Copy `data.public_key` to the server's `[Peer]` config (see `server/README.md`).

## Step 3: Configure WireGuard Tunnel

```text
Tool: clawwrt_set_wireguard_vpn
Parameters:
  deviceId: "<router_device_id>"
  data:
    interface:
      addresses: "10.0.0.2/24"
    peers:
      - public_key: "<server_public_key>"
        endpoint_host: "<vps_public_ip>"
        endpoint_port: "51820"
        allowed_ips: "10.0.0.0/24"
        persistent_keepalive: "25"
        route_allowed_ips: "0"
```

### Parameter Notes

| Parameter | Value | Explanation |
|-----------|-------|-------------|
| `addresses` | `10.0.0.2/24` | Router's tunnel IP — must match the server's `[Peer] AllowedIPs` |
| `public_key` | Server's public key | From `server_public.key` on VPS |
| `endpoint_host` | VPS public IP | The WireGuard server address |
| `endpoint_port` | `51820` | Must match server's `ListenPort` |
| `allowed_ips` | `10.0.0.0/24` | **SAFE DEFAULT** — only tunnel subnet traffic goes through WG |
| `persistent_keepalive` | `25` | Keeps NAT mapping alive (essential for routers behind NAT) |
| `route_allowed_ips` | `0` (false) | **CRITICAL** — Do NOT let WireGuard auto-add routes; use routing-engine instead |

> **⚠️ DANGER: Never set `allowed_ips` to `0.0.0.0/0` combined with `route_allowed_ips: 1`**
> This will redirect ALL traffic (including the WireGuard tunnel itself and the WebSocket control channel) through VPN, causing immediate network breakage and loss of agent connectivity. Always use `route_allowed_ips: 0` and manage routes explicitly via `clawwrt_set_vpn_routes`.

### Private Key Preservation

The `set_wireguard_vpn` handler automatically preserves the existing private key from UCI if no `private_key` field is provided in the request. **Do NOT pass `private_key` in the API call** — the key generated in Step 2 is already stored in UCI and will be reused.

### What Happens Internally

1. Reads existing `private_key` from UCI `network.wg0.private_key`.
2. Deletes old `wg0` interface and all `wireguard_wg0` peer sections.
3. Creates new UCI sections with the provided config.
4. Restores the preserved `private_key`.
5. Commits UCI and runs `ifdown wg0; ifup wg0`.

## Step 4: Verify Tunnel Status

```text
Tool: clawwrt_get_wireguard_vpn_status
Parameters:
  deviceId: "<router_device_id>"
```

**Expected healthy output**:
- Interface `wg0` exists with the correct private key (shown as `(hidden)`)
- Peer section shows server's public key
- `latest handshake` is recent (within last 2 minutes)
- `transfer` shows non-zero RX/TX bytes

**If no handshake appears**:
1. Verify server endpoint and port are correct.
2. Verify server firewall allows UDP 51820.
3. Verify the router's public key is in server's `[Peer]` config.
4. Check NAT: `persistent_keepalive` should be set.

## Step 5: Apply Routing

After tunnel is up and handshake is confirmed, proceed to `routing-engine/README.md` to steer specific traffic through the tunnel using:

```text
clawwrt_set_vpn_routes   (selective mode — recommended)
clawwrt_get_vpn_routes   (verify)
```
