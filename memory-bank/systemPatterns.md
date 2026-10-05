# 系统模式 — Paget

## 分层架构

```
┌────────────────┐  invoke  ┌──────────────────┐  stdin/stdout  ┌────────────────────────┐
│ React  src/    │ ───────▶ │ Rust src-tauri/  │ ── 一行一个 JSON ─▶│ python -m wreader.serve│
│ 书房 / 阅读页   │ ◀─────── │  lib.rs          │ ◀──────────────  │ ~/.wreader（权威）      │
└────────────────┘          │  core_client.rs  │                  └────────────────────────┘
                            │  db.rs (SQLite)  │──▶ cache.sqlite3（可删缓存）
                            │  archive.rs      │──▶ app_data_dir/archived/*.zip（封印）
                            └──────────────────┘──▶ app_data_dir/covers/<id>.*（本地封面 + 生成方案）
```

三层职责：**React 只画**（不过手任何规则）；**Rust 是薄壳**（转发内核 + 管理缓存 / 归档 / 封面）；
**Python 内核拥有数据**。

## 模块职责表

### 前端 `src/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `main.tsx` | 9 | 挂载 `App` |
| `App.tsx` | 132 | 外壳：书房（`Shelf`）+ 三个挂件展开页（stats / achievements / desk）+ 阅读页；启动同步、清缓存 |
| `App.css` | 3,597 | 全部样式（书房昼夜、书脊、过场、封印动画、各页） |
| `lib/core.ts` | 397 | **唯一**和后端说话的地方：`coreRequest` 直通内核，其余是缓存 / 封面 / 归档 / 限时 / 能力探针的类型化包装 |
| `lib/types.ts` | 337 | 内核回包的 wire 形状（`BookRow` / `TocEntry` / `TextSlice` / `ArchiveMeta` …） |
| `lib/format.ts` | 134 | 格式化，**逐条镜像内核算法**（见 `projectbrief.md` 约束 4） |
| `lib/deadlines.ts` | 104 | 限时模式纯函数（`localDay` / `addDays` / `dueMoment` / `expiredBooks`）+ 限时表读写 |
| `lib/coverGenerator.ts` | 134 | 没有封面图时"算"封面：FNV-1a hash → 10 套配色 + 书名头 1~2 字；`COVER_SPEC_VERSION = 1` |
| `views/Shelf.tsx` | 1,147 | 书房：书架 / 翻屏箭头 / 搜索遮罩 / 右键菜单 / 导入 / 限时到期检查与封印 / 封面加载 / 玩具 |
| `views/Reader.tsx` | 316 | 阅读页：`text` 分页（40 行）、`toc` 跳章、书签、60s 自动存位置、退出记 session |
| `views/Stats.tsx` | 195 | 统计页（内核 `stats` + 30 天热力图） |
| `views/Achievements.tsx` | 146 | 成就页（打开时补记 `achievements_view`） |
| `views/Desk.tsx` | 68 | 齿轮：设置 / 数据 / 已归档三个页签 |
| `views/Settings.tsx` | 278 | 设置：按 `config_get` 的值类型渲染布尔 / 数字 / 文本，写回 `config_set` |
| `views/Data.tsx` | 287 | 数据：路径展示、导出 / 合并备份、`prune` / `clear`（含页内二次确认） |
| `views/Archived.tsx` | 122 | 已归档：列表 + 一键找回 |
| `components/BookContextMenu.tsx` | 387 | 右键菜单 + `BookStatsDialog` / `BookPropsDialog` / `ConfirmDeleteDialog` / `LimitDialog` |
| `components/BookTransition.tsx` | 208 | 开书过场：抽书 0.5s → 横转 0.8s → 停留 3s → 翻页 0.5s（纯 CSS 3D） |
| `components/SealEffect.tsx` | 110 | 封印动画：书脊原位光点飞散（28 颗，黄金角）+ 提示条 |
| `assets/wood-texture.svg` | — | 木纹背景 |

### 壳层 `src-tauri/src/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `main.rs` | 6 | 调 `paget_lib::run()` |
| `lib.rs` | 840 | 18 个 `#[tauri::command]`、封面查找 / base64、`use_project_data_root`、归档命令、`run()` |
| `core_client.rs` | 622 | 内核 sidecar 的 JSON-RPC 客户端；`CoreCommand::resolve` 决定用哪个解释器/冻结点 |
| `db.rs` | 1,002 | 本机 SQLite 缓存：schema、CJK 分词、切块计划、全文搜索、GUI 位置与设置 |
| `archive.rs` | 814 | 手写 ZIP：`seal` / `read_meta` / `extract_payload` / `list` |

