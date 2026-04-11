# Artist Batch Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NaiPromptManager 中新增「批量测试」一级页面：移植 ANR 插件的画师解析与多模式强度任务生成逻辑（TypeScript 纯函数）、串行调用 `generateImage`、写入本地历史并支持单张发布灵感。

**Architecture:** `services/artistBatch/*` 承载无 IO 的领域逻辑（与 Python `anr_plugin_artist_batch_tester/__init__.py` 中 `_parse_artist_input`、`_build_strength_map`、`_compose_artist_prefix`、`_build_jobs` 对齐）；`components/ArtistBatchTester.tsx` 管理表单、队列 UI、`useRef` 停止标志与 `localHistory.add`；批量页维护**独立**的 `NAIParams` + `negativePrompt`，复用 `ChainEditorParams` 展示参数。

**Tech Stack:** React 19、TypeScript、Vite 6、Tailwind 4、Vitest（新增）、现有 `naiService.generateImage`、`db.saveInspiration`、`localHistory`。

**权威需求文档:** `docs/superpowers/specs/2026-04-11-artist-batch-tester-design.md`

---

## 文件结构（创建 / 修改）

| 路径 | 职责 |
|------|------|
| `package.json` | 增加 `vitest`、`test` / `test:run` 脚本 |
| `vite.config.ts` | 增加 `test: { pool: 'forks', environment: 'node' }`（或 `environment: 'happy-dom'` 若需 DOM） |
| `services/artistBatch/types.ts` | `BatchMode`、`ArtistBatchJob`、`BuildJobsInput` 等 |
| `services/artistBatch/parseArtists.ts` | `parseArtistInput`、`parseArtistsFromFileContent`、`mergeArtistSources`、`MAX_ARTISTS` |
| `services/artistBatch/strength.ts` | `parseFixedStrengths`、`buildStrengthMap`（五模式） |
| `services/artistBatch/compose.ts` | `composeArtistPrefix`、`buildFullPrompt`（与 spec §4 一致） |
| `services/artistBatch/buildJobs.ts` | `buildJobs`、`sha256Signature` |
| `services/artistBatch/seedForJob.ts` | 按 spec §5 从 `NAIParams.seed` 推导每次请求用的 seed |
| `services/artistBatch/index.ts` | 对外 re-export |
| `services/artistBatch/*.test.ts` | 单元测试 |
| `components/ArtistBatchTester.tsx` | 页面：表单、队列表、跑批、停止、历史写入、发布灵感弹窗 |
| `App.tsx` | `ViewState` 增加 `batch`；`handleNavigate` 加载 artists；渲染 `ArtistBatchTester` |
| `components/Layout.tsx` | 导航项「批量测试」；`onNavigate` / `currentView` 类型包含 `batch`；高亮逻辑与 `playground` 类似处理 |

---

### Task 1: 引入 Vitest

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd g:\Apps\NaiPromptManager
npm i -D vitest
```

- [ ] **Step 2: 修改 `package.json` 的 `scripts`**

在 `"scripts"` 中增加：

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 3: 修改 `vite.config.ts`**

在 `defineConfig` 返回对象中增加（与 `plugins` 同级）：

```ts
test: {
  globals: true,
  environment: 'node',
  include: ['**/*.test.ts'],
},
```

- [ ] **Step 4: 运行 Vitest（应无测试但可启动）**

```bash
npm run test:run
```

Expected: 以 code 0 退出；可能显示 `No test files found` 直至 Task 2 添加测试。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: add vitest for artist batch domain tests"
```

---

### Task 2: `parseArtistInput` 与合并规则

**Files:**
- Create: `services/artistBatch/types.ts`（可先只含常量）
- Create: `services/artistBatch/parseArtists.ts`
- Create: `services/artistBatch/parseArtists.test.ts`

参考 Python：`anr_plugin_artist_batch_tester/__init__.py` 中 `_parse_artist_input`、`_normalize_artist_name`、`_display_artist_name`、`merge_artist_sources`、`_parse_uploaded_artists`。

- [ ] **Step 1: 写入常量**

`services/artistBatch/types.ts`:

```ts
export const MAX_ARTISTS = 20;
```

- [ ] **Step 2: 写失败测试**

`services/artistBatch/parseArtists.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArtistInput } from './parseArtists';

describe('parseArtistInput', () => {
  it('parses artist: tokens and dedupes case-insensitively by normalized key', () => {
    expect(parseArtistInput('artist:Foo Bar, artist:foo bar')).toEqual(['Foo Bar']);
  });

  it('extracts names from weighted segments', () => {
    const out = parseArtistInput('1.2::artist:a, artist:b::');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm run test:run -- services/artistBatch/parseArtists.test.ts
```

