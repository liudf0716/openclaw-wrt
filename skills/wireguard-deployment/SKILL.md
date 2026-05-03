---
name: wireguard-deployment
description: 龙虾WiFi WireGuard VPN 模块化操作指南。用于按模块处理当前 WG VPN 状态查看、重置配置、VPS 服务端配置、路由器客户端配置与网络验证，避免不同流程互相影响。
user-invocable: true
---

# WireGuard VPN 模块化指南

本技能仅用于编排现有 API，不让 LLM 自主实现 WireGuard 逻辑。

## 使用原则

1. 仅调用现有 API 接口，不使用 shell。
2. 每个用户请求只进入一个主模块；不要把查询、重置、部署、验证混在同一流程里，除非用户明确要求串行执行。
3. 每一步都基于接口返回结果决定下一步。
4. 任一步失败且无明确恢复路径：立即停止，报告错误并等待用户决策。
5. 不擅自补参数，不猜测网络状态，不默认替用户选择设备。
6. 若存在可一次完成“采集 + 校验 + 规划”的聚合型 API，优先使用该 API，不要手工拆成多次推导流程。

## 禁止事项

1. 禁止为组网流程调用 shell 接口。
2. 如用户明确要求执行 shell 命令，必须先展示完整命令并获得用户明确同意后再执行。
3. 只要存在专用 API，就必须使用专用 API。

## 模块选择

根据用户意图，只读取对应 reference：

1. 查看当前 WG VPN 状况：读 `references/status.md`
2. 重置当前 WG VPN 配置：读 `references/reset.md`
3. 配置 VPS Host WireGuard 服务端：读 `references/server-deploy.md`
4. 配置 WireGuard 客户端：读 `references/client-config.md`
5. 验证当前 WG VPN 网络：读 `references/verify.md`

若用户一次提出多个目标，按用户表述顺序逐个执行，每完成一个模块再进入下一个模块。

## 共通输入规则

1. 涉及路由器时，先调用 `clawwrt_list_devices` 获取在线设备。
2. 涉及“新增/修改/重置客户端”的请求，必须让用户明确确认设备 ID 列表。
3. 未确认设备 ID 时，不允许默认操作所有在线设备。
4. 多设备场景下，按用户确认列表顺序逐台执行。

## 共通错误输出

每次错误必须输出以下信息：

1. 失败模块。
2. 失败步骤名。
3. 调用的 API 名称。
4. 错误原文或关键字段。
5. 已完成步骤与未执行步骤。
6. 建议用户选择：重试、回滚、或人工介入。
