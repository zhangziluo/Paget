# 技术上下文 — 依赖、环境与命令

> 最后更新：**2026-10-11**（数字均为实测；内核搬进仓库那一轮把 `cargo test` / 内核 pytest / 冻结点烟测都重跑了一遍）。内核的细节见 `core/README.md` 与 `core/` 的源码。

## 依赖

### 前端（`package.json`，name=`paget`，version=0.1.0）

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `react` / `react-dom` | ^19.1.0 | 界面 |
| `@tauri-apps/api` | 2.11.1 | `invoke` 调用 Rust 命令 |
| `@tauri-apps/plugin-opener` | 2.5.5 | 只需 Rust 侧 `init`（JS 侧未用） |
| `pdfjs-dist` | ^6.4.299 | **PDF 图片模式**：把页面画进 `<canvas>`（用 **legacy** 构建：老引擎也打得开；worker 由 Vite 当资源发出去，`dist/assets/pdf.worker.min-*.mjs`） |
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
| `tauri-plugin-dialog` | 2（2.7.3） | **Windows / Linux 的「＋」导入选择器**（`IFileOpenDialog`）。**故意不加 target 门控** —— 让 `lib.rs` 的 `desktop_picker` 在开发机（macOS）上也参与编译，那段只能在 Windows 上跑的代码才一直过类型检查（见 `systemPatterns.md` 坑 #11 旁边那条） |
| `tokio` | 1（dev） | 集成测试自己开运行时 |

`[profile.release]`：`codegen-units=1`、`lto=true`、`opt-level=3`、`panic="abort"`、`strip=true`。
`rust-version = "1.87"`（**必须**，见坑 #3）。

### 内核（`core/`，就在本仓库里 —— 2026-10-11 起）

Python 包 `wreader`（发行名也叫 `wreader`，**故意没改**：改它要动 `env.py` 的 editable 判定、
数据目录名与既有用户数据，收益只是名字好看），Python **3.13** 的 `core/.venv`。
Paget 不 import 它，只在运行期拉起 `python -m wreader.serve`（JSON-RPC over stdin/stdout）。
打包时由 PyInstaller 冻成 **`paget-core`**（原叫 `werd-core`）。
**认得的书籍格式**（`wreader.library.SUPPORTED_EXTENSIONS`）：`.txt` / `.epub` / `.mobi` / `.azw3` / `.pdf`
（mobi / azw3 与 pdf 都是 2026-10-11 加的：前者内核自己解 Palm 数据库，后者自己解对象与流）
—— 界面那两档文件面板因此**不挡任何扩展名**，认不认由内核决定。
内核自己的说明 / 目录表见 `core/README.md`；它的 790 条 pytest 就在 `core/tests/`（跑在临时 `$WREADER_HOME` 上）。

## 开发环境（本机实测）

- OS：macOS（Intel）；Node **v24.18.0**、npm **11.16.0**；**rustc / cargo 1.87.0**。
- 内核 venv：`core/.venv/bin/python`（Python 3.13.x）—— 2026-10-11 起**就在仓库里**，
  克隆一个仓库就能跑、能冻内核（`python3 -m venv core/.venv && core/.venv/bin/python -m pip install -e "core[dev]"`）。
  自动探测找的就是它（`core_client.rs` 的 `dev_interpreter_in`：`<repo>/core/.venv/bin/python`，
  Windows 上是 `Scripts/python.exe`；再退 `<repo>/.venv`）。
  ⚠️ 2026-10-09 那条「本机没有内核源码 → 首屏报 `core transport failed…`」的记录**早已过期**：
  当时自动探测落到一个无关的 `<parent>/.venv`（只有 pip）。现在源码与 venv 都在仓库里。
  要顶用随包那份冻结点仍旧可以显式指：`PAGET_CORE_COMMAND="$PWD/src-tauri/binaries/paget-core/paget-core" npm run tauri dev`。
- **内核的 stderr 走管道**（`watch_stderr` 逐行 `eprintln!`，尾巴 16 行留给报错用），
  不再是 `Stdio::inherit()` —— 这样界面与终端看到的是同一句话（2026-10-09 第十三轮）。
