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

## 前置依赖：LAN 网段采集与路由规划

在开始客户端配置前，必须先完成 `references/lan-collection.md`。

1. 本模块不再负责 LAN 网段采集与冲突检查。
2. 本模块只消费 `references/lan-collection.md` 的输出结果。
3. 若发现 LAN 规划结果缺失、过期或与当前设备列表不一致：立即停止并要求先重跑 `references/lan-collection.md`。

## 路由规则来源

1. `clawwrt_set_vpn_routes.routes` 必须直接使用 `references/lan-collection.md` 输出中的 `routePlans`。
2. 不允许在本模块手工二次计算路由网段，避免与规划结果不一致。
3. 若用户中途增删设备或修改 LAN 网段，必须先重新执行 `references/lan-collection.md`，再继续本模块。

## 逐设备执行

仅对用户明确确认的设备，按顺序执行：

1. `clawwrt_generate_wireguard_keys`
2. `openclaw_add_wg_peer`
3. `clawwrt_set_wireguard_vpn`
4. 使用 `references/lan-collection.md` 输出中当前设备对应的 `routePlans.routes` 调用 `clawwrt_set_vpn_routes`
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
4. 未完成 `references/lan-collection.md` 前，不允许直接下发客户端配置。
5. 若 `references/lan-collection.md` 仍存在 LAN 冲突，本模块不得继续执行 `clawwrt_set_wireguard_vpn` 或 `clawwrt_set_vpn_routes`。
6. `clawwrt_set_vpn_routes` 必须与 `references/lan-collection.md` 输出的 `routePlans` 保持一致，不允许模型擅自增删网段。
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
