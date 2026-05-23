# openclaw-wrt 重构与优化指南

> 面向：执行重构任务的另一位 AI（或工程师）。
> 仓库根：`/home/ubuntu/.openclaw/extensions/openclaw-wrt`
> 包名：`@openclaw/openclaw-wrt`（version 2026.5.20）
> 目标：保持对外行为/工具契约/SKILL 文档不变，把代码物理与逻辑结构整顿到可长期维护的状态，让后续在它之上做功能演进的成本显著降低。

---

## 0. 阅读顺序

1. 第 1 节：仓库结构现状速览
2. 第 2 节：**核心问题诊断**（按"必须修"→"应该修"→"可以修"分级，重构前请通读）
3. 第 3 节：**重构目标终态**（一张目标文件树 + 三条不变量）
4. 第 4 节：**分阶段重构计划**（每个阶段都给出"可机器验证的完工标准"）
5. 第 5 节：单个工具的标准实现模板（重构所有工具的样板代码）
6. 第 6 节：测试策略
7. 第 7 节：约束与红线（绝对不可破坏的契约）

---

## 1. 现状速览

### 1.1 顶层文件
- `index.ts`（214 行）：插件入口；订阅 chawrtd SSE，把事件通过 notification target 投递到 IM 频道；注册工具。
- `api.ts`：仅 re-export，可保留。
- `openclaw.plugin.json`：声明 **75 个工具契约**（含 `clawwrt`、`clawwrt_list_devices`、`clawwrt_get_device`、`clawwrt_publish_portal_page`、`clawwrt_generate_portal_page` 等，与代码中 70 个 `name:` 字段一一对应——剩余 5 个走 `function createXxxTool` 单独工厂，名称没被简单 grep 命中，但实际都存在，**对外契约完整**）。
- `rollup.config.mjs`：双格式 (CJS/ESM) + 类型聚合产物，`preserveModules: true`，所以重构后每个源文件仍 1:1 对应一份 dist 产物——拆分文件不会破坏运行时入口。
- `package.json`：`exports` 指向 `./dist/cjs/index.js` / `./dist/esm/index.js` / `./dist/index.d.ts`，与文件拆分解耦。

### 1.2 src/ 当前文件
| 文件 | 行数 | 角色 |
|---|---:|---|
| `tool-monolith.ts` | **4440** | **上帝文件**：所有工具实现 + 内联 schema/parser/helpers |
| `tool.test.ts` | 2312 | 单测全部塞一起 |
| `tool-schemas.ts` | 776 | TypeBox schema（**已抽出，但 monolith 又自己定义了一份完全重复的**） |
| `tool-chawrtd.ts` | 662 | chawrtd HTTP client（已抽出，但**也存模块级 active state**） |
| `portal-page-renderer.ts` | 582 | Captive portal HTML 模板渲染（自包含，OK） |
| `tool-parsers.ts` | 501 | 通用 parser/formatter（OK） |
| `tool-types.ts` | ~230 | 类型聚合（OK） |
| `tool-validators.ts` | ~140 | IPv4/CIDR/WG key 校验（OK） |
| `tool-portal-utils.ts` | small | portal 发布辅助（OK） |
| `tool-wireguard-routes.ts` | small | WG 路由计划文件读写（OK） |
| `tool-factories.ts` | small | `pickLegacyTools` —— 反模式，见 §2.4 |
| `tool-{device,client,wifi,bpf,portal,xfrpc,server-infra,mqtt,wireguard-client,network-system,auth-trusted}.ts` | 13–30 行 ✕ 11 个 | **伪拆分**：只声明工具名常量数组，再 `pickLegacyTools()` 从 monolith 抓 |
| `tool.ts` | small | 组合 11 个 domain 工具组，去重后导出 |
| `chawrtd-events.ts` | ~210 | SSE client（自包含，OK） |
| `config.ts` | small | TypeBox config schema（OK） |

### 1.3 数字证据（重构前基线，量化用）

以下数字来自 commit `368efdc`（截至 2026-05-23）的实际仓库扫描，命令可复现：

| 指标 | 数值 | 复现命令 |
|---|---:|---|
| `tool-monolith.ts` 行数 | **4440** | `wc -l src/tool-monolith.ts` |
| `tool.test.ts` 行数 | **2312** | `wc -l src/tool.test.ts` |
| `tool-schemas.ts` 行数 | 776 | `wc -l src/tool-schemas.ts` |
| `tool-chawrtd.ts` 行数 | 662 | `wc -l src/tool-chawrtd.ts` |
| 工具总数（plugin.json 与代码 100% 对齐） | **75** | `python3 -c "import json; print(len(json.load(open('openclaw.plugin.json'))['contracts']['tools']))"` |
| monolith 中 `name: "..."` 出现次数 | 75 | `grep -cE "^[[:space:]]+name: \"" src/tool-monolith.ts` |
| `createSimpleOperationTool(` 调用 | 46 | `grep -c "createSimpleOperationTool(" src/tool-monolith.ts` |
| monolith 内重复 `const XxxSchema = ` | **46** | `grep -cE "^const [A-Z][a-zA-Z]+Schema = " src/tool-monolith.ts` |
| `tool-schemas.ts` 中 `export const XxxSchema = ` | 46（与 monolith 1:1 重名/重定义） | `grep -cE "^export const [A-Z][a-zA-Z]+Schema = " src/tool-schemas.ts` |
| `logToolInvocation(undefined, ...)` 隐式取全局 logger | 31 | `grep -c "logToolInvocation(undefined" src/tool-monolith.ts` |
| monolith 中 ` as XxX` 类型断言（含 `rawParams as` / 强制断言） | 108 | `grep -cE " as [A-Z][a-zA-Z]+" src/tool-monolith.ts` |
| 模块级可变状态变量声明 | 6（monolith 3 + tool-chawrtd 3，两份完全独立的副本） | `grep -rE "^let active(Tool\|ClawWRT\|Bridge)" src/` |
| 伪拆分 `tool-<domain>.ts` 文件 | 11，合计 ≤ 21 行/文件 | `wc -l src/tool-{device,client,wifi,bpf,portal,xfrpc,server-infra,mqtt,wireguard-client,network-system,auth-trusted}.ts` |