- `src-tauri/.cargo/config.toml`：`[resolver] incompatible-rust-versions = "fallback"`（不可删，见坑 #3）。
- **IDE（Pylance）**：内核源码现在就在工作区里（`core/wreader/*.py`）。
  `.vscode/settings.json`（**本机文件，被 `.gitignore` 忽略**，不在版本控制里）把解释器指向
  `core/.venv/bin/python`，并把 `core` 与它的 `site-packages` 加入 `python.analysis.extraPaths`。
  没有它时 Pylance 回落到 PATH 上的 `/usr/local/bin/python3`（Python 3.14，没装 chardet），
  报 `library.py:36 无法解析导入 chardet`。
  判据：`core/` 里 `npx pyright` = **0 errors / 0 warnings**（2026-10-05 实测）。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `WREADER_HOME` | 内核数据目录。**没设时由壳层自己定**（`lib.rs` 的 `prepare_core_data_root`）：`tauri dev`（debug 构建）→ `<repo>/.wreader`；**装出去的 app**（release）→ 应用数据目录下的 `core/`（macOS `~/Library/Application Support/com.paget.gui/core`、Windows `%LOCALAPPDATA%\com.paget.gui\core`）。**用户自己设过就一个字节都不动** |
| `WREADER_NOVELS_DIR` | 正文目录；同上，设成该数据目录下的 `novels/` |
| `PAGET_CORE_COMMAND` | 整条内核命令行（如 `paget-core --stdio`）；最高优先级。要顶用随包冻结点就用它：`PAGET_CORE_COMMAND="$PWD/src-tauri/binaries/paget-core/paget-core" npm run tauri dev`（原叫 `WREADER_CORE_COMMAND`） |
| `PAGET_CORE_PYTHON` | 指定解释器（不写 `-m wreader.serve`）（原叫 `WREADER_CORE_PYTHON`） |
| `PAGET_CORE_ROOT` | `packaging/build-core.sh` / `build_core.py` / `build_windows.py` / `paget-core.spec` 用来找内核源码树。优先级：**`--core-root` 参数** > 这个变量 > **仓库自带的 `core/`** > 从解释器里那份 `wreader` 反推（原叫 `WREADER_ROOT`） |

## 文件位置

