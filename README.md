# Paget

A desktop reader for the **werd** core: Tauri v2 + React/TS shell, Python core.

这个目录**刻意放在 `wreader` 仓库之外**（两个项目并排），所以它物理上不会被推上
GitHub —— 它是用户本机的图形界面，不是要发布的包。

## 它到底在做什么

```
┌────────────────┐   invoke    ┌──────────────────┐   stdin/stdout    ┌───────────────────────┐
│ React (src/)   │ ──────────▶ │ Rust (src-tauri) │ ─── 一行一个 JSON ──▶│ python -m wreader.serve│
│ 书架 / 阅读页  │             │ core_client.rs   │ ◀───────────────── │  ~/.wreader（权威）    │
└────────────────┘             │ db.rs (SQLite)   │                    └───────────────────────┘
                               └──────────────────┘
```

- **数据只有一份**：书库、阅读位置、时长、统计、成就全都由 Python 内核写在 `~/.wreader`
  （纯文本 JSON/TOML），终端阅读器 `werd` 与这个界面读写的是同一份文件，
  所以在终端读到第 120 行，打开界面就接着第 120 行。
- **SQLite 只是缓存**：`db.rs` 里那个 `cache.sqlite3`（放在应用配置目录）存的是书架快照、
  全文索引和界面自己的设置，随时可以删，删了下次启动从内核重建。
- **界面不重写任何规则**：进度百分比用 `library.position_percentage` 的算法、
  时间戳用内核的"本地时间 + 秒级"格式、行区间交给内核去重，界面只负责画。

## 跑起来

```bash
# 前置：内核仓库已经装好（见 ../wreader/README.md），也就是
#   ../wreader/.venv/bin/python -m wreader.serve 能跑
npm install
npm run tauri dev        # 开发（前端热更新 + Rust 侧自动重编）
packaging/build-core.sh  # 冻结内核（打包前必须先跑一次）
npm run tauri build -- --ignore-version-mismatches   # 打包成 .app / .dmg
```

内核怎么被找到（`core_client.rs` 的 `CoreCommand::resolve`，按顺序）：

1. `$WREADER_CORE_COMMAND` —— 整条命令行，例如 `werd-core --stdio`；
2. `$WREADER_CORE_PYTHON` —— 指定解释器；
3. 自动：**随包内核**（`<resource dir>/core/werd-core`，或与主程序并排的同名文件；
   只在 release 构建里认它 —— 否则 `tauri dev` 会拿旧的冻结点盖住 `../wreader/` 的修改），
   然后是开发布局里的 `../wreader/.venv/bin/python`；
4. 兜底 `python3`（要求 `wreader` 已装进那个解释器）。

## 界面做了什么

没有标签栏：**书房本身就是首页**，所有功能都藏在墙上的挂件里，点开才展开成一整页，
右上角有「← 返回书架」。每一页都只调内核的对应方法，自己不重算任何规则：

- **书房（书架）**：整间屋子锁在一屏内，不出现滚动条 —— 书超过**一屏 40 本**时，
  鼠标靠近窗口左右两侧才会浮现 **‹ ›** 翻页箭头，点它切换下一屏。
  最上面一栏并排放着：**日历**（左，统计）、**数字时钟**（纯展示、不可点）、
  透明玻璃**徽章盒**（成就），紧挨着徽章盒挂着一枚**黄铜齿轮**（无底色/边框/阴影的小物件，
  设置 + 数据 + 已归档），最右是重新同步 / 清空缓存 / 放大镜三个小圆钮。
  能点的挂件鼠标移上去会发出白色散光，齿轮则是轻轻转过一个齿。
  下面是一组两层的书架：**上层只放装饰**（留声机、竖着立的黑胶唱片、收音机 —— 都不可点，
  为以后的音频播放留个位置；外加一只**毛绒玩具**），**书都放在下层**；两层之间是一道

  **白色带阴影的隔板**，
  下层的头一格是「＋」空书位。每层的书目、进度条和百分比都来自内核 `list`，先画缓存再同步
  （行号 / 字数 / 累计时长 / 上次阅读这些细节搬进了下面的右键菜单）。
  搜索是**纯前端**的：点右上角的 🔍（或按 `/`、`⌘K`）会给整片书架铺一层
  `backdrop-filter: blur(8px)` 遮罩、并从顶部滑下输入框，输入即时按**书名 / 作者**过滤身后的书架；
  回车确认后遮罩收起、命中的书脊高亮 2 秒自动落掉，Esc 或点遮罩空白处取消。