关键结论：
1. monolith 不是"几乎全部工具实现"，而是"100% 工具实现 + 46 份重复 schema + 6 个模块级状态副本"；任何对外行为修改都必须改 monolith。
2. plugin.json 的 75 个工具名与 monolith 内 `name:` 字段 **完全一致**（已通过 `set(plugin) ^ set(code) == ∅` 验证），可以放心把契约名做为重构期间的回归 anchor。
3. monolith 内联 schema 与 `tool-schemas.ts` 中的 `export const XxxSchema` **同名 46 对**，命名空间是冲突的——意味着 monolith 顶部一旦 `import { XxxSchema }`，会立即编译失败，需要先把内联那份删掉。重构步骤要严格按 §4 阶段 A 走，不可同时引入两侧。


---

## 2. 核心问题诊断

### 2.1 【必须修】伪拆分：tool-{device,client,...}.ts 全是空壳

**症状**：`tool-device.ts` 这类文件只有 ~20 行，定义一个工具名常量数组 `DEVICE_TOOL_NAMES`，然后 `pickLegacyTools(DEVICE_TOOL_NAMES, ...)` 把 monolith 里 4440 行实现挑出来。

```ts
// tool-device.ts（当前形态——反模式示例）
export const DEVICE_TOOL_NAMES = ["clawwrt_get_status", "clawwrt_get_sys_info", ...];
export function createDeviceTools(params) {
  return pickLegacyTools(DEVICE_TOOL_NAMES, params);
}
```

**问题**：
1. 名字暗示 domain 拆分，实际是"目录索引"。任何要修 `clawwrt_get_status` 的人仍然要进 4440 行的 monolith。
2. `pickLegacyTools(names, params)` 每次调用都重新构建 **整个 70+ 个工具的工厂闭包**，只为挑出几个。`tool.ts` 编排 11 个 domain → 一次启动构建 70 ✕ 11 = 770 次工具对象（外加 N 次工厂闭包），实际只导出 70 个。

**修法**（必须做）：把每个 domain 的实现从 monolith 真正搬到 `tool-<domain>.ts`，每文件提供 `createXxxTools(deps) -> AnyAgentTool[]`，工具对象**只构建一次**。

### 2.2 【必须修】tool-schemas.ts 与 tool-monolith.ts 内联 schema 双份维护

`tool-schemas.ts` 已有 46 个 `export const XxxSchema`，但 monolith 在第 279–1060 行又定义了同名同结构的 46 份。重构者很容易只改其中一份 → schema 漂移 → 工具入参在文档（plugin.json）与运行时表现不一致。

**修法**：
- 删除 monolith 内联 schema，全部 `import { ... } from "./tool-schemas.js";`。
- 删除 monolith 里 `type XxxParams = Static<typeof XxxSchema>;` 共 33 行——这些类型应该在 `tool-types.ts`（已经从 `tool-schemas` 处 re-import 了，完全可以重用）。

### 2.3 【必须修】模块级可变状态破坏可测试性与并发安全

`tool-monolith.ts` 和 `tool-chawrtd.ts` 各自维护一份：

```ts
let activeToolLogger: Logger | undefined;
let activeClawWRTConfig: ResolvedClawWRTConfig | undefined;
let activeBridgeFallback: ClawWRTBridge | undefined;
```

`createClawWRTTools()` 把入参塞进模块级变量，工具 `execute` 时再从模块读。后果：
1. 同一进程里如果有两个不同 config（多租户 / 测试夹具），**互相覆盖**。
2. 单测想注入 mock 必须按特定顺序 `setActiveXxx()`，且测试间互相污染。
3. `logToolInvocation(undefined, ...)` 31 处依赖此模块状态，相当于隐式全局依赖。

**修法**：引入显式依赖容器 `ToolContext`：

```ts
// src/tool-context.ts（新建）
export interface ToolContext {
  bridge?: ClawWRTBridge;
  config?: ResolvedClawWRTConfig;
  logger?: Logger;
  chawrtd: ChawrtdClient; // 见 §2.5
}
```

所有工具工厂签名改为 `createXxx(ctx: ToolContext): AnyAgentTool[]`；所有 helper（`callChawrtd`/`callDeviceOp`）接收 `ctx` 作为首参。删除所有 `setActiveXxx()`、`active*` 全局变量。

### 2.4 【必须修】`pickLegacyTools` 重复构建

`tool-factories.ts`：

```ts
function pickLegacyTools(names: string[], params): AnyAgentTool[] {
  const allTools = createLegacyClawWRTTools(params); // ← 构建全部 70+ 工具
  const map = new Map(allTools.map(t => [t.name, t]));
  return names.map(n => map.get(n)!).filter(Boolean);
}
```

11 个 domain 组各调一次 → 启动时 70 ✕ 11 ≈ **770 次完整工具构造**。`tool.ts` 还得 `withoutTools()` 做一遍全表扫描去重。

**修法**：在 §2.1 重构完成后，`pickLegacyTools` 与 `createLegacyClawWRTTools` 一起删除；`tool.ts` 直接合并各 domain 工厂结果（每个工厂只产出本 domain 的工具）。

### 2.5 【应该修】chawrtd HTTP 客户端应成为类，而非散函数 + 模块状态