| 内容 | 路径 | 可被覆盖 |
| --- | --- | --- |
| 本机缓存（书架快照 / 全文索引 / GUI 位置与设置） | `<app config dir>/cache.sqlite3`（本机即 `~/Library/Application Support/com.paget.gui/cache.sqlite3`） | 删掉即重建 |
| 本地封面 + 生成方案 | `<app data dir>/covers/<book_id>.{jpg,jpeg,png,webp}` 与 `covers/<book_id>.json` | 删掉即回落自动生成 |
| 封印归档 | `<app data dir>/archived/<sha8><rand>.zip`（内含 `paget-archive.json`） | 可搬走 / 找回 |
| 内核数据（`tauri dev` / debug 构建） | `<repo>/.wreader/`（`settings.toml` / `library.json` / `achievements.json` / `novels/` / `shelf.json`） | `WREADER_HOME` |
| 内核数据（**装出去的 app** / release 构建） | macOS `~/Library/Application Support/com.paget.gui/core/`、Windows `%LOCALAPPDATA%\com.paget.gui\core\` —— **只跟 app 的 identifier 有关**，与「在哪儿编译」「装第几版」都无关 | `WREADER_HOME` |
| 升级时的一次性收养 | 新家还空着、而老位置（项目 `.wreader/`、`~/.wreader`）有数据 → **复制**最近写过的那份过去（可重建的 `cache/` 不搬；旧位置原样留着） | `lib.rs` 的 `adopt_legacy_core_data` |
| 冻结点内核 | `src-tauri/binaries/paget-core/`（打包后落 `<resource dir>/core/paget-core`；Windows 上是 `paget-core.exe`）；**已 gitignore** | `packaging/build-core.sh`（macOS / Linux）/ `packaging/build_core.py`（Windows） |
| 构建产物 | `dist/`（前端）、`src-tauri/target/release/bundle/{macos,dmg}` / `{msi,nsis}` | — |

## 磁盘占用与回收（2026-10-07 实测）

这份仓库**本身只有 273 MB**（清过一次之后的实测），剩下的全是可重建的东西：

| 那块 | 大小 | 是什么 / 怎么回来 |
| --- | --- | --- |
| `src-tauri/target/` | 清空后 0（**清之前 5.4 GB**） | cargo 的编译缓存：`debug` 3.8 GB（`tauri dev` / `cargo test` 用）+ `release` 1.8 GB（打包用）。里面堆着几个月里依赖升升降降留下的**旧版本产物**（清之前 `debug/deps` 有 4,321 个条目、光 `tauri` 同名就有 70 份），cargo 自己不会回收。`cd src-tauri && cargo clean` 一次收回 **5.8 GB / 16,224 个文件** —— 代价只是**下一次**：`tauri dev` 重编约 6 分钟、`cargo test` 约 2 分钟、打 macOS 包约 12 分钟 |
| `.wreader/` | 131 MB | **开发用的内核数据**（书库 / 正文 / 封面），不是缓存 —— 别删 |
| `node_modules/` | 88 MB | `npm ci` 几秒回来 |
| `src-tauri/binaries/paget-core/` | 39 MB | 随包分发的冻结点内核（**已 gitignore**）；`python packaging/build_core.py` 约 1 分钟回来。它是**产物**不是缓存，清理时留着 |
| `design/` | 1.3 MB | 设计参考图（给人看的，不进构建） |
| `dist/` | 456 KB | 前端产物，`npx vite build` 一秒回来 |

**⚠️ 清完之后别开着编辑器**：`cargo clean` 之后如果这个工作区还开在 VS Code 里，**rust-analyzer
会自己把它编回来** —— 实测（2026-10-07）：11:09 清空到 0，12:15–12:33 之间 `target/` 又长到
**1.7 GB**（`debug` 748 MB + `release` 1.0 GB，`ps` 里只有那个 rust-analyzer server 在跑）。
要真把这块留白，就**先关掉这个工作区窗口（或停掉 rust-analyzer）再 `cargo clean`**；
只是想让下一次 `tauri dev` 快点，就让它编（约 6 分钟）。

顺带两条**不在这份仓库里**、但同样吃盘的：`~/.cargo/registry` 约 300 MB（全局 crate 源码缓存，
删了下次要重新下载，一般留着）；`/private/tmp` 里各次会话留下的临时脚本与出图稿（本项目那批在
`pv*` / `paget-key` / `paget_*.log` 名下，已在收尾时清掉）。

## 配置项

**内核 `settings.toml`**（界面设置页直接读写，4 个 section）：
`[reader]` 13 键（`page_scroll_step` / `page_overlap` / `wheel_scroll_step` / `touch_scroll` /
`status_bar_format` / `auto_save_interval` / `auto_scroll_interval` / `auto_scroll_step` /
`auto_scroll_check_minutes` / `auto_scroll_check_seconds` / `page_height` / `theme` / `store_history`）、
`[stats]` 4 键、`[library]` 1 键、`[toc]` 2 键。

**界面自己的状态**（不进内核）：
`gui_settings` 表 —— `shelf.pinned`（置顶 id 列表）、`shelf.deadlines`（限时表，
`{book_id: "YYYY-MM-DD"}`）、`shelf.spine_mode`（`uniform` = 全体等宽，其余都当动态）、
`shelf.import_flight`（只有 `"off"` 才算关）、
**`shelf.layout`（书架管理模式的先后与隔板 `{order, dividers: [{id, label, before, until}], region}` ——
**只在老内核上用**：
新内核有 `shelf_layout` / `set_shelf_layout`，布局跟着书库走（`~/.wreader/shelf.json`，
别处（书库 / 下一次打开）看到的是同一份），界面按探针结果二选一，见 `lib/shelfManage.ts` 的 `readLayout`）**、`reader.prefs`（阅读页排版与配色：字号 / **字重** / **字距** /
**行距** / **段间距** / 左右 / 上 / 下边距 + 上下联动 + 预设主题（`parchment` / `green` / `space` /
`code`）+
亮暗 + 自定义背景色 / 字色 + **光点导读那三样颜色**（`guideDotColor` / `guideLineColor` /
`guideWaveColor`，空串 = 出厂色），见 `lib/readerPrefs.ts`；**没有**栏数 / 分页模式这些键了）；
`localStorage` —— `paget.shelf-toys.v1`（摆件架上三只毛绒玩偶各自**放不放**：
`{ rabbit: { on }, owl: …, turtle: … }`；见 `lib/toyPrefs.ts`。
更早那一版只记「选中哪一只」的 `shelf_toy` 会被迁过来。
**每只曾经还带一个 `facing`（`front` / `left` / `right` / `back`），2026-10-10 按用户要求
把另外三面去掉、只留正面** —— 老存档里多出来的那一格没人读了，键名照旧 `v1` 不换
（换键会把「哪几只摆着」一起丢掉））
与 `paget.shelf-toy-gap.v1`（几只之间的**间距**，一个 rem 数字：范围 -1 … 1.6、出厂 -0.6 =
轻轻搭在一起；`null` / 空串算坏值回落出厂 —— 不显式挡掉的话 `Number(null)` 是 0）。
两项**分开两个键**：摆法是「每只一条 `{ on }`」，间距是几只之间的关系，塞在一起就得
动前者的形状与全部读写点）。

## 常用命令

```bash
npm install                                   # 前端依赖
npm run tauri dev                             # 开发（前端热更新 + Rust 自动重编）
npm run build                                 # tsc + vite build（只构建前端）
cd src-tauri && cargo test                    # 壳层测试（52 项，含真拉内核的契约测试）
cd src-tauri && cargo test <名字>             # 只跑一个
git log --oneline                             # 本地历史（2026-10-05 起有；无远端）

