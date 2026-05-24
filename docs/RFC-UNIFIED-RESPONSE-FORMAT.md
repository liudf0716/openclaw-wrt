# RFC: 统一 chawrtd API 响应格式

> 版本: v1.0 | 日期: 2026-05-24
> 状态: 提案 (Draft)
> 涉及仓库: `chawrtd` (Go) + `openclaw-wrt` (TypeScript)

---

## 1. 问题描述

### 1.1 现状

chawrtd 目前有 **三种不同的响应格式**，取决于请求类型：

#### 格式 A — VPS 操作（FRPS / WireGuard / VPS）

由 `ops.Result` 结构体序列化，走 `wrapJSON` 包装：

```json
HTTP 200
{
  "summary": "FRPS deployed successfully",
  "output": "Created symlink /etc/systemd/...",
  "data": {
    "service": "nwct-server",
    "port": 7070,
    "token": "***"
  }
}
```

错误时由 `wrapJSON` 统一处理：
```json
HTTP 400
{ "error": "port must be between 1 and 65535" }
```

#### 格式 B — 设备透传（POST /v1/device/{id}/{op}）

直接返回路由器 WebSocket 响应的 `msg.Data`（`map[string]any`），无包装：

```json
HTTP 200
{
  "interface": { "addresses": "10.0.0.2/32", ... },
  "peers": [ ... ]
}
```

错误可能是 chawrtd 级别的或路由器级别的：
```json
HTTP 404  { "error": "device not found" }
HTTP 500  { "error": "message timeout" }
HTTP 500  { "error": "response 500: command failed" }
```

#### 格式 C — 设备快照查询

`GET /v1/device/{id}` 返回 `DeviceSession` 结构体直接序列化：

```json
HTTP 200
{
  "device_id": "AW46344625CC7D742A339",
  "connected_at": "2026-05-24T...",
  "last_seen_at": "2026-05-24T...",
  "remote_addr": "127.0.0.1:54520",
  "alias": "WiFi1"
}
```

`GET /v1/devices` 返回包装后的列表：
```json
HTTP 200
{
  "devices": [ ... ],
  "count": 2
}
```

### 1.2 影响

| 影响点 | 描述 |
|--------|------|
| **客户端解析复杂** | openclaw-wrt 的 `ChawrtdClient.call()` 返回 `ChawrtdToolResult`（`summary? + output? + data? + error?`），但设备透传的响应根本不含 `summary/output`，客户端被迫用 `response.data ?? response` 做 fallback |
| **错误格式不统一** | VPS ops 错误走 `wrapJSON`（HTTP 400），设备命令错误走 `handleDeviceCommand`（HTTP 404/500），两者的 error 位置一样但 HTTP 语义不同 |
| **无法区分成功/失败** | 设备透传的成功响应没有 `status` 字段，客户端无法可靠判断操作是否真正成功 |
| **缺少元数据** | 设备透传的响应没有 `deviceId`、`op`、耗时等上下文信息 |

---

## 2. 目标

1. 所有 chawrtd HTTP 响应共享同一个顶层信封结构
2. 向后兼容：openclaw-wrt 可以渐进迁移，旧字段在过渡期仍保留
3. 错误信息位置统一
4. 最小改动量：chawrtd 改一处写入层，openclaw-wrt 改一处解析层

---

## 3. 设计方案

### 3.1 统一信封结构

