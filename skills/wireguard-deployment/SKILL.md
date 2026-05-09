---
name: wireguard-deployment
description: 龙虾WiFi WireGuard VPN 意图驱动自动组网指南。普通用户只需表达“要进行 WG VPN 组网”，系统即进入自动流程；高级用户可按模块单独执行。
user-invocable: true
---

# WireGuard VPN 意图驱动组网指南

本技能仅用于编排现有 API，不让 LLM 自主实现 WireGuard 逻辑。

目标：降低普通用户使用门槛。用户不需要理解 WireGuard 专业细节，只要表达“我要组网”意图，即进入自动组网流程。

当前版本只支持一种场景：重置现有 WG VPN 配置后，重新完整配置服务端和全部目标客户端。
不支持把单个新客户端增量加入已有 WG VPN 网络，也不支持在保留现有配置的前提下局部改动 peer、路由或 LAN mesh。
只要目标设备列表、LAN 网段、peer 公钥、tunnelIp 或服务端配置发生变化，都必须先执行“重置所有”，再从头重建。

## 使用原则

1. 普通用户默认进入“自动组网主流程”；仅当用户明确说“只查看状态/只重置/只配客户端”等，才进入单模块模式。
2. 每一步都基于接口返回结果决定下一步，不猜测网络状态。
3. 若存在可一次完成“采集 + 校验 + 规划”的聚合型 API，优先使用该 API，不要手工拆成多次推导流程。
4. 功能与 API 一一对应：当已有专用 API 能满足目标时，必须调用该 API，不允许用其他接口或自然语言推断替代其职责。
5. 当前 skill 不提供“增量接入已有网络”路径；任何配置变更都按“整体重置后重建”处理。

## 通用规则

1. 仅调用现有 API 接口，不使用 shell。
2. 任一步失败且无明确恢复路径时，立即停止并报告错误，等待用户决策。
3. 不擅自补参数；涉及重置、覆盖配置、批量操作时必须二次确认。
4. 设备 ID、LAN 冲突、路由规划结果等关键前置条件未确认时，不得继续进入后续步骤。
5. 只要存在专用 API，就必须使用专用 API；如用户明确要求执行 shell 命令，必须先展示完整命令并获得用户明确同意后再执行。

## 禁止事项

1. 本技能的 shell、失败停止、确认前置等通用禁止约束统一以“通用规则”为准，不在各 reference 中重复展开。

## 默认入口：自动组网主流程（普通用户）

当用户表达以下意图时，直接进入自动流程：

1. “我要配置 WireGuard 组网”
2. “帮我把几台路由器互通”
3. “我要搭建 WG VPN 内网”

自动流程固定为 8 步：

1. 调用 `openclaw_get_wg_status` 检查 VPS 是否已安装 WG 及当前运行状态。
	- 若返回 `not_installed`：告知用户当前未安装，后续步骤 4（服务端部署）会自动安装。
	- 若返回 `success`：仅记录当前服务端运行状态与原始 peer 运行信息；不要把它当作结构化 `wg0` 地址或各客户端 tunnel IP 的可靠来源。
2. 若 WG 正常运行：询问用户意图：
	- "重置并重新组网" → 执行 `references/reset.md` 中的“重置所有”，完成后继续步骤 3
	- "只查看当前状态" → 执行 `references/status.md`，完成后结束
	- 任何“新增一台设备”“给已有网络补一台客户端”“只改一部分路由”等请求 → 明确告知当前 skill 不支持增量修改，需先执行“重置所有”再重建
3. 执行 `references/lan-collection.md`：
	a. 调用 `clawwrt_collect_wireguard_protected_routes` 收集 LAN 网段并生成路由规划文件
	b. 逐台调用 `clawwrt_generate_wireguard_keys` 生成密钥对
	c. 若返回 `hasConflict=true` 或存在 `blockedDeviceIds`，立即停止，先解决冲突再继续
4. 为每台目标设备确认唯一的 WireGuard `tunnelIp` 分配结果（统一按 `10.0.0.x/32` 记录，例如 `10.0.0.2/32`、`10.0.0.3/32`）；未形成完整的 `deviceId + peerPublicKey + tunnelIp + lanCidr` 前，不得进入服务端部署。
5. 执行 WG 服务端配置，使用第 3 步与第 4 步共同形成的完整 `peerBindings`。
6. 服务端配置成功后，优先直接记录 `openclaw_deploy_wg_server` 返回的 `serverPubKey`、端口和 `tunnelIp`；再调用 `openclaw_get_vps_public_ip` 获取并记录 VPS 公网 IP。若自动获取失败，再进入客户端配置前向用户确认公网 IP 或域名。
7. 执行 WG 客户端配置：
	- `clawwrt_set_wireguard_vpn` 中客户端 peer 的 `allowedIps` 固定传 `["0.0.0.0/0"]`
	- `routeAllowedIps` 固定传 `false`
	- 受保护网段、跨 LAN 互通范围、WG tunnel 子网路由一律由 `clawwrt_set_vpn_routes` 控制
	- 当前流程只支持“本轮确认的全部目标设备”一起重建，不支持在保留旧网络的前提下增量加入新设备
8. 验证 WG 网络连通性与路由生效情况。

说明：上述顺序是默认推荐顺序，合理且适合普通用户；相比“纯模块化”更符合自然对话和一键组网预期。

