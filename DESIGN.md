# 对话流程图插件（FlowChart）设计文档

- 状态：**v0.4.1 — M0–M5 全部完成**（M5 评估记录见 21）。本版把实现期才定下来的细节写回文档；
  与 v0.3 的偏离集中在 18.2，每条都带理由
- 目标插件名：`dsh-plugin-flowchart`（工作区内开发，`plugin_manager` 挂载）
- 工具名：`FlowChart`
- 代码位置：`dsh-plugin-flowchart/`（Host 半 + Client 半 + 8 套测试 + 人眼样例）
- 作者：lead（DSH 插件开发）
- 日期：2026-11-07（v0.3：2026-10-18）

---

## 1. 一句话定义

当代理的文字解释难以理解时，代理调用 `FlowChart` 工具，用一段 YAML 描述流程图；插件把这张图渲染到对话右侧边栏的一个独立标签页里，用户可以直接看懂结构（形状、方向、颜色、连线、文字）。

---

## 2. 目标与非目标

### 2.1 目标

1. **模型侧**：一个易写的 YAML 流程图 DSL。模型只需描述"有什么形状、连到哪、什么颜色、写什么字"，不需要理解坐标、路由、字体度量。
2. **用户侧**：图出现在对话边栏（右侧 Sidebar 标签页），可缩放、可切换多张、可导出。
3. **可复现**：图的内容来自会话日志（session log）中的工具调用事件。重启、resume、fork 之后图能原样重建。
4. **风格一致**：颜色、字体、圆角、图标全部走宿主主题 token 与共享 UI 组件，看起来像产品自带功能。
5. **双语**：界面文案中英双语（跟随宿主 locale）。

### 2.2 非目标（v1 明确不做）

- 不做用户侧图形编辑器（拖拽节点、连线改锚点）。
- 不做 Mermaid / Graphviz / PlantUML 兼容导入。
- 不做时序图、ER 图、甘特图；v1 只做"节点 + 有向边"这一族（流程图、状态图、调用链、决策树、简单拓扑）。时序图与 ER 图**暂不排入 v2**，DSL 不为其预留专用概念。
- 不注入常驻 system prompt 提示，不用 `tools.guard`；触发完全依赖工具 `description` 本身。
- 不做服务端渲染、不做网络请求、不写工作区文件（导出由用户在浏览器侧完成）。
- 不做实时协作、不做跨设备布局同步（右侧 Sidebar 布局本身就是浏览器本地的）。

---

## 3. 设计原则（对齐本 Harness 的插件实践）

| 原则 | 本插件的落法 |
|---|---|
| 会话日志是唯一事实源 | 图的内容 = 工具调用事件里的 YAML。不引入第二份存储；布局由事件折叠（projection fold）确定性重建。 |
| 用最强需求的最弱扩展点 | 只用 `ctx.tools.register` + `ctx.sessionProjections.register` + 公开 Slot 注册。不注入 system prompt，不用 `tools.guard`，不改写别人的 Slot。 |
| 框架驱动、插件计算 | 布局是纯函数：同一份文档 + 同一份字体度量 ⇒ 同一张图。插件不持有"当前图"的可变状态。 |
| UI 只用宿主 token 与 locale | 颜色走主题 token（`auto` 色），文案走 Client locale 服务，图标自带 SVG。绝不往 `document.body` 挂 DOM。 |
| 模型可见输出保持有界 | 工具返回值只回摘要（标题、节点数、边数、警告），不回 YAML 原文，不回 SVG。 |

---

## 4. 插件形态

一个 Cordis bundle，两半：

```
dsh-plugin-flowchart/
├── package.json               # exports["./client"] 指向生成物 client.js
├── cordis.patch.yml           # bundle 补丁（insert 一行）
├── index.js                   # Host 半：apply(ctx, config)
├── client.js                  # Client 半：**生成物，勿手改**
├── client/
│   └── ui.js                  # Client 半源码（普通 ESM，Node 可直接测）
├── lib/
│   ├── dsl.js                 # YAML 子集解析 + 第 1 层校验（行列定位）
│   ├── normalize.js           # 第 2–4 层校验 + 归一化（输出 Client 直接渲染的文档）
│   ├── projection.js          # 会话投影单元：从事件流折叠出图清单
│   ├── metrics.js             # 文本度量与换行（CJK 1.0em / 拉丁 0.55em）
│   ├── layout.js              # 布局引擎（纯函数，Client 侧运行）
│   └── svg.js                 # SVG 生成（纯函数，字符串输出）
├── scripts/
│   └── build-client.mjs       # 把 lib/*.js + client/ui.js 内联成 client.js
├── locale/
│   ├── en.json                # 文案目录（与 bundle 内字典由测试互校）
│   └── zh.json
├── icon.svg                   # 边栏 guide 图标（自带，不借用他包）
├── test/*.mjs                 # 8 套测试
└── samples/*.svg              # 人眼复核样例（含导出产物）
```

### 4.1 Client 半为什么是"生成物"

浏览器模块系统按**包 id** 解析模块（`window.__ModuleLoader__.load({ id, factory })`，
`require` 只能命中已注册的 id 表），一个包只发布一个 `exports["./client"]`。
所以 Client 半**不能** `import './lib/svg.js'`——相对路径没有解析器。

做法：`lib/*.js` 与 `client/ui.js` 保持普通 ESM（Host、测试、Node 诊断都直接 import），
由 `scripts/build-client.mjs` 把它们的 import/export 改写成工厂内 IIFE 并内联进
`client.js`。构建器是**严格**的：遇到不认识的 import/export 形式直接报错，不猜着编译。
`test/client-bundle.test.mjs` 会在 `client.js` 落后于源码时失败。

修改 Client 侧代码的正确顺序：改 `client/ui.js` 或 `lib/*.js` → `npm run build:client`
→ `npm test`。**永远不要**手改 `client.js`。

- **Host 半**：注册工具 `FlowChart`；注册一个会话投影（projection）折叠出"本会话的流程图清单"；通过 `wire.view` 把清单发布给 Client。
- **Client 半**：注册右侧 Sidebar 的标签页类型 + 标签页 body；注册 `tool.call.toolview` 的对话内卡片；渲染 SVG；导出。
- 布局引擎放在 `lib/layout.js`，**在 Client 侧执行**（因为需要真实字体度量）。Host 只做解析、校验、归一化与统计，避免 Host/Client 因字体度量不同而算出两张图。

安装方式：在工作区内开发，通过 `plugin_manager` 的 `install_bundle` 安装（绝不在 `app.asar` 内就地修改，绝不手写 profile 的 `package.json` / `cordis.patch.yml`）。

---

## 5. 工具契约（模型可见）

### 5.1 注册形态

