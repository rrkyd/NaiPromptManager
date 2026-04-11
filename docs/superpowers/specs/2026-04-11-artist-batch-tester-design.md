# Artist Batch Tester 迁移设计说明

**日期**: 2026-04-11  
**项目**: NaiPromptManager  
**来源参考**: `Auto-NovelAI-Refactor/plugins/anr_plugin_artist_batch_tester`（Python/Gradio，逻辑以该插件为准进行 TypeScript 移植）

## 1. 背景与目标

将原 ANR 插件中的「画师批量测试」能力迁移到 NaiPromptManager：在浏览器内串行调用现有 NovelAI 代理与 `naiService`，复用应用内的登录、军火库、本地历史与灵感发布能力。

## 2. 需求结论（已确认）

| 主题 | 决策 |
|------|------|
| 总体范围 | 优先跑通批量生图闭环；实现与插件一致的 **Equal / Fixed Some / Full Random / Iterate / Single** 等强度策略；支持策略块 + 可选附加段 + 基底正向词；可粘贴外部复杂片段（见 §4）。**不包含**：审查工作台、HTML 导出/导入、失败包导出（后续迭代）。 |
| 画师来源 | **C**：军火库多选导入 + 自由粘贴文本；合并与去重（与插件语义对齐的可移植子集）。 |
| 导航 | **A**：侧栏独立一级入口（名称可定为「批量测试」等，实现时与 UI 文案统一）。 |
| 生成结果 | **C**：每张成功图写入 **本地 GenHistory**；列表内提供单张 **发布到灵感**（复用现有灵感发布流程）。 |
| 生图参数 | **独立参数**：批量页维护 **独立的** `NAIParams` 与 `negativePrompt`，**不与「实验室」共用状态**、不做实时双向绑定。 |
| 游客 | **A**：游客可使用批量测试（与登录用户同能力边界，仍遵守全站对游客的其他限制，如「我的」等）。 |
| 架构 | **领域模块 + 薄 UI**：纯函数置于 `services/artistBatch/`（或 `lib/artistBatch/`）；页面组件只负责状态与调用 `naiService`。**不在 Worker 端执行批跑**（API Key 仅存客户端）。 |

## 3. 架构与模块边界

### 3.1 `artistBatch` 领域模块（无 React、无网络）

职责建议与插件对应关系如下：

- 解析画师输入（`artist:`、逗号分隔、`::` 权重片段、CSV/文本导入的合并规则等与插件一致的可移植部分）。
- 去重与规范化（与插件 `_normalize_artist_name` / `_display_artist_name` 行为一致）。
- `MAX_ARTISTS = 20` 截断与校验。
- 构建 `strength_map`：**Equal / Fixed Some / Full Random / Iterate / Single**（算法以 Python 版 `_build_strength_map`、`_build_jobs` 为参照在 TS 中实现）。
- 组合 `artist_prefix`：`_compose_artist_prefix` 等价逻辑；含可选「非画师/附加」文本块。
- 生成任务列表 `jobs[]`：每条含 `full_prompt`、`signature`（用于可选去重）、索引、状态占位字段等。

单元测试：对解析、job 数量（含 Single 模式下 `images_per_artist`）、固定强度表解析等使用表驱动测试。

### 3.2 UI 组件

- 新建页面组件（如 `ArtistBatchTester.tsx`）：表单（画师池、多选、模式与滑条、固定强度文本、批量次数、Single 模式每画师张数、冷却/重试若实现则与插件对齐）、队列表/进度、结果缩略图列表、军火库导入按钮、启动/停止（暂停视实现成本可选）。
- `App.tsx`：新增 `view` 状态值；路由到该组件。
- `Layout.tsx`：新增导航项；游客可见（不因 guest 隐藏该项，除非与全站策略冲突时再单独讨论）。

### 3.3 生图与存储

- 调用现有 `generateImage(apiKey, prompt, negative, params)`，其中 `params` 与 `negative` 来自 **批量页本地状态**。
- 串行执行队列；使用布尔标志或 `AbortController` 支持用户 **停止**（必选）；**暂停**若实现则通过文件级标志或组件内 ref 轮询，与插件 pause/stop 语义类似即可。
- 成功：写入 **GenHistory**（与现有本地历史结构一致）；UI 提供 **发布到灵感** 单条入口。

## 4. Prompt 拼接顺序（与插件对齐）

为避免歧义，MVP 采用与参考插件一致的语义：

1. 由策略与所选画师生成带权重的 **`artist_prefix`**（内部可包含插件中的 `non_artist_block` 等价物：用户可选「附加段」文本，用于粘贴外部复杂前缀/非画师块）。
2. 最终正向 prompt：`full_prompt = "{artist_prefix}, {base_positive}"` 经逗号与空白规整（与 Python 中 `f"{artist_prefix}, {positive_prompt.strip()}".strip(", ")` 同类行为）。

「组合方式 B」：**策略负责画师权重块**；**附加段**作为 `_compose_artist_prefix` 流程中的一段（与插件 `non_artist_block` 一致），再与 **本页「基底正向 prompt」** 拼接。

## 5. 种子（Seed）— MVP

不实现插件中的 **Random / Global Seed / Per-Artist Seed** 三策略（延后迭代）。

MVP 行为：**完全由批量页当前的 `NAIParams.seed` 决定**（与全站 `naiService` 约定一致）：

- 若 seed 为未设置、`-1` 或表示随机的约定值：**每一条 job 均不传固定 seed**（由 API 侧按单次请求随机），以保证批量张张之间有变化。
- 若用户设为有效整数：**全队列每条 job 复用该同一 seed**（便于对照变量时固定噪声；若需「每条不同固定种子」属后续迭代）。

> 说明：曾与「实验室」共用参数的设想已废止；生图参数与 seed 仅以批量页为准。

## 6. 可选功能与上限

- **去重**：插件 `dedupe_guard`（按 prompt signature）可作为 MVP 可选勾选，默认关闭或与插件默认一致，由实现计划决定。
- **冷却 / 重试**：与插件类似的可配置随机冷却与重试次数；上限在 UI 用 slider 约束（如 batch 上限 500、每画师张数上限 20）。
- **水印**：插件含水印；若浏览器端可对生成结果做 Canvas 水印则可选，**非 MVP 必选**（实现计划标注为 P2）。

## 7. 错误处理

- 展示每条 job 的失败原因（API 返回或网络错误）。
- 重试策略（MVP 固定）：每条 job 失败后 **最多再试 1 次**，间隔 **3 秒**（可被取消/停止打断）；仍失败则标记 Failed。若与 NovelAI 限流冲突，实现时可对 429 延长等待，但不在本 spec 展开细节。

## 8. 明确不包含（非 MVP）

- 审查工作台（拖图、行编辑、双击复制、HTML 导出/导入）。
- 失败任务导出 bundle（JSON/CSV/HTML）。
- 插件级三种种子策略。
- Cloudflare Worker 端代跑批量任务。

## 9. 验收标准（建议）

- 从军火库导入画师 + 手动粘贴合并后，能生成预期数量的 jobs（含 Single 模式）。
- 五种强度模式下，抽样对比与 Python 插件同一输入下的 `full_prompt` 列表一致（允许空白/逗号规范化差异，需在测试中约定）。
- 串行生图成功写入 GenHistory；发布灵感单张可用。
- 停止运行后不再发起新的生成请求。
- 领域模块核心函数具备单元测试覆盖。

## 10. 后续步骤

本文件经评审确认后，使用 **writing-plans** 产出分步实现计划（含文件清单与顺序），再进入编码。