Expected: FAIL（模块或函数不存在）。

- [ ] **Step 4: 实现 `parseArtists.ts`**

将 Python 正则与去重逻辑直译为 TS（`normalizeArtistName`、`displayArtistName`、`parseArtistInput`）。导出 `parseArtistsFromFileContent`（`.csv` 用逗号合并行后再 `parseArtistInput`）、`mergeArtistSources(existingText, fileContent: string | null)` 返回 `{ mergedText, artists }`（`mergedText` 为 `artist:x, artist:y` 形式，与插件 `merge_artist_sources` 一致）。

- [ ] **Step 5: 测试通过**

```bash
npm run test:run -- services/artistBatch/parseArtists.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add services/artistBatch/
git commit -m "feat(artistBatch): parse artist input and file merge"
```

---

### Task 3: `parseFixedStrengths` 与 `buildStrengthMap`

**Files:**
- Modify: `services/artistBatch/strength.ts`（新建）
- Create: `services/artistBatch/strength.test.ts`

参考 Python：`_parse_fixed_strengths`、`_build_strength_map`、`_fmt_strength`、`EPS`。

- [ ] **Step 1: 测试 `parseFixedStrengths`**

```ts
import { describe, it, expect } from 'vitest';
import { parseFixedStrengths } from './strength';

describe('parseFixedStrengths', () => {
  it('parses artist:name=strength pairs', () => {
    const m = parseFixedStrengths('artist:Alpha=0.8, artist:Beta=0.6');
    expect(m.get('alpha')).toBe(0.8);
    expect(m.get('beta')).toBe(0.6);
  });
});
```

- [ ] **Step 2: 实现 `parseFixedStrengths`**

- [ ] **Step 3: 测试 `buildStrengthMap` 五模式**

至少覆盖：

- `equal`：全 1.0
- `single`：传入的 `singleStrength`
- `full random`：对同一 `idx` 与 `artists` 列表结果稳定（使用与 Python 相同的 `hash((artist, idx, 'r')) % 1000 / 1000` 公式；TS 用 `hashString` 辅助函数模拟 Python `hash` 的稳定性可改为 **确定性字符串 hash**（例如 FNV-1a）以保证跨运行一致，并在测试中与 **已记录的 golden 值** 断言——实现时打开 Python 对同样输入打印结果，写入测试期望值）。

实现 `iterate`、`fixed some` 时逐行对照 Python `_build_strength_map`（约 253–312 行）。

- [ ] **Step 4: Commit**

```bash
git add services/artistBatch/strength.ts services/artistBatch/strength.test.ts
git commit -m "feat(artistBatch): strength map strategies (Equal/Single/Random/Iterate/FixedSome)"
```

---

### Task 4: `composeArtistPrefix` 与 `buildFullPrompt`

**Files:**
- Create: `services/artistBatch/compose.ts`
- Create: `services/artistBatch/compose.test.ts`

参考 Python：`_compose_artist_prefix`、`_run_internal` 中 `full_prompt` 拼接。

- [ ] **Step 1: 测试**

```ts
import { describe, it, expect } from 'vitest';
import { buildFullPrompt } from './compose';

describe('buildFullPrompt', () => {
  it('joins prefix, optional non-artist block, and base positive like Python', () => {
    const full = buildFullPrompt({
      artistPrefix: 'artist:a',
      basePositive: 'sunset',
    });
    expect(full).toBe('artist:a, sunset');
  });
});
```

`composeArtistPrefix` 需把 `nonArtistBlock`（附加段）按 Python 逻辑并入 `parts`（见 `_compose_artist_prefix` 末尾 `if non_artist_block.strip()`）。

- [ ] **Step 2: 实现并跑测**

```bash
npm run test:run -- services/artistBatch/compose.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add services/artistBatch/compose.ts services/artistBatch/compose.test.ts
git commit -m "feat(artistBatch): compose artist prefix and full prompt"
```

---

### Task 5: `buildJobs` 与 signature

**Files:**
- Create: `services/artistBatch/buildJobs.ts`
- Create: `services/artistBatch/buildJobs.test.ts`
- Modify: `services/artistBatch/types.ts`（补全 `ArtistBatchJob`）

参考 Python：`_build_jobs`。

- [ ] **Step 1: 测试 Single 模式 job 数量**

