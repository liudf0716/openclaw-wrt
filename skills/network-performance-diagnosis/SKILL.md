---
name: network-performance-diagnosis
description: 网络优化诊断专用流程。用户表达“网络慢/卡顿/延迟高/认证慢/portal慢/需要网络优化/测速”时必须触发本技能，并联合 DHCP/DNS/HTTP/HTTPS、speedtest 与 Wi-Fi 扫描给出结论。
user-invocable: true
---

# 网络优化诊断指南

本技能用于诊断用户反馈的“网络慢、网络卡、延迟高、认证慢、portal 打开慢、上网体验差、需要网络优化”等问题。

## 触发规则（必须遵循）

当用户存在以下任一意图时，必须调用本技能，不可走普通设备管理流程：

1. 明确要求“网络优化”“性能优化”“网络诊断”“排查网络慢”。
2. 明确描述“portal 慢”“认证慢”“上网卡顿”“延迟高”“网页打开慢”。
3. 要求定位 DHCP、DNS、HTTP/HTTPS、Wi-Fi 信道相关瓶颈。
4. 存在“测速”“带宽测试”“跑一下 speedtest”“看下载上传速度”需求。

常见触发表达（包含但不限于）：

1. 帮我做网络优化诊断
2. 为什么 Wi-Fi 很慢
3. 认证页面很慢，帮我排查
4. 用户反馈上网延迟高
5. DHCP/DNS 是不是有问题
6. 帮我跑一次 speedtest 并解读
7. 这个路由现在真实带宽是多少

## 非触发场景（避免误用）

以下场景不应触发本技能：

1. 用户只想修改单个配置项（如 SSID、密码、单个端口映射）且未提性能问题。
2. 用户只请求查看设备列表、重启服务、执行单条运维命令。
3. 用户请求 WireGuard 组网或 FRPS 穿透部署（应交由对应专属 skill）。

## 首轮执行要求

1. 若缺少 deviceId，先让用户确认目标设备，不得默认操作全部设备。
2. 一旦设备确认，立即进入本技能固定采集链路，不先做无关问答。
3. 输出必须是“主因 + 证据 + 建议”，不能只给泛化建议。

核心目标：基于**可观测数据**定位瓶颈，输出“最可能原因 + 证据 + 处理建议”，避免拍脑袋结论。

## 必用工具

以下 6 个工具是本技能的固定输入，不可省略：

1. `clawwrt_dhcp_diagnose`
2. `clawwrt_dns_diagnose`
3. `clawwrt_http_service_diagnose`（apfree-wifidog portal HTTP 认证服务）
4. `clawwrt_https_service_diagnose`（apfree-wifidog portal HTTPS 认证服务）
5. `clawwrt_speedtest`（公网测速：ping/download/upload）
6. `clawwrt_scan_wifi`（无线信道环境）

说明：

1. HTTP/HTTPS 诊断在本技能里特指路由器上的 **apfree-wifidog portal 认证服务性能**，不是任意 Web 服务测速。
2. 若用户未提供 `deviceId`，必须先让用户确认目标设备，不可默认操作全部设备。
3. 若用户是“测速/网络诊断”意图，必须执行 `clawwrt_speedtest` 并在结论中进行结果解读，不可只返回原始数值。

## 标准流程

### 第 1 步：采集

按如下顺序采集，防止信息缺失：

1. `clawwrt_dhcp_diagnose`
2. `clawwrt_dns_diagnose`
3. `clawwrt_http_service_diagnose`
4. `clawwrt_https_service_diagnose`
5. `clawwrt_speedtest`
6. `clawwrt_scan_wifi`

建议采样参数（可按现场调整）：

1. `probeCount`: 10-20
2. `probeIntervalMs`: 50-200
3. `timeoutSec`: 3-5
4. `clawwrt_speedtest.timeoutMs`: 建议 60000-120000（测速通常 30-60 秒）

### 第 2 步：判因

