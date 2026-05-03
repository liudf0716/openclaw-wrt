# 验证当前 WG VPN 网络

## 适用场景

用户想验证 WireGuard 是否真正可用，包括服务端状态、客户端握手、连通性与整体网络结果时，使用本模块。

## 固定入口

并行调用：

1. `openclaw_get_wg_status`
2. `clawwrt_list_devices`

## 执行流程

1. 若在线设备数为 0：停止，并提示当前没有可验证的在线设备。
2. 若用户指定设备：只验证指定设备。
3. 若用户未指定设备：
   1. 展示在线设备清单。
   2. 询问用户要验证哪些设备。
   3. 未确认前不继续。
4. 调用 `clawwrt_verify_wireguard_connectivity`。
5. 若用户只想看单台设备的即时状态，可改为调用 `clawwrt_get_wireguard_vpn_status`，不要混成完整验证报告。

## 输出要求

1. 明确区分“服务端检查结果”和“设备侧验证结果”。
2. 明确指出：
   1. 哪些设备握手正常
   2. 哪些设备无握手或状态异常
   3. 服务端 NAT / 转发 / peer 状态是否正常
3. 若验证失败，不定义自动修复动作，只报告问题并建议用户下一步选择。

## 建议的下一步

1. 服务端异常：进入 `references/server-deploy.md` 或 `references/reset.md`
2. 客户端异常：进入 `references/client-config.md` 或 `references/reset.md`
