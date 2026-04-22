---
name: openclaw-wrt
description: Guide tool usage for managing OpenClaw WRT, ClawWRT, and 龙虾WiFi routers, gateways, and captive portal devices.
user-invocable: false
---

# OpenClaw WRT Tool Guidance

You have access to a suite of tools for managing and monitoring network routers, Wi-Fi access points, gateways, and captive portals.

Use this skill whenever the user is asking about OpenClaw WRT, ClawWRT, or 龙虾WiFi router/device operations, including process handling, client control, Wi-Fi configuration, captive portal auth, BPF monitoring, or WireGuard VPN management.

If the user mentions phrases like "龙虾WiFi", "路由器进程", "设备处理", "网关处理", or "OpenClaw 路由器", treat that as a request to use the `clawwrt_*` API tools in this skill. **Exception:** If the user is just saying hello (e.g., "Hello", "你好", "hello 龙虾wifi"), use the `claw-wifi-welcome-guide` skill and its `claw_wifi_hello` tool instead.

When a user asks to manage, list, configure, or query routers (路由器), devices (设备), gateways (网关), Wi-Fi (无线网络), network clients (终端/客户端), or captive portal pages, you must use the `clawwrt_*` tools.

Prefer the specific `clawwrt_*` tools over the low-level `clawwrt` tool for router management.

## Recommended tool choices

- Use `clawwrt_list_devices` to discover online routers.
- Use `clawwrt_get_status` for router health, runtime, and service status.
- Use `clawwrt_get_sys_info` for system resources, platform details, and runtime metrics.
- Use `clawwrt_get_device_info` for configured device metadata.
- Use `clawwrt_update_device_info` to update structured device metadata fields.
- Use `clawwrt_get_clients` to inspect authenticated clients.
- Use `clawwrt_get_client_info` for one client by MAC address.
- Use `clawwrt_kickoff_client` to disconnect a client by MAC address.
- Use `clawwrt_tmp_pass` to temporarily allow a client MAC.
- Use `clawwrt_get_wifi_info` for Wi-Fi configuration.
- Use `clawwrt_set_wifi_info` to update Wi-Fi settings including SSID (network name), password, encryption, or hidden status. Use this when the user asks to change or modify Wi-Fi or SSID settings.
- Use `clawwrt_scan_wifi` to scan nearby Wi-Fi networks.
- Use `clawwrt_set_wifi_relay` to configure upstream Wi-Fi relay or STA.
- Use `clawwrt_get_trusted_domains` and `clawwrt_sync_trusted_domains` for trusted domain allowlists.
- Use `clawwrt_get_trusted_wildcard_domains` and `clawwrt_sync_trusted_wildcard_domains` for wildcard domain allowlists.
- Use `clawwrt_get_trusted_mac` and `clawwrt_sync_trusted_mac` for trusted MAC allowlists.
- Use `clawwrt_get_auth_serv` and `clawwrt_set_auth_serv` for captive portal auth server settings.
- Use `clawwrt_publish_portal_page` when the user wants a custom post-connect captive portal HTML page generated from the prompt, written to the host nginx web root, and activated on a router.
- Use `clawwrt_get_mqtt_serv` and `clawwrt_set_mqtt_serv` for MQTT server connection settings.
- Use `clawwrt_get_websocket_serv` and `clawwrt_set_websocket_serv` for WebSocket server connection settings.
- Use `clawwrt_generate_wireguard_keys` to generate a WireGuard key pair on the router (private key stays on device, only public key returned). **Always call this before `set_wireguard_vpn`** to avoid sending private keys over the network.
- Use `clawwrt_get_wireguard_vpn`, `clawwrt_set_wireguard_vpn`, and `clawwrt_get_wireguard_vpn_status` for WireGuard VPN configuration and runtime status.
- Use `clawwrt_get_vpn_routes` to view current VPN routing rules (which traffic goes through the WireGuard tunnel).
- Use `clawwrt_set_vpn_domain_routes` to resolve domain names to IPv4 addresses and add each resolved IP as an `ip/32` static route through `wg0`.
- Use `clawwrt_set_vpn_routes` to steer traffic through the VPN tunnel: `selective` mode for specific CIDRs, `full_tunnel` mode for all traffic with `excludeIps` to prevent routing loop.
- Use `clawwrt_delete_vpn_routes` to remove VPN routing rules: `flushAll` to clear everything, or `routes` array for individual CIDRs.
- Use `clawwrt_firmware_upgrade` (or OTA) to trigger a remote firmware update via URL.
- Use `clawwrt_get_firmware_info` for firmware and build details.
- Use `clawwrt_get_network_interfaces` for interface inventory and IP details.
- Use `clawwrt_bpf_add` to add an IPv4, IPv6, or MAC target to BPF traffic monitoring.
- Use `clawwrt_bpf_json` to query BPF traffic monitoring statistics for `ipv4`, `ipv6`, `mac`, `sid`, or `l7` tables.
- Use `clawwrt_get_l7_active_stats` to query active L7 protocol traffic speed and volume statistics (SID view).
- Use `clawwrt_get_l7_protocol_catalog` to list the L7 protocol library currently supported by the device (including domain signatures when available).
- Use `clawwrt_bpf_del` to remove an IPv4, IPv6, or MAC target from BPF traffic monitoring.
- Use `clawwrt_bpf_flush` to clear all monitored entries in one BPF table.
- Use `clawwrt_bpf_update` to update per-target downrate/uprate limits.
- Use `clawwrt_bpf_update_all` to update downrate/uprate limits for all monitored entries in one BPF table.
- Use `clawwrt_get_speedtest_servers` to list available nearby speedtest.net servers.
- Use `clawwrt_speedtest` to run an internet speed test (ping, download, upload) on the best nearby server or a specific one.
- Use `clawwrt_get_xfrpc_config` to read current 内网穿透 settings.
- Use `clawwrt_set_xfrpc_common` to configure the 内网穿透客户端 connection to a remote 内网穿透服务端.
- Use `clawwrt_add_xfrpc_tcp_service` to create a new TCP port forwarding service via 内网穿透.
- Use `clawwrt_reboot_device` only when the user explicitly requests a reboot.