当前 `tool-chawrtd.ts` 暴露 `callChawrtd`、`getChawrtdBaseUrl`、`setActive*` 等十几个函数共享一组模块级变量。

**修法**：

```ts
// src/chawrtd-client.ts（新文件，重命名 tool-chawrtd.ts）
export class ChawrtdClient {
  constructor(private readonly opts: { baseUrl: string; logger?: Logger }) {}
  async call<T = JsonRecord>(req: { path: string; method: "GET"|"POST"; body?: unknown; timeoutMs?: number }): Promise<ChawrtdResponse<T>> { ... }
  async listDevices(): Promise<DeviceSnapshot[]> { ... }
  async getDevice(id: string): Promise<DeviceSnapshot> { ... }
  async callDeviceOp(p: { deviceId: string; op: string; payload?: JsonRecord; timeoutMs?: number; expectResponse?: boolean }): Promise<JsonRecord> { ... }
}
```

构造器吃 `baseUrl` 与 `logger` → 无模块状态。`ToolContext.chawrtd` 持有单实例。

### 2.6 【应该修】工具 `execute` 内重复样板

几乎每个 `execute` 都是同样四步：
1. `logToolInvocation(undefined, NAME, rawParams);`
2. `const args = rawParams as XxxParams;`
3. `const response = await callDeviceOp({...});`
4. `return buildToolResult(`summary`, { response });`

`createSimpleOperationTool` 已经覆盖了大部分纯透传场景，但还有 ~25 个工具自己内联（因为有额外校验/路径分支）。

**修法**：再抽两个更宽的工厂：
- `createDeviceOpTool({ name, label, description, schema, op, prepare?(args), summarize?(response, args) })`——可选 `prepare` 在调用前转换 payload，`summarize` 拼摘要。覆盖现在所有内联 `execute` 中只是"轻校验 → callDeviceOp → buildToolResult"模式的 ~20 个工具。
- `createChawrtdOpTool({ name, label, description, schema, request(args), summarize? })`——覆盖所有 `openclaw_*` 系列（直接打 VPS API，不走设备）。

### 2.7 【应该修】175 处 `as XxxParams` 强制断言

来源：`rawParams: unknown` → 手动断言。**正确做法**：在 SDK 边界用 TypeBox `Static<typeof Schema>` 推导参数类型，工具 `execute` 的形参就直接是窄类型。可以在 `createDeviceOpTool<T>` 的泛型上绑定 `T = Static<typeof Schema>`，由编译器保证。

### 2.8 【应该修】测试文件 2312 行单文件

`tool.test.ts` 包含所有 70 个工具的单测。**修法**：跟 §2.1 同步——按 domain 拆 `tool-<domain>.test.ts`，每个 ≤ 300 行；公共夹具放 `__fixtures__/`。

### 2.9 【应该修】schema 单文件 776 行

`tool-schemas.ts` 已是良好抽离，但仍可按 domain 切：
- `schemas/device.ts`（设备/系统）
- `schemas/client.ts`（认证客户端/MAC/trusted）
- `schemas/wifi.ts`
- `schemas/bpf.ts`
- `schemas/portal.ts`
- `schemas/xfrpc.ts` / `schemas/frps.ts`
- `schemas/wireguard.ts`
- `schemas/network.ts`（br-lan/firmware/speedtest/shell）
- `schemas/common.ts`（DeviceIdField、TimeoutField 等共享 Field）

最终从 `src/schemas/index.ts` 重新 `export *`，对外仍是 `import { ... } from "./tool-schemas.js"`（保留 `tool-schemas.ts` 作为兼容入口 re-export 整个 `schemas/` 目录，避免外部消费者破坏）。

### 2.10 【可以修】index.ts 通知投递逻辑可独立

`index.ts` 把"格式化设备事件 → 经 notificationTarget 投递"内联了一段不短的逻辑。这跟工具实现完全无关，应该抽到 `event-notifier.ts`，`index.ts` 只剩"装配 + 启动"。

### 2.11 【可以修】portal-page-renderer.ts 582 行

模板渲染 + HTML 字符串拼接。可按模板拆 `portal/templates/{default,welcome,business,cafe,hotel,terms,voucher,event}.ts`，每模板一个 `render(content): string`，对外 `renderPortalPageHtml(template, content)` 做派发。这是收益最低的一项，可以放到最后或先不动。


---

## 3. 重构目标终态

### 3.1 目标文件树

