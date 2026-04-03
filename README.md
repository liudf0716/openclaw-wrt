# OpenClaw WRT

OpenClaw bridge plugin for OpenWrt / APFree Wifidog router device WebSocket control.

## Features

- WebSocket bridge server accepting router device connections
- Request/response correlation via `req_id`
- Device session management (connect, auth, timeout, alias)
- AWAS authentication proxy (forwards cloud-mode device connect/heartbeat to AWAS server)
- 30+ fine-grained tools covering: WiFi config, client management, BPF traffic monitoring, WireGuard VPN, shell execution, domain trust list, etc.

## Installation

### 方式一：npm 安装（发布后）

```bash
openclaw plugins add @openclaw/openclaw-wrt
```

### 方式二：本地目录安装（推荐开发调试）

无需构建，直接将源码目录安装到 OpenClaw 中：

```bash
openclaw plugins add /path/to/openclaw-wrt
```

例如：

```bash
openclaw plugins add /home/user/work/openclaw-wrt
```

> OpenClaw 会自动将插件链接到 `~/.openclaw/extensions/` 目录下，并通过 jiti 编译 TypeScript 源码加载。

### 方式三：构建后本地安装

```bash
# 先构建
pnpm build

# 安装构建产物
openclaw plugins add /path/to/openclaw-wrt
```

### 验证安装

```bash
# 查看已安装插件列表
openclaw plugins list

# 查看插件详情
openclaw plugins inspect openclaw-wrt
```

### 卸载

```bash
openclaw plugins remove openclaw-wrt
```

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
