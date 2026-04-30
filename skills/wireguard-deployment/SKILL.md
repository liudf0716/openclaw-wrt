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
3. 其余情况：进入“客户端接入”步骤。

## 标准流程（API 状态机）

### A. 服务端部署（按需）

1. 调用 `openclaw_deploy_wg_server`。
2. 若失败：停止，向用户报告失败原因。
3. 若成功：记录并使用返回的服务端公钥，进入下一步。

### B. 客户端接入（逐设备）

对每个目标设备按顺序执行：

1. `clawwrt_generate_wireguard_keys`
2. `openclaw_add_wg_peer`
3. `clawwrt_set_wireguard_vpn`
4. `clawwrt_set_vpn_routes` 或 `clawwrt_set_vpn_domain_routes`
5. `clawwrt_get_wireguard_vpn_status`

规则：

1. 任一步失败即停止该设备流程，报告错误。
2. 不允许跳过失败步骤继续后续步骤。

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

