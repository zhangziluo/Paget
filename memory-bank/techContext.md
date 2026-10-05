# 技术上下文 — 依赖、环境与命令

> 最后更新：**2026-10-05**（数字均为实测）。上游内核的细节见 `../wreader/memory-bank/`。

## 依赖

### 前端（`package.json`，name=`paget`，version=0.1.0）

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `react` / `react-dom` | ^19.1.0 | 界面 |
| `@tauri-apps/api` | 2.11.1 | `invoke` 调用 Rust 命令 |
| `@tauri-apps/plugin-opener` | 2.5.5 | 只需 Rust 侧 `init`（JS 侧未用） |
| `typescript` | ~6.0.3 | 类型检查（`tsc && vite build`） |
| `vite` / `@vitejs/plugin-react` | ^8.0.16 / ^6.0.2 | 构建 / 开发服务器（端口 1420） |
| `@tauri-apps/cli` | ^2（装到 2.12.0） | `npm run tauri` |

脚本：`dev`=`vite`、`build`=`tsc && vite build`、`preview`=`vite preview`、`tauri`=`tauri`。

### 壳层（`src-tauri/Cargo.toml`，crate=`paget`）

| crate | 版本 | 用途 |
| --- | --- | --- |
| `tauri` | 2 | 应用框架（Rust 侧实际锁在 2.11.6，见坑 #8） |
| `tauri-plugin-opener` | 2（2.5.5） | 打开外部链接 |
| `serde` / `serde_json` | 1 | 序列化、`Value` 转 wire 形状 |
| `sqlx` | 0.8（`runtime-tokio`,`sqlite`） | 本机缓存（**不用** `tauri-plugin-sql`） |
| `sha2` | 0.10 | 归档名取书名的 SHA-256 前 8 位 |
| `flate2` | 1 | 归档 zip 的 deflate |
| `crc32fast` | 1 | 归档 zip 每个条目的校验和 |
| `objc2` / `objc2-app-kit` | 0.6 / 0.3 | **仅 macOS**：`NSOpenPanel` 原生文件面板 |
| `tokio` | 1（dev） | 集成测试自己开运行时 |

`[profile.release]`：`codegen-units=1`、`lto=true`、`opt-level=3`、`panic="abort"`、`strip=true`。
`rust-version = "1.87"`（**必须**，见坑 #3）。

### 内核（`../wreader`）

Python 包 `wreader`，Python **3.13** 的 `.venv`。Paget 不 import 它，只在运行期拉起
`python -m wreader.serve`（JSON-RPC over stdin/stdout）。打包时由 PyInstaller 冻成 `werd-core`。

## 开发环境（本机实测）

- OS：macOS（Intel）；Node **v24.18.0**、npm **11.16.0**；**rustc / cargo 1.87.0**。
- 内核 venv：`../wreader/.venv/bin/python`（Python 3.13.3）。
- `src-tauri/.cargo/config.toml`：`[resolver] incompatible-rust-versions = "fallback"`（不可删，见坑 #3）。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `WREADER_HOME` | 内核数据目录；**dev 下 `use_project_data_root()` 会自动设成 `<repo>/.wreader`**（用户自己设过的优先） |
| `WREADER_NOVELS_DIR` | 正文目录；同上设成 `<repo>/.wreader/novels` |
| `WREADER_CORE_COMMAND` | 整条内核命令行（如 `werd-core --stdio`）；最高优先级 |
| `WREADER_CORE_PYTHON` | 指定解释器（不写 `-m wreader.serve`） |
| `WREADER_ROOT` | `packaging/build-core.sh` / `werd-core.spec` 用来找内核仓库（默认 `../wreader`） |

## 文件位置

| 内容 | 路径 | 可被覆盖 |
| --- | --- | --- |
| 本机缓存（书架快照 / 全文索引 / GUI 位置与设置） | `<app config dir>/cache.sqlite3`（本机即 `~/Library/Application Support/com.paget.gui/cache.sqlite3`） | 删掉即重建 |
| 本地封面 + 生成方案 | `<app data dir>/covers/<book_id>.{jpg,jpeg,png,webp}` 与 `covers/<book_id>.json` | 删掉即回落自动生成 |
| 封印归档 | `<app data dir>/archived/<sha8><rand>.zip`（内含 `paget-archive.json`） | 可搬走 / 找回 |
| 内核数据（dev） | `<repo>/.wreader/`（`settings.toml` / `library.json` / `achievements.json` / `novels/`） | `WREADER_HOME` |
| 内核数据（装到别处 / 源码树不在） | `~/.wreader`（内核默认） | `WREADER_HOME` |
| 冻结点内核 | `src-tauri/binaries/werd-core/`（打包后落 `<resource dir>/core/werd-core`）；**已 gitignore** | `packaging/build-core.sh` |
| 构建产物 | `dist/`（前端）、`src-tauri/target/release/bundle/{macos,dmg}/` | — |

