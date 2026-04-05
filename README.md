# OpenClaw WRT

OpenClaw bridge plugin for OpenWrt / APFree Wifidog router device WebSocket control.

**[中文文档](README_zh.md)**

## Features

- WebSocket bridge server accepting router device connections
- Request/response correlation via `req_id`
- Device session management (connect, auth, timeout, alias)
- AWAS authentication proxy (forwards cloud-mode device connect/heartbeat to AWAS server)
- 30+ fine-grained tools covering: WiFi config, client management, BPF traffic monitoring, WireGuard VPN, shell execution, domain trust list, etc.

## Installation

### Option 1: npm install (after published)

```bash
openclaw plugins install @openclaw/openclaw-wrt
```

### Option 2: Local directory install (recommended for development)

Install the source directory directly into OpenClaw without building:

```bash
openclaw plugins install /path/to/openclaw-wrt
```

Example:

```bash
openclaw plugins add /home/user/work/openclaw-wrt
```

> OpenClaw automatically links the plugin into `~/.openclaw/extensions/` and loads it via jiti TypeScript compilation.

### Option 3: Build then install locally

```bash
# Build first
pnpm build

# Install the built artifacts
openclaw plugins install /path/to/openclaw-wrt
```

### Verify installation

```bash
# List installed plugins
openclaw plugins list

# Inspect plugin details
openclaw plugins inspect openclaw-wrt
```

### Uninstall

```bash
openclaw plugins remove openclaw-wrt
```

## How it works

```
┌──────────────┐    WebSocket     ┌──────────────────┐    Tool calls    ┌──────────────────┐
│  OpenWrt /   │ ──────────────>  │  OpenClaw WRT    │ ──────────────>  │  OpenClaw Agent  │
│  APFree      │ <──────────────  │  Bridge Plugin   │ <──────────────  │  (LLM)           │
│  Wifidog     │    JSON-RPC      │                  │                  │                  │
│  Router      │                  │  · req_id correl. │                  │  Uses 30+ tools  │
└──────────────┘                  │  · device mgmt   │                  │  to manage router│
                                  │  · auth/token    │                  └──────────────────┘
                                  │  · AWAS proxy    │
                                  └──────────────────┘
```

1. **Router connects** — Each OpenWrt/APFree Wifidog router opens a WebSocket to the bridge (`ws://host:8866/ws`) and sends a connect message with its `device_id`.
2. **Bridge manages sessions** — The plugin maintains a device registry with connection state, aliases, and optional token-based authentication.
3. **Agent controls devices** — OpenClaw's LLM agent calls 30+ registered tools (e.g., `apfree_wifidog_get_clients`, `apfree_wifidog_set_wifi_info`, `apfree_wifidog_exec_shell`). Each tool call is correlated with the router's response via `req_id`.
4. **AWAS proxy (optional)** — For cloud-mode devices, the plugin can forward authentication traffic to an AWAS (Auth Server) backend.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `enabled` | Enable bridge | `true` |
| `bind` | Bind address | `0.0.0.0` |
| `port` | Bridge port | `8866` |
| `path` | WebSocket path | `/ws` |
| `allowDeviceIds` | Allowed device IDs (allowlist) | *(any)* |
| `requestTimeoutMs` | Default request timeout (ms) | `15000` |
| `maxPayloadBytes` | Max payload bytes | `262144` |
| `token` | Device authentication token | *(none)* |
| `awasEnabled` | Enable AWAS auth proxy | `false` |
| `awasHost` | AWAS server hostname | `127.0.0.1` |
| `awasPort` | AWAS server port | `8088` |
| `awasPath` | AWAS WebSocket path | `/ws` |
| `awasSsl` | Use TLS (wss://) | `false` |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev
```

## License

MIT