## 模块模式（高级用户）

当用户明确要求某个单项操作时，只读取对应 reference：

1. 查看当前 WG VPN 状况：读 `references/status.md`
2. 重置当前 WG VPN 配置：读 `references/reset.md`
3. 收集 LAN 网段与路由规划：读 `references/lan-collection.md`
4. 配置 VPS Host WireGuard 服务端：读 `references/server-deploy.md`
5. 配置 WireGuard 客户端：读 `references/client-config.md`
6. 验证当前 WG VPN 网络：读 `references/verify.md`

若用户一次提出多个目标，按用户表述顺序逐个执行，每完成一个模块再进入下一个模块。

## 自动流程关键输入规则

1. 涉及路由器时，先调用 `clawwrt_list_devices` 获取在线设备。
2. 涉及“新增/修改/重置客户端”的请求，必须让用户明确确认设备 ID 列表。
3. 未确认设备 ID 时，不允许默认操作所有在线设备。
4. 多设备场景下，按用户确认列表顺序逐台执行。
5. 第 3 步收集的 LAN 信息至少包含：设备 ID（或唯一标识）、LAN 网段（CIDR）和路由规划文件。
6. 若出现 LAN 网段冲突（例如两个客户端同网段），必须先提示冲突并要求用户调整后再继续。
7. 进入服务端部署前，必须为每台客户端明确 `tunnelIp`；`clawwrt_collect_wireguard_protected_routes` 不会生成该字段，不能把 LAN 采集结果误当成完整 `peerBindings`。
8. 服务端 peer AllowedIPs 需包含客户端 `tunnelIp` 与 LAN 网段；客户端 peer `allowedIps` 在标准流程下固定为 `["0.0.0.0/0"]`，客户端路由规则需与对应对端 LAN 网段一致，并统一由 `clawwrt_set_vpn_routes` 控制；客户端公钥必须在服务端配置前由前置采集阶段生成并回填。
9. 若验证阶段发现服务端私钥/公钥不匹配，或任一客户端私钥推导公钥与服务端 peer 公钥不匹配，或客户端配置中的服务端公钥与 VPS 实际服务端公钥不匹配，则视为“密钥体系已失配”，不得只做局部修补，必须执行“服务端 + 全部目标客户端”整体重置后从头重配。
10. 标准客户端接入流程中，`clawwrt_generate_wireguard_keys` 已负责把私钥写入设备本地；后续调用 `clawwrt_set_wireguard_vpn` 时默认不应再传 `privateKey`，更不允许把 `GENERATED_ON_DEVICE` 之类占位字符串当作真实私钥下发。
11. 任何设备增删、LAN 网段调整、peer 变更、路由变更或 tunnelIp 变更，都视为“需要整体重建”的变更类型；不得保留旧 WG 网络做增量补配。

## 自动流程交互要求

1. 交互用语优先非专业表达，例如“是否清空并重建当前组网配置”，避免直接抛出过多 WG 术语。
2. 每步完成后给出简短结果和下一步动作。
3. 在“重置配置”前，明确提示影响范围：服务端 + 已接入客户端。
4. 在“开始配置”前，给用户一次总确认：目标设备、LAN 网段、是否执行“重置所有”。
5. 验证阶段至少覆盖：服务端基础状态、客户端隧道状态、跨 LAN 互通结果；若要做 VPS -> 客户端 ping，必须使用事先记录好的客户端 tunnel IP。
6. 若验证阶段发现密钥不匹配，必须明确告知用户“当前配置应整体作废并重建”，下一步默认建议为执行 `references/reset.md` 中的“重置所有”，然后重新走主流程。

## 推荐执行形态

为减少模型轮次、重复查询和长会话风险，默认推荐以下执行形态：

1. `openclaw_get_wg_status` 与 `clawwrt_list_devices` 作为入口检查；如用户未确认设备列表，不继续后续步骤。
2. `clawwrt_collect_wireguard_protected_routes` 与逐台 `clawwrt_generate_wireguard_keys` 可以在同一阶段连续完成，但必须先检查采集结果中的冲突与阻塞设备。
3. 服务端刚部署成功时，优先复用 `openclaw_deploy_wg_server` 的返回结果中的 `serverPubKey`、端口和服务端 `tunnelIp`，不要立即重复查询同一信息。
4. 只有在“复用现有服务端”或“部署返回信息缺失”时，才调用 `openclaw_get_wg_server_public_key` 补取服务端公钥。
5. 客户端路由下发时，优先把 `routePlanFile` 直接交给 `clawwrt_set_vpn_routes`，不要手工拼装 `requestedRoutes`。
6. 当前 skill 不提供任何“增量加入已有网络”或“保留旧配置补路由”的快捷路径；只允许完整重建。
7. 批量流程完成后，优先执行一次聚合型 `clawwrt_verify_wireguard_connectivity`；除非用户明确要求逐台查看，否则不把逐台 `clawwrt_get_wireguard_vpn_status` 作为默认必经步骤。

## 共通错误输出

每次错误必须输出以下信息：

1. 失败模块。
2. 失败步骤名。
3. 调用的 API 名称。
4. 错误原文或关键字段。
5. 已完成步骤与未执行步骤。
6. 建议用户选择：重试、回滚、或人工介入。