所有 chawrtd 的 JSON 响应统一为以下结构：

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "deviceId": "AW46344625CC7D742A339",
    "op": "get_status",
    "durationMs": 1234
  },
  "error": null
}
```

#### 字段定义

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `ok` | `boolean` | ✅ | 操作是否成功 |
| `data` | `object \| null` | ✅ | 业务数据载荷。成功时包含结果，失败时可为 `null` |
| `error` | `string \| null` | ✅ | 错误描述。成功时为 `null` |
| `meta` | `object \| null` | ❌ | 可选元数据，用于调试和日志 |

#### `meta` 子字段（可选）

| 字段 | 类型 | 何时出现 | 描述 |
|------|------|---------|------|
| `deviceId` | `string` | 设备透传 | 目标设备 ID |
| `op` | `string` | 设备透传 | 操作名称 |
| `durationMs` | `number` | 所有请求 | 服务端处理耗时 |
| `summary` | `string` | VPS ops | 操作摘要（兼容旧 `ops.Result.Summary`） |
| `output` | `string` | VPS ops | Shell 输出（兼容旧 `ops.Result.Output`） |

### 3.2 各接口类型的映射

#### VPS 操作（FRPS / WireGuard / VPS）

**改前**：
```json
{
  "summary": "FRPS deployed successfully",
  "output": "Created symlink ...",
  "data": { "port": 7070, "token": "***" }
}
```

**改后**：
```json
{
  "ok": true,
  "data": { "port": 7070, "token": "***" },
  "error": null,
  "meta": {
    "summary": "FRPS deployed successfully",
    "output": "Created symlink ...",
    "durationMs": 5432
  }
}
```

**兼容策略**：过渡期同时输出顶层 `summary` 和 `meta.summary`（见 §4.2）。

#### 设备透传

**改前**：
```json
{ "interface": { ... }, "peers": [ ... ] }
```

**改后**：
```json
{
  "ok": true,
  "data": { "interface": { ... }, "peers": [ ... ] },
  "error": null,
  "meta": { "deviceId": "AW46...", "op": "get_wireguard_vpn", "durationMs": 320 }
}
```

#### 设备列表

**改前**：
```json
{ "devices": [ ... ], "count": 2 }
```

**改后**：
```json
{
  "ok": true,
  "data": { "devices": [ ... ], "count": 2 },
  "error": null,
  "meta": { "durationMs": 5 }
}
```

#### 错误响应

所有错误统一为：

```json
{
  "ok": false,
  "data": null,
  "error": "device not found",
  "meta": { "deviceId": "AW46...", "op": "get_status", "durationMs": 12 }
}
```

HTTP 状态码仍然保持语义化：
- `400` — 请求参数错误
- `404` — 设备不存在
- `500` — 内部错误 / 设备通信失败
- `408` — 超时（可选，当前 500 也可接受）

---

## 4. 实施计划

### 4.1 阶段 1 — chawrtd 侧：信封包装（向后兼容）

**文件变更**：`internal/httpapi/server.go`

#### 4.1.1 新增 `writeEnvelope` 函数

```go
type envelope struct {
    OK    bool           `json:"ok"`
    Data  any            `json:"data"`
    Error *string        `json:"error"`
    Meta  map[string]any `json:"meta,omitempty"`
}

func writeEnvelope(w http.ResponseWriter, status int, data any, errMsg string, meta map[string]any) {
    env := envelope{
        OK:   status >= 200 && status < 300,
        Data: data,
        Meta: meta,
    }
    if errMsg != "" {
        env.Error = &errMsg
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(env)
}
```

#### 4.1.2 改造 `wrapJSON`（VPS ops 包装器）

```go
func (s *Server) wrapJSON(next jsonHandler) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        if err := next(w, r); err != nil {
            writeEnvelope(w, http.StatusBadRequest, nil, err.Error(),
                map[string]any{"durationMs": time.Since(start).Milliseconds()})
        }
    }
}
```

#### 4.1.3 改造 VPS handler 的 `writeJSON` 调用

以 `handleFRPSDeploy` 为例：

```go
// 改前
writeJSON(w, http.StatusOK, res)

// 改后
meta := map[string]any{"durationMs": time.Since(start).Milliseconds()}
if res.Summary != "" {
    meta["summary"] = res.Summary
}
if res.Output != "" {
    meta["output"] = res.Output
}
writeEnvelope(w, http.StatusOK, res.Data, "", meta)
```

每个 VPS handler 需要在函数开头加 `start := time.Now()`。

影响文件：
- `handleFRPSDeploy`
- `handleFRPSStatus`
- `handleFRPSVerify`
- `handleFRPSReset`
- `handleVPSPublicIP`
- `handleWGDeploy`
- `handleWGStatus`
- `handleWGReset`
- `handleWGVerify`
- `handleHealth`

#### 4.1.4 改造设备命令路由

```go
// handleDeviceCommand 中成功分支
// 改前
writeJSON(w, http.StatusOK, result)

