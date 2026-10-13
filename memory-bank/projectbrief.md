# 项目定位 — Paget

Paget 是 **Tauri v2 + React/TS 外壳 + 自带 Python 内核**的桌面阅读器。

- 目录：`/Users/zhangziluo/Downloads/Paget`。**内核源码就在本仓库的 `core/` 里**
  （2026-10-11 起；早先是一个并排的 `../wreader` checkout）。
- 克隆一个仓库就能跑、能打包，不需要第二个 checkout；内核的说明见 `core/README.md`。
- 数据只有一份：书库、阅读位置、时长、统计、成就全部由 Python 内核写在
  `~/.wreader`（开发期是本项目的 `.wreader/`，见 `techContext.md`），
  界面每一处读的都是它。

## 核心功能需求

- **书房即首页**：整间屋子锁在一屏内。墙上并排贴着三枚**便利贴**（「日记」= 统计、「勋章」= 成就、
  「调一调」= 设置 / 数据 / 已归档；和纸质感、米黄 / 淡粉 / 淡绿三色、可拖到任意位置并记住位置）
  与一枚**数字时钟**（纯展示）；右上角是重新同步 / 清缓存 / 放大镜。
- **书架**：默认一屏 **40 本**（`PAGE_SIZE`），超过一屏时靠鼠标靠近左右两侧浮现的 **‹ ›** 箭头翻屏，
  **不出现滚动条**。两层书架：上层只放装饰（留声机、黑胶、收音机、毛绒玩偶 —— 兔子 / 猫头鹰 / 乌龟
  三只可以同时摆上、每只放不放随你，造型只有正面一种），书都在下层。
  下层头一格摆着一只**藤条篮子**（篮子里插着一本书、几张残页），它也是导入入口。
- **封面**：优先本地封面图（`covers/<id>.<ext>`，或正文 txt 旁同名的图），
  否则按书名**稳定生成**（同一本书在任何机器上配色与中央文字都一样）。
- **开书**：有进度直接进阅读页；没进度先播「抽书 → 横转封面 → 停留 → 翻页」过场（纯 CSS 3D）。
- **阅读页**：内核 `text` 取正文（**行号是唯一坐标**），纸页**一路向下滚**（按批追加，
  可一直读到书末）；可跳章节（`toc`）、用右上角 **拟物丝带**加/删书签并跳转（`progress.bookmarks`）、
  `↑ ↓` 翻一行 / `← →` `空格` `PgUp` `PgDn` 滚一屏、每 **60 秒**自动写回位置（`position`），
  退出时经 `session` 记入时长与成就；排版（**字体（六款系统字体） / 字号 / 字重 / 字距 / 行距 /
  段间距 / 页边距**）与
  **纸面主题**（羊皮纸 / 护眼绿 / 深空蓝 × 白天黑夜，另可自定义背景色与字色）都是
  界面自己的状态，存在 `gui_settings` 的 `reader.prefs`，内核不认识。
  顶栏那枚**光点导读**（「跟着光读」）也是阅读页自己的：一位「领路的」沿当前行从左往右、
  **在正文下方**走，**光点 / 下划线 / 波浪线**三样任选（后两样是「四五个字宽的一小段线
  自己往前挪、走过就化掉」，走法共用一套、只是笔迹不同），速度按**每行停留时间**分 20 档，
  **这三样还能各自换颜色**（三枚取色器）；进度存本机 `localStorage`、颜色存 `reader.prefs`，
  同样**不进内核**。
- **书籍右键菜单**（触屏长按 **550ms**）：继续阅读 / 阅读统计 / 属性 / 置顶·取消置顶 /
  标记已读·未读 / 删除（二次确认）/ **设置限时**。
- **导入**：书架左边那只**藤条篮子**弹出**系统原生文件面板**（macOS `NSOpenPanel`，文件与文件夹同框、可多选），
  每个路径交给内核 `import`。**认得的格式由内核决定**（`.txt` / `.epub` / `.mobi` / `.azw3` / `.pdf`；mobi / azw3 / pdf
  自 2026-10-11 起支持，内核自己解压与转换），界面**不挡扩展名**。
  **PDF 默认按图片读**：导入只收文件 + 数页数 + 取封面，阅读页用 pdf.js 画页面；文字要在阅读页按
  「转换成文字」（那一步才跑内核的文字层解析，转完写 `<书名>_utf8.txt` 并切到文字阅读页）。