```js
// 用普通对象注册，不用 `defineTool()`：链接的本地 bundle 从 workspace 的真实路径
// 解析，import 不到 app 树里的 `@deepseek-ai/*`；`ctx.tools.register()` 接受普通对象。
ctx.tools.register({
  name: 'FlowChart',
  description: FLOWCHART_TOOL_DESCRIPTION,
  parameters: {
    yaml: { type: 'string', description: /* 见 5.3 */ },   // 与 file 二选一，必须提供其一
    file: { type: 'string', description: /* 见 6.8 */ },
    open: { type: 'boolean', description: 'Expand the sidebar and reveal this diagram. Defaults to the plugin setting.' },
  },
  output: {
    schema: { type: 'object', /* ok / id / title / nodes / edges / warnings / errors */ },
    render: (_args, value) => [{ type: 'text', text: renderResultForModel(value) }],
  },
  async execute(args, exec) { /* 解析 → 校验 → 归一化 → 摘要 */ },
})
```

注册在插件自身 effect 上 ⇒ 全局工具，所有 agent 可见。若后续需要只给部分 agent，用 `ctx.tools.restrict` 由调用方收窄，插件不自我限制。

### 5.2 description 草案（模型-facing，英文）

> Render a flowchart in the conversation's right sidebar. Use it when a process, branching decision, state transition, call chain, or system interaction is hard to follow as prose — the diagram makes the structure visible. Author the diagram as YAML: nodes with shapes, text, fills and outlines, joined by directed edges. Calling again with the same `id` replaces that diagram; a new `id` opens a new one.

要点（遵循 agent-experience 规则）：
- 说**行为**（"在右侧边栏渲染一张图"），不说实现（不提 projection / SVG / 布局算法）。
- 说**何时用**（"文字难以跟随的结构"），给模型可判断的触发条件。
- 每个事实只说一次；参数级规则写在参数上，不堆进 description。
- 不写"你必须先调用 X"这类流程指令。

### 5.3 参数规则（写在参数 description 上）

`yaml`（必填，字符串）：

> Flowchart document. Top-level keys: `nodes` (required, 1–60), `edges`, `groups`, `legend`, `title`, `id`, `direction` (`TB`|`LR`|`BT`|`RL`, default `TB`), `defaults`, `canvas`.
> Node: `id` (unique, ≤40 chars), `label` (text, `\n` breaks lines, ≤120 chars), `shape` (`rect`|`rounded`|`stadium`|`ellipse`|`circle`|`diamond`|`hexagon`|`parallelogram`|`cylinder`|`document`|`cloud`|`triangle`|`star`|`note`|`subroutine`), `fill` (color | `auto` | `none`), `stroke` (color | `auto` | `none`), `strokeWidth` (number, `0` = no outline), `dashed` (bool), `color` (text color), `align` (`left`|`center`|`right`), `fontSize`, `bold`, `mono`, `size: [w,h]`, `pos: [x,y]`.
> Edge: `from`, `to`, `label`, `arrow` (`none`|`start`|`end`|`both`, default `end`), `arrowShape` (`triangle`|`vee`|`line`|`circle`|`diamond`), `style` (`solid`|`dashed`|`dotted`), `color`, `width`, `route` (`orthogonal`|`straight`|`curve`), `fromSide`/`toSide` (`auto`|`top`|`right`|`bottom`|`left`).
> Colors: `#rgb`, `#rrggbb`, CSS color names, `auto` (theme-derived), `none` (transparent).
> Example:
> ```
> title: 发布流程
> nodes:
>   - { id: a, label: 开始, shape: stadium }
>   - { id: b, label: 通过测试?, shape: diamond }
>   - { id: c, label: 发布, shape: rect }
> edges:
>   - { from: a, to: b }
>   - { from: b, to: c, label: 是 }
>   - { from: b, to: a, label: 否, style: dashed }
> ```

`open`（可选，布尔）：

> Expand the sidebar and reveal this diagram. Defaults to the plugin setting.

`file`（可选，字符串）：

> Path to a `.yaml` flowchart file, relative to the session's working directory or absolute. Provide `file` or `yaml`, not both. The file is read once at call time; the diagram keeps that snapshot.

`yaml` 与 `file` 互斥：都缺 → 错误 `provide yaml or file`；都给 → 错误 `provide yaml or file, not both`。

### 5.4 返回值（模型可见，有界）

成功：

```json
{ "ok": true, "id": "deploy-flow", "title": "灰度发布流程",
  "nodes": 6, "edges": 6, "warnings": ["edge roll->build crosses 1 edge"] }
```

失败（不结束回合，作为普通错误结果返回）：

```json
{ "ok": false,
  "errors": [
    { "path": "edges[3].from", "line": 21, "message": "unknown node id 'rol'", "hint": "did you mean 'roll'?" }
  ] }
```

约束：`warnings` 最多 5 条、`errors` 最多 10 条，超出的部分折成一行摘要
（`…and N more warnings.` / `…and N more problems.`），保证返回值有界；
返回值不含 YAML 原文、不含 SVG、不含布局坐标。

另有一个**内部字段** `snapshot`（仅 `file` 来源时出现）：它是工具的渲染期数据，
不出现在结构化返回值之外，也不该被模型依赖；作用是让投影从结果文本里取回快照
（见 9.1）。

---

## 6. YAML DSL 规范（核心）

### 6.1 顶层

```yaml
version: 1            # 省略即 1；未来不兼容时用于分流
id: deploy-flow       # 文档身份。同 id 再次调用 = 替换；省略则由内容哈希生成
title: 灰度发布流程    # 标签页标题 + 图上方标题
direction: TB         # TB | LR | BT | RL，默认 TB（自上而下）
theme: auto           # auto | light | dark（覆盖主题推导）
canvas:
  grid: 8             # 栅格单位
  rankSpacing: 64     # 层间距
  nodeSpacing: 40     # 同层节点间距
  padding: 24         # 画布内边距
defaults:             # 逐字段继承：顶层 defaults < 节点显式值
  shape: rounded
  fill: auto
  stroke: auto
  strokeWidth: 1.5
  color: auto
  fontSize: 13
  align: center
nodes: [...]          # 必填
edges: [...]          # 可空
groups: [...]         # 可选：把若干节点框在一起
legend: [...]         # 可选：图例
```

### 6.2 节点

```yaml
nodes:
  - id: gate
    label: 通过冒烟测试？
    shape: diamond
    fill: "#FFF4E5"
    stroke: "#F59E0B"
    strokeWidth: 2
    dashed: false
    color: "#7A4B00"
    align: center
    fontSize: 13
    bold: true
    mono: false
    size: [160, 80]   # 可选：显式尺寸（像素，落位时吸附 canvas.grid）
    pos: [120, 40]    # 可选：显式坐标（像素，吸附 canvas.grid），覆盖自动布局
```

字段语义：

