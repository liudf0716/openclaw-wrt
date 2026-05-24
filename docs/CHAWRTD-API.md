# openclaw-wrt ↔ chawrtd 接口文档

> 自动生成于 2026-05-24，基于 openclaw-wrt@2026.5.20 与 chawrtd main 分支交叉审查。

## 架构概述

```
┌─────────────────────────────────────────────────────┐
│  openclaw-wrt (TypeScript, OpenClaw Plugin)         │
│  75 AI tools → callChawrtd() / callDeviceOp()       │
│  SSE client  → /v1/events/stream                    │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (localhost:8001)
┌──────────────────▼──────────────────────────────────┐
│  chawrtd (Go, Gateway Daemon)                       │
│  HTTP API server + WebSocket device manager         │
│  VPS ops (FRPS / WireGuard / shell)                 │
└──────────────────┬──────────────────────────────────┘
                   │ WebSocket
┌──────────────────▼──────────────────────────────────┐
│  ClawWRT 路由器固件 (OpenWrt)                        │
│  55 个 device operations (op 透传)                   │
└─────────────────────────────────────────────────────┘
```

通信链路：
- **openclaw-wrt → chawrtd**：HTTP REST（默认 `http://127.0.0.1:8001`）
- **openclaw-wrt ← chawrtd**：SSE 事件流（`GET /v1/events/stream`）
- **chawrtd ↔ 路由器**：WebSocket（`ws://host:8001/ws/clawwrt`）

---

## 一、VPS 管理接口（openclaw-wrt 直连 chawrtd）

这些接口由 chawrtd 直接处理，不透传到路由器。

### 1.1 设备发现

| 方法 | 路径 | 描述 | 调用方 |
|------|------|------|--------|
| GET | `/v1/devices` | 列出所有在线路由器 | `ChawrtdClient.listDevices()` |
| GET | `/v1/device/{deviceId}` | 获取单台设备连接快照 | `ChawrtdClient.getDevice()` |

**响应结构**（`/v1/devices`）：
```json
{
  "devices": [
    {
      "device_id": "AW46344625CC7D742A339",
      "connected_at": 1716523200000,
      "last_seen_at": 1716523260000,
      "remote_addr": "127.0.0.1:54520",
      "alias": "WiFi1",
      "device_info": { ... }
    }
  ],
  "count": 1
}
```

### 1.2 设备别名管理

| 方法 | 路径 | 描述 | openclaw-wrt 使用 |
|------|------|------|-------------------|
| GET | `/v1/devices/aliases` | 列出所有别名 | ❌ 未调用 |
| POST | `/v1/devices/alias/set` | 设置设备别名 | ❌ 未调用 |
| POST | `/v1/devices/alias/delete` | 删除设备别名 | ❌ 未调用 |

### 1.3 事件系统

| 方法 | 路径 | 描述 | openclaw-wrt 使用 |
|------|------|------|-------------------|
| GET | `/v1/events/stream` | SSE 事件流（设备上下线、客户端连接等） | ✅ `ChawrtdEventStreamClient` |
| POST | `/v1/events/subscribe` | 注册 webhook 回调 | ❌ 未调用 |
| POST | `/v1/events/unsubscribe` | 取消 webhook 回调 | ❌ 未调用 |

**SSE 事件格式**：
```
event: device
data: {"op":"client_connected","device_id":"AW46...","alias":"WiFi1","data":{"mac":"AA:BB:CC:DD:EE:FF"},"time":1716523260000}
```

### 1.4 FRPS 内网穿透服务端

| 方法 | 路径 | 请求体 | 描述 |
|------|------|--------|------|
| POST | `/v1/frps/deploy` | `{ port: number, token: string }` | 部署/重装 nwct-server |
| GET | `/v1/frps/status` | — | 获取服务端状态、配置、公网 IP |
| POST | `/v1/frps/verify` | `{ protocol: "tcp"\|"udp", port: number }` | 检查端口监听 |
| POST | `/v1/frps/reset` | — | 停止并卸载 nwct-server |

**通用响应结构**（`ops.Result`）：
```json
{
  "summary": "FRPS deployed successfully",
  "output": "...(shell 输出)...",
  "data": {
    "service": "nwct-server",
    "port": 7070,
    "token": "...",
    "publicIp": "43.159.38.154"
  }
}
```

