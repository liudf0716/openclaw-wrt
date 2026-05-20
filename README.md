# OpenClaw WRT

OpenClaw plugin for subscribing to chawrtd device events and controlling ClawWRT routers through the chawrtd API.

**[中文文档](README_zh.md)**

## Features

- Subscribes to chawrtd device events over SSE for live router state
- Uses the chawrtd HTTP API for router operations and tool calls
- Resolves online devices and keeps aliases/session state from event data
- 30+ fine-grained tools covering: WiFi config, client management, BPF traffic monitoring, WireGuard VPN, shell execution, portal page publishing, domain trust list, etc.

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
┌──────────────┐   SSE events    ┌──────────────────┐   HTTP API    ┌──────────────────┐
│  chawrtd     │ ──────────────> │  OpenClaw WRT    │ ────────────> │  OpenClaw Agent  │
│  event stream │                 │  plugin          │              │  (LLM)           │
│  + router API │ <────────────── │  subscribes to   │ <─────────── │  Uses 30+ tools  │
└──────────────┘   device ops    │  device events   │   tool calls  │  to manage router│
                                 └──────────────────┘                └──────────────────┘
```

1. **Subscribe to events** — The plugin connects to chawrtd's SSE stream at `/v1/events/stream` and keeps the online device view fresh.
2. **Call router APIs** — OpenClaw's LLM agent uses the registered `clawwrt_*` and `openclaw_*` tools to call chawrtd's HTTP endpoints.
3. **Manage devices** — Device state, aliases, and timestamps are derived from the event stream and API responses.

## Captive portal pages

Use `clawwrt_publish_portal_page` after the agent has generated the portal HTML from the user's prompt. The tool writes the page into the host nginx web root as a device-specific HTML file, then updates the connected router so ApFree WiFiDog redirects users to that page.

The page should be self-contained HTML. Keep CSS and JavaScript inline unless you know the nginx web root will also serve extra assets.

## Configuration

Configure this plugin under `plugins.entries.openclaw-wrt.config` in `~/.openclaw/openclaw.json`.

Example:

```json
{
  "plugins": {
    "entries": {
      "openclaw-wrt": {
        "enabled": true,
        "config": {
          "chawrtdEventStream": {
            "baseUrl": "http://127.0.0.1:8001",
            "path": "/v1/events/stream"
          },
          "notificationTarget": "feishu:chat:oc_xxx"
        }
      }
    }
  }
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `enabled` | Enable the plugin entry | `true` |
| `config.chawrtdEventStream.baseUrl` | chawrtd base URL | `http://127.0.0.1:8001` |
| `config.chawrtdEventStream.path` | Event stream path | `/v1/events/stream` |
| `config.chawrtdEventStream.reconnectMinMs` | Minimum reconnect delay | `1000` |
| `config.chawrtdEventStream.reconnectMaxMs` | Maximum reconnect delay | `30000` |
| `config.notificationTarget` | Optional device event delivery target | unset |

### Tool allowlist note

If your OpenClaw config uses a restrictive tool profile such as:

```json
{
  "tools": {
    "profile": "coding"
  }
}
```

then the built-in `coding` profile only allows core coding tools by default. Plugin tools from `openclaw-wrt` are loaded, but they may not be callable by the agent unless you explicitly re-allow them.

Recommended configuration:

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw-wrt"]
  }
}
```

Why this matters:

- `coding` is a core-tool allowlist, not a plugin-tool allowlist
- `alsoAllow: ["openclaw-wrt"]` expands to the tools registered by this plugin
  - without it, the agent may recognize the plugin conceptually but fail to call tools such as `clawwrt_list_devices`, `clawwrt_get_status`, or `clawwrt_get_clients`

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