| 字段 | 语义 | 默认 |
|---|---|---|
| `id` | 唯一标识，边引用它 | 必填 |
| `label` | 节点文字，`\n` 换行；自动换行按宽度 | 空 |
| `shape` | 形状，见 6.3 | `defaults.shape` → `rounded` |
| `fill` | 填充色；`auto` = 主题中性填充；`none` = 透明 | `auto` |
| `stroke` | 描边色；`auto` = 主题描边；`none` = 无描边 | `auto` |
| `strokeWidth` | 描边宽度；**`0` 即关闭描边**（"带不带描边"的开关） | `1.5`（**默认带描边**） |
| `dashed` | 描边虚线 | `false` |
| `color` | 文字色；`auto` = 主题前景（**例外见下**） | `auto` |
| `align` / `fontSize` / `bold` / `mono` | 文字排版；`mono` 用等宽字体（贴代码/标识符） | `center` / `13` / `false` / `false` |
| `size` / `pos` | 显式尺寸与坐标（**像素**，按 `canvas.grid` 吸附），用于模型想精确控制布局时 | 自动 |

**描边的三种写法都支持**，语义等价，方便模型按习惯书写：`strokeWidth: 0`、`stroke: none`、`stroke: false`。

**`color: auto` 的例外**（v0.4）：当 `fill` 是**显式颜色**时，`color: auto` 不再直接用主题前景，
而是按填充色的 WCAG 相对亮度，在白色与深色（`#1f2329`）两种墨之间选对比度更高的一支。
原因：照 v0.3 字面实现，`fill: "#1f2329"` + `color: auto` 就是深底深字，作者必须手写
`color` 才能读；而深/浅两墨的对比度是确定可算的，不需要人工判断。显式 `color` 永远优先；
`fill` 为 `auto`/`none` 时行为与 v0.3 完全一致（仍是主题前景）。

### 6.3 形状清单（v1，15 种）

| 分类 | shape | 用途 |
|---|---|---|
| 起止 | `stadium` | 开始 / 结束 |
| 过程 | `rect`、`rounded` | 步骤、动作 |
| 判断 | `diamond` | 分支判断 |
| 数据 | `ellipse`、`circle` | 状态、事件 |
| 子流程 | `subroutine`（双边竖线矩形） | 子流程 / 远程调用 |
| 准备 | `hexagon` | 预处理 / 配置 |
| 判断（偏斜） | `parallelogram` | 输入 / 输出 |
| 存储 | `cylinder` | 数据库 / 队列 |
| 文档 | `document` | 文件 / 报告 |
| 外部 | `cloud` | 外部系统 / 网络 |
| 修饰 | `note`（折角便签） | 注释、旁注 |
| 汇聚 | `triangle`、`star` | 触发 / 强调（少用） |

形状实现为参数化 SVG path（按 `size` 生成），不引入图标库、不引入第三方图形库。

### 6.4 边

```yaml
edges:
  - { from: build, to: gate, label: 部署后 }
  - { from: gate, to: gray,  label: 是 }
  - { from: gate, to: roll,  label: 否, style: dashed, color: "#EF4444", fromSide: right, toSide: top }
  - { from: roll, to: build, label: 修复后重试, route: curve, arrow: both }
  - { from: a,  to: b, arrow: none, width: 3 }        # 无箭头粗连接线
```

| 字段 | 语义 | 默认 |
|---|---|---|
| `from` / `to` | 节点 id | 必填 |
| `label` | 线上文字，自动放在线中段并加背景遮罩 | 空 |
| `arrow` | `none` / `start` / `end` / `both` — **方向**控制 | `end` |
| `arrowShape` | 箭头样式 `triangle` / `vee` / `line` / `circle` / `diamond` | `triangle` |
| `style` | `solid` / `dashed` / `dotted` | `solid` |
| `color` / `width` | 线色 / 线宽；`auto` = 主题线色 | `auto` / `1.5` |
| `route` | `orthogonal`（正交折线，圆角） / `straight`（直线） / `curve`（贝塞尔） | `orthogonal` |
| `fromSide` / `toSide` | 锚点：`auto` 按相对位置自动选，或指定 `top/right/bottom/left` | `auto` |
| `dashArray` | 自定义虚线节奏 | 由 `style` 推导 |

"不同方向的线条连接"由三件事共同满足：`direction`（整体流向）、`arrow`（箭头方向）、`fromSide`/`toSide`（出入锚点方向）。

### 6.5 分组与图例

```yaml
groups:
  - id: ci
    label: CI
    members: [build, gate]
    fill: "#F5F7FA"
    stroke: "#C9D2E2"
    style: dashed
legend:
  - { shape: diamond, label: 判断 }
  - { shape: stadium, label: 起止 }
```

组框 = 成员包围盒 + 内边距，渲染在节点层之下，不参与布局约束（v1）。

两个实现细节（v0.4）：

- **标题带**：带 `label` 的组在成员上方额外预留一条标题带（内边距 16 + 标题带 18 =
  34px）。v0.3 只留一圈 16px，标题基线正好压在成员节点上沿。标题按框宽省略。
- **图例落位**：默认画布右下角；若该角已被节点/组框/边标签/连线占用，则**画布向下长出
  一条图例带**，图例仍落在右下角而不压图。图例比图还宽时扩展画布宽度。
  图例项标题超过 150px 省略。

### 6.6 约束上限（可配置）

| 项 | 默认上限 | 超限行为 |
|---|---|---|
| YAML 字符数 | 20 000 | 拒绝，返回错误 |
| 节点数 | 60 | 拒绝 |
| 边数 | 120 | 拒绝 |
| 单条 label 字符数 | 120 | 拒绝 |
| 分组数 / 图例项 | 12 / 8 | 截断并 warning |

上限存在的目的：防止模型写出需要长时间布局的大图，拖慢会话。

### 6.7 解析安全

- 使用 YAML 库的**安全解析**：禁止自定义 tag（`!!js/function`、`!!js/eval` 等直接报错）、禁止重复键、允许锚点与别名（用于 `defaults` 复用）。
- 纯解析，不 `eval`，不 `require`，不访问网络与文件系统。

### 6.8 从工作区文件读取（`file` 参数）

| 规则 | 行为 |
|---|---|
| 路径解析 | 相对路径按会话工作目录解析；绝对路径直接使用 |
| 允许范围 | 普通文件；目录、设备、FIFO 直接拒绝 |
| 编码 | 只接受 UTF-8；含 NUL 或解码失败 → 错误 `not a UTF-8 text file` |
| 大小 | 受 `maxYamlChars` 限制，超限 → 错误并给出当前字符数 |
| 失败反馈 | `no such file`（附解析后的绝对路径）、`is a directory`、`not readable`，全部可操作 |
| 快照语义 | 调用时读一次，图保存的是**读到的内容快照**。之后用户改了文件，图不会自动变；代理重新调用同 `id` 即刷新。**边栏工具条不提供"重新读取"入口**（决策 9），卡片上显示来源路径，让用户知道内容来自文件快照 |
| 副作用 | 只读，不写、不改、不创建文件 |

