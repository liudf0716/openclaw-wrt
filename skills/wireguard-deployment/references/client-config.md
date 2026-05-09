# 配置 WireGuard 客户端

## 适用场景

用户想在“已执行重置所有”之后，把一组路由器重新接入新的 WireGuard VPN 时，使用本模块。

本模块不支持把单个新路由器增量加入已有 WG VPN 网络，也不支持在保留现有配置的前提下只修改部分客户端路由。
若目标设备列表、LAN 网段、tunnelIp 或服务端 peer 配置有任何变化，必须先执行 `references/reset.md` 的“重置所有”，再重新走完整配置流程。

## 固定入口

推荐顺序：

1. `openclaw_get_wg_status`
2. `clawwrt_list_devices`
3. 若当前轮次刚完成服务端部署，优先使用部署结果中返回的 `serverPubKey`；仅在未持有该结果时，再调用 `openclaw_get_wg_server_public_key`

## 服务端 endpoint 确认

在任何客户端配置下发前，必须先确认服务端公网 IP 或域名以及 WireGuard 监听 UDP 端口；如果无法确认，立即停止流程，不允许继续：

1. 优先使用 `references/server-deploy.md` 中记录的服务端公网 IP 或域名与监听端口。
2. 若当前没有可用的 endpoint 记录，立即停止并要求用户提供准确的公网 IP 或域名及端口。
3. 向用户明确提示：云服务安全组/防火墙必须放行该 UDP 端口，否则客户端即使配置成功也可能无法握手。
4. 若用户提供了多个候选地址，只允许在用户明确确认后继续，不允许自行猜测或自动切换。
5. 在用户明确确认之前，不允许进入服务端公钥获取、设备确认或任何 `clawwrt_*` 配置调用。

## 设备确认

1. 展示当前在线设备清单。
2. 允许用户按设备 ID 或设备名称选择要加入当前 WG VPN 的设备。
3. 若用户按设备名称选择，先基于 `clawwrt_list_devices` 结果解析成明确的设备 ID 列表，再继续后续流程。
4. 要求用户明确确认“最终要加入当前 WG VPN 的设备 ID 列表”。
5. 若用户未确认或确认列表为空：停止流程。
6. 确认当前方案中每台待接入设备都已有明确的 `tunnelIp` 分配结果；若缺失，立即停止并要求先补齐。
7. 若当前上下文里没有刚部署成功时返回的 `serverPubKey`，调用 `openclaw_get_wg_server_public_key` 明确拿到服务端 public key；若读取失败，先处理服务端部署或重置问题。
8. 使用已确认的服务端公网 IP 或域名、UDP 端口、服务端 public key，以及每台设备的 `tunnelIp` 分配结果，再继续后续客户端配置。

## 前置依赖：LAN 网段采集、密钥生成与路由规划

在开始客户端配置前，必须先完成 `references/lan-collection.md`。

1. 本模块只消费 `references/lan-collection.md` 的输出结果，其中包含每台待接入设备的 `peerPublicKey` 和 `routePlans`。
2. 若结果缺失、过期或与当前设备列表不一致：立即停止并要求先重跑 `references/lan-collection.md`。
3. `references/lan-collection.md` 不会生成每台设备的 `tunnelIp`；客户端地址配置所需的 `tunnelIp` 必须来自独立的分配或确认结果。
4. `clawwrt_generate_wireguard_keys` 已在设备本地写入 `network.wg0.private_key`；本模块后续默认只使用该阶段返回的公钥，不再重复下发私钥。

## 路由规则来源

1. `clawwrt_collect_wireguard_protected_routes` 生成的 JSON 文件是客户端路由规则的唯一输入来源。
2. 若用户中途增删设备或修改 LAN 网段，必须先重新执行 `references/lan-collection.md`，再继续本模块。

## 逐设备执行

仅对用户明确确认的设备，按顺序执行：

1. 调用 `clawwrt_set_wireguard_vpn`，参数组装规则：
   - `deviceId`: 当前设备 ID
   - `interface`: 默认只下发地址、端口、MTU 等必要字段，不传 `privateKey`
   - `interface.addresses`: 直接使用当前设备已确认的 `tunnelIp`
     示例：已确认 `tunnelIp = 10.0.0.2/32` → 填入 `["10.0.0.2/32"]`
   - `peers[0].publicKey`: 服务端公钥（来自 `openclaw_get_wg_server_public_key`）
   - `peers[0].endpointHost`: 服务端公网 IP 或域名
   - `peers[0].endpointPort`: 服务端 WireGuard UDP 端口
   - `peers[0].allowedIps`: `["0.0.0.0/0"]`
   - `peers[0].persistentKeepalive`: `25`
   - `peers[0].routeAllowedIps`: `false`（路由由后续 `clawwrt_set_vpn_routes` 管理）
2. 使用 `clawwrt_collect_wireguard_protected_routes` 返回的 `routePlanFile` 调用 `clawwrt_set_vpn_routes`，不要手工拼装 routes；标准流程下不要手工传 `requestedRoutes`
3. 客户端配置批量完成后，优先统一进入 `references/verify.md`；只有用户明确要求查看单台即时状态时，才补充 `clawwrt_get_wireguard_vpn_status`

## 参数约束

`clawwrt_set_wireguard_vpn` 的关键参数约束由代码强制处理，这里只保留调用前提：必须先拿到服务端 public key、目标设备已确认的 `tunnelIp` 和当前规划结果。标准流程下不要传 `privateKey`；若日志中出现 `privateKey=GENERATED_ON_DEVICE` 之类占位值，应视为上层调用错误并修正。标准流程下客户端 peer `allowedIps` 固定为 `["0.0.0.0/0"]`，实际受保护网段完全以 `clawwrt_set_vpn_routes` 为准。

## 规则
本模块遵循 SKILL.md 通用规则。以下为本模块特有约束：

1. 未完成 `references/lan-collection.md` 前，不允许直接下发客户端配置。
2. 若 `references/lan-collection.md` 仍存在 LAN 冲突，本模块不得继续执行 `clawwrt_set_wireguard_vpn` 或 `clawwrt_set_vpn_routes`。
3. 发现 LAN 冲突后，不允许退回任何“旧流程”绕过冲突检查。
4. 未确认每台目标设备的 `tunnelIp` 前，不允许下发客户端 `interface.addresses`。
5. 标准流程下，不允许把私钥或私钥占位字符串作为 `clawwrt_set_wireguard_vpn.interface.privateKey` 传入；私钥应仅在 `clawwrt_generate_wireguard_keys` 阶段由设备本地生成和保存。
6. 不支持把单个新设备增量加入已有 WG VPN 网络；若用户提出此类请求，必须先建议执行“重置所有”，再以新的完整设备列表重新配置。