// 改后
writeEnvelope(w, http.StatusOK, result, "", map[string]any{
    "deviceId":   deviceID,
    "op":         operation,
    "durationMs": time.Since(start).Milliseconds(),
})
```

#### 4.1.5 改造设备列表和设备查询

```go
// handleDevicesList
writeEnvelope(w, http.StatusOK, map[string]any{
    "devices": devicesList,
    "count":   len(devices),
}, "", map[string]any{"durationMs": time.Since(start).Milliseconds()})

// GET /v1/device/{id}
writeEnvelope(w, http.StatusOK, device, "", map[string]any{
    "deviceId":   deviceID,
    "durationMs": time.Since(start).Milliseconds(),
})
```

#### 4.1.6 向后兼容：过渡期保留顶层 `summary`/`output`

在过渡期（阶段 1 完成后至阶段 2 完成前），VPS ops 的信封中同时包含：

```json
{
  "ok": true,
  "summary": "FRPS deployed successfully",
  "output": "...",
  "data": { "port": 7070 },
  "error": null,
  "meta": { "summary": "FRPS deployed successfully", "output": "...", "durationMs": 5432 }
}
```

这样 openclaw-wrt 的 `ChawrtdToolResult`（依赖 `summary` / `output`）无需立即修改。

**实现方式**：`writeEnvelope` 中若 `meta` 含 `summary`/`output`，同时写入顶层字段。

```go
type envelope struct {
    OK      bool           `json:"ok"`
    Data    any            `json:"data"`
    Error   *string        `json:"error"`
    Meta    map[string]any `json:"meta,omitempty"`
    // Backward compatibility — remove after openclaw-wrt migration
    Summary string         `json:"summary,omitempty"`
    Output  string         `json:"output,omitempty"`
}

