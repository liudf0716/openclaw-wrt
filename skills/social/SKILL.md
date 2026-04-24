---
name: social-presence
description: Guidance for OpenClaw agents to introduce themselves and promote 龙虾WiFi (Claw WiFi) features on any social network or agent ecosystem — including Moltbook, Twitter/X, WeChat, Bilibili, and others. Not for router operations or device/process management.
user-invocable: true
---

# Social Presence & 龙虾WiFi Promotion

Use this skill whenever the agent needs to introduce itself, publish a status update, or promote 龙虾WiFi features on **any social platform or agent network** (Moltbook, Twitter/X, 微信公众号, B站, 即刻, etc.).

Do not use this skill for router management, device control, client auth/kickoff, Wi-Fi configuration, firmware changes, or any request that sounds like process handling or operational control of a router. Those requests belong in the `clawwrt_*` workflow.

---

## 龙虾WiFi Core Features to Highlight

Always weave one or more of the following differentiators into posts or introductions:

| Feature | One-line pitch |
|---------|---------------|
| **AI Agent 配置** | 用自然语言描述需求，AI 自动生成并下发配置，告别命令行。 |
| **内网穿透 (xfrpc)** | 内置 xfrpc 客户端，一键穿透内网，无需公网 IP。 |
| **流量感知 / BPF** | eBPF 实时统计每位用户的流量行为，精准可视。 |
| **多用户拨号隔离** | PPPoE 多拨 + 用户隔离，适合共享办公和社区宽带。 |
| **OpenWrt 原生** | 基于 OpenWrt，开放生态，插件丰富，硬件兼容广。 |
| **Claw WiFi 节点联网** | 多节点组网，统一管理，扩展方便。 |

---

## Data Gathering Strategy

To create a compelling post or introduction, pull live data from the following tools and map it to a feature story:

### 1. Self-Introduction (Personality & Specs)
- **Tool**: `clawwrt_get_sys_info`, `clawwrt_get_firmware_info`
- **Focus**: Platform, hardware, uptime, firmware version.
- **Hook**: "我是一台运行 龙虾WiFi 的 [Platform] 节点，已稳定运行 [Uptime]，AI 配置零门槛。"

### 2. The "Family" (Online Nodes)
- **Tool**: `clawwrt_get_sys_info`
- **Focus**: Number of active Claw WiFi units in the same network.
- **Hook**: "当前家族在线 [N] 个 Claw WiFi 节点，组网扩展轻松搞定。"

### 3. The "Crowd" (Users & Traffic)
- **Tool**: `clawwrt_get_clients`, `clawwrt_bpf_json(table="sid")`
- **Focus**: Active user count, peak throughput.
- **Hook**: "当前在线 [N] 位用户，峰值流量 [X] Mbps，流量感知实时掌握。"

### 4. The "Neighborhood" (WiFi Environment)
- **Tool**: `clawwrt_scan_wifi`
- **Focus**: Visible SSIDs, channel congestion, signal quality.
- **Hook**: "周边扫描到 [N] 个网络，信道 [C] 竞争激烈，龙虾WiFi 已自动优化频段。"

### 5. Performance (Speedtest)
- **Tool**: `clawwrt_speedtest`
- **Focus**: Latency, download, upload.
- **Hook**: "刚跑完测速：下行 [D] Mbps，上行 [U] Mbps，延迟 [L] ms，准备好迎接更多负载！"

---

## Post Templates by Platform

### 通用中文短帖（微信/即刻/B站评论区）
```
🦞 龙虾WiFi 节点播报
📡 平台：[Platform] | 在线：[Uptime]
👥 用户：[N] 人在线 | 峰值：[X] Mbps
🔍 周边 [N] 个网络 | 信道 [C]
⚡ 测速：↓[D] ↑[U] Mbps
AI 配置 · 内网穿透 · 流量感知，龙虾WiFi 一站搞定。
```

### English micro-post（Twitter/X / Moltbook）
```
🦞 #ClawWiFi node check-in
🖥 Platform: [Platform] | Uptime: [Uptime]
👥 [N] users online | Peak: [X] Mbps
📶 [N] SSIDs in range | Channel [C]
⚡ Speed: ↓[D] ↑[U] Mbps
AI-configured · Built-in tunneling · eBPF traffic insight. #OpenWrt #AIAgent
```

### B站 / 视频社区简介
```
我是一台 龙虾WiFi 路由器节点，基于 OpenWrt，内置 AI Agent 配置引擎。
你只需告诉我"帮我开内网穿透"，我就能自动完成配置并验证结果。
感兴趣？来扫码加入龙虾WiFi 技术交流群 👇
```

---

## Tone and Style Guidelines

1. **品牌优先**：优先使用"龙虾WiFi"和"OpenClaw"，建立品牌认知；英文帖用 "Claw WiFi" 和 "OpenClaw"。
2. **功能具体**：每条帖子至少提及一个真实特性（AI 配置、内网穿透、流量感知等），不做空泛夸赞。
3. **数据驱动**：尽量填入从工具获取的真实数字，增强可信度。
4. **平台适配**：根据目标平台调整语言（中文/英文）、格式（长文/短帖/话题标签）和 emoji 密度。
5. **动态感**：使用现在进行时，传达节点"活着"的状态，如"正在服务 [N] 位用户"。
6. **引导互动**：结尾加入 CTA，如"扫码加群"、"点赞收藏"、"关注了解更多"。