用途：图较大、需要版本管理、或用户希望"这张图就是这个文件"时使用。小图直接内联 `yaml` 更省事。

---

## 7. 校验与错误反馈

分四层，逐层短路：

1. **词法/语法**：YAML 解析错误 → 返回 `{ line, message }`，并把 Tab 字符、全角标点、缩进不一致这类模型高频错误翻译成可操作提示（例：`line 12: 使用了 Tab 缩进，请改用空格`）。
2. **结构**：字段类型/枚举/必填 → `{ path: "nodes[2].shape", message: "unknown shape 'rhombus'", hint: "did you mean 'diamond'?" }`。
   "最近候选"的取法：先查**别名表**（`rhombus`→`diamond`、`box`/`square`→`rect`、`oval`→`ellipse`、
   `pill`/`capsule`→`stadium`、`database`→`cylinder` 等；箭头 `head`→`end`、路线 `curved`→`curve`），
   查不到再按编辑距离 ≤2 找最近的枚举值。语义同义词（菱形 vs diamond）编辑距离很远，
   只靠距离算不出来，所以别名单列。
   未知字段不报错，丢弃并给 warning（同样带 did-you-mean）。
3. **图语义**：`id` 重复、边引用不存在的节点、孤立节点（warning）、自环（允许，warning）、含环（允许，反馈边自动走 `curve` 绕行，warning）。
4. **容量**：6.6 的上限。

原则：**错误信息必须可操作**（路径 + 行号 + 建议），让模型一次就能修对；校验失败时不产生任何 UI 变化，也不产生"空图"标签页。

---

## 8. 布局引擎（纯函数）

输入：归一化文档 + 字体度量函数；输出：`{ viewBox, groups[], edges[], nodes[] }` 的绝对坐标几何。

```
1 归一化      defaults 继承、颜色解析（auto → 主题 token 名）、尺寸换算
2 文本测量    按 label/字号/字体测量 → 节点自然尺寸（CJK 1.0em/字，拉丁 0.55em/字，真实 measureText 精修）
3 分层        最长路径分层（DAG）；检测环，标记反馈边
4 层内排序    barycenter 4 轮迭代，减少交叉
5 坐标分配    按 direction 映射轴向；rankSpacing / nodeSpacing 定距；显式 pos 覆盖并做重叠检测（warning）
6 锚点求解    fromSide/toSide=auto 时按两节点相对位置选边
7 边路由      orthogonal 折线 + 圆角；同向平行边错开 8px（**挪锚点**而非折弯，
              否则两节点正对时折弯会退化回同一条线）；curve 用三次贝塞尔
              边标签落点：正交取"中点不在节点内"的最长线段，曲线取贝塞尔上的
              t=0.5/0.35/0.65… 第一个不在节点内的点
8 组框        成员包围盒 + padding；有标题时上方另加标题带
9 视图盒      包围盒 + canvas.padding
```

确定性要求：不使用随机数、不使用 `Date`、不依赖 Map 迭代顺序之外的隐式顺序。同一文档在任何设备得到同一几何（字体度量差异只影响节点宽度，不影响拓扑与顺序）。

性能目标：60 节点 / 120 边在 30ms 内完成布局；渲染为一次性 SVG（无逐帧动画），缩放平移用 transform，不重算布局。

---

## 9. 数据流与持久化

```
模型调用 FlowChart(yaml)
        │
        ▼
Host: execute → 解析/校验/归一化 → 工具结果（摘要）
        │        （调用与结果都作为会话事件写入 session log —— 唯一事实源）
        ▼
Host: ctx.sessionProjections.register({ key: 'flowchart', stateVersion: 2, init, apply, wire })
        apply 逐事件折叠 → state = {
          charts:   [{ id, seq, version, callId, doc, source, warnings }],
          failures: [{ callId, seq, errors }],   // 被拒调用，供卡片解释
          lastSeq, lastId, openSeq, settings,
        }
        wire.view: 去掉 Host 私有字段（pending）后的快照 → 下发给 Client
        ▼
Client: 边栏标签页 body 通过 useProjection() 读取清单 → lib/layout.js → SVG
        ▼
Client: tool.call.toolview（key = 'FlowChart'）渲染对话内卡片
```

要点：

- **不新增存储**：图内容在会话事件里，投影是派生视图。resume / fork / 重放都会重建出同样的清单（投影 fold 从事件流重建）。
- **compaction 无影响**：fold 基于事件序列，不依赖模型可见消息表面。
- **布局在 Client**：Host 只下发归一化文档与统计，避免字体度量分歧。
- **有界下发**：`wire.view` 下发的是归一化文档（不是原始 YAML 字符串），并只保留清单必需字段；
  最多保留 24 张图、12 条失败记录，超出从最旧丢弃。
- **`callId` 是卡片与图的连接键**：折叠时把产生这张图的工具调用 id 记在图上，卡片据此在投影里
  找回"自己那张图"，浏览器因此不必再解析一次 YAML。
- **`stateVersion` 是状态形状的版本**：任何会让 fold 产出不同字段的改动都必须 +1。注册表会丢弃
  版本不匹配的 checkpoint 行并从 seq 0 重折——v1→v2 就是这么发生的（v2 增加
  `callId`/`failures`/`settings`）。改字段忘了 +1，老检查点会喂给新 fold，症状很隐蔽。
- **`apply` 必须容忍"不是自己造的 state"**：注册表可能拿 checkpoint 行、wire 视图（已删掉
  `pending`）、或残缺旧状态当折叠起点。第一版没做这件事，用 checkpoint 恢复时第一个
  `tool/call` 就抛错、整个会话挂载夭折（用户看到"会话不可用"）。现在 `apply` 入口先补齐缺失列表。

### 9.1 内容快照如何持久（`file` 参数的关键设计）

内联 `yaml` 时，文档内容天然在工具调用事件里。走 `file` 时，调用事件里只有路径，**内容必须另外落到会话日志**，否则重启后无法重建。

方案（v0.3 的设想）：`execute` 产出归一化文档后，把它写进工具结果的**持久化呈现元数据**，
模型可见的结果内容仍只有摘要；投影 fold 从元数据读取文档，两条输入路径走同一折叠逻辑。

**M1 实测结论（v0.4）**：`tool/result` 事件**没有**结构化值字段——只有
`{ role, source, toolCallId, content: [{type:'text',text}], isError }`。首选的"呈现元数据"
通道不存在，实际采用文档里预留的**退路**：

- `file` 来源时，工具结果文本末尾附一段 ```flowchart-snapshot``` 围栏，内容是**调用时读到的
  原始 YAML 快照**（不是序列化后的归一化文档）。这样 fold 用同一套 normalize 重算，
  "工具判定"与"投影重算"永远不会分歧；序列化归一化文档反而更大且要跨版本兼容。
