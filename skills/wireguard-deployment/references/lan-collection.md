# 收集路由器 LAN 网段与路由规划

## 适用场景

当用户要把多台路由器加入 WireGuard 组网，且希望不同路由器下的 LAN 互通时，先执行本模块。

本模块是服务端与客户端配置的共同前置步骤：

1. 服务端侧需要这些 LAN 网段、服务端隧道网段以及每个客户端的 WireGuard 公钥，用于后续组装 `peerBindings`。
2. 客户端侧需要这些 LAN 网段、服务端隧道网段以及已生成的客户端密钥信息，用于生成保护路由 JSON 文件；`clawwrt_set_vpn_routes` 会从该文件读取路由，再合并现有 wg0 静态路由，不能遗漏本次规划出的 LAN 网段。

注意：AllowedIPs 和路由规则均为覆盖写入，漏掉服务端隧道网段会导致 VPN 隧道地址本身不可达；漏掉客户端公钥会导致服务端无法一次性完成 peerBindings。另一方面，本模块本身不会生成每台设备的 `tunnelIp`，因此完成本模块后仍需额外确认每台设备的 `tunnelIp` 分配结果，才能形成完整 `peerBindings`。

## 固定入口

并行调用：

1. `clawwrt_list_devices`
2. `openclaw_get_wg_status`（仅用于检查服务端是否已安装/运行，以及查看原始 peer 运行信息；不要把它当作结构化 `wg0` 地址来源）

## 执行流程

1. 展示当前在线设备清单。
2. 让用户确认要加入组网的设备 ID 列表。
3. 若用户按设备名称选择，先基于 `clawwrt_list_devices` 结果解析成明确设备 ID 后再继续。
4. 调用 `clawwrt_collect_wireguard_protected_routes`，输入用户确认的设备 ID 列表和服务端隧道 CIDR：
   - 若当前方案已有明确的服务端 `tunnelIp` / 隧道网段记录 → 使用该记录
   - 若当前为新部署且尚未另行指定 → 使用默认值 `10.0.0.1/24`（与 `openclaw_deploy_wg_server` 默认值一致）
   生成并保存保护路由 JSON 文件。
5. 按用户确认的设备 ID 顺序，逐台调用 `clawwrt_generate_wireguard_keys`，收集每台设备的 WireGuard 公钥。公钥字段优先取 `public_key`，若不存在则取 `publicKey` 或 `data.public_key`。
6. 读取并展示规划结果，至少包含：
   1. 设备 ID
   2. 设备名称（若可获取）
   3. `br-lan` CIDR
   4. 每台设备的 routePlans
   5. 保护路由 JSON 文件路径（后续 `clawwrt_set_vpn_routes` 直接消费）
   6. 每台设备对应的 WireGuard 公钥
   7. 明确提示：本模块尚未生成每台设备的 `tunnelIp`，后续仍需单独确认或分配
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

1. 服务端相关步骤使用各设备 LAN CIDR + 各 peer `tunnelIp` + 各 peer 公钥，共同组成 `openclaw_deploy_wg_server.peerBindings`；其中 `tunnelIp` 必须来自后续明确的分配或确认结果，不得假定本模块已经生成。
2. 客户端相关步骤使用本模块生成的保护路由 JSON 文件作为 `clawwrt_set_vpn_routes.routePlanFile` 输入，`clawwrt_set_vpn_routes` 会从该文件读取每台设备的路由，再合并现有 wg0 静态路由。
3. 若设备列表、LAN 网段、服务端隧道网段或客户端公钥发生变化，必须重新执行本模块并覆盖旧结果与 JSON 文件。

## 规则
本模块遵循 SKILL.md 通用规则。以下为本模块特有约束：

1. 不允许绕过 `clawwrt_collect_wireguard_protected_routes` 手工拼装路由。
2. 不允许使用过期的 LAN 规划结果。
3. 服务端隧道 CIDR 必须有明确来源（部署入参、既有记录或新部署默认值 `10.0.0.1/24`），不允许由 LLM 自行推测。
4. 每台客户端的 `tunnelIp` 必须在本模块完成后单独确认；没有 `tunnelIp`，不得声称已具备完整 `peerBindings`。