```
openclaw-wrt/
├── index.ts                       # ≤ 100 行：装配 + 启动 SSE
├── api.ts                         # 保持原样（公共 re-export 入口）
├── openclaw.plugin.json           # 不动
├── rollup.config.mjs              # 不动（preserveModules 已经天然支持文件拆分）
├── package.json                   # 不动
└── src/
    ├── config.ts                  # 不动
    ├── tool-context.ts            # 新建：ToolContext 接口 + 构造函数
    ├── chawrtd-client.ts          # 重命名+重写：ChawrtdClient 类（替代 tool-chawrtd.ts）
    ├── chawrtd-events.ts          # 不动
    ├── event-notifier.ts          # 新建：从 index.ts 抽出的事件→通知格式化与投递
    ├── schemas/                   # 从 tool-schemas.ts 拆出
    │   ├── index.ts
    │   ├── common.ts
    │   ├── device.ts
    │   ├── client.ts
    │   ├── wifi.ts
    │   ├── bpf.ts
    │   ├── portal.ts
    │   ├── xfrpc.ts
    │   ├── frps.ts
    │   ├── wireguard.ts
    │   └── network.ts
    ├── tool-schemas.ts            # 保留为 re-export 兼容入口：export * from "./schemas/index.js"
    ├── tool-types.ts              # 不动
    ├── tool-parsers.ts            # 不动
    ├── tool-validators.ts         # 不动
    ├── tool-portal-utils.ts       # 不动
    ├── tool-wireguard-routes.ts   # 不动
    ├── portal-page-renderer.ts    # 暂不动（§2.11 选做）
    ├── tools/
    │   ├── index.ts               # createClawWRTTools(ctx) 入口，合并各 domain
    │   ├── _factory.ts            # createDeviceOpTool / createChawrtdOpTool / createListDevicesTool / createGetDeviceTool / createGenericTool
    │   ├── device.ts              # status/sys_info/device_info/reboot/firmware_*/network_interfaces
    │   ├── client.ts              # clients/client_info/auth/kickoff/tmp_pass
    │   ├── wifi.ts                # wifi_info/set_wifi/scan/relay/delete_relay
    │   ├── bpf.ts                 # bpf_* + l7_*
    │   ├── auth-trusted.ts        # auth_serv + trusted_{domains,wildcard_domains,mac}
    │   ├── mqtt.ts                # mqtt_serv
    │   ├── portal.ts              # generate_portal_page / publish_portal_page
    │   ├── wireguard.ts           # 设备侧 WG（get/set/reset/status/verify/keys/routes/collect_protected_routes）
    │   ├── xfrpc.ts               # 设备侧 XFRPC（含 restart_xfrpc）
    │   ├── frps.ts                # openclaw_*frps* + openclaw_deploy_wg_server / get_wg_status / get_wg_server_public_key / get_vps_public_ip / reset_wg_server
    │   ├── network-system.ts      # br_lan / speedtest / shell
    │   └── hello.ts               # claw_wifi_hello
    └── __tests__/
        ├── _helpers.ts            # 公共 mock chawrtd / fixture loader
        ├── device.test.ts
        ├── client.test.ts
        ├── wifi.test.ts
        ├── bpf.test.ts
        ├── portal.test.ts
        ├── wireguard.test.ts
        ├── xfrpc.test.ts
        ├── frps.test.ts
        └── network-system.test.ts
```

**关键变化**：删除 11 个伪拆分 `tool-*.ts`、`tool-monolith.ts`、`tool-factories.ts`、`tool.ts`、`tool.test.ts`。

### 3.2 三条不变量（重构必须保持）

1. **对外工具契约 100% 不变**：`openclaw.plugin.json` 中 75 个工具的 `name` / `parameters` schema / `description` 字段不得改动；`createClawWRTTools(...)` 返回的工具数组数量、名称、参数、行为与重构前一致。
2. **package.json `exports` 入口不变**：`./dist/cjs/index.js` / `./dist/esm/index.js` 仍能加载。`api.ts` 的所有 `export` 名称保留，必要时改为从新位置 re-export。
3. **SSE 事件流契约不变**：`chawrtd-events.ts` 的 `ChawrtdEventStreamClient` 接口、`ChawrtdDeviceEvent` 形状保持原样；只允许把"事件 → 通知文本"的格式化逻辑搬到 `event-notifier.ts`。


---

## 4. 分阶段重构计划

每个阶段独立可合并，且都给出"机器可验证的完工标准"。**强烈建议**严格按顺序推进，每阶段做完跑一次 `pnpm build && pnpm test` 锁定。

### 阶段 A — 安全清理（零行为变更）

**目标**：删除已知冗余，建立基线。

**步骤**：
1. 删除 `tool-monolith.ts` 内部 46 份内联 schema 定义（行 279–1060 附近的所有 `const XxxSchema = ...`）。改为 `import { ... } from "./tool-schemas.js"`，同时引入 `import * as SharedSchemas from "./tool-schemas.js"` 已存在的别名。
2. 删除 `tool-monolith.ts` 内部 33 行 `type XxxParams = Static<typeof XxxSchema>;`。改为从 `tool-types.ts` 引入（如缺，先在 `tool-types.ts` 补 `export type DeviceOnlyParams = Static<typeof DeviceOnlySchema>;` 等）。
3. 删除重复的 helper：`tool-monolith.ts` 的 `normalizeMac` / `normalizeBpfAddress` / `parseChawrtdTimestamp` / `parseChawrtdDeviceSnapshot` / `formatDuration` / `getCategoryEmoji` 等已经在 `tool-parsers.ts` 中存在。改为从 `tool-parsers.ts` 引入。
4. 删除 `tool-monolith.ts` 的 IPv4/CIDR/WG-key 工具函数（已在 `tool-validators.ts`）。
5. 跑构建与测试：

```bash
cd /home/ubuntu/.openclaw/extensions/openclaw-wrt
pnpm install && pnpm build && pnpm test
```

**完工标准**：
- `wc -l src/tool-monolith.ts` 从 4440 降至 ≤ 3400。
- `grep -cE "^const [A-Z][a-zA-Z]+Schema =" src/tool-monolith.ts` == 0。
- 单测全绿，且 `git diff openclaw.plugin.json` 为空。

### 阶段 B — 抽出 ChawrtdClient

**目标**：消除模块级状态，工具实现仍留在 monolith 但通过 `ctx.chawrtd` 调用。

**步骤**：
1. 新建 `src/chawrtd-client.ts`，把 `tool-chawrtd.ts` 的散函数包成 `ChawrtdClient` 类（保留所有现有方法签名，但 `this.baseUrl` 取代模块变量）。
2. 新建 `src/tool-context.ts`，定义 `ToolContext`。
3. `tool-monolith.ts` 顶部接收 `ctx: ToolContext` 而不是从 `setActive*` 全局拿，把所有 `callChawrtd({...})` 替换为 `ctx.chawrtd.call({...})`，所有 `callDeviceOp({...})` 替换为 `ctx.chawrtd.callDeviceOp({...})`。
4. `createClawWRTTools({ bridge, config, logger })` 内部构造一个 `ctx`，传给原来的 `createLegacyClawWRTTools`。
5. 删除 `tool-chawrtd.ts` 的所有 `setActive*` 与 `let activeXxx` 模块变量（chawrtd 文件保留为薄包装层 → 最后一步删除；这里先让它转调 `ChawrtdClient`）。