## Captive Portal Page Workflow

For portal page generation and template selection, use the dedicated portal skill in `skills/portal-pages/SKILL.md`.

These portal pages are typically shown after a client has already connected to Wi-Fi, so the copy should read as a welcome, notice, or confirmation page rather than a network-setup gate.

`clawwrt_publish_portal_page` still owns the router-side publishing step. It writes the generated HTML into the host nginx web directory as a device-specific file, then calls the router-side `set_local_portal` flow so ApFree WiFiDog serves that page to Wi-Fi clients.

## Speedtest quick reference

- `clawwrt_get_speedtest_servers`
  - Required: `deviceId`
  - Returns: list of server objects `{id, name, country, sponsor, host}`.
- `clawwrt_speedtest`
  - Required: `deviceId`
  - Optional: `server_id` (string, target a specific server from the server list).
  - Returns: results object `{server_id, server_name, sponsor, latency, download, upload, unit, download_bytes, upload_bytes}`. Velocities are in Mbps.
  Only use the low-level `clawwrt` tool when you need an openclaw-wrt operation that is not covered by a specific tool above.

## BPF quick reference

Use `table` as one of: `mac`, `ipv4`, `ipv6`, `sid`, `l7`.

- `clawwrt_bpf_add`
  - Required: `deviceId`, `address`
  - Optional: `table` (default `mac`)
  - Example: add one MAC to monitoring.
- `clawwrt_bpf_del`
  - Required: `deviceId`, `address`
  - Optional: `table` (default `mac`)
  - Example: remove one IPv4 from monitoring.
- `clawwrt_bpf_json`
  - Required: `deviceId`
  - Optional: `table` (default `mac`)
  - Example: read current stats for `ipv4` table, `sid` active L7 traffic stats, or `l7` protocol library.
- `clawwrt_get_l7_active_stats`
  - Required: `deviceId`
  - Query target: `bpf_json` with `table=sid`.
- `clawwrt_get_l7_protocol_catalog`
  - Required: `deviceId`
  - Query target: `bpf_json` with `table=l7`.
- `clawwrt_bpf_flush`
  - Required: `deviceId`
  - Optional: `table` (default `mac`)
  - Example: clear all monitored entries in `mac` table.
- `clawwrt_bpf_update`
  - Required: `deviceId`, `target`, `downrate`, `uprate`
  - Optional: `table` (default `mac`)
  - Rate units: bps, valid range `1..10000000000`.
- `clawwrt_bpf_update_all`
  - Required: `deviceId`, `downrate`, `uprate`
  - Optional: `table` (default `mac`)
  - Rate units: bps, valid range `1..10000000000`.

## Additional operations via low-level `clawwrt`

When a user explicitly asks for any of the following operations, call the low-level tool with `action=call` and `op` set to the exact operation name:

- `get_ipsec_vpn`, `set_ipsec_vpn`, `get_ipsec_vpn_status`.

## VPN route quick reference

- `clawwrt_get_vpn_routes`
  - Required: `deviceId`
  - Returns: list of `proto static` routes on wg0, tunnel_up status.
- `clawwrt_set_vpn_domain_routes`
  - Required: `deviceId`, `domains`
  - Optional: `interface` (defaults to `wg0`)
  - Resolves each domain to IPv4 addresses and installs each result as an `ip/32` static route on the WireGuard interface.
- `clawwrt_set_vpn_routes`
  - Required: `deviceId`, `mode` (`selective` or `full_tunnel`)
  - Selective mode: provide `routes` array of CIDRs (e.g. `["1.2.3.0/24", "4.5.6.0/24"]`).
  - Full tunnel mode: provide `excludeIps` array with VPS public IP to prevent routing loop. Routes `0.0.0.0/1` + `128.0.0.0/1` are added automatically.
  - Note: existing routes are flushed before new ones are applied.
