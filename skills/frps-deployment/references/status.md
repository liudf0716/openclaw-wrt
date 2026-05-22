# 获取当前内网穿透状态

## 适用场景

需要先判断服务端状态，或想一次性盘点服务端、公网 IP 和所有在线设备配置时使用。

## 固定入口

优先调用 `openclaw_frps_full_status`。如果只需要最小服务端判断，再单独调用 `openclaw_get_frps_status`。

## 执行流程

1. 调用 `openclaw_frps_full_status`，拿到服务端状态、公网 IP、设备全局配置和 TCP 映射。
2. 如果聚合结果不可用，再回退到：
   1. `openclaw_get_frps_status`
   2. `openclaw_get_vps_public_ip`
   3. `clawwrt_list_devices`
   4. `clawwrt_get_xfrpc_common_config` 或 `clawwrt_get_xfrpc_common`
   5. `clawwrt_get_xfrpc_tcp_service`（不传 `name`）
3. 根据结果判断下一步：
   1. 服务端缺失或 token 为空，进入 `references/server-deploy.md`
   2. 服务端正常但客户端未配置，进入 `references/client-deploy.md`
   3. 服务端和客户端都已配置，先展示现状，再决定是否复用、修改、删除或新增映射
4. 服务端状态正常时，不要让用户在“继续下一步”与“重置配置”之间做默认选择；重置只在用户明确要求时进入 `references/reset.md`。

## 规则

1. 不依赖记忆输出设备或映射状态。
2. 发现旧客户端配置时，只把它标记为旧配置，不直接复用。
3. `clawwrt_get_xfrpc_tcp_service` 不传 `name` 时，用于读取某台设备的全部 TCP 映射。
4. `clawwrt_get_xfrpc_common_config` 或 `clawwrt_get_xfrpc_common` 用于判断客户端当前连向哪个服务端。

## 成功输出

至少包含：

1. 当前服务端状态
2. 是否需要进入服务端部署
3. 公网 IP
4. 每台设备的全局配置摘要
5. 每台设备的 TCP 映射摘要
6. 下一步建议