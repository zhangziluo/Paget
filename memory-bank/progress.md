# 进度总览 — Paget

> 最后更新：**2026-10-05**。汇报进度 / 排优先级时读这个文件。

## 整体状态

**功能完整、可打包运行**：书房 + 阅读页 + 统计 + 成就 + 设置与数据 + 限时归档全部落地，
本机已打出 `.app` / `.dmg` 并实际运行过。壳层有 38 项 `cargo test`，前端类型检查干净（`tsc --noEmit` exit 0）。

2026-10-05 收尾：`git init` + 首次提交、README 与新功能 / 实测数字对齐（见「待办」与「决策演变史」）。

未做的：前端自动化测试、`.clinerules/`、rustc 升级后清 workaround（见「待办」）。

## 已完成功能清单

### 1. 数据通道（壳 ↔ 内核）
- `core_client.rs`：`python -m wreader.serve` 的 JSON-RPC 客户端；`CoreCommand::resolve` 的优先级
  `WREADER_CORE_COMMAND` > `WREADER_CORE_PYTHON` > 随包冻结点（仅 release）/ 检出 venv > `python3`。
- `core_request` 万能转发（任意内核方法），另有 `core_version` 做存活探针。
- **能力探针**：启动时探测 `remove` / `finish`（2026-10-04 起才有），缺失就把菜单项禁用并说明。

### 2. 本机 SQLite 缓存
- `db.rs`：`books` / `chunks` / `chunks_fts` / `positions` / `gui_settings` / `cache_meta`，`SCHEMA_VERSION=1`。
- CJK 分词三件套（`segment_cjk` / 短语查询 / `desegment_cjk`）修掉 FTS5 `unicode61` 的整串汉字问题。
- `chunk_plan` 按章切块（`MAX_CHUNK_LINES=20,000`），索引上限 `MAX_INDEX_LINES=200,000` 并在报告里说明截断。
- `reset_cache` 一键清了重建。

### 3. 书房 / 书架（`Shelf.tsx` + `App.css`）
- 一屏 **40 本**、边缘箭头翻屏、无滚动条；两层架子 + 毛绒玩具（5 种，存 `localStorage`）。
- 墙面挂件：日历（统计）、数字时钟（每秒跳）、徽章盒（成就）、齿轮（设置/数据/已归档）、右上三个小圆钮。
- **昼夜主题**（6/18 点分界）、封面加载（本地图 → 自动生成）、置顶排序。
- **搜索**：纯前端按书名 / 作者过滤，`backdrop-filter` 遮罩从顶部滑下，`/` 或 `⌘K` 打开、Esc 关闭、回车高亮 2 秒。
- **右键 / 长按菜单**：继续阅读、阅读统计、属性、置顶、标记已读、删除（二次确认）、设置限时。
- **开书过场**（`BookTransition.tsx`）：抽书 0.5s → 横转 0.8s → 停留 3s → 翻页 0.5s，纯 CSS 3D；
  有进度的书直接进阅读页，不放过场。

### 4. 阅读页（`Reader.tsx`）
- 内核 `text` 按行号分页（一屏 40 行），跳章节（`toc`）、书签增删跳、每分钟自动写回 `position`（含书签），
  退出经 `session` 记时长与成就；可手动「建立索引」（内核 `text` + `chunk_plan` 入库）。

### 5. 统计与成就
- `Stats.tsx`：内核 `stats`（`werd stats --json` 那份 `build_report`）+ 30 天热力图（字符与图例镜像内核）。
- `Achievements.tsx`：内核 `achievements`，已解锁 + 进行中分组，打开时补记 `achievements_view`（幂等）。

### 6. 设置与数据（齿轮 → `Desk.tsx`）
- `Settings.tsx`：按 `config_get` 的值类型渲染布尔 / 数字 / 文本，写回 `config_set`（点号路径）。
- `Data.tsx`：显示 4 个路径；备份导出 / 合并（`export` / `import_data`）；`prune` / `clear`（页内二次确认）。
- `Archived.tsx`：归档列表 + 一键找回。

### 7. 导入
- 书架「＋」→ `pick_import_paths`（macOS `NSOpenPanel`，文件与文件夹同框多选）→ 逐个内核 `import`。

### 8. 限时模式 / 封印 / 归档（**最新**，2026-10-05）
- 限时表存 `gui_settings` 的 `shelf.deadlines`；到期判定搭在书房时钟上（`expiredBooks`）。
- `archive.rs`：**手写 ZIP**（deflate + CRC-32），归档名 `<sha256(title)[0:8]><4 随机字符>.zip`，
  元信息 `paget-archive.json` 随包走；`MAX_ARCHIVE_BYTES=512 MiB`。