## 配置项

**内核 `settings.toml`**（界面设置页直接读写，4 个 section）：
`[reader]` 13 键（`page_scroll_step` / `page_overlap` / `wheel_scroll_step` / `touch_scroll` /
`status_bar_format` / `auto_save_interval` / `auto_scroll_interval` / `auto_scroll_step` /
`auto_scroll_check_minutes` / `auto_scroll_check_seconds` / `page_height` / `theme` / `store_history`）、
`[stats]` 4 键、`[library]` 1 键、`[toc]` 2 键。

**界面自己的状态**（不进内核）：
`gui_settings` 表 —— `shelf.pinned`（置顶 id 列表）、`shelf.deadlines`（限时表，
`{book_id: "YYYY-MM-DD"}`）；`localStorage` —— `shelf_toy`（毛绒玩具 id）。

## 常用命令

```bash
npm install                                   # 前端依赖
npm run tauri dev                             # 开发（前端热更新 + Rust 自动重编）
npm run build                                 # tsc + vite build（只构建前端）
cd src-tauri && cargo test                    # 壳层测试（38 项，含真拉内核的契约测试）
cd src-tauri && cargo test <名字>             # 只跑一个
git log --oneline                             # 本地历史（2026-10-05 起有；无远端）
packaging/build-core.sh                       # 冻结内核（打包前必跑；--no-smoke 跳过校验）
npm run tauri build -- --ignore-version-mismatches   # 打包 .app / .dmg
```

> 打包前先杀掉正在跑的 app：bundle 会在原地替换 `.app`（macOS 上不是原子操作，
> 旧实例可能读到半新半旧的文件）。

## 测试基础设施

- **框架**：`cargo test`（`src-tauri/`）。
- `db.rs` 的用例**不碰真实数据**：每条都在 `std::env::temp_dir()` 里开一个临时库，跑完删掉。
- `core_client.rs` 的用例会**真的拉起 Python 内核**（壳与内核的契约测试）；
  机器上没有内核时打印 `SKIP: ...` 并跳过，而不是假装通过。
- `archive.rs` 的用例在临时目录里造书、封印、解回来并断言压缩率。
- 前端目前**没有自动化测试**；`tsc --noEmit` 是唯一静态门禁。

## 当前测试规模（2026-10-05 实测）

| 命令 | 结果 |
| --- | --- |
| `cd src-tauri && cargo test` | **38 passed / 0 failed**（`lib.rs` 3 + `db.rs` 14 + `archive.rs` 9 + `core_client.rs` 12） |
| `npx tsc --noEmit` | **exit 0**（无类型错误） |

> ✅ `README.md` 的「测试」一节已同步为 38 项（含按模块拆分），2026-10-05 起与实测一致。

## 接口一览

### Tauri 命令（`src-tauri/src/lib.rs`，18 个）

`core_request`、`core_version`、`sync_shelf`、`cached_shelf`、`index_book`、`search_cache`、
`save_gui_position`、`load_gui_position`、`get_gui_setting`、`set_gui_setting`、`reset_cache`、
`pick_import_paths`、`cover_info`、`cover_save`、`archive_dir`、`archive_list`、`archive_seal`、`archive_restore`。

### 内核 RPC 方法（`../wreader/wreader/serve.py`，24 个）

`ping`、`version`、`paths`、`list`、`recent`、`search`、`get_book`、`toc`、`text`、`position`、
`session`、`event`、`daily_open`、`import`、`stats`、`achievements`、`config_get`、`config_set`、
`export`、`import_data`、`prune`、`clear`、`remove`、`finish`。
（界面主要用 `list` / `get_book` / `toc` / `text` / `position` / `session` / `event` / `daily_open` /
`import` / `stats` / `achievements` / `config_*` / `export` / `import_data` / `prune` / `clear` / `remove` / `finish`；
`recent` / `search` / `paths` 也在包装里。）