### 1.5 VPS 公网 IP

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/v1/vps/public-ip` | 探测 VPS 公网 IPv4（curl ifconfig.me 等） |

**响应**：
```json
{
  "summary": "Detected VPS public IPv4 address",
  "data": { "publicIp": "43.159.38.154", "source": "https://ifconfig.me/ip" }
}
```

### 1.6 WireGuard VPN 服务端

| 方法 | 路径 | 请求体 | 描述 |
|------|------|--------|------|
| POST | `/v1/wg/deploy` | `DeployWireGuardRequest` | 安装 WG + 生成密钥 + 配置 wg0 |
| GET | `/v1/wg/status` | — | wg show + NAT + IP forward + 密钥检查 |
| POST | `/v1/wg/reset` | `{ interface?: string, removeKeys?: bool }` | 停止 wg-quick + 删配置 |
| POST | `/v1/wg/verify` | `{ pingTargets?: string[] }` | 状态 + ping 连通性 |

**DeployWireGuardRequest**：
```json
{
  "port": 51820,
  "tunnelIp": "10.0.0.1/24",
  "egressInterface": "eth0",
  "peerBindings": [
    {
      "deviceId": "AW46344625CC7D742A339",
      "peerPublicKey": "52YIv/5S4iORcevHZE/tiYgDh4t72tlAqmHp2CyjKRQ=",
      "tunnelIp": "10.0.0.2/32",
      "lanCidr": "192.168.8.0/24",
      "endpoint": ""
    }
  ]
}
```

**WG Status 响应 `data.server`**：
```json
{
  "wgShow": "interface: wg0\n  ...",
  "natRules": "-P POSTROUTING ACCEPT\n...",
  "ipForwardOk": true,
  "snatOk": true,
  "serverPublicKey": "WIU55fcR689Yo62T42s34/90YlWsYjKFJaJvkV7/SmQ=",
  "keyCheck": { "status": "ok", "configuredPublicKey": "...", "derivedPublicKey": "..." },
  "reportLines": ["- IP Forwarding: ✅ enabled", ...],
  "peerConfig": [{ "publicKey": "...", "allowedIps": ["10.0.0.2/32", "192.168.8.0/24"] }]
}
```

### 1.7 健康检查

| 方法 | 路径 | 描述 | openclaw-wrt 使用 |
|------|------|------|-------------------|
| GET | `/healthz` | 返回 `{"ok":true,"service":"chawrtd"}` | ❌ 未调用 |

---

## 二、设备透传接口（通过 chawrtd WebSocket 转发到路由器）

### 路径模式

```
POST /v1/device/{deviceId}/{op}
```

chawrtd 不解析 payload，原样透传到路由器的 WebSocket 连接，等待路由器响应后返回。

### 2.1 完整 op 列表（55 个）

#### 设备管理（9 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_status` | `clawwrt_get_status` | 路由器运行状态 |
| `get_sys_info` | `clawwrt_get_sys_info` | 系统信息（型号/内存/存储） |
| `get_device_info` | `clawwrt_get_device_info` | 设备元数据 |
| `update_device_info` | `clawwrt_update_device_info` | 更新设备元数据 |
| `reboot_device` | `clawwrt_reboot_device` | 重启路由器 |
| `get_firmware_info` | `clawwrt_get_firmware_info` | 固件版本信息 |
| `firmware_upgrade` | `clawwrt_firmware_upgrade` | OTA 固件升级 |
| `get_network_interfaces` | `clawwrt_get_network_interfaces` | 网络接口列表 |
| `shell` | `clawwrt_execute_shell` | 执行 shell 命令 |

#### 客户端管理（5 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_clients` | `clawwrt_get_clients` | 已认证客户端列表 |
| `get_client_info` | `clawwrt_get_client_info` | 单个客户端详情 |
| `auth_client` | `clawwrt_auth_client` | 认证客户端放行 |
| `kickoff` | `clawwrt_kickoff_client` | 断开客户端 |
| `tmp_pass_client` | `clawwrt_tmp_pass_client` | 临时放行 |