- 内联 `yaml` 不需要围栏：内容本来就在 `tool/call` 事件的 arguments 里，零额外开销。
- **实测成本**：`deploy.yaml`（约 700 字符）的围栏 ≈ 200 tokens，一次性，且只对 `file` 来源生效。
- 围栏是模型可见的（会占一次上下文），这是已知且已接受的代价；换取的是重启/fork 后
  `file` 来源的图能重建（§19.8）。

---

## 10. 边栏呈现（右侧 Sidebar）

使用右侧 Sidebar 公开的标签页类型注册路径（与产品自带的文档预览同一套公开 API）：

```js
// 1) 类型
ctx.sidebarRightTabs.register({
  id: '@local/dsh-plugin-flowchart',
  kind: 'flowchart',
  multiple: false,                // 一个 kind 一个标签页（理由见下）
  priority: 'extension',
  keepMounted: true,              // 保留缩放/平移状态
  title: () => t('tab.title'),
  guide: [{ id: 'flowchart', order: 40, title, description, icon: Glyph }],
})

// 2) body —— 组件是 register 的第二个参数，且必须写在 inject 回调内部
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS,
  inject: () => ({ t }),
}, FlowChartPanel))

// FlowChartPanel 通过 useTabInfo() 读 tab.navigation.params.docId，
// 读不到时退回"最新一张图"；投影由 useProjection('flowchart') 取得。
```

打开方式：`ctx.sidebarRight.openTab('flowchart', { params: { docId } })`。

界面结构：

- **顶部工具条**（标签页 body 内，不自定义面板头部）：文档切换（多张图时下拉）、方向切换（TB/LR/BT/RL，临时改视图）、缩放（−/+/适应/100%）、导出菜单（复制 SVG、下载 SVG、导出 PNG）、重新打开。
- **画布**：SVG，滚轮缩放、拖拽平移、双击适应；`role="img"` + `aria-label` 摘要（标题 + 节点数）。
- **空态**：本会话尚无流程图时，显示共享空态组件 + 一句说明（"让代理用 FlowChart 工具画一张图"）。
**为什么是 `multiple: false`（v0.4 变更）**：v0.3 这里写 `multiple: true`，但那种实现给每次
`openTab` 生成随机地址（`pageAddress(kind)/randomUUID()`），也就是**每打开一次就多一个标签页**
——与 §19.3"同 id 更新同一标签页，不新增"以及本节工具条里的"文档切换下拉"直接冲突。
现在一个 kind 一个标签页：同 id 更新就地重绘，换图则切换该标签页的当前文档。

- **自动打开策略**（v0.4 变更）：effect 放在**对话内工具卡片**里，而不是全局订阅 `lastSeq`。
  卡片恰好只在"产生这张图的调用所在、且该会话在屏"时挂载，语义天然正确，也不必判断某个
  `lastSeq` 变化是否属于前台会话。展开前仍按 v0.3 的要求比对 `ctx.sidebarRight.mounted`；
  若它尚未就绪，订阅该 observable，等它报告当前会话后再展开。后台会话永不展开。
- 每个**文档 id 只自动展开一次**（模块级集合）：用户手动关掉后同一文档的更新不会再弹侧栏，
  换一张新图（新 id）才会。默认开启、`autoOpen` 可关仍由 Host 配置决定——投影下发的
  `openSeq` 已经等于"这次调用要求展开"的结论，Client 不需要再读配置。
- 打开动作包在 try/catch 里：`openTab` 在"会话表面未挂载"时抛错，而它发生在 effect 里，
  未捕获就会带走整个页面。

## 11. 对话内呈现（工具卡片）

注册 `tool.call.toolview`（key = 工具名 `FlowChart`）：

- 一行标题（图标题）+ 统计（`6 节点 · 6 连线`）
- 缩略预览（同一布局的缩放版，`max-height: 160px`，点击放大）
- 按钮「在右侧边栏打开」→ `ctx.sidebarRight.openTab('flowchart', { params: { docId } })`
- 失败态：显示前 3 条校验错误，帮助用户理解代理为什么在重试

**四个阶段**（`phase` 由宿主下发；v0.4 把边界写清）：

| phase | 卡片显示 |
|---|---|
| `preparing` | "准备绘制流程图" |
| `start` | "正在绘制流程图…" |
| `result`，投影里有本 `callId` 的图 | 标题 + 统计 + 缩略图 + 打开按钮 |
| `result`，没有图 | "图未通过校验" + 前 3 条错误 |

失败态不重新解析 YAML：错误由 Host 折叠时用同一校验器一并产出（投影的 `failures`），
浏览器只负责显示。`start` 阶段绝不能显示"未通过校验"——那时还没有结果可判。

这样"边栏插入"与"对话可见"两头都照顾到：卡片负责发现，边栏负责阅读。

---

## 12. 视觉与主题

- 所有 `auto` 颜色解析为宿主主题 token，亮/暗主题都成立；用户显式指定的颜色原样使用。
  实际使用的 token（名取自 Client Inspect 的 `Theme.listTokens`，不是自造名）：

  | 角色 | token | 兜底色（浅 / 深） |
  |---|---|---|
  | 画布 | `--dsw-specific-sidebar-fill` | `#ffffff` / `#17181c` |
  | 节点填充 | `--dsw-alias-bg-layer-1` | `#ffffff` / `#20232a` |
  | 节点描边 | `--dsw-alias-border-l2` | `#c2cad8` / `#3c424c` |
  | 正文 | `--dsw-alias-label-primary` | `#1f2329` / `#e7e9ee` |
  | 次要文字 / 连线 | `--dsw-alias-label-secondary` | `#5f6772` / `#a2aab6` |
  | 组框填充 / 描边 | `--dsw-alias-bg-layer-2` / `--dsw-alias-border-l1` | `#f4f6fa` / `#23262c`、`#cfd6e2` / `#3c424c` |

  写法是 `var(--token, 兜底色)`：面板内 token 生效（跟明暗）；导出文件单独打开时用兜底色。
- **导出必须烘焙具体颜色**（v0.4）：导出走 `buildExportSvg(doc, { theme })`，把 `auto` 解析成
  浅/深主题的兜底色；文档显式 `theme` 优先于宿主主题。否则下载的 SVG/PNG 在应用外打开时
  `var()` 无从解析，等于导出空白。
- 面板取对话的底色与字号（右侧 Sidebar 的既定语言：它是页面的一列，不是浮在上面的卡片）。
- 圆角、按钮、下拉、菜单全部使用共享 UI 组件（`ui-primitives`），不自定义控件外观。
- 描边默认 1.5px，`vector-effect: non-scaling-stroke` 保证缩放时线宽稳定。
- 文字自动换行 + 溢出省略；CJK 与拉丁混排按字符宽度测量。
- 无动画（尊重 `prefers-reduced-motion`）；面板展开动画由 dockkit 负责，插件不额外加动效。

