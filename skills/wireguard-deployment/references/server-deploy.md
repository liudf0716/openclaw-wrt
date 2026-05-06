# 配置 VPS Host WG 服务端

## 适用场景

用户想在 VPS 上部署、重建或补配 WireGuard 服务端时，使用本模块。

## 固定入口

先调用：

1. `openclaw_get_wg_status`

## 执行流程

1. 先检查服务端是否已安装或已有运行中的 WireGuard 配置。
2. 在执行部署前，明确提示用户同步检查两侧防火墙放行规则：
   1. 云厂商运管平台或安全组需放行 WireGuard 监听端口对应的 UDP 入站流量
3. 若用户不确认云平台防火墙已放行，仍可继续部署，但要明确提醒“部署成功不等于外部一定可连通”。
4. 若用户要求新建或重建服务端：调用 `openclaw_deploy_wg_server`。
5. 若部署失败：立即停止并报告失败原因。
6. 若部署成功：
   1. 记录返回的服务端公钥、监听端口、隧道地址等关键信息。
   2. 明确告知该结果将用于后续客户端配置。
   3. 再次提醒用户核对：
      1. 运管平台/安全组是否已放行对应 UDP 端口
7. 若当前是自动组网流程，必须先完成 `references/lan-collection.md`，并将其中的 LAN 规划结果作为服务端 peer AllowedIPs 配置的唯一依据；未完成 LAN 采集前，不允许进入 `openclaw_deploy_wg_server`。
8. 若 `references/lan-collection.md` 已提供完整的节点绑定信息，则必须将其作为 `openclaw_deploy_wg_server.peerBindings` 一次性传入，由该 tool 直接生成完整的 `wg0.conf`，禁止在部署后再补写 peer 配置。

## 规则

1. 本模块只处理 VPS 服务端，不自动接入任何路由器客户端。
2. 不在本模块里调用客户端相关 API。
3. 若用户实际意图是“重新部署后马上给路由器接入”，完成本模块后再进入 `references/client-config.md`。
4. 本机防火墙放行由 `openclaw_deploy_wg_server` 负责处理，文档中只要求额外提醒用户检查云平台安全组/防火墙。
5. 若后续客户端无法握手，优先提醒用户排查“运管平台安全组/云防火墙”是否已放行对应 UDP 端口。
6. 当 `peerBindings` 已传入时，不要再把服务端 peer AllowedIPs 配置拆成第二阶段补写步骤。
7. 自动组网场景下，LAN 采集是强制前置条件，不是可选项；没有 `references/lan-collection.md` 的结果，就不能执行服务端部署。

## 成功输出

至少包含：

1. 服务端部署结果
2. 服务端公钥
3. 监听端口
4. 隧道网段或接口地址
5. 下一步建议：是否继续配置客户端
