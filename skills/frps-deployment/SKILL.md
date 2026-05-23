---
name: frps-deployment
description: 内网穿透端到端配置指南。涵盖 VPS 侧服务端部署、路由器侧客户端配置、连通性验证的完整工作流。用户说"内网穿透"、"穿透"、"映射端口"、"远程访问路由器"等均触发此 skill。
user-invocable: true
---

# 内网穿透部署指南

本技能用于把 VPS 侧服务端、路由器侧客户端和最终验证串成一个完整流程。

## 默认流程

1. 先读 `references/status.md`，获取服务端状态和已存在的客户端配置。
2. 服务端未安装、未运行或 token 为空时，读 `references/server-deploy.md`。
3. 需要配置路由器时，读 `references/client-deploy.md`。
4. 配置完成后，读 `references/verify.md`。

## 重置入口

当用户明确要求清理、卸载、重置或重新开始已有配置时，直接读 `references/reset.md`。

## 约定

1. 状态盘点优先使用 `openclaw_frps_full_status`；需要拆分排查时再回退到 `openclaw_get_frps_status`、`openclaw_get_vps_public_ip` 和路由器侧查询工具。
2. `openclaw_deploy_frps` 可自动生成 token；只有用户明确提供 token 时才使用用户值。
3. `clawwrt_set_xfrpc_common` 会直接从 chawrtd 读取服务端地址、端口和认证密钥；不要再向用户追问这三个值，工具层仍会拒绝显然不可用的服务端地址。
4. `clawwrt_add_xfrpc_tcp_service` 负责 `remote_port` 的范围检查，以及同设备远端端口冲突检查。
5. `openclaw_verify_frps` 只做监听检查；监听出现后仍要引导用户做实际访问测试。
6. 对用户输出时，优先使用“内网穿透服务端”“内网穿透客户端”“认证密钥”等表述。
