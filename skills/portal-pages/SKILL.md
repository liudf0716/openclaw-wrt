---
name: openclaw-wrt-portal-pages
description: 根据用户提示生成中文为主的门户页 HTML，并通过现有 ClawWRT 门户流程发布。
user-invocable: false
---

# OpenClaw WRT 门户页生成

优先使用 `clawwrt_generate_portal_page`。只有用户已经提供完整 HTML 时，才使用 `clawwrt_publish_portal_page`。

## 代码为准

- HTML 模板源码在 [src/portal-page-renderer.ts](src/portal-page-renderer.ts)。
- 模板选择与文案由代码实现，不在 skill 里展开。

## 选择规则

- `default`：通用弹出页。
- `welcome`：欢迎或品牌承接。
- `business`：企业或办公网络。
- `cafe`：咖啡馆或餐饮场景。
- `hotel`：酒店宾客网络。
- `terms`：条款或政策确认。
- `voucher`：券码或口令输入。
- `event`：活动或推广页。

不明确时默认用 `default`。

## 输出要求

- 页面默认假设用户已经在线。
- 文案优先中文，简洁、单列、移动优先。
- 除非用户明确要求，否则不要写成“先联网再继续”。
- 每个龙虾 WiFi 默认生成独立文件名，不要写死为统一名称。
- 用户如果只是要“生成门户页”，直接走模板生成，不要手工拼 HTML。