**完工标准**：
- `grep -E "let active(Tool|ClawWRT|Bridge)" src/` 无输出。
- `tool-monolith.ts` 不再有 `setChawrtd*` 调用。
- 测试通过；新增 1 个测试 `chawrtd-client.test.ts` 覆盖类的核心方法。

### 阶段 C — 工具按 domain 真正搬家

**目标**：消灭 monolith，建立 `src/tools/<domain>.ts`。

**搬家分组**（共 11 个 domain + 1 个 hello + 1 个 factory）：

| 文件 | 含工具数 | 关键工具 |
|---|---:|---|
| `tools/device.ts` | 7 | `get_status`, `get_sys_info`, `get_device_info`, `update_device_info`, `reboot_device`, `get_firmware_info`, `firmware_upgrade` |
| `tools/client.ts` | 5 | `get_clients`, `get_client_info`, `auth_client`, `kickoff_client`, `tmp_pass_client` |
| `tools/wifi.ts` | 5 | `get_wifi_info`, `set_wifi_info`, `scan_wifi`, `set_wifi_relay`, `delete_wifi_relay` |
| `tools/bpf.ts` | 8 | `bpf_add`, `bpf_del`, `bpf_flush`, `bpf_json`, `bpf_update`, `bpf_update_all`, `get_l7_active_stats`, `get_l7_protocol_catalog` |
| `tools/auth-trusted.ts` | 8 | `get_auth_serv`, `set_auth_serv`, `get_trusted_{domains,wildcard_domains,mac}`, `sync_trusted_{domains,wildcard_domains,mac}` |
| `tools/mqtt.ts` | 2 | `get_mqtt_serv`, `set_mqtt_serv` |
| `tools/portal.ts` | 2 | `generate_portal_page`, `publish_portal_page` |
| `tools/wireguard.ts` | 9 | `get_wireguard_vpn`, `set_wireguard_vpn`, `reset_wireguard_vpn`, `get_wireguard_vpn_status`, `verify_wireguard_connectivity`, `generate_wireguard_keys`, `get_vpn_routes`, `set_vpn_routes`, `collect_wireguard_protected_routes` |
| `tools/xfrpc.ts` | 9 | `get_xfrpc_common[_config]`, `set_xfrpc_common`, `get/del/disable_xfrpc_tcp_service`, `add_xfrpc_tcp_service`, `disable_xfrpc_service`, `restart_xfrpc` |
| `tools/frps.ts` | 9 | `openclaw_deploy_frps`, `openclaw_get_frps_status`, `openclaw_frps_full_status`, `openclaw_verify_frps`, `openclaw_reset_frps`, `openclaw_reset_wg_server`, `openclaw_deploy_wg_server`, `openclaw_get_wg_status`, `openclaw_get_wg_server_public_key`, `openclaw_get_vps_public_ip` |
| `tools/network-system.ts` | 5 | `get_network_interfaces`, `get_br_lan`, `set_br_lan`, `execute_shell`, `get_speedtest_servers`, `speedtest` |
| `tools/hello.ts` | 1 | `claw_wifi_hello` |
| `tools/_factory.ts` | 0 | `createDeviceOpTool`, `createChawrtdOpTool`, `createListDevicesTool`, `createGetDeviceTool`, `createGenericTool`, `createSimpleOperationTool`（保留兼容） |

合计 70 个工具 + `clawwrt`/`clawwrt_list_devices`/`clawwrt_get_device` 3 个通用 = 73。`generate_portal_page`/`publish_portal_page` 已计入 portal.ts，所以实际是 70+3 单算 portal=2 → 75 与 plugin.json 对齐。

**步骤**：
1. 先做 `tools/_factory.ts`：复制 monolith 里的 `createSimpleOperationTool`、`createGenericTool`、`createListDevicesTool`、`createGetDeviceTool`、`createPublishPortalPageTool`、`createGeneratePortalPageTool` + 新增 `createDeviceOpTool` / `createChawrtdOpTool`。所有工厂签名第一参数都是 `ctx: ToolContext`。
2. 一个 domain 一个 PR/commit。每搬一个：
   - 在 `tools/<domain>.ts` 实现 `export function createXxxTools(ctx: ToolContext): AnyAgentTool[]`，工具实现从 monolith 复制过来。
   - 在 `tools/index.ts` 注册：`...createXxxTools(ctx)`。
   - 从 `tool-monolith.ts` 删除已搬走的工具对象。
   - 跑 `pnpm test`，确保 `tool.test.ts` 仍绿（旧测试此时还指向 monolith export，需要保持 monolith 暂时 re-export 已搬走的工厂，最后一步统一删）。
3. 全搬完后：
   - 删 `tool-monolith.ts`。
   - 删 11 个伪拆分文件：`tool-{device,client,wifi,bpf,portal,xfrpc,server-infra,mqtt,wireguard-client,network-system,auth-trusted}.ts`。
   - 删 `tool-factories.ts`、`tool.ts`。
   - 更新 `api.ts` 与 `index.ts` 改为 `import { createClawWRTTools } from "./src/tools/index.js"`。

