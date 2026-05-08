# 验证 WG VPN 连通性

## 适用场景

用户想验证 WireGuard VPN 隧道是否真正可用（端到端能通），使用本模块。

若用户只想查看配置状态或握手信息，应使用 `references/status.md`。

## 固定入口

调用 `clawwrt_verify_wireguard_connectivity`。

该 API 会自动完成以下检查并返回聚合报告：
1. 服务端：wg show、SNAT/MASQUERADE 规则、IP 转发状态
2. 每台设备：路由器侧握手时间、收发流量
3. VPS 侧 ping 测试（需传入 `pingTargets`）

## 执行流程

1. 若在线设备数为 0：停止，提示无可验证设备。
2. 确定验证范围：
   - 若用户指定设备 → 传入对应 `deviceIds`
   - 若用户未指定 → 展示在线设备清单，让用户确认后再继续
3. 组装 `pingTargets`：
   - 取每台待验证设备事先记录好的 tunnel IP
   - 来源应为部署时明确记录的 `peerBindings.tunnelIp` 或其它已确认的分配结果
   - 不要依赖 `openclaw_get_wg_status` 或原始 `wg show` 去临时解析并推断 tunnel IP
   - 传入 `pingTargets` 以触发 VPS → 客户端的端到端 ping 验证
4. 调用 `clawwrt_verify_wireguard_connectivity`，传入 `deviceIds` 和 `pingTargets`。

## 输出要求

1. 明确区分三层结果：
   - 服务端基础设施（IP 转发、SNAT 规则）
   - 每台设备的握手与流量状态
   - 端到端 ping 可达性（✅ reachable / ❌ unreachable）
2. 若验证失败，只报告问题，不自动修复。给出排查建议：
   - 服务端 IP 转发未开启 → 建议重新部署服务端
   - SNAT 规则缺失 → 建议重新部署服务端
   - 设备无握手 → 建议检查客户端配置或云平台防火墙
   - ping 不通但握手正常 → 建议检查路由规则
3. 若所有检查均通过，输出"VPN 连通性验证通过"。

## 建议的下一步

1. 服务端异常 → `references/server-deploy.md` 或 `references/reset.md`
2. 客户端异常 → `references/client-config.md` 或 `references/reset.md`
3. 路由问题 → 重新执行 `references/lan-collection.md` 并重下发路由
