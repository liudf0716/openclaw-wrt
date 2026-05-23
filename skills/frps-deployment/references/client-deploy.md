# 配置路由器侧内网穿透客户端

## 适用场景

服务端已准备好，需要把某台路由器上的服务映射到公网时使用。

## 前置条件

1. 目标 `device_id`

## 执行流程

1. 调用 `clawwrt_list_devices`，确认目标 `device_id`。
2. 收集本地 IP、本地端口和远端端口。
3. 调用 `clawwrt_set_xfrpc_common`。该工具会自动从 chawrtd 读取并写入 `server_addr`、`server_port`、`token`，用户无需再提供这三项。
4. 调用 `clawwrt_add_xfrpc_tcp_service` 创建 TCP 映射。`remote_port` 的范围和同设备冲突检查由工具层处理。
5. 回读配置：调用 `clawwrt_get_xfrpc_common` 或 `clawwrt_get_xfrpc_common_config`，以及 `clawwrt_get_xfrpc_tcp_service`。
6. 回读成功后，进入 `references/verify.md`。

## 规则

1. 不猜测 `device_id`、本地 IP、本地端口或远端端口。
2. `clawwrt_set_xfrpc_common` 由工具自动取值，不再要求用户输入 `server_addr`、`server_port`、`token`，也不要把它们作为人工前置条件。
3. 如果要查看、禁用或删除映射，使用对应的精细化接口。
4. 如果要清空全部映射，调用 `clawwrt_del_xfrpc_tcp_service` 且不传 `name`。

## 成功输出

1. 目标设备及 `device_id`
2. 客户端全局连接配置
3. 已创建的 TCP 映射
4. 配置回读结果
5. 验证结果