- **书籍右键菜单**：在书脊上点**右键**（触屏**长按 550ms**）弹出浅木色圆角卡片 ——
  **继续阅读 / 阅读统计 / 属性 / 置顶·取消置顶 / 标记已读·未读 / 删除（二次确认）/ 设置限时**。
  菜单在指针处弹出、超出窗口时自动夹回来，点菜单外或按 Esc 关闭，出现时淡入 + 轻微下落 0.2s。
  其中：**置顶**是界面自己的状态（存本机 `gui_settings`，排在书架最前）；
  **阅读统计 / 属性**来自内核 `get_book`（打卡天数按 `progress.sessions` 里不同的日期数，
  添加时间取 `import_date`）；**标记已读**和**删除**走内核的 `finish` / `remove` 两个方法，
  与终端读写的是同一份 `library.json`。
  后两项只有较新的内核（2026-10-04 起）才有：界面启动时会拿一个**不可能存在的 book id** 各探一次
  （`unknown method` = 内核不认识它，`unknown book id` = 认识；探针零副作用），
  探不到就把这两项**禁用**并说明原因，而不是等点了才报错。
- **书架格子里的「＋」→ 导入电子书**：点一下弹出**系统原生的文件浏览器**（macOS 上是唯一一个
  `NSOpenPanel`，文件与文件夹同框、都能多选），选中的每个路径交给内核 `import` 转换入索引。
  这是唯一一处用了原生对话框的地方：`tauri-plugin-dialog` 的 `open()` 只能在"文件"和
  "文件夹"里二选一，做不到同框多选，所以面板直接由 `src-tauri/src/lib.rs` 的
  `pick_import_paths` 用 `NSOpenPanel` 弹出（其它平台退回到 `werd import <路径>`）。
- **阅读页**：内核 `text` 按**行号**分页（一屏 40 行），跳章走 `toc`，
  位置与**书签**（`progress.bookmarks`）每分钟自动写回内核（`position`），
  退出时经由 `session` 记入时长与成就。书签可以加 / 删 / 跳转，与终端里按 `b` 是同一份数据。
- **日历 → 统计**：内核 `stats`（就是 `werd stats --json` 那份 `build_report`）——
  总时长、今日 / 本周 / 本月、每日目标、连续天数、读完本数、每本书累计，以及 30 天热力图。
- **徽章盒 → 成就**：内核 `achievements` —— 已解锁（带解锁时间）与进行中（按分类、带进度条，
  隐藏成就解锁前不剧透）。打开这一页会像 CLI 一样补记一次 `achievements_view` 事件（幂等）。
- **齿轮 → 设置 / 数据 / 已归档**（三页合一）：设置用内核 `config_get` / `config_set` 直接读写
  `settings.toml`（点号路径），并显示数据 / 正文 / 书目 / 设置文件的位置（内核 `paths`）；
  数据用内核 `export` / `import_data`（备份迁移，只增不减）、`prune` / `clear`
  （清理失效书目 / 清空书库）。备份路径以输入框填写（一次性操作，手填最可控）。
- **限时模式 → 封印 → 已归档**：右键菜单的「设置限时」给一本书定一个到期日。
  这份状态和置顶一样**存在界面一侧**（`gui_settings` 的 `shelf.deadlines`，值时形如
  `{"<book_id>": "2026-10-08"}`）—— `werd` 不认识「限时」；书脊上只标一枚 **⏳**，不显示倒计时。
  到期那天 **0 点**（`dueMoment`：到期日自己的零点过了）**书房那个每秒跳的时钟**会命中它
  （`expiredBooks`），不另设定时器。封印的顺序是 **先写 zip、再让内核 `remove`**：
  整本打包进 `<app data dir>/archived/<sha256(书名)前 8 位><4 随机字符>.zip`
  （**手写 ZIP**，deflate + 每条目 CRC-32；里面还夹着 `paget-archive.json` 元信息），
  原文件不删、只是内核记录被摘掉，书架少一格并播 `SealDissolve`（书脊**原位** 28 颗光点
  按黄金角散开）+ `SealToast`（"这本书似乎被兔子藏起来了……"）。
  **任何一步失败都只是「没封印」，不会丢数据**（半成品 zip 会被删掉）。
  「已归档」页**只读归档目录**：归档名本身看不懂是有意的，书名 / 作者 / 封印时刻 / 到期日 /
  原文件名 / 进度快照全在 zip 自己的元信息里，所以清缓存、换机器都认得出。
  点「找回」走 `archive_restore`：白名单校验归档名 → 解到**临时目录** → 内核 `import`
  → 内核 `position` 写回行号 / 百分比 / 书签 / 读完（正文没变 → book id 与封印前一致）→ 删掉 zip。

界面自己那份设置（主题、字号…）仍存 `gui_settings`，与内核的 `settings.toml` 互不干扰；
上面的每一页都不留副本 —— 数字都来自内核。


## 四个踩过的坑（都在代码里留了注释）

1. **没有 epub.js**。原计划用 epub.js 渲染，但内核存的是**转换后的 `.txt`**，
   原始 epub 不在 `~/.wreader` 里，所以 epub.js 拿不到书、也用不上 CFI。
   共用坐标只能是**行号**（和 `werd` 完全同一套），于是阅读页走 `text` 分页。
   `CFI` 相关的设计保留在 `positions.cfi` 列里，留给将来"直接打开一个 epub"的功能。