```ts
it('Single mode: len(jobs) = artists * imagesPerArtist', () => {
  const jobs = buildJobs({
    selectedArtists: ['a', 'b'],
    positivePrompt: 'p',
    mode: 'Single',
    fixedStrengthsText: '',
    randMin: 0.4,
    randMax: 1.2,
    iterMin: 1,
    iterMax: 2,
    iterStep: 0.2,
    iterBase: 1,
    nonArtistBlock: '',
    batchCount: 20,
    imagesPerArtist: 3,
    singleStrength: 1,
  });
  expect(jobs).toHaveLength(6);
});
```

- [ ] **Step 2: 测试非 Single 时 `batchCount` 条**

- [ ] **Step 3: 实现 `buildJobs`**，每条含 `index`、`artists`、`artistPrefix`、`fullPrompt`、`strengthMap`（可序列化或省略 UI 不需要的字段）、`signature`（SHA-256 hex of utf-8 `fullPrompt`，与 Python `hashlib.sha256` 一致）。

浏览器可用 `crypto.subtle` 或引入轻量 sha256；**领域模块保持纯函数**：若 `crypto.subtle` 不便同步测试，使用纯 JS 的 `sha256` 小函数或 `vitest` 环境 `node` 下动态 `import('crypto').createHash`。

- [ ] **Step 4: `services/artistBatch/index.ts` re-export 全部公共 API**

- [ ] **Step 5: Commit**

```bash
git add services/artistBatch/
git commit -m "feat(artistBatch): build job list and prompt signatures"
```

---

### Task 6: 每次请求的 seed 推导

**Files:**
- Create: `services/artistBatch/seedForJob.ts`
- Create: `services/artistBatch/seedForJob.test.ts`

按 spec §5：

- [ ] **Step 1: 测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveSeedForApiCall } from './seedForJob';

describe('resolveSeedForApiCall', () => {
  it('returns undefined when random (undefined)', () => {
    expect(resolveSeedForApiCall({ seed: undefined })).toBeUndefined();
  });
  it('returns undefined when random (-1)', () => {
    expect(resolveSeedForApiCall({ seed: -1 })).toBeUndefined();
  });
  it('returns fixed number when seed set', () => {
    expect(resolveSeedForApiCall({ seed: 42 })).toBe(42);
  });
});
```

- [ ] **Step 2: 实现** `resolveSeedForApiCall(params: Pick<NAIParams, 'seed'>)`

- [ ] **Step 3: Commit**

```bash
git add services/artistBatch/seedForJob.ts services/artistBatch/seedForJob.test.ts
git commit -m "feat(artistBatch): map NAIParams.seed to per-request seed for batch"
```

---

### Task 7: UI 组件 `ArtistBatchTester`

**Files:**
- Create: `components/ArtistBatchTester.tsx`
- Modify: `types.ts`（若需导出 Batch 相关类型给组件，可选；优先组件内联类型）

- [ ] **Step 1: Props 定义**

```ts
interface ArtistBatchTesterProps {
  currentUser: User;
  artistsData: Artist[] | null;
  onRefreshArtists: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}
```

- [ ] **Step 2: 状态**

- `artistText`、`selectedNames`（最多 `MAX_ARTISTS`）
- `basePositive`、`negativePrompt`、`nonArtistBlock`
- 模式 radio：`Equal` | `Fixed Some` | `Full Random` | `Iterate` | `Single`（与 Python `mode` 字符串一致，注意大小写映射）
- 数值：batchCount、imagesPerArtist、fixed 文本、rand min/max、iterate 四元、singleStrength、cooldown min/max（秒）、`dedupeGuard` checkbox
- `batchParams: NAIParams` 初始默认值与 `App.tsx` 中 playground 默认值对齐（`width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: true, ucPreset: 4` 等）
- `jobs` 运行态：`state` Pending | Running | Success | Failed | Skipped、`attempts`、`error`、`imageDataUrl?`
- `stopRequestedRef = useRef(false)`

- [ ] **Step 3: 军火库导入**

多选 `Artist`（checkbox 或 multi-select），将 `name` 经 `parseArtistInput` 合并入 `artistText` 与 `selectedNames`（去重截断至 20）。

- [ ] **Step 4: 嵌入 `ChainEditorParams`**

```tsx
<ChainEditorParams
  params={batchParams}
  setParams={(p) => setBatchParams(p)}
  canEdit={true}
  markChange={() => {}}