---

## 13. 配置项（Host Config schema）

```yaml
- name: '@deepseek-ai/dsh-plugin-flowchart'
  config:
    autoOpen: true          # 新图是否自动展开右侧边栏
    defaultDirection: TB    # TB | LR | BT | RL
    maxNodes: 60
    maxEdges: 120
    maxYamlChars: 20000
    showLegendByDefault: false
    export:
      svg: true
      png: true
```

配置通过 `ctx.config` 声明 schema，宿主自动生成设置界面；插件不在 UI 里自建设置面板。

---

## 14. 国际化与图标

- `locale/en.json` + `locale/zh.json` 全量覆盖所有界面文案；文案通过 Client locale 服务取，
  绝不硬编码在组件里。**目录是 `locale/`（单数）**，v0.3 写作 `locales/`。
- JSON 目录与 bundle 内字典是同一份内容的两个副本（浏览器运行时只能读内联那份），由测试
  互相校验：键集合一致、值一致、每个静态 `t('...')` 都有词条、没有无人引用的词条。
  改文案要动两处——不是靠自觉，是测试会红。
- guide 图标自带 `icon.svg`（原创：三个方块 + 一条带箭头连线；组件内同名 `Glyph`），
  不借用他包图标。v0.3 写作 `assets/flowchart.svg`，实现放在包根。
- 模型-facing 文本（工具描述、参数描述、错误提示）为英文；错误提示里可包含节点 id 原文。

---

## 15. 安全与性能

- 无网络、无 shell；文件系统**只读**（`file` 参数），不写、不改、不创建。
- YAML 安全解析（禁自定义 tag、禁 eval）。
- 渲染纯客户端 SVG，不注入外部脚本，不创建 iframe。
- 上限保护（6.6）+ 布局纯函数 + 一次性渲染，避免大图拖慢会话。
- 工具结果有界，避免污染模型上下文（见 5.4）。
- **插件不许拖垮宿主页面**（v0.4 教训，见 20.3）：Client 半任何组件都不抛错——布局/渲染包
  try/catch 并降级为面板内提示；唯一的命令式宿主调用（`openTab`）包 try/catch；自动展开前
  先确认前台会话。
- **`inject` 必须列出读到的每一个服务**：Client 上下文是代理，读未声明的服务会**直接抛错**
  （`cannot get property "..." without inject`）；`apply` 一抛，插件已做的全部注册整体回滚，
  标签页与卡片一起消失，用户看到的就是"插件把页面搞崩了"。

---

## 16. 备选方案与取舍

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 渲染 | 自研轻量布局 + SVG | 引入 Mermaid | Mermaid 体积大、样式与主题不可控、描边/形状控制粒度粗、模型写 Mermaid 语法错误率高；自研可控且与产品视觉一致 |
| 布局 | 自动分层布局 + 显式 `pos` 覆盖 | 纯手工坐标 | 模型写坐标极易重叠；自动布局保证可读，`pos` 保留精确控制能力 |
| 传递 | `yaml` 内联 + `file` 读工作区文件，双通道 | 只做内联 / 只做文件 | 内联零副作用、事件里天然持久，适合小图；`file` 适合大图与版本管理。两者在 Host 侧汇流成同一份归一化文档（见 9.1） |
| 落点 | 右侧 Sidebar 标签页 + 对话内工具卡片 | 仅对话内嵌 / composer dock | 边栏有独立空间、可长时间参照、可并排看代码；卡片负责发现 |
| 布局计算位置 | Client | Host | 需要真实字体度量；Host 计算会与 Client 视觉不一致 |
| 更新语义 | 同 `id` 替换（版本 +1） | 每次调用新建 | 代理迭代修图时不应堆出 5 个标签页 |
| Client 半形态 | 生成物单文件（`scripts/build-client.mjs` 内联 `lib/*` + `client/ui.js`） | 手写单文件 / 拆多包 | 浏览器模块系统按包 id 解析、相对 import 无解析器；共享源码仍是普通 ESM，构建有新鲜度测试兜底 |
| `file` 快照通道 | 结果文本里的 fenced 快照（原始 YAML） | 结构化呈现元数据 | 实测 `tool/result` 无结构化值字段，退路即文档预留方案；存原始 YAML 让 fold 用同一校验器重算 |

---

## 17. 里程碑

| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 | bundle 骨架 + Host 注册空工具 + Client 注册空标签页 | 安装后工具可见、边栏 guide 出现、双语显示 | ✅ `c4785f0` |
| M1 | DSL 解析 + 四层校验 + `file` 读取 + 错误反馈 | 20 条正/负用例（Tab 缩进、拼错 shape、悬空边、文件不存在）；9.1 快照持久化可用 | ✅ `9bd7c74`，42 例 + 持久化回放 |
| M2 | 形状库 + 布局引擎 + SVG 渲染 | 60 节点布局 <30ms；四向正确；描边开关生效 | ✅ `5eeb99e`，实测 0.7ms |
| M3 | 边栏标签页 + 投影下发 + 自动打开 + 工具卡片 | 重启后可重建；fork 带图；关闭后不再自动展开 | ✅ `8abce03`（fork 继承未单独验证，见 19） |
| M4 | 导出、分组、图例、主题打磨、双语校对 | 明暗对比；导出 SVG/PNG 可用 | ✅ `4c810ac`，22 例；PNG 光栅化仅浏览器可验 |
| M5 | 触发效果评估（工具描述调优） | 10 个真实"文字难懂"场景观察是否恰当调用 | ✅ `9b5628e`（评估揪出并修掉一个 schema 缺陷，见 21） |

中间还修掉三个实现期缺陷（都带回归测试）：边标签被节点遮挡与图例压图（`69c176f`）、
Client `apply` 读未声明服务导致注册回滚（`ece1d03`）、投影从 checkpoint 恢复时崩溃（`938741c`）。

---

## 18. 决策记录

### 18.1 已确认（2026-10-18 审阅，两轮全部落定）

| # | 议题 | 决策 |
|---|---|---|
| 1 | 边栏落点 | 右侧 Sidebar 独立标签页 + 对话内工具卡片 |
| 2 | YAML 传递 | `yaml` 内联 **和** `file` 读工作区文件，双通道都支持 |
| 3 | 自动展开 | 新图自动展开右侧边栏，配置项 `autoOpen` 可关闭 |
| 4 | 更新语义 | 同 `id` 替换（版本 +1），不堆标签页 |
| 5 | 导出 | 浏览器侧导出 SVG / PNG；**不做** `saveTo` 写工作区 |
| 6 | 描边默认 | **默认带描边**，`strokeWidth: 1.5`、`stroke: auto`；关闭描边用 `strokeWidth: 0` / `stroke: none` |
| 7 | 触发强度 | **只靠工具描述触发**，不注入 system prompt、不加常驻提示。M5 评估后若触发不足再单独评审 |
| 8 | 图类型范围 | v1 只做"节点 + 有向边"（流程图 / 状态图 / 调用链）。**时序图、ER 图暂不排入 v2**，不预留专用抽象 |
| 9 | `file` 刷新语义 | **不做"重新读取"按钮**。文件是调用时的快照，要刷新由代理重发同 `id` |

