# 配置 WireGuard 客户端

## 适用场景

用户想把一个或多个路由器接入当前 WireGuard VPN，或修改客户端 VPN 路由策略时，使用本模块。

## 固定入口

并行调用：

1. `openclaw_get_wg_status`
2. `clawwrt_list_devices`

## 设备确认

1. 展示当前在线设备清单。
2. 允许用户按设备 ID 或设备名称选择要加入当前 WG VPN 的设备。
3. 若用户按设备名称选择，先基于 `clawwrt_list_devices` 结果解析成明确的设备 ID 列表，再继续后续流程。
4. 要求用户明确确认“最终要加入当前 WG VPN 的设备 ID 列表”。
5. 若用户未确认或确认列表为空：停止流程。

## LAN 网段采集与冲突检查

在开始客户端配置前，必须先处理所选设备的 LAN 网段信息。

1. 优先调用 `clawwrt_plan_wireguard_client_routes`，并将用户确认的设备 ID 列表作为输入。
2. 该 API 必须统一完成以下动作：
   1. 获取所有已选设备的 `br-lan` CIDR
   2. 检查所选设备之间是否存在 LAN 网段冲突
   3. 在无冲突时，计算每台设备应下发的 `clawwrt_set_vpn_routes.routes`
3. 将 API 返回的 LAN 网段信息整理后展示给用户，至少包含：
   1. 设备 ID
   2. 设备名称（若 `clawwrt_list_devices` 可提供）
   3. `br-lan` CIDR
4. 若 `clawwrt_plan_wireguard_client_routes` 返回存在 LAN 冲突：
   1. 立即停止客户端配置流程
   2. 明确列出哪些 WiFi 设备存在 LAN 网段冲突
   3. 明确告知当前不能继续后续客户端配置
   4. 要求用户先解决冲突，解决方案仅限：
      1. 剔除掉有冲突的 WiFi 设备
      2. 修改有冲突 WiFi 设备的 LAN 网段，调用 `clawwrt_set_br_lan`
5. 若 API 返回无冲突，才允许进入后续客户端接入与路由配置步骤
6. 用户调整完设备列表或修改完 LAN 网段后，必须再次调用 `clawwrt_plan_wireguard_client_routes` 重新检查冲突。
7. 只要仍然存在冲突，就继续停止在本步骤，循环执行“展示冲突 -> 用户解决 -> 再次检查”，直到无冲突后才进入后续流程。

## 路由规则网段计算

在无 LAN 冲突的前提下，优先使用 `clawwrt_plan_wireguard_client_routes` 返回的 `routePlans` 作为 `clawwrt_set_vpn_routes` 的输入来源。

1. 计算原则：
   1. 当前设备应下发的路由规则网段 = 所有已选设备的 LAN 网段集合 - 当前设备自己的 LAN 网段
2. 也就是说：
   1. 设备 A 的 `routes` = 设备 B、设备 C、设备 D ... 的 LAN CIDR
   2. 不包含设备 A 自己的 LAN CIDR
3. 计算完成后，先将每台设备对应的目标路由网段展示给用户，再继续配置。
4. 除非 API 不可用，否则不要让模型手工再次计算一遍，避免与工具结果不一致。

## 逐设备执行

仅对用户明确确认的设备，按顺序执行：

1. `clawwrt_generate_wireguard_keys`
2. `openclaw_add_wg_peer`
3. `clawwrt_set_wireguard_vpn`
4. 使用 `clawwrt_plan_wireguard_client_routes.routePlans` 中当前设备对应的 `routes` 调用 `clawwrt_set_vpn_routes`
5. `clawwrt_get_wireguard_vpn_status`

## 参数约束

`clawwrt_set_wireguard_vpn` 必须满足：

1. `peer.allowedIps` 为 `["0.0.0.0/0"]`
2. `peer.routeAllowedIps` 为 `false`
3. 通过 `clawwrt_set_vpn_routes` 或 `clawwrt_set_vpn_domain_routes` 决定实际走 `wg0` 的流量

## 规则

1. 任一步失败即停止当前设备流程。
2. 不允许跳过失败步骤继续后续步骤。
3. 不允许擅自新增未确认设备。
4. 未完成 `clawwrt_plan_wireguard_client_routes` 或等价的 LAN 采集与冲突检查前，不允许直接下发客户端配置。
5. 存在 LAN 冲突时，不允许继续执行 `clawwrt_set_wireguard_vpn` 或 `clawwrt_set_vpn_routes`。
6. `clawwrt_set_vpn_routes` 必须与 `clawwrt_plan_wireguard_client_routes` 返回的 `routes` 保持一致，不允许模型擅自增删网段。
7. 本模块默认只做客户端接入与基于已选设备 LAN 网段的路由策略，不自动处理更广义的多设备 LAN mesh。
8. 发现 LAN 冲突后，不允许退回任何“旧流程”绕过冲突检查。

## 扩展说明

若用户明确要求多设备 LAN 互通，再追加以下流程：

1. `clawwrt_check_lan_conflict`
2. 若 `hasConflict=false`：调用 `clawwrt_join_wireguard_lan_mesh`
3. 若 `hasConflict=true`：
   1. 提示冲突详情
   2. 询问用户是否修改 LAN
   3. 用户确认后调用 `clawwrt_set_br_lan`
   4. 再次执行 `clawwrt_check_lan_conflict`