#### WiFi（5 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_wifi_info` | `clawwrt_get_wifi_info` | WiFi 配置 |
| `set_wifi_info` | `clawwrt_set_wifi_info` | 修改 SSID/密码/加密 |
| `scan_wifi` | `clawwrt_scan_wifi` | 扫描周围 WiFi |
| `set_wifi_relay` | `clawwrt_set_wifi_relay` | 配置 WiFi 中继 |
| `delete_wifi_relay` | `clawwrt_delete_wifi_relay` | 删除 WiFi 中继 |

#### BPF 流量监控（8 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `bpf_add` | `clawwrt_bpf_add` | 添加监控目标 |
| `bpf_del` | `clawwrt_bpf_del` | 删除监控目标 |
| `bpf_flush` | `clawwrt_bpf_flush` | 清空监控表 |
| `bpf_json` | `clawwrt_bpf_json` | 查询流量统计 |
| `bpf_update` | `clawwrt_bpf_update` | 更新单目标限速 |
| `bpf_update_all` | `clawwrt_bpf_update_all` | 更新全表限速 |
| `get_l7_active_stats` | `clawwrt_get_l7_active_stats` | L7 协议流量 |
| `get_l7_protocol_catalog` | `clawwrt_get_l7_protocol_catalog` | L7 协议库 |

#### 认证/信任域（8 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_auth_serv` | `clawwrt_get_auth_serv` | 认证服务器配置 |
| `set_auth_serv` | `clawwrt_set_auth_serv` | 设置认证服务器 |
| `get_trusted_domains` | `clawwrt_get_trusted_domains` | 信任域名白名单 |
| `sync_trusted_domain` | `clawwrt_sync_trusted_domains` | 同步域名白名单 |
| `get_trusted_wildcard_domains` | `clawwrt_get_trusted_wildcard_domains` | 泛域名白名单 |
| `sync_trusted_wildcard_domains` | `clawwrt_sync_trusted_wildcard_domains` | 同步泛域名白名单 |
| `get_trusted_mac` | `clawwrt_get_trusted_mac` | MAC 白名单 |
| `sync_trusted_mac` | `clawwrt_sync_trusted_mac` | 同步 MAC 白名单 |

#### MQTT（2 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_mqtt_serv` | `clawwrt_get_mqtt_serv` | MQTT 服务器配置 |
| `set_mqtt_serv` | `clawwrt_set_mqtt_serv` | 设置 MQTT 服务器 |

#### Portal 门户页（2 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `set_local_portal` | `clawwrt_publish_portal_page`（内部调用） | 设置门户页 URL |
| — | `clawwrt_generate_portal_page` | 生成 HTML（不透传，本地文件操作） |

#### WireGuard VPN（6 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_wireguard_vpn` | `clawwrt_get_wireguard_vpn` | 获取 WG 配置 |
| `set_wireguard_vpn` | `clawwrt_set_wireguard_vpn` | 设置 WG 配置 |
| `reset_wireguard_vpn` | `clawwrt_reset_wireguard_vpn` | 重置 WG 配置 |
| `get_wireguard_vpn_status` | `clawwrt_get_wireguard_vpn_status` | WG 运行状态 |
| `generate_wireguard_keys` | `clawwrt_generate_wireguard_keys` | 生成密钥对 |
| `get_vpn_routes` | `clawwrt_get_vpn_routes` | VPN 路由表 |
| `set_vpn_routes` | `clawwrt_set_vpn_routes` | 设置 VPN 路由 |
| `get_br_lan` | `clawwrt_get_br_lan` | LAN 网段信息 |
| `set_br_lan` | `clawwrt_set_br_lan` | 修改 LAN IP |

#### XFRPC 内网穿透客户端（9 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `get_xfrpc_common` | `clawwrt_get_xfrpc_common` | XFRPC 全局配置 |
| `get_xfrpc_common_config` | `clawwrt_get_xfrpc_common_config` | XFRPC 全局配置（备用） |
| `set_xfrpc_common` | `clawwrt_set_xfrpc_common` | 设置 XFRPC 全局配置 |
| `get_xfrpc_tcp_service` | `clawwrt_get_xfrpc_tcp_service` | TCP 映射查询 |
| `add_xfrpc_tcp_service` | `clawwrt_add_xfrpc_tcp_service` | 添加 TCP 映射 |
| `del_xfrpc_tcp_service` | `clawwrt_del_xfrpc_tcp_service` | 删除 TCP 映射 |
| `disable_xfrpc_tcp_service` | `clawwrt_disable_xfrpc_tcp_service` | 禁用 TCP 映射 |
| `disable_xfrpc_service` | `clawwrt_disable_xfrpc_service` | 禁用 XFRPC 全局 |
| `restart_xfrpc` | `clawwrt_restart_xfrpc` | 重启 XFRPC 服务 |