### 打包 `packaging/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `build-core.sh` | 129 | 找解释器 → 在临时目录里跑 PyInstaller（`werd-core.spec`）→ 装到 `src-tauri/binaries/werd-core/` → `smoke_core.py` 验协议 |
| `werd-core.spec` | 94 | PyInstaller 配方：**onedir + console**，收集 `wreader/data/`，排除 `rich`/`curses`，保留 `requests` |
| `werd_core.py` | 15 | 冻结二进制的入口（`wreader.serve.main`） |
| `smoke_core.py` | 292 | 对冻结点真发一轮协议，确认它能干活 |
| `make_icon.py` | 351 | 生成应用图标 |

## 关键设计模式

1. **薄壳 + 万能转发**：`core_request(method, params)` 直通内核，前端能调 `wreader/serve.py` 的任何方法，
   不必为每个方法加一条 Rust 命令。真正需要壳层能力的（缓存 / 封面 / 归档 / 原生面板）才单独成命令。
2. **数据所有权切分**：内核权威 / SQLite 可抛。判据：这东西丢了会不会让用户损失数据？会 → 内核；不会 → 缓存。
3. **前端打时间戳**：`synced_at` / `sealed_at` 由前端给（前端才知道时区），壳层只存不解释。
4. **能力探针**：`coreCapabilities()` 用假 book id 各探一次 `remove` / `finish`，探测零副作用；
   只有明确回 `unknown method` 才判"不支持"（其它错误一律按支持算，真调用时会报清楚）。
5. **纯函数与 IO 分离**：`deadlines.ts`、`coverGenerator.ts`、`db::chunk_plan`、`db::segment_cjk` 都是纯函数，
   所以能脱离界面 / webview 做单测。
6. **写在前、删在后（可回退）**：封印先写 zip（原文件还在），再让内核 `remove`；
   内核失败就把刚写的 zip 删掉 —— 最坏情况是"这本书没被封印"，不会丢数据。
7. **找回绕一趟临时目录**：解压到 `temp/` 再交给内核 `import`，否则内核会在 `novels/` 里
   再复制一份（`..._utf8(2).txt`）变成两本书。正文没变 → book id 与封印前一致 → 进度写得回去。
8. **自解释归档**：元信息（书名 / 作者 / 原文件名 / 封印时刻 / 到期日 / 进度快照）随 zip 走，
   列表与找回只依赖归档目录本身，缓存清掉 / 换机器都认得出。
9. **"检出优先 dev、随包优先 release"**：`CoreCommand::resolve` 在 release 构建里认随包冻结点，
   在 dev 构建里走 `../wreader/.venv/bin/python`，这样改了内核立刻生效，不被旧冻结点盖住。
10. **缓存"检测并重建"**：`SCHEMA` 一次 `CREATE ... IF NOT EXISTS`，`SCHEMA_VERSION` 变了就整库重建，
    不做逐表迁移（缓存的价值在于可抛）。
11. **一屏不滚动**：书多于一屏（`PAGE_SIZE=40`）用两侧箭头翻屏，而不是滚动条 —— 这是"书房"的视觉前提。
12. **昼夜主题**：`useSky()` 按系统时间（6 点天亮 / 18 点天黑）给 `main` 换类名，CSS 写 `.study.day` / `.study.night` 两套。
13. **嵌入式页面**：`Settings` / `Data` / `Archived` / `Stats` / `Achievements` 既能当整页（自带顶栏 + 返回），
    也能 `embedded` 交给 `Desk` 排版 —— 靠可选 props 复用，不搞路由。
14. **封面"只算不画"**：`coverGenerator` 只算方案，真正画的是 DOM + CSS（`BookTransition` 的 `.cover-*` + `App.css`）。
15. **纯 CSS 动画 + 黄金角**：过场与封印光点不用动画库、不用图片、不引随机数（方向由下标算出，可重放）。

## 关键调用链

- **同步书架**：`App.refresh` → `cachedShelf()`（先画缓存，瞬间） → `coreVersion()`（顺带当"内核还活着"的探针）
  → `sync_shelf`（内核 `list` → 覆盖写缓存 → 回行）。