- 封印顺序 **先写 zip 再内核 `remove`**；找回 **解到临时目录 → 内核 `import` → 内核 `position` 写回进度**。
- 封印动画：`SealDissolve`（书脊原位 28 颗光点，黄金角散开）+ `SealToast`（"这本书似乎被兔子藏起来了……"）。

### 9. 打包
- `packaging/build-core.sh`：找解释器 → 临时目录跑 PyInstaller（`werd-core.spec`）→ 装到
  `src-tauri/binaries/werd-core/` → `smoke_core.py` 真发一轮协议验证。
- `tauri.conf.json` 把该目录当资源发（`binaries/werd-core` → `core`），macOS 落
  `Contents/Resources/core/werd-core`。**用户机器上不用装 Python。**
- 实测（2026-10-04，Intel macOS，rustc 1.87）：冻结点 onedir `werd-core` 4.6 MB + `_internal/` 共 34 MB；
  `.app` 40.7 MiB / `.dmg` 18.3 MiB；起来后跑的是随包内核，无任何 `python` 进程。

## 待办（主列表）

| # | 事项 | 备注 |
| --- | --- | --- |
| 1 | ~~更正 `README.md` 的测试数字（26 → **38**）并补写限时 / 归档功能~~ | ✅ 2026-10-05 完成：README 按模块列出 3 / 14 / 9 / 12 项，并新增「限时 → 封印 → 已归档」一节 |
| 2 | ~~给 Paget `git init`~~ | ✅ 2026-10-05 完成：本地仓库 + 首次提交；`.gitignore` 追加 `src-tauri/binaries/`、`nohup.out` |
| 3 | 给前端纯函数补单测（`deadlines.ts` / `coverGenerator.ts` / `format.ts`） | 现在只有 `tsc --noEmit` |
| 4 | 给 Paget 建 `.clinerules/memory-bank.md`（把维护协议抽出去） | 与 `../wreader` 对齐 |
| 5 | rustc ≥ 1.90 后清掉版本 workaround | `cargo update -p tauri -p tauri-plugin-opener`，删 `--ignore-version-mismatches` |
| 6 | `positions.cfi` 真正启用 | 等"直接打开一个 epub"的需求 |

## 已知问题

| 问题 | 影响 | 处置 |
| --- | --- | --- |
| ~~README 的「测试」写 26 项，实测 38 项~~ | ~~文档误导~~ | ✅ 2026-10-05 已更正为 38（按模块 3 / 14 / 9 / 12） |
| ~~README 未记录限时 / 封印 / 已归档~~ | ~~新功能无文档~~ | ✅ 2026-10-05 已补写（含归档目录与找回流程） |
| ~~无版本控制（Paget 目录无 `.git`）~~ | ~~改动没有历史可查~~ | ✅ 2026-10-05 已 `git init` + 首次提交（本地，无远端） |
| 无前端自动化测试 | 纯函数回归只靠类型检查 | 待办 #3 |
| `target/release/bundle/macos/` 里还留着旧的 `wreader.app`（改名前的产物） | 无功能影响，只是容易混淆 | 可手动删 |
| `src-tauri/nohup.out`（某次后台构建留下的日志） | 无功能影响 | 已加进 `.gitignore`；文件仍在，可手动删 |

## 决策演变史

| 时间 | 决策 | 理由 / 结果 |
| --- | --- | --- |
| 早期 | epub.js 渲染 → **改为按行号分页** | 内核只留转换后的 `.txt`，原始 epub 不可得（坑 #1） |
| 早期 | `tauri-plugin-sql` → **直接用 `sqlx`** | schema / 分词 / 查询要能在 `cargo test` 里脱离 webview 验证（坑 #4） |
| 早期 | `tauri-plugin-dialog` → **`NSOpenPanel`** | 需要在"文件 / 文件夹"之间同框多选 |
| 2026-09-29 | `--onefile` → **onedir** 冻结点内核 | onefile 冷启动 12–24s，代价落在用户第一屏（坑 #7） |
| 2026-10-04 | 内核新增 `remove` / `finish` | 界面加**能力探针**兼容旧冻结点内核 |
| 2026-10-05 | 限时书到期**封印（打包）而非删除** | 到期不该丢书；归档自解释、可找回 |
| 2026-10-05 | 归档 ZIP **手写**，不引 `zip` crate | 需求极小（两个条目），换来可读性 + 可测性 |
| 2026-10-05 | README 测试数字 26 → **38**，并补写限时 / 归档 | 文档必须对得上实测；README 是外人看这个项目的第一入口 |
| 2026-10-05 | 给 Paget **`git init`**（本地仓库，仍不推 GitHub） | 回应「改动没有历史可查」；首次提交只收源码 / 配置 / 打包脚本 / memory-bank，构建产物与本机数据全部 gitignore |

> 更早的历史没有留档（Paget 建库前没有 MemoryBank）。以上依据现有代码注释、README 与文件时间戳还原。