**完工标准**：
- `! test -f src/tool-monolith.ts`。
- `wc -l src/tools/*.ts | tail -1`：总行数应在 3500–4000 之间（比 monolith 略多，因为多了 export/import 样板，但每文件 ≤ 600 行）。
- `pnpm build`、`pnpm test` 全绿。
- 抽样 5 个工具用 mock chawrtd 跑端到端 → 行为与重构前 git tag 一致。

### 阶段 D — 测试拆分

**目标**：`tool.test.ts` 2312 行按 domain 拆。

**步骤**：
1. 公共部分（mock `ChawrtdClient`、夹具 JSON）抽到 `__tests__/_helpers.ts`。
2. 按 §3.1 文件树拆出 9 个测试文件，每个 ≤ 300 行。
3. 删除 `tool.test.ts`。

**完工标准**：`pnpm test` 全绿；新文件每个 ≤ 300 行。

### 阶段 E — schema 目录拆分（选做）

按 §2.9 拆 `tool-schemas.ts` 到 `schemas/<domain>.ts`，保留 `tool-schemas.ts` 为 re-export 入口确保兼容。

### 阶段 F — index.ts 收紧（选做）

把通知投递逻辑抽到 `event-notifier.ts`，`index.ts` 只剩 ≤ 100 行（构造 ChawrtdClient、ToolContext、SSE client、event notifier，然后 `start()`）。


---

## 5. 单工具标准模板

重构后所有工具应符合下面 4 种模板之一。

### 5.1 模板 A：纯设备透传（覆盖最多 ~30 个工具）

⚠️ **SDK 签名约束（重要）**：实际 SDK 的 `AnyAgentTool.execute` 只接两个参数 —— `(toolCallId: string, rawParams: unknown) => Promise<ToolResult>`（与 `src/tool-monolith.ts` 中现有 `execute: async (_toolCallId, rawParams) => { ... }` 完全一致）。**`ToolContext` 不能作为 `execute` 的第 3/4 参数注入**，必须通过工厂函数的闭包捕获。下面工厂模板已按此修正。

```ts
// tools/_factory.ts
import type { TSchema, Static } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { ToolContext } from "../tool-context.js";
import { logToolInvocation, buildToolResult } from "./_runtime.js";

export function createDeviceOpTool<S extends TSchema>(
  ctx: ToolContext,                                      // ← 通过闭包注入，不进 execute 形参
  params: {
    name: string;
    label: string;
    description: string;
    schema: S;                                            // 例如 SharedSchemas.DeviceOnlySchema
    op: string;
    prepare?: (args: Static<S>) => {
      payload?: JsonRecord;
      expectResponse?: boolean;
    };
    summarize?: (response: JsonRecord, args: Static<S>) => string;
  },
): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.schema,
    // ⚠️ 严格遵守 SDK 既有签名，与 monolith 现状保持一致
    execute: async (_toolCallId: string, rawParams: unknown) => {
      const args = rawParams as Static<S>;
      logToolInvocation(ctx.logger, params.name, args);
      const prep = params.prepare?.(args) ?? {};
      const response = await ctx.chawrtd.callDeviceOp({
        deviceId: ((args as JsonRecord).deviceId as string).trim(),
        op: params.op,
        payload: prep.payload,
        timeoutMs: (args as JsonRecord).timeoutMs as number | undefined,
        expectResponse: prep.expectResponse,
      });
      const summary = params.summarize?.(response, args) ?? `Device responded to ${params.op}.`;
      return buildToolResult(
        `${summary}\n\nDevice response data:\n${JSON.stringify(response)}`,
        { response },
      );
    },
  };
}
```

```ts
// tools/device.ts 节选
import { DeviceOnlySchema } from "../schemas/device.js";
import { createDeviceOpTool } from "./_factory.js";
import type { ToolContext } from "../tool-context.js";

export function createDeviceTools(ctx: ToolContext): AnyAgentTool[] {
  return [
    createDeviceOpTool(ctx, {
      name: "clawwrt_get_status",
      label: "OpenClaw WRT Status",
      description: "Get detailed runtime status...",
      schema: DeviceOnlySchema,
      op: "get_status",
      summarize: (_r, a) => `Fetched status for device ${a.deviceId}.`,
    }),
    // ... 其余 device 域工具
  ];
}
```

**关于参数类型推导**：`rawParams: unknown` 是 SDK 边界事实（来自外部 RPC），不可避免要做一次断言。把它**集中在工厂模板的一行 `const args = rawParams as Static<S>;`** 内即可，不要在每个工具的 `execute` 里散开 `as XxxParams`。重构完成后 `as` 使用次数应该 = `工厂数量` ≈ 3-5 次，而不是当前 monolith 中的 108 次。

### 5.2 模板 B：纯 VPS / chawrtd 调用（覆盖 9 个 openclaw_* 工具）

```ts
export function createChawrtdOpTool<S extends TSchema>(params: {
  name: string;
  label: string;
  description: string;
  schema: S;
  request: (args: Static<S>) => { path: string; method: "GET"|"POST"; body?: unknown; timeoutMs?: number };
  summarize?: (response: ChawrtdResponse, args: Static<S>) => string;
}): AnyAgentTool { ... }
```

### 5.3 模板 C：复合工具（如 `set_vpn_routes`、`verify_wireguard_connectivity`、`openclaw_frps_full_status`）

这类工具有自己的多步骤逻辑，**保留独立 `execute`**，但所有外部依赖（chawrtd、execFileSync）通过 `ctx` 注入。`execFileSync` 不直接 `import("node:child_process")` —— 改为在 `ToolContext` 上挂 `execFileSyncRunner`，测试可注入 mock。

### 5.4 模板 D：列表 / 通用 dispatcher（`clawwrt`、`clawwrt_list_devices`、`clawwrt_get_device`）