# 开发数据（书架上默认只有一本《Paget 使用手册》，见 README 的「跑起来」）
python3 packaging/seed_dev_shelf.py           # 把开发书架恢复成「只有这本手册」（时长与成就留着）
python3 packaging/seed_dev_shelf.py --keep-others   # 只补手册，不动别的书

# 打包 · macOS / Linux
packaging/build-core.sh                       # 冻结内核（打包前必跑；--no-smoke 跳过校验）
npm run tauri build -- --ignore-version-mismatches   # 打包 .app / .dmg

# 打包 · Windows（MSI + NSIS）—— 只能在 Windows 上跑，见下面那条注
python packaging/build_windows.py --check      # 只查环境（非 Windows 上会停在这里并说明原因）
python packaging/build_windows.py              # 查环境 → npm ci → 冻内核 → tauri build --bundles msi nsis
python packaging/build_core.py                 # 只冻内核（build-core.sh 的跨平台孪生）
python packaging/build_windows.py --core-root D:\src\wreader   # 内核不在旁边时指给它（那台机器上得能 import wreader）
```

> 打包前先杀掉正在跑的 app：bundle 会在原地替换 `.app`（macOS 上不是原子操作，
> 旧实例可能读到半新半旧的文件）。
>
> **`.msi` 只能在 Windows 上打**（WiX 只跑在 Windows 上），随包内核也必须在那台 Windows 上冻
> （PyInstaller 不能交叉编译）。没有 Windows 机器就用 `.github/workflows/windows-installer.yml`
> 的 `windows-latest` runner —— 那需要先把仓库推到一个 GitHub 远端（现在还没有）。

## 测试基础设施

- **框架**：`cargo test`（`src-tauri/`）。
- `db.rs` 的用例**不碰真实数据**：每条都在 `std::env::temp_dir()` 里开一个临时库，跑完删掉。
- `core_client.rs` 的用例会**真的拉起 Python 内核**（壳与内核的契约测试）；
  机器上没有内核时打印 `SKIP: ...` 并跳过，而不是假装通过。
- `archive.rs` 的用例在临时目录里造书、封印、解回来并断言压缩率。
- 前端目前**没有自动化测试**；`tsc --noEmit` 是唯一静态门禁。
- 前端的「临时校验脚本」不在仓库里，放在 `/tmp`（`/tmp/tsconfig.json` 把它们按仓库同一套编译选项
  钉住；`/tmp/node_modules` 是仓库 `node_modules` 的软链 —— 缺了就重建：
  `ln -s <repo>/node_modules /tmp/node_modules`，**别在 `/tmp` 里跑 `npm i`**，那会把软链换成真目录、
  `react` 立刻解析不到）。2026-10-07 实测：guide 109 / prefs 27 / theme 17 / shelf 36 /
  **importflight 46** / **manage 63** 条断言，外加 reader-smoke 12 / shelf-smoke 17 /
  **importflight-smoke 6** / **manage-smoke 24** / **pair-smoke 22** / **pick-smoke 13**
  条 SSR 渲染冒烟；这几条也覆盖「跨屏飞行」「书架管理模式」（含**区名标签一区一枚**与
  **选中后的 `picked` 类**），以及「内核问不到时回落本机」。
- **2026-10-07 起 `tsx` 不在依赖里了**（`npx tsx` 会去网上找包，离线环境下会一直卡住），
  于是临时脚本按「有没有 import / 有没有 JSX」分两条路跑：
  - **纯逻辑、且不 import 仓库里别的模块**（如 `lib/shortcuts.ts`）→ `node /tmp/paget-key/check.ts`
    （node 自带的类型擦除；所在目录放一份 `{"type":"module"}` 的 package.json 即可，import 要写全 `.ts`）；
  - **要 import 仓库里带 `.tsx` 的组件**（`renderToString` 那种渲染冒烟）→ 借仓库自己的 vite 打临时包：
    `cp /tmp/paget-key/smoke.tsx <repo>/smoke/` → `npx vite build --ssr smoke/shortcuts-smoke.tsx
    --outDir smoke-out` → `node smoke-out/shortcuts-smoke.js` → **删掉这两个临时目录**
    （脚本里的相对 import 是按「放在 `<repo>/smoke/` 下」写的）。
  - 依赖仓库模块的纯逻辑也可以走 CJS 老路（`/tmp/paget-check`：`npx tsc --ignoreConfig --target ES2020
    --module commonjs --moduleResolution node --ignoreDeprecations 6.0 --outDir out` 之后
    `node out/<名字>.js`）—— 隔板那一轮（`divmain.ts`）、**隔板成对那一轮（`pairmain.ts`，31 条）**
    与**方向键排序那一轮（`pickmain.ts`，44 条）**都是这么跑的：把 `src/lib/shelfManage.ts` 拷过去，
    配一份桩 `core.ts`（六个空函数，挡住 Tauri 那边），再 `node out/pickmain.js`。
    注意 `--ignoreDeprecations 6.0`：TS 6 会把 `--moduleResolution node` 当成错误（TS5107）。
  - **改布局数据结构的轮次还要顺手跑内核那一侧**（`core/`）：`core/.venv/bin/python -m pytest core/tests -q`
    （现在 748 项）、`tools/check_docs.py`、`tools/check_doc_numbers.py` —— 布局是两边共读的一份
    JSON，`shelf_regions` 的口径必须与 `regionsOf` 一致（2026-10-07 隔板成对那一轮两边各加了断言）。

## 当前测试规模（2026-10-05 实测）

| 命令 | 结果 |
| --- | --- |
| `cd src-tauri && cargo test` | **45 passed / 0 failed**（2026-10-10 复核重跑：全部用例跑在一个 binary 里 —— `lib.rs` 45 + `main.rs` 0 + doc-tests 0） |
| `npx tsc --noEmit` | **exit 0**（无类型错误） |

> ✅ `README.md` 的「测试」一节已同步为 **45 项**（2026-10-10 复核重跑实测），与这里、
> `memory-bank/README.md` 的「45 项」三处一致。


## 接口一览

### Tauri 命令（`src-tauri/src/lib.rs`，21 个）

`core_request`、`core_version`、`sync_shelf`、`cached_shelf`、`index_book`、`search_cache`、
`save_gui_position`、`load_gui_position`、`get_gui_setting`、`set_gui_setting`、`reset_cache`、
`pick_import_paths`（收一个 `mode: Option<String>`：`folder` = 选文件夹，其余一律选文件）、
`import_picker_modes`（回 `["panel"]` / `["files","folder"]`，界面据此决定要不要先弹那个小菜单）、
`cover_info`、`cover_save`、`archive_dir`、`archive_list`、`archive_seal`、`archive_restore`；
**`book_source`**（把一本 pdf 的**原始字节**通过 `tauri::ipc::Response` 原样发给前端 —— 图片模式要在
webview 里画页面，路径仍由壳层从内核记录里取，只认 `.pdf`）与 **`convert_pdf`**（阅读页那颗
「转换成文字」：转调内核 `convert_pdf`，抽几百页要几十秒，所以它是**唯一 async 的命令** ——
`spawn_blocking` 丢给阻塞线程池，主线程一个字节都不占）。

### 内核 RPC 方法（`core/wreader/serve.py`，25 个）

`ping`、`version`、`paths`、`list`、`recent`、`search`、`get_book`、`toc`、`text`、`position`、
`session`、`event`、`daily_open`、`import`、`stats`、`achievements`、`config_get`、`config_set`、
`export`、`import_data`、`prune`、`clear`、`remove`、`finish`、`set_meta`。
（界面主要用 `list` / `get_book` / `toc` / `text` / `position` / `session` / `event` / `daily_open` /
`import` / `stats` / `achievements` / `config_*` / `export` / `import_data` / `prune` / `clear` /
`remove` / `finish` / `set_meta`；`recent` / `search` / `paths` 也在包装里。）
