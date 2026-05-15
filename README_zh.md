# OpenClaw WRT

OpenClaw 插件，通过订阅 chawrtd 的设备事件并调用 chawrtd API 来管理 ClawWRT 路由器。

**[English](README.md)**

## 功能特性

- 通过 SSE 订阅 chawrtd 设备事件，实时同步路由器状态
- 通过 chawrtd 的 HTTP API 执行路由器操作与工具调用
- 根据事件流和接口响应维护在线设备、别名和时间戳
- 30+ 细粒度工具，覆盖：WiFi 配置、客户端管理、BPF 流量监控、WireGuard VPN、Shell 执行、portal 页面发布、域名信任列表等

## 安装

### 方式一：npm 安装（发布后）

```bash
openclaw plugins install @openclaw/openclaw-wrt
```

### 方式二：本地目录安装（推荐开发调试）

无需构建，直接将源码目录安装到 OpenClaw 中：

```bash
openclaw plugins install /path/to/openclaw-wrt
```

示例：

```bash
openclaw plugins install /home/user/work/openclaw-wrt
```

> OpenClaw 会自动将插件链接到 `~/.openclaw/extensions/` 目录下，并通过 jiti 编译 TypeScript 源码加载。

### 方式三：构建后本地安装

```bash
# 先构建
pnpm build

# 安装构建产物
openclaw plugins install /path/to/openclaw-wrt
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

## 工作原理

```
┌──────────────┐   SSE 事件流    ┌──────────────────┐   HTTP API    ┌──────────────────┐
│  chawrtd     │ ──────────────> │  OpenClaw WRT    │ ────────────> │  OpenClaw Agent  │
│  事件流 +    │                 │  插件            │              │  (LLM)           │
│  路由器 API  │ <────────────── │  订阅设备事件    │ <─────────── │  通过 30+ 工具   │
└──────────────┘   设备操作      └──────────────────┘   工具调用    │  管理路由器      │
                                                                   └──────────────────┘
```

1. **订阅事件** — 插件连接 chawrtd 的 SSE 流 `/v1/events/stream`，持续更新在线设备视图。
2. **调用路由器 API** — OpenClaw 的 LLM Agent 通过已注册的 `clawwrt_*` 和 `openclaw_*` 工具调用 chawrtd 的 HTTP 接口。
3. **管理设备** — 在线状态、别名和时间戳均从事件流和接口响应中获得。

## Portal 页面

在 Agent 已根据用户 prompt 生成 portal HTML 之后，使用 `clawwrt_publish_portal_page` 将页面写入宿主机 nginx 的 web 目录，并保存为设备专属 HTML 文件，随后更新已连接路由器，让 ApFree WiFiDog 将用户重定向到该页面。

页面应尽量保持自包含。除非你明确知道 nginx web 目录还会提供额外资源，否则建议把 CSS 和 JavaScript 内联到 HTML 中。

## 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `enabled` | 启用插件 | `true` |
| `chawrtdEventStream.baseUrl` | chawrtd 基础地址 | `http://127.0.0.1:8001` |
| `chawrtdEventStream.path` | 事件流路径 | `/v1/events/stream` |
| `chawrtdEventStream.reconnectMinMs` | 最小重连延迟 | `1000` |
| `chawrtdEventStream.reconnectMaxMs` | 最大重连延迟 | `30000` |

### 工具白名单说明

如果你的 OpenClaw 配置使用了较严格的工具配置，例如：

```json
{
  "tools": {
    "profile": "coding"
  }
}
```

那么内置的 `coding` profile 默认只允许核心 coding 工具，不会自动放行 `openclaw-wrt` 这样的插件工具。插件虽然已经加载，但 Agent 可能无法真正调用这些工具。

建议配置为：

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw-wrt"]
  }
}
```

原因如下：

- `coding` 是核心工具白名单，不是插件工具白名单
- `alsoAllow: ["openclaw-wrt"]` 会展开并放行本插件注册的工具
- 如果不加这项，Agent 可能“知道有这个插件”，但无法实际调用 `clawwrt_list_devices`、`clawwrt_get_status`、`clawwrt_get_clients` 等工具

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 监听模式
pnpm dev
```

## 许可证

MIT