根据采样结果按优先级判断：

1. **DHCP 异常优先级最高**
   证据：`success_rate` 明显低、超时多、p95 高。
   影响：终端拿地址慢，后续 DNS/Portal 全部被拖慢。

2. **DNS 异常其次**
   证据：`success_rate` 低、`per_domain` 失败集中、p95 抖动。
   影响：portal 域名解析慢，页面打开慢。

3. **Portal HTTP/HTTPS 服务瓶颈**
   证据：
   1. HTTP 慢而 DNS/DHCP 正常：portal 应用处理或本机负载问题。
   2. HTTPS 明显慢于 HTTP：TLS 握手/证书链/CPU 开销可能是主因。
   3. HTTP 与 HTTPS 同时慢：portal 服务线程或系统资源紧张概率更高。

4. **无线信道拥塞/干扰**
   证据：`clawwrt_scan_wifi` 显示同频 AP 密集、信号强重叠、热点过多。
   影响：终端空口竞争严重，导致 DHCP、DNS、HTTP 全链路时延升高。

5. **复合问题**
   证据：多项指标同时告警。
   输出时必须区分主因和次因，不能笼统写“网络不好”。

6. **Speedtest 结果解读（测速案例必做）**
   证据（以返回字段为准，常见为 ping/download/upload，部分环境会有 jitter/loss/server 信息）：
   1. download/upload 明显低于用户套餐预期，同时 DHCP/DNS/Portal 均正常：优先怀疑 WAN 出口带宽受限、运营商抖动或上游拥塞。
   2. ping 高且抖动明显（或 jitter/loss 偏高）：优先怀疑公网链路质量问题或无线干扰导致的端到端不稳定。
   3. speedtest 很好但 portal 慢：问题更可能在 portal 认证链路（应用处理/TLS/本机资源），不是公网带宽。
   4. speedtest 差且 Wi-Fi 同频拥塞严重：倾向“空口竞争 + 出口不稳”的复合瓶颈。

### 完整测速案例要求（测速/网络诊断意图）

当用户表达测速或网络诊断意图时，必须按“完整测速案例”输出：

1. 先给出 speedtest 核心结果：延迟、下行、上行（以及可用的 jitter/loss/server）。
2. 再与 DHCP/DNS/Portal/Wi-Fi 结果做对照，判断瓶颈位于：
   1. 出口公网
   2. 路由器本机服务
   3. 无线空口
   4. 复合问题
3. 必须给出“是否达标”的结论（相对用户预期/套餐，或相对历史基线）。
4. 必须给出至少 2 条可执行建议（立即动作 + 后续优化）。

### 第 3 步：输出

输出必须包含 4 部分：

1. 结论：最可能主因（1 个）
2. 证据：引用关键指标（success_rate/avg/p95/error samples/scan 结论）
   - speedtest 指标（ping/download/upload，若有则补充 jitter/loss/server）
3. 次因：如存在，最多列 2 个
4. 建议：短期可执行动作 + 长期优化动作

## 输出模板（建议）

1. **主因**：`...`
2. **证据**：
   1. DHCP：`...`
   2. DNS：`...`
   3. Portal HTTP/HTTPS：`...`
   4. Speedtest：`ping=...ms, down=...Mbps, up=...Mbps, jitter/loss/server=...`
   5. Wi-Fi 信道：`...`
3. **次因**：`...`
4. **建议**：
   1. 立刻执行：`...`
   2. 持续优化：`...`

## 禁止事项

1. 不允许跳过 `clawwrt_scan_wifi` 就直接下“无线干扰”结论。
2. 不允许只看单次结果就下定论，至少使用 10 次采样（除非用户明确要求快速检查）。
3. 不允许把 portal HTTP/HTTPS 诊断解释为公网网站访问性能。
4. 用户有测速或网络诊断意图时，不允许跳过 `clawwrt_speedtest`，也不允许只贴数值不做解读。