2. **FTS5 的 `unicode61` 会把一整串汉字当成一个词**，`MATCH '三体'` 永远搜不到

   `三体世界就在我们眼前`。解法是入库前给每个汉字两边加空格（`db::segment_cjk`），
   查询时把整串当**短语**（`MATCH '"三体"'`），显示前再把空格去掉（`desegment_cjk`）。
   这三步缺一不可，`cargo test` 里有对应的端到端用例。
3. **`rustc 1.87` 编不动最新依赖**：`icu_* 2.3` / `darling 0.24` / `time 0.3.4x` 都要求 1.88。
   已在 `src-tauri/.cargo/config.toml` 里设 `incompatible-rust-versions = "fallback"`
   并声明 `rust-version = "1.87"`，让 cargo 在解析阶段就退回到能编的版本
   （实测把 `wry` 从 0.57 降到 0.55.1）。
4. **不用 `tauri-plugin-sql`，直接用 `sqlx`**（与最初计划不同）。
   这样 schema、中文分词、切块规则、全文查询全都能在 `cargo test` 里脱离 webview 验证，
   也不会出现"Rust 一份 schema、JS 一份 SQL"的漂移。JS 侧只调 `#[tauri::command]`。

## 测试

```bash
cd src-tauri && cargo test     # 38 项：分词 / 切块 / SQLite 端到端 / 归档 ZIP / 内核位置 / 真 sidecar 协议
```

按模块：`lib.rs` **3** 项（封面查找 / base64 / 路径白名单）、`db.rs` **14** 项
（缓存往返 + CJK 分词三件套 + 切块计划 + FTS5 查询）、`archive.rs` **9** 项
（手写 ZIP 的往返 / 压缩率 / 坏归档拒收 / 归档名白名单 / DOS 时间戳）、
`core_client.rs` **12** 项（命令解析 + 真拉起内核的协议往返）。

- `db.rs` 里的用例**不碰真实数据**：每一条都在 `std::env::temp_dir()` 里开一个临时库，跑完删掉。
- `archive.rs` 里的用例同样在 `std::env::temp_dir()` 里造书、封印、解回来，跑完删掉。
- `core_client.rs` 里的用例会**真的拉起 Python 内核**（这是壳与内核的契约测试）。
  机器上没有内核时，它们会打印 `SKIP: ...` 并跳过，而不是假装通过。

## 打包

```bash
packaging/build-core.sh                              # 1) 冻结内核
npm run tauri build -- --ignore-version-mismatches   # 2) 打包成 .app / .dmg
```


**第 1 步**：PyInstaller 把 `wreader` 冻成 `src-tauri/binaries/werd-core/`，再用
`packaging/smoke_core.py` 真发一轮协议确认它能干活（不通过就别往下打）。

**第 2 步**：`tauri.conf.json` 把那个目录当**资源**发出去：

```json
"bundle": { "resources": { "binaries/werd-core": "core" } }
```

于是 macOS 上落在 `Contents/Resources/core/werd-core`（`Rust` 侧就是按
`<resource dir>/core/werd-core` 找它的，见 `core_client.rs` 的 `bundled_binary`），
Windows / Linux 上落在可执行文件旁的资源目录里。**用户机器上不用装 Python。**

实测（2026-10-04，Intel macOS，rustc 1.87）：

| | |
| --- | --- |
| 冻结内核 | onedir，`werd-core` 4.6 MB + `_internal/` 共 34 MB |
| `.app` / `.dmg` | 40.7 MiB / 18.3 MiB |
| 起来后跑的是谁 | `…/Paget.app/Contents/Resources/core/werd-core`，无任何 `python` 进程 |
| 界面数据 | `~/Library/Application Support/com.paget.gui/cache.sqlite3` 里有真实书目（内核 `list` 的产物） |

两条**故意**的选择：

- **onedir 而不是 onefile**：onefile 每次启动都要把载荷解到新的临时目录、macOS 还要重扫
  一遍那个新可执行文件 —— 实测冷启动 12–24 s（onedir 1.1 s、`python -m wreader.serve` 0.7 s）。
  这笔开销落在用户开机后的第一屏上，所以发目录。
- **`--ignore-version-mismatches` 不是可选装饰**：CLI 要求 `@tauri-apps/api` 与 Rust `tauri`
  crate 的 major/minor 对齐，但本机 **rustc 只有 1.87**，`tauri` 2.12 / `tauri-plugin-opener`
  2.6 都要求 rustc 1.90 —— 只能让 Rust 侧留在 2.11.6 / 2.5.5（`.cargo/config.toml` 里那条
  `incompatible-rust-versions = "fallback"` 就是这么算出来的），而 JS 侧是 npm 按 `^2` 装出来的
  2.12.0。差一个次版本，且插件 API 根本没从 JS 用过（`plugin-opener` 只在 Rust 侧 `init`），
  所以跳过这条检查是安全的。**等 rustc ≥ 1.90**：`cargo update -p tauri -p tauri-plugin-opener`，
  这行参数就能删掉。

> 打包前先杀掉正在跑的 app：bundle 会在原地替换掉 `.app`（macOS 上不是原子操作，旧实例
> 可能读到半新半旧的文件）。