继续使用现有 `createListDevicesTool` / `createGetDeviceTool` / `createGenericTool` 实现，但同样从 `ctx` 取 chawrtd。

---

## 6. 测试策略

### 6.1 公共 helper

```ts
// __tests__/_helpers.ts
import type { ChawrtdClient } from "../src/chawrtd-client.js";

export function makeMockChawrtd(responses: Record<string, JsonRecord>): ChawrtdClient {
  return {
    call: jest.fn(async ({ path }) => responses[path] ?? { summary: "" }),
    callDeviceOp: jest.fn(async ({ op }) => responses[`device:${op}`] ?? {}),
    listDevices: jest.fn(async () => responses.devices ?? []),
    getDevice: jest.fn(async (id) => responses[`device:${id}`] ?? { deviceId: id }),
  } as unknown as ChawrtdClient;
}

export function makeCtx(overrides?: Partial<ToolContext>): ToolContext { ... }
```

### 6.2 每个 domain 的测试结构

```ts
// __tests__/device.test.ts
describe("device tools", () => {
  describe("clawwrt_get_status", () => {
    test("calls chawrtd with device op and summarizes", async () => {
      const chawrtd = makeMockChawrtd({ "device:get_status": { uptime: 123 } });
      const ctx = makeCtx({ chawrtd });
      const [tool] = createDeviceTools(ctx).filter(t => t.name === "clawwrt_get_status");
      const result = await tool.execute("call-id", { deviceId: "dev1" });
      expect(chawrtd.callDeviceOp).toHaveBeenCalledWith(expect.objectContaining({ op: "get_status", deviceId: "dev1" }));
      expect(result.details.response).toEqual({ uptime: 123 });
    });
  });
});
```

### 6.3 回归保护

在 §阶段 A 开始前，记录基线快照：

```bash
node -e "const { createClawWRTTools } = require('./dist/cjs/api.js');
  const tools = createClawWRTTools({});
  console.log(JSON.stringify(tools.map(t => ({ name: t.name, label: t.label })).sort((a,b)=>a.name.localeCompare(b.name)), null, 2));" > docs/baseline-tools.json
```

每个阶段结束后再跑一次，`diff` 必须为空。

---

## 7. 约束与红线

1. **绝不修改 `openclaw.plugin.json`**：除非 SDK 显式要求新字段。任何对外工具名、参数 schema、description 的修改都会破坏调用方（包括本仓库的 SKILL 文档与其他插件）。
2. **绝不删除或重命名 `api.ts` 的 export**：消费者可能直接 `import { createClawWRTTools } from "@openclaw/openclaw-wrt/api"`。
3. **绝不破坏 `dist/` 的双格式输出**：rollup `preserveModules: true` 已经能跟随源码拆分；不要切回单 bundle。
4. **`tool-types.ts`、`tool-parsers.ts`、`tool-validators.ts`、`tool-portal-utils.ts`、`tool-wireguard-routes.ts`、`portal-page-renderer.ts`、`chawrtd-events.ts`、`config.ts` 保持原签名**。可以内部重构，但导出 API 不动。
5. **SKILL 文档不动**：`skills/**/SKILL.md` 与 `references/*.md` 描述的是工具使用 contract，重构纯代码层，不应触发 SKILL 修订。
6. **每个阶段独立 PR**：单 PR 行数变化建议 ≤ 1500（搬家 PR 例外，但要按 domain 一个一个来）。
7. **重构期间禁止顺手"优化业务逻辑"**：任何业务行为变更必须走单独 PR，不能跟搬家混在一起。

---

## 8. 量化收益（预期）

| 指标 | 当前 | 重构后目标 |
|---|---:|---:|
| 单文件最大行数 (src/) | 4440 | ≤ 600 |
| 模块级可变状态变量 | 6（×2 副本，monolith + tool-chawrtd 各持一份） | 0 |
| 重复 schema 定义 | 46 | 0 |
| `pickLegacyTools` 重复构建次数 / 启动 | ~770（11 domain × ~70 tools） | 0（每工具构造 1 次） |
| monolith 内类型断言（`as XxX`） | 108 | ≤ 10（仅边界处保留） |
| 测试单文件最大行数 | 2312 | ≤ 300 |
| 新增 domain 工具的开发触点 | ≥ 4 个文件（schema + monolith 工具对象 + domain 名单 + 测试） | ≤ 2 个文件（schemas/<d>.ts + tools/<d>.ts；测试可选放 __tests__） |

---

## 9. 实操要点（工程细节）

下面这些细节在 §1-§8 中没有显式列出，但都是真实代码扫描得到的硬约束，执行 AI 必须遵守。

### 9.1 构建 / 测试命令

`package.json` **没有 `test` 脚本**。`vitest` 是 devDependency，使用方式：

```bash
# 安装依赖（按当前 lockfile 选择包管理器）
pnpm install              # 仓库根有 pnpm-lock.yaml

# 构建（rollup，双格式 CJS/ESM + .d.ts）
pnpm build                # = rollup -c

# 测试（直接调 vitest，因为 package.json 没声明 test 脚本）
pnpm exec vitest run      # 一次性跑全部 *.test.ts
pnpm exec vitest          # watch 模式

# 类型检查（tsconfig 已 strict: true）
pnpm exec tsc --noEmit
```

如果要补 `test` 脚本，建议直接在 `package.json` 加 `"test": "vitest run"`、`"typecheck": "tsc --noEmit"`，作为重构 PR 的副产物。

### 9.2 SDK execute 签名是固定的

实测 `src/tool-monolith.ts` 中所有工具的 `execute` 形态都是：

```ts
execute: async (_toolCallId: string, rawParams: unknown) => { ... }
```

