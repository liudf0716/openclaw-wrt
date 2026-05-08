# 配置 WireGuard 客户端

## 适用场景

用户想把一个或多个路由器接入当前 WireGuard VPN，或修改客户端 VPN 路由策略时，使用本模块。

## 固定入口

并行调用：

1. `openclaw_get_wg_status`
2. `clawwrt_list_devices`
3. `openclaw_get_wg_server_public_key`

## 服务端 endpoint 确认

在任何客户端配置下发前，必须先确认服务端公网 IP 或域名以及 WireGuard 监听 UDP 端口；如果无法确认，立即停止流程，不允许继续：

1. 优先使用 `references/server-deploy.md` 中记录的服务端公网 IP 或域名与监听端口。
2. 若当前没有可用的 endpoint 记录，立即停止并要求用户提供准确的公网 IP 或域名及端口。
3. 向用户明确提示：云服务安全组/防火墙必须放行该 UDP 端口，否则客户端即使配置成功也可能无法握手。
4. 若用户提供了多个候选地址，只允许在用户明确确认后继续，不允许自行猜测或自动切换。
5. 在用户明确确认之前，不允许进入设备确认、密钥获取或任何 `clawwrt_*` 配置调用。

## 设备确认

1. 展示当前在线设备清单。
2. 允许用户按设备 ID 或设备名称选择要加入当前 WG VPN 的设备。
3. 若用户按设备名称选择，先基于 `clawwrt_list_devices` 结果解析成明确的设备 ID 列表，再继续后续流程。
4. 要求用户明确确认“最终要加入当前 WG VPN 的设备 ID 列表”。
5. 若用户未确认或确认列表为空：停止流程。
6. 使用 `openclaw_get_wg_server_public_key` 明确拿到服务端 public key；若读取失败，先处理服务端部署或重置问题。
7. 使用已确认的服务端公网 IP 或域名与 UDP 端口，再继续后续客户端配置。

## 前置依赖：LAN 网段采集、密钥生成与路由规划

在开始客户端配置前，必须先完成 `references/lan-collection.md`。

1. 本模块只消费 `references/lan-collection.md` 的输出结果，其中包含每台待接入设备的 `peerPublicKey` 和 `routePlans`。
2. 若结果缺失、过期或与当前设备列表不一致：立即停止并要求先重跑 `references/lan-collection.md`。

## 路由规则来源

1. `clawwrt_collect_wireguard_protected_routes` 生成的 JSON 文件是客户端路由规则的唯一输入来源。
2. 若用户中途增删设备或修改 LAN 网段，必须先重新执行 `references/lan-collection.md`，再继续本模块。

## 逐设备执行

仅对用户明确确认的设备，按顺序执行：

1. 使用 `references/lan-collection.md` 输出中当前设备对应的 `peerPublicKey` 和 `openclaw_get_wg_server_public_key` 的服务端 public key 调用 `clawwrt_set_wireguard_vpn`
2. 使用 `clawwrt_collect_wireguard_protected_routes` 返回的 `routePlanFile` 调用 `clawwrt_set_vpn_routes`，不要手工拼装 routes
3. `clawwrt_get_wireguard_vpn_status`

## 参数约束

`clawwrt_set_wireguard_vpn` 的关键参数约束由代码强制处理，这里只保留调用前提：必须先拿到服务端 public key、目标设备公钥和当前规划结果。

## 规则
本模块遵循 SKILL.md 通用规则。以下为本模块特有约束：

1. 未完成 `references/lan-collection.md` 前，不允许直接下发客户端配置。
2. 若 `references/lan-collection.md` 仍存在 LAN 冲突，本模块不得继续执行 `clawwrt_set_wireguard_vpn` 或 `clawwrt_set_vpn_routes`。
3. 发现 LAN 冲突后，不允许退回任何“旧流程”绕过冲突检查。

## 扩展说明

若用户明确要求 LAN mesh 互通，先按场景选择路径：

1. 单设备增量加入已有 mesh：
   1. 先完成 `references/lan-collection.md`
   2. 若需要对新设备做局部预检，可先调用 `clawwrt_check_lan_conflict`；但当 `references/lan-collection.md` 已返回冲突结果时，以该结果为准，不再把 `check_lan_conflict` 当作独立主流程
   3. 确认 `hasConflict=false` 后，调用 `clawwrt_join_wireguard_lan_mesh`
2. 多设备批量重建 / 重新编排 mesh：
   1. 先完成 `references/lan-collection.md`
   2. 直接调用 `clawwrt_reconcile_wireguard_lan_mesh`
   3. 该路径用于一次性处理多台设备的 mesh 关系，不再逐台走 `join`