- **搜索**：纯前端，在本地书目上按**书名 / 作者**过滤（`/` 或 `⌘K` 打开遮罩输入框）。
- **统计**：内核 `stats`（那份 `build_report`）+ 30 天热力图。
- **成就**：内核 `achievements`；打开页面时补记一次 `achievements_view` 事件（幂等）。
- **设置与数据**：直接读写内核 `settings.toml`（`config_get` / `config_set`，点号路径）；
  数据页做备份导出 / 合并（`export` / `import_data`）与 `prune` / `clear`。
- **限时模式（封印）**：给一本书设到期日；到期那天 0 点把它**打包进归档目录**并从书架消失
  （不是删除），「已归档」页可随时找回，进度照旧。

## 硬性技术约束（改代码前必读，不可违反）

1. **数据只有一份**：`~/.wreader` 由 **Python 内核**独占。界面**从不直接写**这些文件，
   一切读写在 `src/lib/core.ts` → Rust → 内核 RPC 这条路上。
2. **SQLite 只是缓存**：`cache.sqlite3` 随时可删，删了下次启动从内核重建；**永远不是事实来源**。
   没有逐表迁移，schema 变了就 bump `SCHEMA_VERSION` 重建。
3. **行号是唯一共同坐标**：`current_line`、书签 `line`、`chapters[].line_start`、`text` 的行范围
   全用「正文 `split("\n")` 的下标」。
4. **界面不重算规则**：`src/lib/format.ts` 逐条镜像内核算法
   （`percentageOf`=`library.position_percentage`、`formatHours`=`stats.format_hours`、
   `humanWords`=`library.human_words`、`progressBar`=`stats.progress_bar`、
   `metricText`=`cli._metric_text`、`coreStamp`=`session.iso` 的本地秒级格式）。
5. **时间戳由前端生成**（前端才知道用户时区），必须是**本地时间、秒级**；
   **禁止 `toISOString()`**（那是 UTC，会把「周末/夜间」判定和到期日算错一天）。
6. **Tauri 命令一律同步**：两侧都是本地活（到内核的管道、本地 SQLite 文件），
   阻塞主线程几毫秒比铺 `Send` future 简单 —— 后者会踩 rustc 的
   `implementation of Executor is not general enough`。
7. **测试不碰真实数据、不依赖 webview**：`db.rs` 的用例在临时目录开库跑完就删；
   `core_client.rs` 会真的拉起 Python 内核（那是壳与内核的契约测试），机器上没有内核时
   打印 `SKIP: ...` 跳过，而不是假装通过。
8. **不轻易加依赖**：不用 `zip` crate（归档 ZIP 手写）、不用 epub.js / three.js（动画纯 CSS）、
   不用 `tauri-plugin-sql`（直接用 `sqlx`）。**`tauri-plugin-dialog` 是个例外**：macOS 上仍然
   直接 `NSOpenPanel`（它的 `open()` 只能二选一，做不到文件与文件夹同框），但 Windows / Linux
   的系统对话框本来就只能二选一，那里用它最省事 —— 于是引了它，并且**故意不加 target 门控**，
   好让那段只能在 Windows 上跑的代码在开发机上也参与编译。
9. **本机 rustc 1.87**：`src-tauri/Cargo.toml` 的 `rust-version = "1.87"` 与
   `src-tauri/.cargo/config.toml` 的 `incompatible-rust-versions = "fallback"` **不可删**。

## 明确的非目标

- **不是要发布的包**：Paget 只作本机 GUI。
  ⚠️ 2026-10-07 的一处例外：想用 GitHub Actions 打 **Windows 安装包**就得先推一个远端
  （`.github/workflows/windows-installer.yml`）。那是「借一台 Windows runner」，不是为了发布
  —— 2026-10-11 起内核就在同一个仓库里，那条工作流也不再需要第二个 checkout。
- **不重新实现内核规则**，也不自己藏一份数据副本。
- **不渲染原始 epub**：内核只保留转换后的 `.txt`；见 `productContext.md` 的「没有 epub.js」。
- **不做多用户 / 云同步**：两份数据合并走内核的 `export` / `import_data` 明文 JSON 包。
