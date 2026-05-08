# 收集路由器 LAN 网段与路由规划

## 适用场景

当用户要把多台路由器加入 WireGuard 组网，且希望不同路由器下的 LAN 互通时，先执行本模块。

本模块是服务端与客户端配置的共同前置步骤：

1. 服务端侧需要这些 LAN 网段、wg0 接口地址以及每个客户端的 WireGuard 公钥，用于 peer AllowedIPs 规划（须覆盖原有配置，不能遗漏）。
2. 客户端侧需要这些 LAN 网段、wg0 接口地址以及已生成的客户端密钥信息，用于生成保护路由 JSON 文件；`clawwrt_set_vpn_routes` 会从该文件读取路由，再合并现有 wg0 静态路由，不能遗漏本次规划出的 LAN 网段。

注意：AllowedIPs 和路由规则均为覆盖写入，漏掉 wg0 接口地址会导致 VPN 隧道地址本身不可达；漏掉客户端公钥会导致服务端无法一次性完成 peerBindings。

## 固定入口

并行调用：

1. `clawwrt_list_devices`
2. `openclaw_get_wg_status`（用于获取 wg0 接口地址及现有 peer 信息）

## 执行流程

1. 展示当前在线设备清单。
2. 让用户确认要加入组网的设备 ID 列表。
3. 若用户按设备名称选择，先基于 `clawwrt_list_devices` 结果解析成明确设备 ID 后再继续。
4. 调用 `clawwrt_collect_wireguard_protected_routes`，输入用户确认的设备 ID 列表和服务端 wg0 隧道地址（来自 `openclaw_deploy_wg_server` 的 `tunnelIp` 输出），生成并保存保护路由 JSON 文件。
5. 按用户确认的设备 ID 顺序，逐台调用 `clawwrt_generate_wireguard_keys`，收集每台设备的 WireGuard 公钥。
6. 读取并展示规划结果，至少包含：
   1. 设备 ID
   2. 设备名称（若可获取）
   3. `br-lan` CIDR
   4. 每台设备的 routePlans
   5. 保护路由 JSON 文件路径（后续 `clawwrt_set_vpn_routes` 直接消费）
   6. 每台设备对应的 WireGuard 公钥
7. 若返回存在 LAN 冲突：
   1. 立即停止后续组网流程
   2. 展示冲突设备与冲突网段
   3. 提示用户二选一处理：
      1. 剔除冲突设备
      2. 修改冲突设备 LAN 网段（调用 `clawwrt_set_br_lan`）
   4. 用户调整后，重新执行本模块第 4 步
8. 若返回无冲突，则输出本模块结果，供后续模块使用。

## 输出契约

本模块完成后，后续模块必须复用同一份规划结果，不得自行二次推导：

1. 服务端相关步骤使用各设备 LAN CIDR + 各 peer wg0 隧道地址 + 各 peer 公钥，共同组成 peer AllowedIPs 与 `openclaw_deploy_wg_server.peerBindings`（覆盖写入，三者缺一不可）。
2. 客户端相关步骤使用本模块生成的保护路由 JSON 文件作为 `clawwrt_set_vpn_routes.routePlanFile` 输入，`clawwrt_set_vpn_routes` 会从该文件读取每台设备的路由，再合并现有 wg0 静态路由。
3. 若设备列表、LAN 网段、wg0 隧道地址或客户端公钥发生变化，必须重新执行本模块并覆盖旧结果与 JSON 文件。

## 规则

1. 未确认设备 ID 列表时，不允许继续。
2. LAN 冲突未消除前，不允许进入服务端或客户端配置。
3. 不允许绕过 `clawwrt_plan_wireguard_client_routes` 手工拼装路由。
4. 不允许使用过期的 LAN 规划结果。
5. wg0 隧道地址未从 `openclaw_get_wg_status` 中确认前，不允许输出本模块结果。
6. 任一步失败即停止，报告失败步骤、API 名称和错误原文。
