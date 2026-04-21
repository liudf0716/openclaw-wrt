---
name: frps-deployment
description: VPS-side FRPS server deployment guide for OpenClaw. Covers server setup, port configuration, and deployment on the host.
user-invocable: true
---

# FRPS Server Deployment Guide

Deploy and operate the FRPS (frp server) on an **OpenClaw VPS host** or other cloud Linux host to enable intranet penetration for connected routers. Router/client setup is handled separately by `clawwrt` using its xfrpc tools.

This skill is server-side only. If you need a router/client xfrpc configuration, use the `clawwrt` workflow and `clawwrt_*_xfrpc_*` tools.

## Recommended Workflow (End-to-End)

Follow these steps to set up a complete intranet penetration solution:

1.  **Phase 1: Server Check (VPS side)**
    - Check if `frps` is already running on the host. You can attempt to read `frps.toml` or check if the port is in use.
    - If not running, use `openclaw_deploy_frps` to deploy and start the server.
    - Note the `port` and `token` used.

2.  **Phase 2: Client Connection (Router side)**
    - Call `clawwrt_get_xfrpc_config` to check existing settings on the target device.
    - Compare settings. If the `server_addr`, `server_port`, and `token` already match your server, skip to Phase 3.
    - If they differ, use `clawwrt_set_xfrpc_common` to configure the connection. Inform the user if you are overwriting an existing configuration.

3.  **Phase 3: Service Mapping (Router side)**
    - List existing services from `clawwrt_get_xfrpc_config`.
    - If a service with the same `remote_port` or `name` already exists, warn the user instead of creating a duplicate.
    - Use `clawwrt_add_xfrpc_tcp_service` to create the requested mapping (e.g., SSH on port 22 to remote port 6000).

4.  **Phase 4: Verification**
    - Confirm with the user that the service should now be reachable via `VPS_IP:REMOTE_PORT`.

## API Tools Reference

| Tool | Purpose |
|------|---------|
| `openclaw_deploy_frps` | Write `frps.toml` and start the server process on the VPS host. |
| `openclaw_get_frps_status` | Check if frps is running and return its configuration. |
| `clawwrt_get_xfrpc_config` | Read current xfrpc client and service settings from the router. |
| `clawwrt_set_xfrpc_common` | Configure xfrpc client connection on the router. |
| `clawwrt_add_xfrpc_tcp_service` | Add a port forwarding service on the router. |

## Quick reference for `openclaw_deploy_frps`

- Required: `port` (e.g., 7000)
- Optional: `token`, `dashboardPort`, `vhostHttpPort`.
- Returns: path to `frps.toml` and execution status.

> **⚠️ SECURITY**: Always use a strong `token` to prevent unauthorized clients from using your proxy.