#### 网络/测速（3 个）
| op | 工具名 | 描述 |
|----|--------|------|
| `speedtest` | `clawwrt_speedtest` | 网速测试 |
| `get_speedtest_servers` | `clawwrt_get_speedtest_servers` | 测速服务器列表 |
| `get_br_lan` | `clawwrt_get_br_lan` | LAN 网段 |

---

## 三、chawrtd 已注册但 openclaw-wrt 未调用的接口

| 路径 | 描述 | 建议 |
|------|------|------|
| `GET /healthz` | 健康检查 | 可用于插件启动时验证 chawrtd 可达性 |
| `GET /v1/devices/aliases` | 列出所有别名 | 可集成到设备管理工具 |
| `POST /v1/devices/alias/set` | 设置别名 | 可作为 `clawwrt_update_device_info` 的补充 |
| `POST /v1/devices/alias/delete` | 删除别名 | 同上 |
| `POST /v1/events/subscribe` | Webhook 订阅 | SSE 已覆盖，webhook 为备用 |
| `POST /v1/events/unsubscribe` | 取消 Webhook | 同上 |

---

## 四、接口设计问题与优化建议

### 🔴 需修复

#### 4.1 `/v1/frps/status` 内嵌公网 IP 探测，增加延迟

**现状**：`GetFRPSStatus()` 在每次调用时都执行 `getVpsPublicIP()`，后者依次尝试 3 个外部 URL（ifconfig.me / ipify / amazonaws），单个超时 8 秒。

**影响**：openclaw-wrt 多处调用 `/v1/frps/status`（deploy 重试、full_status 聚合、xfrpc common 配置），每次都附带一次外网探测。

**建议**：
1. chawrtd 侧将公网 IP 缓存 5 分钟（TTL）
2. 或拆分为两个接口：`/v1/frps/status`（纯本地状态）和 `/v1/vps/public-ip`（已存在），让调用方按需组合

#### 4.2 `sync_trusted_domain` vs `sync_trusted_domains` 命名不一致

**现状**：
- openclaw-wrt 工具名：`clawwrt_sync_trusted_domains`（复数）
- 实际发送的 op：`sync_trusted_domain`（单数）

**建议**：统一命名。路由器侧 op 应改为 `sync_trusted_domains`，或工具名改为 `clawwrt_sync_trusted_domain`。

### 🟡 建议优化

#### 4.3 缺少请求级别超时透传

**现状**：openclaw-wrt 的 schema 支持 `timeoutMs`，但透传到 chawrtd 时，chawrtd 使用全局 `defaultTimeout`（120s），不看请求体中的超时参数。

**建议**：chawrtd `handleDeviceCommand` 支持请求头 `X-Timeout-Ms` 或请求体中的 `_timeout_ms` 字段，覆盖默认超时。

#### 4.4 设备 op 无版本/鉴权机制

**现状**：`POST /v1/device/{deviceId}/{op}` 无任何鉴权，任何能访问 8001 端口的进程都可以发送设备命令。

**建议**：添加 Bearer token 或共享密钥校验（与 WebSocket 连接使用相同 token）。

#### 4.5 `/v1/frps/deploy` 中 token 由客户端生成后传入

**现状**：openclaw-wrt 在 `tools/frps.ts` 中用 `generateSecureToken()` 生成 token，再传给 chawrtd。

**建议**：token 生成应在 chawrtd 服务端完成，避免 token 在 HTTP 传输中暴露。chawrtd 可在 deploy 时自动生成并返回。

#### 4.6 统一响应结构

**现状**：VPS 管理接口返回 `ops.Result`（`summary` + `output` + `data`），设备透传返回路由器原始 JSON。两种格式混用。

**建议**：统一包装为 `{ status: "ok"|"error", data: {...}, meta: { deviceId, op, durationMs } }`。