**只有两个参数**。`ToolContext` / `Logger` / `ChawrtdClient` 等依赖一律通过工厂函数闭包注入，不要尝试给 `execute` 加第 3、第 4 个形参——会破坏 SDK 契约。详见 §5.1 已修正的模板 A。

### 9.3 tool-schemas.ts 与 monolith 内联 schema 的命名冲突

两边都用了完全相同的标识符 `XxxSchema`。一旦在 monolith 顶部 `import { XxxSchema } from "./tool-schemas.js"`，下方 `const XxxSchema = ...` 会立即触发 TypeScript 重复声明错误。

因此 §阶段 A 的搬家**必须按 schema 一组一组做**：

1. 在 monolith 中删除 `const XxxSchema = Type.Object(...)` 与 `type XxxParams = Static<typeof XxxSchema>;`；
2. 在 monolith 顶部已经存在的 `import * as SharedSchemas from "./tool-schemas.js";` 上**直接复用** `SharedSchemas.XxxSchema`；或者改为命名 import；
3. 编译通过后再处理下一组。

不要一次性删 46 个再统一改 import——会产生几百个红线，难以定位。

### 9.4 dist/ 的双格式与 preserveModules

`rollup.config.mjs` 已经设置 `preserveModules: true`，意味着 `src/foo.ts` → `dist/cjs/src/foo.js` + `dist/esm/src/foo.js` 一一对应。文件拆分**不会**破坏入口；但要注意：

- 新增的 `src/tools/<domain>.ts` 必须**最终被 `src/tools/index.ts` 引用，并通过 `index.ts` / `api.ts` 暴露**，否则 rollup 不会 emit 它（preserveModules 仍然走 entry graph）。
- 检测产物完整性：每个阶段结束 `pnpm build && ls dist/esm/src/tools/`，新加文件应当出现。

### 9.5 baseline-tools.json 回归保护（每阶段必跑）

§6.3 提到的基线快照，给一个能直接拷贝的脚本：

```bash
# 重构前一次性产出基线
pnpm build
node --input-type=module -e "
  import('./dist/esm/api.js').then(m => {
    const tools = m.createClawWRTTools({});
    const summary = tools
      .map(t => ({ name: t.name, label: t.label, paramsKeys: Object.keys(t.parameters?.properties ?? {}).sort() }))
      .sort((a,b)=>a.name.localeCompare(b.name));
    console.log(JSON.stringify(summary, null, 2));
  });
" > docs/baseline-tools.json

# 每个阶段结束跑一次新快照，diff 必须为空
node --input-type=module -e "..." > docs/_tools-after.json
diff -u docs/baseline-tools.json docs/_tools-after.json   # 期望无输出
```

注意：基线只保护**对外契约**（name / label / parameters keys），不保护内部实现摘要字符串。

### 9.6 不要顺手改的高风险点

- `src/portal-page-renderer.ts`：模板 HTML 中包含大量手写转义与 `<style>`，看上去能整理但极容易破坏现有 portal 页面渲染，**列入 §2.11 选做**，重构主线绝对不动。
- `src/chawrtd-events.ts` 的 `createSseDispatcher`：依赖 undici Agent 的特定行为，已经踩过 keep-alive / connect timeout 的坑（见 git log `3754a19`），不在本次重构范围。
- `src/tool-parsers.ts` / `src/tool-validators.ts`：被多个工具直接 import，签名稳定优先，内部实现可以重构但**不要改导出名**。
- `openclaw.plugin.json` 的 `contracts.tools[]`：75 个字符串是**字符串数组**而非对象数组（已通过 `python3 -c "..."` 验证），重构期间这个文件不允许动。

### 9.7 commit / PR 切分建议

按 §4 的阶段切，每阶段一个 PR：

| PR | 阶段 | 估计行变化 | 风险 |
|---|---|---:|---|
| 1 | A：删 monolith 内联 schema，统一 import 自 tool-schemas | -1000 / +50 | 低 |
| 2 | B：引入 `tool-context.ts` + `chawrtd-client.ts` 类化 | +400 / -100 | 中 |
| 3 | C-1 ~ C-N：按 domain 把工具搬家（device→client→wifi→bpf→...） | 每 PR ±800 | 中 |
| 4 | D：拆 `tool.test.ts` 到 `__tests__/*.test.ts` | +2300 / -2312 | 低（测试本身不变） |
| 5 | E：删 `tool-monolith.ts`、`tool-factories.ts`、11 个伪拆分文件、旧 `tool.ts` | -5000 | 低（前置阶段都绿后纯清理） |
| 6 | F（可选）：schemas/ 子目录拆分 + portal-page-renderer 模板拆分 | ±1000 | 低 |

**每个 PR 都必须**：跑 `pnpm build` + `pnpm exec vitest run` + baseline diff，三项全绿才合入。

---

## 10. 给执行 AI 的最后提示

- **不要一次性重写整个 monolith**。按 §4 阶段推进，每阶段单独跑测试。
- 阶段 C 的搬家过程可能要保留 `tool-monolith.ts` 一段时间作为旧 export 兼容入口，让旧 `tool.test.ts` 还能跑；阶段 D 拆完测试后再删 monolith。
- 任何阶段如果 `pnpm exec vitest run` 出现非"工具名重命名"类的红，**回滚当前阶段**，不要堆叠改动。
- 阶段 A 是低风险的"清理重复"，强烈建议先做完获得反馈循环；之后再开始 B/C 的结构重塑。
- 在动手前先跑一次 `pnpm install && pnpm build && pnpm exec vitest run` 拿到绿色基线，并把当前 `git rev-parse HEAD` 记进 PR 描述。
- 任何业务行为变更（例如修正某个工具的语义、加新工具）一律走独立 PR，**不允许与搬家提交混合**。