func writeEnvelope(w http.ResponseWriter, status int, data any, errMsg string, meta map[string]any) {
    env := envelope{
        OK:   status >= 200 && status < 300,
        Data: data,
        Meta: meta,
    }
    if errMsg != "" {
        env.Error = &errMsg
    }
    // Backward compat: copy summary/output to top level
    if s, ok := meta["summary"].(string); ok {
        env.Summary = s
    }
    if o, ok := meta["output"].(string); ok {
        env.Output = o
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(env)
}
```

### 4.2 阶段 2 — openclaw-wrt 侧：适配新信封

**文件变更**：`src/chawrtd-client.ts`

#### 4.2.1 更新 `ChawrtdToolResult` 类型

```typescript
// 改前
export type ChawrtdToolResult = {
  summary?: string;
  output?: string;
  data?: JsonRecord;
  error?: string;
};

// 改后
export type ChawrtdEnvelope = {
  ok: boolean;
  data: JsonRecord | null;
  error: string | null;
  meta?: {
    deviceId?: string;
    op?: string;
    durationMs?: number;
    summary?: string;
    output?: string;
  };
  // Backward compat — removed after chawrtd fully migrated
  summary?: string;
  output?: string;
};
```

#### 4.2.2 更新 `ChawrtdClient.call()`

```typescript
async call(params): Promise<ChawrtdEnvelope> {
  // ... fetch ...
  const payload = await response.json() as ChawrtdEnvelope;

  if (!response.ok || payload.ok === false) {
    const message = payload.error
      ?? `chawrtd request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}
```

#### 4.2.3 更新 `callDeviceOpViaChawrtd()`

```typescript
// 改前
return response.data ?? response;

// 改后
return response.data ?? {};
```

所有设备透传的响应现在总是在 `data` 中，不再需要 fallback。

#### 4.2.4 更新 VPS 工具的 summary/output 读取

```typescript
// 改前
const text = `${response.summary ?? "FRPS status fetched."}${
  response.output ? `\n\n${response.output}` : ""
}`;

// 改后 — 先从 meta 读，fallback 到顶层（兼容旧格式）
const summary = response.meta?.summary ?? response.summary ?? "FRPS status fetched.";
const output = response.meta?.output ?? response.output ?? "";
const text = `${summary}${output ? `\n\n${output}` : ""}`;
```

### 4.3 阶段 3 — 清理

在阶段 1+2 稳定运行一段时间后：

1. **chawrtd**：从 `envelope` 结构体中移除顶层 `Summary` / `Output` 字段
2. **openclaw-wrt**：从 `ChawrtdEnvelope` 中移除顶层 `summary` / `output`
3. **openclaw-wrt**：删除 fallback 逻辑（`response.summary ?? response.meta?.summary`）

---

## 5. 变更影响评估

### chawrtd 变更（阶段 1）

| 文件 | 变更 | 预估行数 |
|------|------|---------|
| `internal/httpapi/server.go` | 新增 `envelope` 结构 + `writeEnvelope`，改造 ~15 处 `writeJSON` | +40, −15 |

### openclaw-wrt 变更（阶段 2）

| 文件 | 变更 | 预估行数 |
|------|------|---------|
| `src/tool-types.ts` | 更新 `ChawrtdToolResult` → `ChawrtdEnvelope` | +12, −5 |
| `src/chawrtd-client.ts` | 更新 `call()` + `callDeviceOpViaChawrtd()` | +5, −8 |
| `src/tools/frps.ts` | 更新 ~10 处 `response.summary` 读取 | +10, −10 |
| `src/tools/xfrpc.ts` | 更新 1 处 | +1, −1 |

### 不受影响的部分

- 所有 55 个设备 op 的 payload 格式不变
- 路由器侧 WebSocket 协议不变
- SSE 事件流格式不变
- 所有 schema 定义不变
- 75 个工具的 AI tool 契约不变

---

## 6. 测试策略

### 阶段 1（chawrtd）

1. **单元测试**：新增 `TestWriteEnvelope` 验证信封格式
2. **集成测试**：`test-integration.sh` 中验证各端点响应含 `ok` + `data` + `error`
3. **向后兼容测试**：验证 VPS ops 响应仍含顶层 `summary`/`output`

### 阶段 2（openclaw-wrt）

1. `vitest run` 62/62 全绿
2. baseline-tools.json 75 tools 无变化
3. 实际设备连通性测试（VPN / FRPS / WiFi）

---

## 7. 回滚方案

由于阶段 1 保留了向后兼容的顶层字段，回滚只需：
- chawrtd: `git revert` 阶段 1 提交，重新编译
- openclaw-wrt: 无需变更（旧解析逻辑仍可工作）

---

## 8. 时间估计

| 阶段 | 工作量 | 前置 |
|------|--------|------|
| 阶段 1 — chawrtd 信封包装 | ~2 小时 | 无 |
| 阶段 2 — openclaw-wrt 适配 | ~1 小时 | 阶段 1 |
| 阶段 3 — 清理向后兼容字段 | ~30 分钟 | 阶段 2 运行稳定 1 周后 |

---

## 附录 A：当前 vs 目标对比

| 接口类型 | 当前格式 | 目标格式 |
|----------|---------|---------|
| VPS ops 成功 | `{summary, output, data}` | `{ok:true, data, error:null, meta:{summary,output,durationMs}}` |
| VPS ops 失败 | `{error}` (400) | `{ok:false, data:null, error, meta:{durationMs}}` |
| 设备透传成功 | `{...raw device data}` | `{ok:true, data:{...}, error:null, meta:{deviceId,op,durationMs}}` |
| 设备透传失败 | `{error}` (404/500) | `{ok:false, data:null, error, meta:{deviceId,op,durationMs}}` |
| 设备列表 | `{devices,count}` | `{ok:true, data:{devices,count}, error:null, meta:{durationMs}}` |
| 设备快照 | `DeviceSession` | `{ok:true, data:DeviceSession, error:null, meta:{deviceId,durationMs}}` |
| 健康检查 | `{ok:true,service}` | `{ok:true, data:{service:"chawrtd"}, error:null}` |