第 7 项的落法：工具 `description` 里写清触发条件（见 5.2），插件不注册 `systemPrompt.section`、不使用 `tools.guard`。

第 8 项的落法：DSL 不引入"泳道""生命线""实体关系"等专用概念；时序图若将来要做，作为独立工具而非本 DSL 的扩展字段。

第 9 项的落法：边栏工具条里没有"重新读取"入口；`file` 来源的文档在卡片上显示来源路径，便于用户知道内容来自文件快照。

### 18.2 实现期补充决策（v0.4 新增）

v0.3 定稿后，实现过程中有 9 处必须当场决定的地方。它们不是"更好的设计"，而是**照原文写会坏**
或者**原文假设的接口不存在**，所以逐条记下理由。

| # | 议题 | v0.3 原文 | 实际做法 | 理由 |
|---|---|---|---|---|
| 1 | 标签页数量 | §10 `multiple: true` | `multiple: false` | `true` 会给每次 `openTab` 生成随机地址，等于每开一次多一个标签页，与 §19.3 和工具条的文档切换冲突 |
| 2 | 自动展开位置 | 全局 effect 订阅 `lastSeq` | 放在工具卡片里 + 比对 `mounted` | 卡片只在"该调用所在、且会话在屏"时挂载；比推断 `lastSeq` 归属更准确，且天然满足"后台会话不展开" |
| 3 | `color: auto` | 一律主题前景 | 显式 `fill` 上按 WCAG 对比度选深/浅墨 | 照原文写，深色填充就是深底深字，作者必须手写 `color`；对比度是可算的 |
| 4 | `size` / `pos` 单位 | 栅格单位 | **像素**，落位时吸附 `canvas.grid` | 原文示例 `size: [160,80]` 只有按像素才合理（栅格单位×8 = 1280px）；且 `pos` 用于"精确控制" |
| 5 | `file` 快照通道 | 结构化呈现元数据 | 结果文本里的 fenced 快照，存原始 YAML | `tool/result` 无结构化值字段（实测）；存原始 YAML 让 fold 用同一校验器重算，永不与工具判定分歧 |
| 6 | 图例落位 | 画布右下角 | 右下角空则就地放，被占则向下长出图例带 | 直接放会压住图（用户实际反馈过） |
| 7 | 组框标题 | 成员包围盒 + padding | 有标题时上方另加 18px 标题带 | 只留 16px 时标题基线正压成员上沿 |
| 8 | 平行边错开 | 折线错开 8px | **挪锚点** 8px | 两节点正对时，折中间的弯会退化回同一条线 |
| 9 | 边标签落点 | 线中段 | 正交选"中点不在节点内"的线段；曲线取贝塞尔上第一个不在节点内的 t | 弦中点常横穿图中间的节点，遮罩也救不了"完全被节点盖住" |

另有三条**不是偏离、但文档没写清**的实现约束，一并记下：

- `inject` 必须列出读到的每个服务（否则 `apply` 抛错、注册整体回滚）；
- `stateVersion` 必须随状态形状变化 +1；
- Client 半是生成物，改完源码要 `npm run build:client`。

---

## 19. 验收标准（做完后怎么验）

1. 安装插件后，`FlowChart` 出现在工具清单，边栏 guide 出现"流程图"入口。
2. 让代理解释一个含分支与回滚的流程 → 代理调用 `FlowChart` → 右侧边栏出现图，节点形状/颜色/描边/文字与 YAML 一致。
3. 让代理改一个节点颜色并重发同 `id` → 同一标签页内容更新，不新增标签页。
4. 刷新页面 / 重启会话 → 图仍在。
5. fork 会话 → 子会话能看到继承的图。
6. 明暗主题切换 → 图自动跟随，显式颜色保持不变。
7. 故意让代理写坏 YAML（拼错 shape）→ 代理收到可操作错误并自行修对，边栏不出现空标签页。
8. 让代理用 `file: ./flow/deploy.yaml` 传图 → 边栏出现同一张图；**重启会话后这张图仍能重建**（验证 9.1 的快照持久化）；文件不存在时错误信息里带解析后的绝对路径。
9. 导出 SVG 与 PNG 可在外部打开，颜色与边栏一致。
10. 英文与中文界面下所有文案正确，无硬编码字符串。

**逐条状态（v0.4）**

| # | 验收项 | 状态 | 依据 |
|---|---|---|---|
| 1 | 工具可见 + guide 入口 + 双语 | ✅ | 插件挂载后 `Tool.listTools` 有 `FlowChart`；Slot 里有 `@local/dsh-plugin-flowchart` 占用 |
| 2 | 图与 YAML 一致 | ✅ | `samples/*.svg` 人眼复核；几何审计测试断言形状/文本/箭头 |
| 3 | 同 id 更新不新增标签页 | ✅ | `multiple: false` + 投影同 id 版本 +1；组件测试覆盖 |
| 4 | 刷新 / 重启后图仍在 | ✅ | 投影行（`ver=2`）落盘 + `test/persistence.mjs` 从行播种续折与全量折叠一致 |
| 5 | fork 子会话带图 | ⚠️ 未单独验证 | fold 基于事件序列、init 与 inheritedEventCount 由注册表统一处理，理论上成立；未造 fork 实测 |
| M5 | 触发效果 | ✅ | 见 21：修复前后对照，误触发 0/6；触发判断本身 7/7 正确，缺陷在输入 schema |
| 6 | 明暗主题跟随 | ✅ | `samples/export-light.svg` 与 `export-dark.svg` 对比；测试断言几何一致、颜色不同 |
| 7 | 坏 YAML 可操作且不产生空标签页 | ✅ | 22 条负例 + 投影 `failures` 支撑卡片显示前 3 条错误 |
| 8 | `file` 传图 + 重启可重建 + 缺失文件带绝对路径 | ✅ | tool-contract 测试覆盖三条；持久化回放用真实会话日志验证 |
| 9 | 导出 SVG/PNG 可外部打开 | ⚠️ SVG ✅ / PNG 仅浏览器可验 | `buildExportSvg` 断言无 `var()`、颜色烘焙；PNG 走 `Image`+`canvas`，Node 无 DOM 无法测 |
| 10 | 双语完整、无硬编码 | ✅ | 4 条文案断言（静态 key / 动态 key / 键集一致 / 无死词条） |

---

## 20. 维护须知（v0.4 新增）

这一节不是设计，是"拿到代码后怎么用它、坏了怎么查"。

### 20.1 常用命令

