---
name: wireguard-deployment
description: 龙虾WiFi WireGuard VPN 组网部署指南。涵盖 VPS 服务端部署、路由器客户端配置、peer 管理、NAT/转发、路由策略及状态验证。路由器侧操作由 clawwrt 工具集完成。
user-invocable: true
---

# WireGuard VPN 组网部署指南

本技能仅用于编排 API 调用，不让 LLM 自主“实现”组网逻辑。

## 核心原则

1. 仅调用现有 API 接口，不使用 shell。
2. 每一步都基于接口返回结果决定下一步。
3. 任一步失败且无明确恢复路径：立即停止，告知用户错误原因，等待用户决策。
4. 不擅自补参数，不猜测网络状态，不跳步。

## 严格限制：禁止未授权 shell

1. 禁止为组网流程调用 shell 接口。
2. 如用户明确要求执行 shell 命令，必须先展示完整命令并获得用户明确同意后再执行。
3. 只要存在专用 API，就必须使用专用 API。

## 执行入口（固定）

收到任何 WireGuard 相关请求后，先并行调用：

1. `openclaw_get_wg_status`
2. `clawwrt_list_devices`

判定规则：

1. 若在线设备数为 0：停止并提示用户先让设备上线。
2. 若服务端未安装或未运行：进入“服务端部署”步骤。
3. 其余情况：先进入“设备选择确认”步骤，再进入“客户端接入”步骤。

## 设备选择确认（必须）

1. 先调用 `clawwrt_list_devices` 获取当前在线设备。
2. 向用户展示在线设备清单，要求用户明确确认“要加入当前 WG VPN 的设备ID列表”。
3. 仅允许处理用户确认的设备，不允许默认将所有在线设备自动加入。
4. 若用户未确认或确认列表为空：停止流程并提示用户先选择设备。
5. 多设备场景下，按用户确认列表顺序逐台执行，不得擅自增减设备。

## 标准流程（API 状态机）

### A. 服务端部署（按需）

1. 调用 `openclaw_deploy_wg_server`。
2. 若失败：停止，向用户报告失败原因。
3. 若成功：记录并使用返回的服务端公钥，进入下一步。

### B. 客户端接入（逐设备）

仅对“设备选择确认”步骤中用户明确确认的设备，按顺序执行：

1. `clawwrt_generate_wireguard_keys`
2. `openclaw_add_wg_peer`
3. `clawwrt_set_wireguard_vpn`
4. `clawwrt_set_vpn_routes` 或 `clawwrt_set_vpn_domain_routes`
5. `clawwrt_get_wireguard_vpn_status`

`clawwrt_set_wireguard_vpn` 参数约束（固定策略）：

1. `peer.allowedIps` 必须为 `["0.0.0.0/0"]`。
2. `peer.routeAllowedIps` 必须为 `false`（即 `route_allowed_ips=0`）。
3. 通过 `clawwrt_set_vpn_routes` / `clawwrt_set_vpn_domain_routes` 决定哪些流量走 `wg0`。

规则：

1. 任一步失败即停止该设备流程，报告错误。
2. 不允许跳过失败步骤继续后续步骤。
3. 不允许在未获用户确认的情况下新增设备到 WG VPN。

### C. 多设备 LAN 互通（在线设备 >= 2）

1. 先调用 `clawwrt_check_lan_conflict`。
2. 若 `hasConflict=false`：调用 `clawwrt_join_wireguard_lan_mesh`。
3. 若 `hasConflict=true`：
   1. 提示冲突详情。
   2. 询问用户是否修改 LAN。
   3. 用户确认后调用 `clawwrt_set_br_lan`。
   4. 再次回到 `clawwrt_check_lan_conflict`。
4. 若任一 API 失败且无恢复路径：停止并交由用户决策。

### D. 最终验证

1. 调用 `clawwrt_verify_wireguard_connectivity`。
2. 若失败或结果异常：停止并报告问题，不做未定义修复动作。

## 错误处理（统一）

每次错误必须输出以下信息：

1. 失败步骤名。
2. 调用的 API 名称。
3. 错误原文或关键字段。
4. 已完成步骤与未执行步骤。
5. 建议用户选择：重试、回滚、或人工介入。

## 可选回滚（仅用户明确要求时）

1. `openclaw_reset_wg_server`
2. `clawwrt_reset_wireguard_vpn`

未收到用户明确回滚指令时，不自动回滚。

