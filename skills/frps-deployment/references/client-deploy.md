# 配置路由器侧内网穿透客户端

## 适用场景

当服务端已具备可用的 `server_addr`、`server_port`、`token`，需要把某台路由器的内网服务映射到公网时，使用本模块。

## 前置条件

必须已拿到以下三个值：

1. `server_addr`
2. `server_port`
3. `token`

若任一值缺失，先返回 `references/status.md` 或 `references/server-deploy.md`，不得继续。

## 标准提问模板

### 模板 A：首轮收集

请按顺序向用户确认以下信息：

1. 请提供目标路由器 `device_id`，从设备列表中选择要下发配置的路由器。
2. 请确认是否使用当前已获取的服务端公网 IP 作为 `server_addr`；如果要使用域名，请直接提供域名。
3. 请说明要映射的本地服务类型，例如 SSH、Web、数据库；这会影响后续本地端口和远端端口的确认。

### 模板 B：创建单条映射前的参数确认

请按顺序向用户确认以下信息：

1. 请提供本地 IP 地址，也就是被穿透服务实际所在主机地址，例如 `192.168.1.10`。
2. 请提供本地端口，也就是该服务真实监听端口，例如 SSH 常见 `22`。
3. 请提供远端端口，也就是 VPS 对外开放端口，外部用户将通过 `VPS_IP:远端端口` 访问该服务。

### 模板 C：缺失 `server_addr` 时

若 `server_addr` 尚未确认，请先调用 `openclaw_get_vps_public_ip`，再向用户说明：

- 我已通过系统接口获取到当前 VPS 的公网 IP 为 `[自动填入获取的 IP]`，请确认是否使用该 IP 作为服务端连接地址；如果需要使用域名，请直接提供域名。

## 参数合法性快速校验清单

调用工具前必须至少确认：

1. `device_id` 不为空，且来自 `clawwrt_list_devices` 返回列表。
2. `server_addr` 不为空，且不能是 `localhost`、`127.0.0.1`、`0.0.0.0`。
3. 本地 IP 地址是有效 IPv4 地址，不得使用猜测值。
4. 本地端口是 `1-65535` 的整数。
5. 远端端口是 `1-65535` 的整数，且不能与服务端监听端口冲突。
6. 若用户不确定本地端口，先确认服务真实监听端口，再决定远端端口。
7. 若同一设备上已存在相同远端端口映射，先提示冲突并要求改端口。

## 执行流程

1. 调用 `clawwrt_list_devices` 获取在线设备列表，并让用户明确确认目标 `device_id`。
2. 若 `server_addr` 尚未确认，调用 `openclaw_get_vps_public_ip`，再按模板 C 让用户确认公网 IP 或域名。
3. 按模板 A 和模板 B 收集客户端配置所需参数。
4. 执行最小参数校验；若失败，明确指出错误项并要求用户修正。
5. 调用 `clawwrt_set_xfrpc_common`，写入 `server_addr`、`server_port`、`token`。
6. 调用 `clawwrt_add_xfrpc_tcp_service`，创建单条 TCP 映射。
7. 调用 `clawwrt_get_xfrpc_common_config` 或 `clawwrt_get_xfrpc_tcp_service` 回读配置，确认客户端公共配置和映射规则已落盘。
8. 向用户说明下一步将进入 `references/verify.md` 做成功验证。

## 规则

1. 不得自行猜测 `device_id`、本地 IP、本地端口或远端端口。
2. 调用 `clawwrt_set_xfrpc_common` 前，必须确认 `token` 非空；若为空，回到服务端部署阶段。
3. 如果用户要求查看、禁用或删除特定映射，使用 `clawwrt_get_xfrpc_tcp_service`、`clawwrt_disable_xfrpc_tcp_service`、`clawwrt_del_xfrpc_tcp_service` 的精细化接口。
4. 如果用户要求清空某台设备上全部映射，调用 `clawwrt_del_xfrpc_tcp_service` 且不传 `name`。
5. 如果用户要求全局关闭客户端内网穿透功能，调用 `clawwrt_disable_xfrpc_service`。

## 成功输出

至少包含：

1. 目标设备
2. 已写入的服务端地址和端口
3. 已创建的本地 IP、本地端口、远端端口映射
4. 配置回读结果
5. 下一步建议：进入成功验证