全部在 `dsh-plugin-flowchart/` 下执行：

```bash
npm test              # 8 套测试，串行跑完
npm run build:client  # 改过 lib/*.js 或 client/ui.js 之后必须跑
npm run samples       # 重新生成 samples/*.svg（人眼复核用）
```

`npm test` 包含：DSL 解析、四层校验与投影折叠（49 例）、布局（36 例）、SVG 渲染（36 例）、
工具契约（10 例）、M4 打磨（22 例）、持久化回放（读真实会话日志）、客户端组件（21 例）、
客户端 bundle（9 例，含"生成物是否落后于源码"）。

**改代码的正确顺序**：改 `lib/*.js` 或 `client/ui.js` → `npm run build:client` → `npm test`。
`client.js` 是生成物，手改会在下一次构建时被覆盖，且 `npm test` 会报"stale"。

### 20.2 文件地图

| 文件 | 管什么 | 改它的后果 |
|---|---|---|
| `index.js` | 工具注册、`file` 读取、Config、投影注册 | 改 Config 键要同步 13 节 |
| `lib/dsl.js` | YAML 子集解析（行列定位、Tab/缩进报错） | 动它就是动所有错误信息的行号 |
| `lib/normalize.js` | 第 2–4 层校验 + 归一化（默认值、颜色、容量） | Client 直接渲染它的输出，字段增删要同步 `svg.js`/`ui.js` |
| `lib/projection.js` | 事件折叠、`callId`/`failures`/`settings` | 改状态形状必须 `STATE_VERSION + 1` |
| `lib/layout.js` | 九步布局（分层、排序、坐标、路由、组框、视图盒） | 纯函数；改完跑 layout 测试 + `samples` |
| `lib/svg.js` | 形状、箭头、颜色解析、图例 | 纯函数；导出的颜色烘焙也在这里 |
| `lib/metrics.js` | 文本度量与换行 | 影响节点尺寸，不影响拓扑 |
| `client/ui.js` | 边栏面板 + 工具卡片 + 导出交互 | 改完必须 `build:client` |
| `locale/{zh,en}.json` | 文案目录（与 bundle 内字典互校） | 只改一处测试会红 |

### 20.3 故障排查

| 症状 | 先查 | 原因 |
|---|---|---|
| 工具列表里没有 `FlowChart`，边栏也没有入口 | `plugin_manager list_bundles` | bundle 没挂载（`enabled: false`）。重新 `set_bundle enabled: true` |
| 页面崩了 / 标签页与卡片同时消失 | `plugin_manager list_plugins` 看该 entry 的 `fiberPhase` | Client `apply` 抛错导致注册整体回滚。最常见原因：读了没写进 `inject` 的服务 |
| **会话显示"不可用"**（v0.4.1 实际发生过，`2222353` 修复） | 该会话的投影缓存行是否由坏版本写入 | `restore()` 对 checkpoint 行的 `stateSchema.parse` 无守卫，一行坏条目就抛错。v0.4.2 起 schema 永不拒绝行（坏条目丢弃、日志重放重建），`apply` 全链路防抛——本插件在结构上不再可能把会话搞挂 |
| 图不刷新 | 是否用了新的 `id` | 同 id 才会就地更新；改文件不会让旧图变（快照语义） |
| 导出的 SVG/PNG 一片空白或全黑 | 导出是否走 `buildExportSvg` | 导出必须烘焙具体颜色，`var()` 在应用外无从解析 |
| 边标签/图例压住内容 | 布局的落点与占位逻辑 | 见 6.5（图例落位）与第 8 节第 7 步（边标签落点） |

**判断插件是否活着**（不需要看浏览器）：`cordis_inspect_query` 查
`sidebar.right.pane.tab` 与 `tool.call.toolview` 两个 Slot，占用里有
`@local/dsh-plugin-flowchart` / `FlowChart` 且 `active: true` 即为激活。
占位消失 = 客户端激活失败，不是"没画出来"。

---

## 21. M5 触发效果评估记录（v0.4.1）

方法：10 个贴近真实的场景投给**独立子代理会话**（不诱导——提示词不含"图""流程图""FlowChart"等字样），
按场景类型分两组：7 个"结构难懂"（应触发）、3 个"翻译/改代码/资源判断"（不应触发）。
判定以**会话日志里的 `tool/call` 事件与投影行**为准，不以子代理的口头汇报为准。

### 21.1 结果

| 组 | 修复前（v0.4.0） | 修复后（v0.4.1，见 21.2） |
|---|---|---|
| 应触发（7 个） | **7/7 模型都决定调用** FlowChart，但 4/7 发出**空参数 `{}`**，8 次调用全部被工具拒绝，代理退回文字/Mermaid/YAML 文件交付；3 个在其它会话成功画图或其路由本身不带 FlowChart | 同一批提示词复测：应触发场景 2/4 直接产出合法图表（`backend-release` 15 节点 17 边、`order-state-machine` 6 节点 6 边），0 次空参；其余场景的子代理投给 `swift` 路由（该路由子代理另有工作习惯，未触发即直接文字作答，记为"未触发"，与工具缺陷无关） |
| 不应触发（3 个） | **0/6 调用**（修复前后两轮各 3 个，一致） | 误触发 0 |

关键结论：

1. **工具描述的触发判断本身是好的**——修复前模型在参数传不进去的情况下仍然 7/7 选择了调用；
   描述不需要为"没触发"负责。
2. **真正的缺陷在工具输入 schema**（见 21.2），它把"模型想画"变成了"画不出来"。
   M5 的价值正在于此：只看注册代码永远不会发现，只有把工具放进真实会话才暴露。
3. 触发有合理的场景波动（同一提示词有的轮次选择不画），这属于模型行为噪声，
   不构成对描述的修改依据；§18.1 决策 7（只靠描述触发）维持不变。

### 21.2 评估揪出的缺陷：输入 schema 形状

`ctx.tools.register()` 把 `parameters` **原样透传**给模型。M0 注册时传的是 friendly
spec-map 形状（`{ yaml: {...}, file: {...}, open: {...} }`，当时的依据是"其它工具也这么传"），
但实际到达模型侧的是**没有 `type`/`properties` 的残缺 schema**——用 `Tool.listTools`
对比可见：其它工具都是 `{ type:'object', properties:{...}, required:[...] }`，
唯独 `FlowChart` 的顶层键直接是参数名。

后果：弱模型（GLM-5.3-Flash）看到一个"无参数工具"，按 schema 规矩发 `{}`，
连续 8 次；强模型靠鲁棒性硬猜 `{yaml: ...}` 才碰巧能用——本会话主人此前观察到的
"我发的调用偶尔变成空参重试"，根因同此。

修复（`9b5628e`）：`parameters` 改为标准 JSON Schema。**教训：注册完必须用
`Tool.listTools` 或 `request/header` 事件复核模型实际看到的形状，不能只看注册代码。**