- **打开一本新书**：`Shelf` 点击 → `bookCover` + `bookRecord`（顺带记"打开"事件） → `BookTransition` 过场
  → `Reader` → `text` / `toc` / `loadGuiPosition` → 60s 定时 `position` → 退出 `session`。
- **到期封印**：书房时钟每秒跳 → `expiredBooks(...)` 命中 → 量书脊坐标 → `archive_seal`
  （内核 `get_book` → `archive::seal` 写 zip → 内核 `remove`） → `SealDissolve` / `SealToast` → `onSync`。
- **找回**：`Archived` → `archive_restore`（白名单校验归档名 → `read_meta` → 解到临时目录 →
  内核 `import` → 内核 `position` 写回进度 / 书签 / 读完） → 删掉 zip → 刷新书架。
- **导入**：书架「＋」 → `pick_import_paths`（macOS `NSOpenPanel`） → 逐个内核 `import`。
- **全文搜索索引**：`Reader.建立索引` → `index_book`（内核 `get_book` + `toc` → `chunk_plan` 切块 →
  内核 `text` 取每块 → 分词入库，超过 `MAX_INDEX_LINES` 就在报告里说明"只索引了前半部分"）。

## 必踩的坑（都在代码里留了注释）

1. **没有 epub.js**：内核只留着**转换后的 `.txt`**，原始 epub 不在 `~/.wreader`，epub.js 拿不到书也用不上 CFI。
   于是阅读页走 `text` 按行号分页；CFI 设计保留在 `positions.cfi` 列里。
2. **FTS5 的 `unicode61` 会把一整串汉字当一个词**：`MATCH '三体'` 永远搜不到 `三体世界就在我们眼前`。
   三步缺一不可：入库前给每个汉字两边加空格（`db::segment_cjk`），查询时当**短语**（`MATCH '"三体"'`），
   显示前再去掉空格（`desegment_cjk`）。
3. **`rustc 1.87` 编不动最新依赖**：`icu_* 2.3` / `darling 0.24` / `time 0.3.4x` 都要求 1.88。
   已在 `src-tauri/.cargo/config.toml` 设 `incompatible-rust-versions = "fallback"`，并在
   `Cargo.toml` 声明 `rust-version = "1.87"`（实测把 `wry` 从 0.57 降到 0.55.1）。
4. **不用 `tauri-plugin-sql`，直接用 `sqlx`**：这样 schema、中文分词、切块、全文查询全能在 `cargo test` 里
   脱离 webview 验证，也不会出现「Rust 一份 schema、JS 一份 SQL」的漂移。
5. **`window.confirm()` 在 Tauri 的 WKWebView 里不弹窗**（没实现 `WKUIDelegate` 的 confirm），恒返回 `false`；
   破坏性操作改用**页内确认条**（见 `Data.tsx` 的 `confirmingClear`）。
6. **手写 ZIP 而不是引 `zip` crate**：只用两个条目、不做 ZIP64 / 加密 / 数据描述符；
   读的时候要**先看大小上限**（`MAX_ARCHIVE_BYTES = 512 MiB`），坏归档必须明确报错而不是回半份正文。
7. **`--onefile` 冷启动太慢**：实测 onefile 12–24s（onedir 1.1s、`python -m wreader.serve` 0.7s），
   代价落在用户开机第一屏，所以冻结内核用 **onedir**。
8. **`--ignore-version-mismatches` 不是装饰**：CLI 要求 `@tauri-apps/api` 与 Rust `tauri` crate 的
   major/minor 对齐，但 rustc 1.87 只能让 Rust 侧停在 `tauri` 2.11.6 / `tauri-plugin-opener` 2.5.5，
   而 JS 侧是 2.12.0。插件 API 根本没从 JS 用过，跳过是安全的；**等 rustc ≥ 1.90** 就能删掉这个参数。
9. **UI 不重算百分比**：`percentageOf` 必须与 `library.position_percentage` 一字不差
   （`(pos+1)/total`，最后一行正好 100%），否则同一个进度在终端和界面会差一截。
10. **封印动画的落点要提前量**：书一旦被内核摘掉，书脊 DOM 节点就没了，所以必须在 `archive_seal`
    之前 `spineRect()` 量下坐标；量不到就跳过动画，封印照常。
