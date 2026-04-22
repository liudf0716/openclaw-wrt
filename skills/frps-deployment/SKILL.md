---
name: intranet-penetration-deployment
description: VPS 侧内网穿透服务端部署指南。涵盖服务端安装、端口配置及在宿主机上的部署。
user-invocable: true
---

# 内网穿透服务端部署指南

在 **OpenClaw VPS 宿主机**上部署并运行内网穿透服务端，以便为连接的 龙虾WiFi 路由器实现内网穿透。

## 推荐工作流 (端到端)

按照以下步骤设置完整的内网穿透方案：

### 阶段 1：服务端部署 (VPS 侧)

1.  **检查与安装**：
    - 检查宿主机是否已安装内网穿透服务端（`frps`）。
    - **如果未安装**：
        - 下载适用于当前架构（如 linux_amd64）的最新安装包。
        - 将 `frps` 可执行文件安装到 `/usr/bin/` 目录。
        - 创建 `systemd` 服务文件（例如 `/etc/systemd/system/frps.service`）以实现开机自启动：
          ```ini
          [Unit]
          Description=Intrant Penetration Server
          After=network.target

          [Service]
          Type=simple
          ExecStart=/usr/bin/frps -c /etc/frp/frps.toml
          Restart=on-failure

          [Install]
          WantedBy=multi-user.target
          ```
        - 启动服务并设置自启动：`systemctl enable --now frps`。
    - **如果已安装但未运行**：
        - 检查服务状态并启动：`systemctl start frps`。

2.  **配置告知**：
    - 将服务端的 `监听端口`、`Token` 以及 `VPS 公网 IP` 告知用户。

3.  **连接确认**：
    - 使用 `netstat -tunlp` 或 `ss -tunlp` 验证服务端是否正在正确的端口上监听。

### 阶段 2：客户端配置 (路由器侧)

1.  **连接设置**：
    - 调用 `clawwrt_set_xfrpc_common` 配置路由器的连接参数。
2.  **服务添加**：
    - 使用 `clawwrt_add_xfrpc_tcp_service` 创建所需的映射（例如 SSH 22 -> 远程 6000）。
3.  **运行检查**：
    - **必须检查** 客户端（xfrpc）是否正常启动并成功连接。可以通过 `clawwrt_get_xfrpc_config` 或查看系统日志确认。

### 阶段 3：最终功能验证

1.  **端口监听验证**：
    - **核心验证步骤**：在 VPS 宿主机上检查对应的 `远程端口`（如 TCP 6000）是否已进入 `LISTEN` 状态。
    - 如果端口未监听，说明客户端连接失败或配置有误。
2.  **连通性测试**：
    - 尝试通过 `VPS_IP:远程端口` 进行连接测试（如 `ssh -p 6000 user@VPS_IP`）。

## 工具参考

| 工具 | 用途 |
|------|---------|
| `openclaw_deploy_frps` | 在 VPS 上安装、配置并启动服务端（支持二进制安装与 systemd）。 |
| `openclaw_get_frps_status` | 检查服务端运行状态、配置文件及监听端口。 |
| `clawwrt_get_xfrpc_config` | 读取并检查路由器侧的客户端运行状态。 |
| `clawwrt_set_xfrpc_common` | 配置客户端连接。 |
| `clawwrt_add_xfrpc_tcp_service` | 添加端口映射服务。 |

## 使用示例 (Suggested Prompts)

- **自动部署**: "我的 VPS 还没装内网穿透服务端，请帮我下载最新版安装到 /usr/bin/，配置好 systemd 自启动。然后把 101 房间路由器的 SSH 映射到 6022 端口，并确认端口是否已经在 VPS 上监听了。"
- **状态自检**: "检查一下现在的内网穿透服务是否正常？包括服务端进程、客户端连接，以及公网端口是否已经开启监听。"

> **⚠️ 防火墙提醒**: 务必引导用户开启 VPS 的相应 UDP/TCP 端口防火墙。
