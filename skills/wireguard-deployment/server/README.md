# VPN Deployment - Server

This module covers WireGuard server deployment on the **OpenClaw VPS host**. The VPS acts as the WireGuard server that routers connect to.

Router/client-side key generation and tunnel setup are handled separately by the `clawwrt` workflow.

## Scope

- Install WireGuard packages on the VPS
- Generate server keys
- Prepare `wg0.conf` with NAT and forwarding
- Register router peers
- Start and verify the tunnel

## Step 1: Install WireGuard

```bash
# Debian / Ubuntu
apt update && apt install -y wireguard

# CentOS 8+ / RHEL 8+ / Rocky / AlmaLinux
dnf install -y epel-release elrepo-release
dnf install -y kmod-wireguard wireguard-tools

# CentOS 7
yum install -y epel-release
yum install -y https://www.elrepo.org/elrepo-release-7.el7.elrepo.noarch.rpm
yum install -y kmod-wireguard wireguard-tools

# Fedora
dnf install -y wireguard-tools

# Arch Linux
pacman -S --noconfirm wireguard-tools

# Verify
which wg && which wg-quick
modprobe wireguard && echo "wireguard module loaded"
```

## Step 2: Generate Server Keys

```bash
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
chmod 600 /etc/wireguard/server_private.key
```

Save the **server public key** — it will be used in the router client config.

## Step 3: Detect VPS Network Info

Before writing `wg0.conf`, identify the egress interface and public IP:

```bash
# Detect egress interface (replace eth0 in wg0.conf with this)
EGRESS_IF=$(ip route get 1.1.1.1 | awk '{print $5; exit}')
echo "Egress interface: $EGRESS_IF"

# Detect VPS public IP (use as endpointHost on client side)
VPS_PUBLIC_IP=$(curl -s4 ifconfig.me || ip -4 addr show "$EGRESS_IF" | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
echo "VPS public IP: $VPS_PUBLIC_IP"
```

## Step 4: Receive Router Public Key

Obtain the router public key from the `clawwrt` workflow. The router-side private key stays on the device, and only the public key is provided to this server-side deployment flow.

## Step 5: Create `wg0.conf`

```bash
EGRESS_IF=$(ip route get 1.1.1.1 | awk '{print $5; exit}')
SERVER_PRIVKEY=$(cat /etc/wireguard/server_private.key)

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = $SERVER_PRIVKEY
PostUp = iptables -t nat -A POSTROUTING -o $EGRESS_IF -j MASQUERADE; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o $EGRESS_IF -j MASQUERADE; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT

[Peer]
# Router 1
PublicKey = <router1_public_key_from_generate_wireguard_keys>
AllowedIPs = 10.0.0.2/32
EOF
```

### About Server-Side `AllowedIPs`

The server peer's `AllowedIPs` defines **which source IPs the server will accept from this peer**:

- `10.0.0.2/32` — Only accept traffic from the router's tunnel IP. **This is the safe default.**
- `10.0.0.2/32, 192.168.1.0/24` — Also accept traffic from the router's LAN subnet (needed if you want LAN devices to be reachable from VPS).

> **Do NOT set `AllowedIPs = 0.0.0.0/0` on the server peer** unless you intend this peer to be a full gateway, which is not the typical use case.

## Step 6: Enable IP Forwarding

```bash
sysctl net.ipv4.ip_forward
sed -i '/^net.ipv4.ip_forward/d' /etc/sysctl.conf
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
sysctl -p
```

## Step 7: Open Firewall

```bash
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port=51820/udp
  firewall-cmd --permanent --add-masquerade
  firewall-cmd --reload
elif command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  ufw allow 51820/udp
else
  echo "No firewalld or ufw detected; relying on wg0.conf PostUp/PostDown iptables rules."
fi
```

## Step 8: Start Service

```bash
systemctl enable --now wg-quick@wg0
wg show wg0
```

Expected output should show:
- Interface `wg0` with `listening port: 51820`
- Peer section with the router's public key (no handshake yet until the router connects)

## Adding More Routers

For each new router:

1. Run `clawwrt_generate_wireguard_keys` on the router and collect `data.public_key`.
2. Assign a unique tunnel IP (e.g., `10.0.0.3/32`, `10.0.0.4/32`, ...).
3. Add a new `[Peer]` block in `/etc/wireguard/wg0.conf`.
4. Reload without disrupting existing peers:

```bash
wg syncconf wg0 <(wg-quick strip wg0)
```

## Alternative: Configure Server via clawwrt API

If the VPS also runs the `clawwrt` agent (which it does when running OpenClaw), the server WireGuard config can also be managed via API:

```text
clawwrt_generate_wireguard_keys   → generates server keypair, stores in /etc/wireguard/wg0.conf
clawwrt_set_wireguard_vpn         → writes full wg0.conf and runs wg-quick up
clawwrt_get_wireguard_vpn         → reads current wg0.conf
clawwrt_get_wireguard_vpn_status  → runs wg show
```

On generic Linux (non-OpenWrt), the clawwrt handler automatically uses the `wg-quick` config path (`/etc/wireguard/wg0.conf`) instead of UCI.