/>
```

负面词单独 `textarea`，与 `ChainEditor` 一致：提交生成时传入 `generateImage` 的 `negative`。

- [ ] **Step 5: API Key**

与 `ChainEditor` 相同：从 `localStorage` 读取（复制现有 key 名，在代码库中 `grep localStorage` `nai_` 或相应键名）。

- [ ] **Step 6: 启动批跑**

1. `buildJobs(...)` 得到静态 job 列表。  
2. `stopRequestedRef.current = false`。  
3. `for` 循环每条：若 `stopRequestedRef` 则标记 Skipped 并 `break`。  
4. 若 `dedupeGuard` 且 `signature` 已在本次运行 `Set` 中，标记 Skipped。  
5. `resolveSeedForApiCall` → 构造 `{ ...batchParams, seed: resolved ?? -1 }` 传给 `generateImage`（若 `undefined`，`naiService` 内部已处理不传 seed）。  
6. 失败：等待 3s（可 `await sleep` + 检查 stop），再试 1 次；仍败则 Failed。  
7. 成功：`localHistory.add(imageUrl, job.fullPrompt, batchParams)`（`prompt` 存完整正向）。  
8. 任务间 `cooldown`：`Math.random() * (max - min) + min` 秒，循环 250ms 检查 stop（对齐插件 `_sleep_with_flags` 的响应性，可简化）。  

- [ ] **Step 7: 停止按钮**

`stopRequestedRef.current = true`。

- [ ] **Step 8: 结果列表与发布灵感**

每条 Success 显示缩略图；「发布」打开 modal：`publishTitle` + 确认调用 `db.saveInspiration({ ... })` 与 `GenHistory.tsx` `handlePublish` 相同字段（`imageUrl`、`prompt`、`userId`、`username`、`createdAt`）。

- [ ] **Step 9: 手动 smoke**

`npm run dev`，登录后进入批量测试，1 job 测试跑通。

- [ ] **Step 10: Commit**

```bash
git add components/ArtistBatchTester.tsx
git commit -m "feat(ui): artist batch tester page with queue and local history"
```

---

### Task 8: 接入 `App.tsx` 与 `Layout.tsx`

**Files:**
- Modify: `App.tsx`
- Modify: `components/Layout.tsx`

- [ ] **Step 1: `App.tsx`**

- `type ViewState = ... | 'batch'`
- `handleNavigate`：当 `newView === 'batch'` 时调用 `loadArtists()`
- `renderContent`：`case 'batch': return <ArtistBatchTester ... />`
- 传入 `artistsCache`、`loadArtists(true)`、`currentUser`、`notify`

- [ ] **Step 2: `Layout.tsx`**

- `LayoutProps.onNavigate` 联合类型加入 `'batch'`
- `navItems` 增加 `{ id: 'batch', label: '批量测试', icon: ... }`（自选 SVG，与军火库区分开）
- 高亮：`currentView === 'batch'` 时该项 active
- 游客 **不**过滤该项（`navItems.filter` 仅排除 `admin` 对 guest 保持原逻辑）

- [ ] **Step 3: `npm run build`**

Expected: `tsc -b` 与 `vite build` 无错误。

- [ ] **Step 4: Commit**

```bash
git add App.tsx components/Layout.tsx
git commit -m "feat(nav): wire batch tester view and sidebar entry"
```

---

## Spec 覆盖核对（计划自检）

| Spec 章节 | 对应任务 |
|-----------|----------|
| §2 多模式强度 + 附加段 + 基底词 | Task 3–5 |
| §2 军火库 + 粘贴合并 | Task 2、Task 7 |
| §2 独立 NAI 参数 | Task 7 `ChainEditorParams` |
| §2 游客可用 | Task 8（导航不过滤 batch） |
| §2 本地历史 + 发布灵感 | Task 7 |
| §3 串行、停止、重试 | Task 7 |
| §4 拼接顺序 | Task 4 |
| §5 Seed | Task 6、Task 7 |
| §6 冷却、去重 | Task 7 |
| §7 重试 1 次 / 3s | Task 7 |
| §8 不包含审查/HTML | 无任务（刻意不实现） |
| §9 验收 | Task 2–8 完成后整体验证 |

## 占位符扫描

本计划不含 TBD/TODO 式步骤；golden 向量需在 Task 3 对照 Python 打印一次后写入测试。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-11-artist-batch-tester.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派生子代理，任务间人工或自动复核，迭代快。  
2. **Inline Execution** — 本会话按 Task 顺序直接改代码，在检查点停顿验收。

你想用哪一种推进实现？
