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
| `App.tsx` | 205 | 外壳：书房（`Shelf`）+ 三个挂件展开页（stats / achievements / desk）+ 阅读页；启动同步、清缓存；**挂件页的键盘快捷键**（`S`/`A`/`G` 去哪儿、`M` 回书房进管理模式、`Esc` 返回 —— 判定在 `lib/shortcuts.ts`，这里只落地；按 `G` 还会把设置页签拨回「设置」）与「锤子在不在手上」（`managing` 由 `Shelf` 报上来，见 `initialManaging` / `onManageChange`） |
| `App.css` | 5,488 | 全部样式（**书架管理模式那一节单独在 `styles/manage-mode.css`（562 行）、墙上那一栏的便利贴单独在 `styles/sticky-note.css`（288 行，其中 `.sticky-note-face` 那一节的字是 **0.72rem / 600**、三档墨色 `#33270e` / `#401d27` / `#24311a`）、统计页那一纸手绘风的「读书日记」单独在 `styles/stats-page.css`（516 行）、设置页那一纸手绘风的方格纸清单单独在 `styles/settings-page.css`（534 行，2026-10-09 加）、成就页那块暗底金徽章的陈列板单独在 `styles/achievements.css`（503 行），都由本文件顶部 `@import` 进来**）：书房昼夜、书脊、过场、封印动画、阅读页拟物纸页 / 滚动的正文区 / 静态封面 / 排版与主题面板 / 浮层顶栏与位置牌 / **光点导读的轨迹下划线、轨迹条、光点与下划线 / 波浪线那两号领路的（`.guide-crawl`：墨色方头的一段 + `reading-guide-ink-fade` 让走过的迅速化掉；`.guide-wave`：同一段换成波浪，形状是 `src/assets/guide-wave.svg` 拿去做 `mask`、颜色走 `background-color` + `reading-guide-wave-fade`）、顶栏那枚速度按钮与它的小浮层**，各页）；书房的**书脊那一排**（`.shelf` 是横向 flex：`.dynamic` 按算出来的厚度、`.uniform` 等宽平分）、**每排下面那块白色挡板**（`.shelf-rack.books::after`，与摆件架下面那块同一套）、**书脊侧边那道厚度阴影**（`--spine-side`，`--spine-depth` 越大越深，夜里再深一档）、**第二屏起右上角的「回到主屏 / 跳到第几屏」浮层**（`.shelf-nav`）与**主屏的「悬空」排布**（`.study.main` 那几条）、**摆件架那两件大装饰**（2026-10-07 按效果图重画：**留声机** 4.9 × 5.6rem / 23 个零件 —— 台阶木箱 + 顶上的唱片与唱臂 + 摇柄 + 银肘套 + 竖管 + **28 折点采样出来的喇叭锥** + 弯肩 + 铜箍 + **5 瓣的花瓣口**；**收音机** 5.4 × 3.4rem / 16 个零件 —— 木壳 + 面板 + 横百叶格栅 + 表盘 + 四个铜旋钮 + 侧面旋钮 + 木脚。零件坐标全是对着效果图量的，说明见 `.g-*` / `.r-*` 两节的开头）也在这里；**毛绒玩偶那一节 2026-10-09 曾多出「朝向」四套画法，2026-10-10 按用户要求整段撤掉 —— 现在只有「朝前」一种造型**（`.plush[data-facing=…]` / `--plush-flip` 镜像变量都跟着没了：`data-facing` 属性、`--plush-face-x` 那个侧身时用的面盘横位也一起去掉，猫头鹰面盘退回写死的 50%；`styles/manage-mode.css` 里两条关键帧（`rabbit-alert` / `rabbit-intercept`）原本要把镜像一起带上、现在只剩 `translateY + rotate`）；摆法面板也从「缩略图小圆钮 + 名字 + 四颗朝向方块」改成**一行一整条按钮**（缩略图 + 名字，`.toy-choice` 铺满整行、`.toy-thumb` 是里面那 2.5rem 见方的一格，里面的 `.plush` 仍旧绝对定位居中缩到 `scale(0.42)`），`.toy-facing` / `.toy-facing-btn` 两条样式删掉，面板宽度改由「间距」那一行定（`.toy-gap-slider` 定宽 5.2rem、`.toy-gap-value` 定宽 3rem —— 从前滑杆写 `flex: 1`，它的固有宽度会把面板撑得很宽），另有并排用的 `.toy-row`（相邻两只的间距由面板上那根滑杆调，`--toy-gap` 变量、出厂搭 0.6rem）、一只也没摆时的 `.toy-empty`，以及从「一排圆钮」改成三行小卡片（摆上两只以上再多一行「间距」滑杆，见 `.toy-gap-line`）的 `.toy-picker` / `.toy-line` / `.toy-name`）。`:root` 里另有一份**全局手写体栈 `--hand-font`**（便利贴、统计页、设置页共用，见 `styles/sticky-note.css` 那条注释）；原来统计页那一节木头卡片 / 瓷片热力块（`.cards` / `.card` / `.goal` / `.heat*`）已随第十轮整段删掉、原来成就页那一节徽章墙（`.badges` / `.badge` / `.medal` / `.badge-bar`）已随第十一轮整段删掉（这一页改用 `.ach-*`）、原来设置页那几张木头卡片（`.settings` / `.setting-row` / `.setting-key` / `.setting-path`）已随第十四轮删掉（那一页改用 `.set-*`，只留 `.switch*` / `.slider*` / `.text-input` 三样控件底子），通用 `progress` 留着给书架的书脊用 |
| `lib/core.ts` | 479 | **唯一**和后端说话的地方：`coreRequest` 直通内核，其余是缓存 / 封面 / 归档 / 限时 / 元数据 / 能力探针 / **原生导入选择器（`pickImportPaths(mode)` 与 `importPickerModes()`）**的类型化包装 |
| `lib/types.ts` | 349 | 内核回包的 wire 形状（`BookRow` / `TocEntry` / `TextSlice` / `BookMeta` / `ArchiveMeta` …） |
| `lib/format.ts` | 136 | 格式化，**逐条镜像内核算法**（见 `projectbrief.md` 约束 4）；`duration()` 是界面自己的口径（「1 小时 5 分」），2026-10-07 起**整点不再拖一个「0 分」**（`9 小时 0 分` → `9 小时`，与内核 `stats.format_hours` 同一规矩） |
| `lib/statsText.ts` | 115 | 统计页的**措辞**层（纯函数，一个数字都不重算）：`todayHeadline`（今天没读就说「还没翻开书」）/ `durationWords`（一秒没读就是「还没读」，不吐一排「0 秒」）/ `goalSentence`（没达标报**还差多少**）/ `streakSentence`（说清内核那条「今天读满 30 分钟才算今天」）/ `nightSentence`（凌晨 0~4 点读的那部分，超一半就认领「夜猫子」，没读返回 `null`）/ `goalPercent` / `bookShare`（占比条宽度，兜 2% 下限）/ `heatPlainLabel`（五档强度换成人话）。单独一层是为了在 node 里钉住 —— 措辞最容易改坏又最看不出来 |
| `lib/deadlines.ts` | 104 | 限时模式纯函数（`localDay` / `addDays` / `dueMoment` / `expiredBooks`）+ 限时表读写 |
| `lib/readerPrefs.ts` | 560 | 阅读页排版与纸面配色偏好（**字体六款**（默认 / 宋体 / 楷体 / 仿宋 / 圆体 / 等宽，都用系统字体、不联网）、字号 20–80、字重 100–900 整百档、字距 -1–6px、**行距 1.2–3.4 倍**、**段间距 0–2.5em**、左右 / 上 / 下边距、上下联动、四套预设主题 × 亮暗（含**代码**主题）、自定义背景 / 字色、**光点导读那三样颜色**（`guideDotColor` / `guideLineColor` / `guideWaveColor`，空串 = 出厂色））+ 归一化 + `readerFontStack(font)`（字体族列表）+ `readerPalette(prefs)` 配色推导 + **`guideColorVars(prefs)`**（按挑的颜色派生出光点那五档与那条线 / 波浪线的色，写成一串 CSS 变量；一个都没自定义时返回空对象 —— 于是出厂外观与从前完全一样）+ **`guideSwatchColor(prefs, ink, marker)`**（面板上那三枚取色器该显示什么：自定义色优先，没填就给这一档的出厂色，所以色块总与屏幕上那一条线同色）+ hex 工具；存 `gui_settings` 的 `reader.prefs` |
| `lib/readingGuide.ts` | 568 | 光点导读的纯逻辑与进度：**20 档速度刻度**（每行停留 20s…0.5s 等比，默认 10 档 3.48s）、**三种标记**（光点 / 下划线 / 波浪线 —— 后两号走法共用一套，只是笔迹不同；从前还有第三种「兔子」，2026-10-10 按用户要求删掉，连带兔子专用的 `GUIDE_PRINT_EM` / `guidePrintWidth` / `guideHopMs` 一起）与档位归一化、档位牌文案（「10档 · 3.5s/行」）、`stepGuideClock`（一行一行地走的算术）+ **`stepGuideWalk`**（一帧的推进：把前者与「空行一步跨过去」串成一步，`stopped` = 这批再没有有字的行）、**`isBlankLine` / `guideNextLine`**（「没有字」就这一个判断：渲染 `.reading-line.blank`、段首、导读跳空行共用）、`guideTrailY` / `guideDotAt` / `guideTrailAt`（折行时把一行摊到每折上，领路的与字底那条轨迹）、**那几号「一段线自己往前爬」的**（`GUIDE_CRAWLER_EM` = 4.6em ≈ 四五个字 / 两个英文单词、2.2s 一次的伸缩 `_BREATH_MS` 与幅度 `_BREATH` = ±18%，`guideBreath` → **`guideCrawlWidth`（只返回一个宽度）**，`guideCrawlAt` → `GuideCrawlBand[]`（一折一条，**只有 left / top / width**：粗细 / 颜色 / 长相 / 落点都交给 CSS 与已读那条对齐），内部 `crawlStep` 的 smoothstep 让步子一步一顿）、**跟着滚的两条判定**（`guideFollowTop` 把当前行摆回视野上方 1/3 的「带子」，`guideNeedsMore` 下面不足 `GUIDE_PREFETCH_PX` 就该接下一批）、进度读写（`localStorage`，键 `paget.reading-guide.v1.<书 id>`，记录里带 `rev` 以便把老的 6 档刻度换算过来） |
| `lib/coverGenerator.ts` | 134 | 没有封面图时"算"封面：FNV-1a hash → 10 套配色 + 书名头 1~2 字；`COVER_SPEC_VERSION = 1` |
| `lib/shelfLayout.ts` | 178 | 书房的**分屏与书脊厚度算术**（纯函数）：`spineWidthRem`（按总字数做**对数**映射 —— 三万字以下保底 4.2rem、一百二十万字以上封顶 7.6rem）、`spineDepth`（0–1，给侧边那道厚度阴影）、`spineTitleLength` / `spineTitleFontRem`（长书名自动缩字号，保证整条排得下）、`packShelfRows`（按厚度累加打包成排，主屏第一排先让出那只藤条篮子）、`planShelfPages`（主屏 1 排、其余每屏 3 排，末尾补空排）、`normalizeSpineMode` + `SPINE_MODE_KEY`（动态 / 统一等宽这个本机偏好） |
| `lib/shelfManage.ts` | 290 | 书架**管理模式的纯逻辑**：布局归一化（`normalizeLayout`，只认 `order`）、与内核书单按 id 并（`mergeOrder`）、拖拽落点算术（`ManageHit` / `ManageDrag`（拖的是一本书）/ `gapInRow` / `orderIndexAt` / `moveBook` / `squeezeIds`）、**方向键排序**（`nudgeStep`（← ↑ 往前、→ ↓ 往后）、`shiftBook`（挪一位；已经在最前 / 最后就**返回同一个数组**））、**批量改书名**（`ManageRename` / `renameTouched` / `renamedTitle`（先替换再拼前后缀））；**存哪儿**由 `readLayout`/`writeLayout` 决定 —— 新内核走 `shelf_layout` / `set_shelf_layout`（布局跟着书库走），老内核回落本机 `gui_settings` 的 `MANAGE_LAYOUT_KEY`（`home: "kernel" \| "local"`） |
| `lib/toyPrefs.ts` | 203 | 摆件架上三只毛绒玩偶的摆法（**每只放不放 + 几只之间的间距**）：`TOYS`（兔子 / 猫头鹰 / 乌龟）、`ToyPlacement { on }`、`DEFAULT_TOY_SETTINGS`（**只有兔子在架上** = 出厂样子）、`normalizeToySettings`（只认名单里的三只；**没写到的项 = 没摆**，只有整个存档不存在才是出厂样子；老存档里多出来的 `facing` 直接忽略）、`placedToys`（摆着的那几只，按名单顺序，只带 `id` 与 `label`）、`toggleToy`（纯函数）、`loadToySettings` / `saveToySettings`（本机 `localStorage`，键 `TOY_STORE_KEY` = `paget.shelf-toys.v1`；**不进 `gui_settings`** —— 那格首屏第一帧就得摆对；更早的单只玩具键 `shelf_toy` 会迁过来）。**还有几只之间的间距**：`TOY_GAP_MIN` / `TOY_GAP_MAX` / `TOY_GAP_STEP` / `DEFAULT_TOY_GAP`（-1 … 1.6rem、台阶 0.1、出厂 -0.6 = 从前写死那一档，`-0.6` 是「轻轻搭上」）+ `normalizeToyGap`（夹取 / 对齐台阶 / 挡掉 `null` 与空串等坏值）/ `loadToyGap` / `saveToyGap`（**另一个键** `paget.shelf-toy-gap.v1` —— 间距是几只之间的关系，不塞进摆法那份「每只一条」的存档）。`ToyFacing` / `TOY_FACINGS` / `setToyFacing` / `toyFacingHint` 这一路（前 / 左 / 右 / 后 四个朝向）**2026-10-10 整段删掉**，只剩正面；造型画法在 `App.css` |

| `lib/shortcuts.ts` | 97 | **键盘快捷键**（书房与墙上那三页共用一份表）：`SHORTCUTS`（`M` 管理模式 / `S` 统计 / `A` 成就 / `G` 设置）+ `shortcutFrom`（单键、不带修饰键、不是长按重复才算）+ `shortcutKey`（屏上印大写）+ `isTypingTarget`（输入框 / 文本域 / contentEditable 里不抢键）+ `pageKeyAction`（挂件页里 `Esc` → 回书房、`M` → 回书房进管理模式、`S`/`A`/`G` → 切页）。**判定与落地分开**：`App.tsx` 只负责把结果 setState，`views/Shelf.tsx` 直接读 `shortcutFrom` —— 于是全都能在 node 里钉住 |
| `lib/settingsText.ts` | 286 | 设置页的**措辞**层（纯函数，一个数值都不翻译）：`settingWords(path)`（大白话名字 + 一句话 + 单位 + **管哪儿** `scope`）、`sectionWords(name)`（节的大白话标题与引言）、`plainValue(path, value)`（值的人话读法：「60」→「60 分钟」、空路径说「还没设 —— 按默认的 ~/novels」、`time|chapter|duration` → 「此刻时间 ｜ 章节名 ｜ 读了多久」）、`SCOPE_TAG`。**认不出来的键一律回落**（键名当名字、无说明、不给范围）—— 内核加新设置项时这一页不必同步跟上。`scope` 是实测出来的：`reader.store_history` 关掉后走内核 `session` 统计照样 +600 秒（2026-10-09 拿一次性 `WREADER_HOME` 验的），所以它只管终端 |
| `views/Shelf.tsx` | 2,380 | 书房（另有**书架管理模式** —— 右上角锤子进 / 出、拖书排序、跨屏、玩偶反应，书的先后那一套纯逻辑在 `lib/shelfManage.ts`）：书架 / 翻屏箭头 / 搜索遮罩 / 右键菜单 / 导入（**逐个路径报进度**）/ 限时到期检查与封印 / 封面加载 / **毛绒玩偶**（三只各自放不放 + **多只之间的间距**；造型只有正面一种；摆法 / 间距先读本机 `localStorage` 再画，改一次就写回；换玩偶的小面板是导出的 `ToyPicker` 组件，一行整条是按钮）/ 属性保存（`set_meta`）；**键盘**：`/` `⌘K` 搜索、`←` `→` 翻屏、`M` 管理模式、`S` `A` `G` 开三个挂件页（键位表在 `lib/shortcuts.ts`，界面开着东西时不抢）；排布是**一排一格** —— **主屏**（窗 + 墙上那一栏（三枚便利贴 + 数字时钟，见 `components/StickyNoteNav.tsx`）+ 摆件架 + 只一排书，头一格是藤条篮子）与**第二屏起的整面书架**（三排、每排一块白挡板、右上角浮「回到主屏」+ 书超三屏时的「跳到第几屏」）由 `main` 上的 `main` / `shelves` 模式类切换；**书脊厚度按总字数算、一排几本按厚度累加排**（`ResizeObserver` 量书排宽度 → `packShelfRows` / `planShelfPages`），书多书厚都不挤不溢出；拖书由 `armDrag` / `dropDrag`（`ManageDrag`）管；**书脊卡片 `memo` + 时钟自成组件**（书多了也不因为每秒的秒针/贴边亮箭头把四十张卡片重算一遍） |
| `views/Reader.tsx` | 1,776 | 阅读页：`text` 按行号取文 + **滚动**（按批追加、可一路读到书末、屏顶行二分定位）、**挪位置串行队列**、拟物丝带书签、**静态封面 + 纸页堆叠**、**点屏幕中间呼出的浮层顶栏**、`Aa` 排版面板（**字体** / 字号 / 字重 / 字距 / **行距** / **段间距** / 页边距）、**主题面板**（四套预设 × 亮暗 + 自定义背景 / 字色）、**光点导读**（rAF 每帧只调一次 `stepGuideWalk`（正常走一格 / **空行一步跨过去**）→ `land()` / `placeGuide`；字底下的轨迹下划线（**下划线 / 波浪线那两号「一段线自己往前爬」的**（每帧只写 left / top / width，长度跟着它自己的伸缩走，见 `guideCrawlAt` / `guideCrawlWidth`；`placeGuide` 的分支只判断「是不是光点」—— 不是光点就爬，所以两号**共用一套走法**，只有 `.reader-lines` 上挂的模式类不同）+ **自己接下一批并把画面跟着滚**（不等 `scroll` 事件；见 `progress.md` 那条「走到屏幕最下面就不翻页」）+ 顶栏速度浮层里的**标记胶囊（光点 / 下划线 / 波浪线）**、**三枚取色器**（光点 / 下划线 / 波浪线，写进 `reader.prefs`，颜色由 `lib/readerPrefs.ts` 的 `guideColorVars` 摊成 `.reader-lines` 上的 CSS 变量）与 1–20 档滑杆 / 1–6 快捷档 / 0 开关 + 进度存本机；`.reading-line.blank` 与段首也走 `isBlankLine`）、`↑ ↓` 翻行 + `← → / 空格 / PgUp PgDn` 滚一屏 + 位置牌、`toc` 跳章、60s 自动存位置、退出记 session |
| `views/Stats.tsx` | 289 | 统计页（内核 `stats`），现在是一页手绘风的**「读书日记」**：`Stats` 只管取数（加载 / 出错也长在纸上）+ **导出的 `StatsSheet`**（数据由外面递进来，冒烟直接渲染它）。四节顺着读：今天（大字 + 一句人话 + 描红的目标条）/ 这些天 / 坚持（连击 + 最久一次 + 翻开过·读完·生词·译文·勋章 + 凌晨那句）/ 每本书读了多久（占比条，书 id 只留在悬停提示里）；热力图是一格格手画的铅笔格子。**措辞全在 `lib/statsText.ts`**（一个数字都不重算），样式在 `styles/stats-page.css`；返回按钮的提示里写着 `Esc` |
| `views/Achievements.tsx` | 342 | 成就页（内核 `achievements`），一整块**黑漆陈列板 + 金色的铁十字勋章**：`Achievements` 只管取数（加载 / 出错也长在板上，打开时补记 `achievements_view`）+ **导出的 `AchievementsBoard`**（数据由外面递进来，冒烟直接渲染它）；一枚章是一尊**铁十字**（内联 SVG 的 `path`：四臂外张、内四个角是内凹的小弧；金属感全在 CSS 的渐变 / 斜面 / 凹槽阴影里，不用图片）——**已授予**镀金 + 章心是成就自己那枚符号（`deviceOf(row.name)` 从内核的 `📖 开卷有益` 里摘下那枚，名字里就不重复写了）+ 章底刻解锁时间；**还没授予**是同一尊**生铁**（`is-iron`，符号压成灰的，底下一条细金条报 `current/required`）；**隐藏成就**章心只剩一个问号（`is-secret`，解锁前一个字的真名与条件都不出现）。样式在 `styles/achievements.css`；返回按钮的提示里写着 `Esc` |
| `views/Desk.tsx` | 74 | 设置 / 数据 / 已归档三个页签（入口是便利贴「调一调」；**页签受控**：`tab` / `onTab` 由 `App.tsx` 拿着，按 `G` 才能从别的页签拨回「设置」；返回按钮的提示里写着 `Esc`） |
| `views/Settings.tsx` | 501 | 设置页，现在是一页手绘风的**方格纸清单**：`Settings` 管取数（`config_get` / `paths` / 两个本机偏好）+ **导出的 `SettingsSheet`**（数据由外面递进来、没有 hooks，冒烟直接渲染它）；按值类型渲染**勾选框 / 铅笔线 + 数字 / 横线上的填空**，写回 `config_set`。每一项的排版是：大白话名字 + 管哪儿的牌子 + 控件 → 一句话（它干什么的）→ 一行小字（技术名 + 「现在：…」的人话读法 + 保存）。**措辞全在 `lib/settingsText.ts`**（认不出来的键回落成「键名当名字」，不替它编说明），样式在 `styles/settings-page.css`。`save(row, raw)` 的 `raw` 由调用方递进来 —— 布尔那一行「勾选即保存」原来从**还没更新**的 `draft` 里读，第一次勾选会把旧值写回去（开关看着开了、文件里是关的），2026-10-09 顺手修掉 |
| `views/Data.tsx` | 287 | 数据：路径展示、导出 / 合并备份、`prune` / `clear`（含页内二次确认） |
| `views/Archived.tsx` | 122 | 已归档：列表 + 一键找回 |
| `components/BookContextMenu.tsx` | 484 | 右键菜单 + `BookStatsDialog` / `BookPropsDialog`（书名 / 作者 / 标签可编辑）/ `ConfirmDeleteDialog` / `LimitDialog` |
| `components/BookTransition.tsx` | 208 | 开书过场：抽书 0.5s → 横转 0.8s → 停留 3s → 翻页 0.5s（纯 CSS 3D） |
| `components/BookshelfManager.tsx` | 394 | 管理模式的交互层：管理条（完成 / ☑️批量编辑 / 选中那一本）+ **拖书**的浮起卡片 + 落点指示线 + 边缘停留 0.3s 的翻屏环。它不碰数据：每动一下只问父组件「落在第几屏第几排第几个缝」（`hitAt`），落点变了才回调；卡片 / 指示线 / 进度环的位置**直接写 style**（不每帧渲染整面书架） |
| `components/ImportFlight.tsx` | 313 | 导入飞行动画：这一批新书从篮口沿抛物线一本本飞上架 + 「已归位 X/N 本」计数器便签（节奏与落点算术在 `lib/importFlight.ts`；跨屏时先请父组件翻到那一屏） |
| `components/ImportPickMenu.tsx` | 110 | **Windows / Linux 专有的「＋」小菜单**（macOS 不会出现）：两项 —— 选文件（多选）/ 选文件夹（内核递归找）。挂点按篮子的 `getBoundingClientRect` 算、量完自身尺寸夹回窗口；收起三条路（点项 / Esc / 点那层 `.import-pick-scrim` 遮罩，遮罩压在篮子上所以「再点一次篮子」= 关掉）。样式复用右键菜单那张木色卡片（`.book-menu`），只多 3 条规则 |

| `components/SealEffect.tsx` | 110 | 封印动画：书脊原位光点飞散（28 颗，黄金角）+ 提示条（「这本书似乎被兔子藏起来了……」—— 就是导读里那只） |
| `components/StickyNoteNav.tsx` | 400 | **墙上那一栏的便利贴式功能入口**（统计 / 成就 / 设置三枚，替掉了原来的日历挂件 / 徽章盒 / 黄铜齿轮）：和纸质感（**纯 CSS**，不用图片、不引 web font）、米黄 / 淡粉 / 淡绿三色**顺着 id 列表循环发**（三枚正好三色各一枚；起点取自列表的哈希，每枚各自哈希会撞色 —— 试过）+ ±3° 倾斜**按 id 哈希**（复用 `lib/coverGenerator` 的 `hashText`，看着随机、每次打开都一样）、尺寸 3rem × 2rem（**字是系统手写体栈，2026-10-07 起 `0.72rem / 600`、三档墨色压深** —— 三字文案仍留约 16% 余量不会出省略号；那一串字体现在是 `App.css` 里的全局 `--hand-font`，统计页那纸日记共用，本文件只写 `--note-font: var(--hand-font)`；翻面的纸展开成 5.2 × 3rem 装一整句）、右下角翘 ≈3px（hover 展开）；交互：hover 下压 0.98 + 投影加深；点一下「**撕下**」（向上飞出 + 转 15° + 淡出）之后才开面板；面板关掉时**从上方贴回**（面板一开 `Shelf` 就被 `App.tsx` 卸下，所以「上一次撕下的是哪一枚」记在模块变量 `lastTornId` 里，挂载时补那一眼）；**拖拽**（写 `transform` 偏移、不动版面，超过 4px 才算拖，松手吸附：离原位 28px 内回原位、否则吸到 8px 格，位置存本机 `paget.sticky-note.v1`）；**连点 5 下翻到背面**说一句闲话（翻面用 `opacity` 控显隐、不靠 `backface-visibility`）；22:00–次日 6:00 纸边发黄。样式在 `styles/sticky-note.css` |
| `assets/wood-texture.svg` | — | 木纹背景 |

### 壳层 `src-tauri/src/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `main.rs` | 6 | 调 `paget_lib::run()` |
| `lib.rs` | 964 | 19 个 `#[tauri::command]`、封面查找 / base64、`use_project_data_root`、归档命令、**「＋ 导入」的两个平台两套选择器**（macOS 的 `macos_picker` / 其余平台的 `desktop_picker` + `ImportPick` 与 `picker_modes`）、`run()` |
| `core_client.rs` | 870 | 内核 sidecar 的 JSON-RPC 客户端；`CoreCommand::resolve` 决定用哪个解释器/冻结点；管道断了时把**整条命令 + 内核自己的 stderr 尾巴**一起报出去（`StderrLog` / `explain`，见 `activeContext.md` 第十三轮） |
| `db.rs` | 1,002 | 本机 SQLite 缓存：schema、CJK 分词、切块计划、全文搜索、GUI 位置与设置 |
| `archive.rs` | 814 | 手写 ZIP：`seal` / `read_meta` / `extract_payload` / `list` |

### 打包 `packaging/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `build-core.sh` | 129 | 找解释器 → 在临时目录里跑 PyInstaller（`paget-core.spec`）→ 装到 `src-tauri/binaries/paget-core/` → `smoke_core.py` 验协议（macOS / Linux 用） |
| `build_core.py` | 306 | 上面那个的**跨平台孪生**，Windows 上走它（那边不一定有 bash，venv 的可执行文件在 `Scripts/` 而不是 `bin/`）。内核按 `--core-root` > `$PAGET_CORE_ROOT` > **仓库自带的 `core/`** > 从解释器里那份 `wreader` 反推四级找；全找不到时打一整屏「试过哪些位置 + 两条出路」（`missing_core_report`） |
| `build_windows.py` | 226 | Windows 上一条命令出包：查环境（node / rust / MSVC / 内核解释器）→ `npm ci` → `build_core.py`（带着定好的 `--core-root` 递下去）→ `tauri build --bundles msi nsis` → 报产物。**非 Windows 上只做 `--check`** |

| `paget-core.spec` | 94 | PyInstaller 配方：**onedir + console**，收集 `wreader/data/`，排除 `rich`/`curses`，保留 `requests` |
| `paget_core.py` | 15 | 冻结二进制的入口（`wreader.serve.main`） |
| `smoke_core.py` | 292 | 对冻结点真发一轮协议，确认它能干活 |
| `make_icon.py` | 351 | 生成应用图标 |

Windows 那条路还要两样东西：**`src-tauri/tauri.windows.conf.json`**（20 行，Windows 专属的
`bundle.windows` —— 只打 msi + nsis、MSI 语言 `zh-CN`、NSIS 语言 `SimpChinese` 且 `currentUser`、
`upgradeCode` 写死；Tauri **只在打 Windows 时**才把它合进主配置）与
**`.github/workflows/windows-installer.yml`**（70 行，没有 Windows 机器时在 `windows-latest`
上跑同一套流程并把两个安装包传成 Artifacts）。**`.msi` 只能在 Windows 上打**（WiX 只跑在
Windows 上），随包内核也必须在那台 Windows 上冻。

## 关键设计模式

1. **薄壳 + 万能转发**：`core_request(method, params)` 直通内核，前端能调 `wreader/serve.py` 的任何方法，
   不必为每个方法加一条 Rust 命令。真正需要壳层能力的（缓存 / 封面 / 归档 / 原生面板）才单独成命令。
2. **数据所有权切分**：内核权威 / SQLite 可抛。判据：这东西丢了会不会让用户损失数据？会 → 内核；不会 → 缓存。
3. **前端打时间戳**：`synced_at` / `sealed_at` 由前端给（前端才知道时区），壳层只存不解释。
4. **能力探针**：`coreCapabilities()` 用假 book id 各探一次 `remove` / `finish` / `set_meta`，探测零副作用；
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
   在 dev 构建里走仓库自带的 `core/.venv/bin/python`，这样改了内核立刻生效，不被旧冻结点盖住。
10. **缓存"检测并重建"**：`SCHEMA` 一次 `CREATE ... IF NOT EXISTS`，`SCHEMA_VERSION` 变了就整库重建，
    不做逐表迁移（缓存的价值在于可抛）。
11. **一屏不滚动**：书多于一屏（`PAGE_SIZE=40`）用两侧箭头翻屏，而不是滚动条 —— 这是"书房"的视觉前提。
12. **昼夜主题**：`useSky()` 按系统时间（6 点天亮 / 18 点天黑）给 `main` 换类名，CSS 写 `.study.day` / `.study.night` 两套。
13. **嵌入式页面**：`Settings` / `Data` / `Archived` / `Stats` / `Achievements` 既能当整页（自带顶栏 + 返回），
    也能 `embedded` 交给 `Desk` 排版 —— 靠可选 props 复用，不搞路由。
14. **封面"只算不画"**：`coverGenerator` 只算方案，真正画的是 DOM + CSS（`BookTransition` 的 `.cover-*` + `App.css`）。
15. **纯 CSS 动画 + 黄金角**：过场与封印光点不用动画库、不用图片、不引随机数（方向由下标算出，可重放）。
16. **阅读页「按批追加的滚动」**：一次不取全书（内核也没有整本接口），取 `SCROLL_CHUNK = 200` 行，
    离底 `SCROLL_PREFETCH_PX` 时 `appendScroll` 再追加一批；位置用**二分 `offsetTop`**
    从可见区第一行反推 —— 它既是屏顶显示的位置，也是存回内核的位置，书滚到几千行也不卡。
17. **「一屏」是滚出来的，不是量出来的**：`← / → / 空格 / PgUp / PgDn` 调 `scrollScreen`，
    **按像素**滚 `clientHeight * 0.9`（留 10% 重叠，读起来不断在行缝里）。滚动视图不需要
    「这一屏放得下几行」这种度量，所以没有 `pageSize`：位置由滚动回调重算，天然是准的。
    （曾经量过一屏几行，还配了分页模式与单栏 / 双栏，2026-10-05 按用户要求整套删除。）
18. **丝带书签是「视图」，数据仍在内核**：丝带只是 `progress.bookmarks` 的一个视图，
    点击走 `saveCorePosition` 整份覆盖写，与终端按 `b` 是同一条路；界面不自己存书签。
19. **排版偏好是界面状态，行内样式落地**：字体 / 字号 / 字重 / 字距 / 行距 / 段间距与页边距存在
    `gui_settings` 的 `reader.prefs`（`lib/readerPrefs.ts` 负责范围归一化与读写），阅读页把它们贴成
    `.reader-lines` 的行内样式：标量（`fontSize` / `lineHeight`…）直接当属性，**段间距走 CSS 变量**
    `--reader-para-gap`（每一行都可能用到它，变量只写一次）。写盘按 400ms 防抖，避免拖滑块时连写。
    **字体**是「id → 字体族列表」的一张小表（`READER_FONTS`），贴上去的是 `readerFontStack(font)`：
    只用**系统字体**（离线应用不引 web font），每款排几个候选名 + 一个通用族收尾，
    所以缺字体时版式不会塌；面板里那六枚胶囊**自己就用那款字体**写名字（挑的时候看得出差别）。
20. **滚动键不做连发限制**：`← / → / 空格 / PgUp / PgDn` 长按可以一直滚 —— 像素滚动没有异步取文，
    不会乱序落地。需要排队的是**取文**的动作（`↑ ↓` 与跳转，见下一条）。
21. **顶栏是「呼出来的浮层」**：`.reader-bar` 绝对定位 + `translateY(-100%)`，**不占布局**，
    所以呼出 / 收起时书页不跳；`inert` 保证收起后键盘焦点也进不去。呼出条件是一块**比例矩形**
    （`MIDDLE_BAND` x 25%~75% / y 18%~82%），用 `event.clientX/Y` 与容器 `rect` 相除判断，
    与窗口大小无关。点面板外面只关面板不关顶栏 —— 靠一个 `swallowClick` ref 把那次 `click` 吃掉
    （`mousedown` 关面板、随后的 `click` 会冒泡到容器，不拦住就会顺手收起顶栏）。
    三块面板（`Aa` / 主题 / 速度）加上阅读页那颗**「阅读设置」**（2026-10-11：内核 `reader.*`
    整节从「调一调」搬来）共用一个 `panel` 状态，天然互斥；判内外用 `closest(".reader-prefs-wrap")`。
22. **光点导读：每帧写 DOM，不每帧渲染 React**：`reader.lines` 的每一行就是一个 `reading-line`
    节点，「领路的」（光点或兔子）挂在**当前行里**的 `.reading-guide-marker` 上、位置每帧由
    `placeGuide` 直接写 `style.left/top` —— 走 state 的话一秒要渲染几十次，而 React 只在
    **换行 / 换档 / 换标记 / 开关**时渲染（≤ 2 次/秒）。
    动画循环（rAF）不依赖任何 state，每帧要读的都放 `guide` ref，所以换行 / 换档都不会重启它
    （重启会丢一帧、也会打乱当前行的计时）。计时单位是**每行停留时间**（20 档：1 档 20s/行 …
    20 档 0.5s/行，顶栏那枚速度按钮点开拖的滑杆就是它），换行时把超出的那点时间带到下一行，
    长跑不累积漂移；`dt` 夹在 120ms 以内，所以切后台回来一帧也只走一行、不会掠过一整屏。
    一帧的推进整个儿在纯函数 `stepGuideWalk` 里（`lines` + `{index, elapsed}` + `dt` + `duration`
    → 下一次停在哪儿 / 这一行走了多久 / `moved` / `stopped`）：**空行一步跨过去、一条也不花时间**
    （`guideNextLine`；落在空行上当帧纠正，`stopped` = 这批再没有有字的行了 → 接下一批或收住）。
    抽成纯函数是为了这条能对着真实调用路径下断言 —— 拼在组件里就只能复制一份逻辑来模拟。
    每帧的顺序：`walk.stopped` → 接下一批 / 收住，`walk.moved` → `land()`（清掉量好的 rect、
    重渲染、进度落本机、跟滚），否则 `placeGuide(elapsed / duration)`。
23. **一行折成几折就按几折走**：一行是 `reading-line`（`<p>`），里面套一层 `.reading-line-text`
    只为了让 `getClientRects()` 量出**这一行文字铺到哪儿** —— 折行时它返回多条 rect，
    `guideDotAt` 把一行的时间**均摊**到每条 rect 上，光点于是沿折行继续往右走，而不是在第一折右端停住。
    量 rect 只在换行 / 改字号 / 改纸面时做（`useLayoutEffect`，绘制前就位），不是每帧。
    量出来的每一折既给光点当路，也给**当前行那几条轨迹条**当几何：条数（`guideTrailRows`）
    只有量完才知道，所以它是 state；那几条的 `style.width` 仍旧每帧直接写。
24. **轨迹是字底下那条下划线，不是整段底色**：两段各用一种画法，但**同色同高**，
    所以换行那一瞬间看不出接缝：
    - **已读行**用 `.reading-line-text` 上的 `text-decoration`（`text-underline-offset: 0.25em`、
      `thickness: 0.1em`、`skip-ink: none`）。折行时它天然一折一条、只到文字本身，正好是
      「一行字的下划线」而不是糊满整段；颜色靠可插值的 `text-decoration-color`（0.4s）化开 ——
      与「渐变背景没法插值」是同一类取舍。
    - **当前行**用那一折一条的 `.reading-guide-trail`（走过的整条亮、正在走的那折按进度长），
      光点圆心压在这条线上，于是「从正文下方划过」。空行没有字，两样都不画（光点照走）。
    两者的高度是**一对常量**：CSS 那边从字母基线往下 `0.25em`，TS 那边取一折内容框的下沿
    （`guideTrailY`）—— 20px 字号下都在基线下约 5px。改一个就要改另一个。
    两者都靠 `z-index: -1` + 行上 `isolation: isolate` 待在字下面，又不会掉到纸页背景之下。
24b. ~~**换成兔子时，同一套轨迹改铺脚印**~~ —— **这一号 2026-10-10 按用户要求去掉了**，
    只剩光点与下划线。留着这段当经验：那一号是怎么画的（`GuideRabbit.tsx` 的 18 × 12 像素画、
    「探-缩-探-进」四拍、`--guide-hop` 由档位算、`--guide-prints` 那张一格 5em × 1em 的梅花 / 月牙
    底图、`guidePrintWidth` 把轨迹收成整只脚印、`GUIDE_PRINT_EM` ↔ `background-size` 那对常量），
    以及**「模式类一挂、字底下那层整个换掉」**这个做法本身（与下面 24c 的下划线同源）。
24c. **「下划线」这一号领路的（2026-10-09 加，当天改过一版）：四五个字宽的一段下划线自己往前挪**。
    它没有实体的那一位 —— **那一段短下划线本身就是领路的**，复用上面那几条 `.reading-guide-trail`
    （一折一条），所以它长得**就是字底下那道线**：与已读行那条 `text-decoration` 同色
    （`var(--reader-ink)`）、同粗（都是 0.1em）、同高（落点都压在轨迹线上）、连方头都不改样子
    （`border-radius: 0`）。**一件只动一样东西**：只有**长度**在动。
    - **宽度按字算**：`GUIDE_CRAWLER_EM = 4.6`（一个汉字 ≈ 1em，英文一个词 ≈ 0.5em → 约两个
      单词），而且是**最长那一拍**的宽度（缩回来那一拍 3.77 个字），所以一整轮都在「四五个字」里。
      照旧跟着字号缩放：`Reader.tsx` 按 `fontSize × GUIDE_CRAWLER_EM` 算好放进 `guide` ref。
    - **步子一步一顿**：`crawlStep`（smoothstep）把 `pct` 拧一下 —— 一折之内先慢后快再慢，
      两头几乎停住、中间才快。`pct` 是均摊出来的时间比例，直接用它定位置就是匀速。
      **平均值不变**，所以一折走完的时间（= 每行停留时间）一点没动，换行节奏不受影响。
    - **伸缩是自己的节奏**：`guideBreath(clock)` → `guideCrawlWidth(em, clock)` 只返回**一个宽度**。
      时钟是 ref 里一个**只增不减**的毫秒数（每帧 `+= dt`）：**不能拿 `pct` 当相位**，
      那个每换一行就归零，看着就是「一换行抽一下」。周期 2.2s 是挑出来的（二十档的每行停留时间
      没有一个与它成整数倍，最接近的也差 7%），免得每翻一行都踩在同一拍上。
      **粗细 / 颜色 / 落点一律不动** —— 一条会变粗变细的线一眼就看出是「另一个东西」，
      而它要的正是「一条下划线」。
    - **身子铺在头的后面，顺着阅读顺序往回退**：右端 = 正在走的那一头、左端 = 刚走过的四五个字；
      一折铺不下就从**上一折的末尾**接着铺（折行时几折都从行首那个 x 起头，拿区间硬套会算错
      —— 第一版就错了），于是折行天然拆成两条、行首那一段从左边长出来、行尾那一条右端正好
      压在行尾。返回的是 `GuideCrawlBand[]`（与 `rows` 一一对应，没搭上的那条 `width` 为 0），
      每条**只有 left / top / width** —— 高度不是它的事，那条线多粗由 CSS 说。
    - **走过的迅速化掉**：下划线模式下已读行那条**不再常驻**，
      `.reader-lines.guide-crawl .reading-line.passed .reading-line-text` 用一条 0.75s 的 CSS 动画
      （`reading-guide-ink-fade`，前 22% 保持墨色、之后淡到 `transparent`，`forwards` 停在「没有」上）
      让刚读过的那行「亮一下就走」。**这是「看着像在前进」的关键**：要是身后积着一条越来
      越长的下划线，又变成进度条了；化掉之后正文里任何一刻能看到的都只有那一小段。
      动画是纯 CSS、按行一次性播完，所以**不需要 JS 计时器**，React 重渲染也不会重播。
    下划线模式下当前行**不再有「走过的进度」**（那一段就是全部），
    `.reading-guide-marker` 那个 span 留着当**量尺寸的锚点**（里面空的）。长相在
    `.reader-lines.guide-crawl`（模式类 —— 「挂一个类、字底下那层整个换掉」这个做法与已删掉的
    `.guide-rabbit` 同源）。
24d. **颜色可以自己换（2026-10-10 加）**：光点那颗小球与它划过的那条线各一枚取色器
    （在顶栏那枚速度按钮点开的浮层里，紧挨着标记胶囊），存 `reader.prefs` 的
    `guideDotColor` / `guideLineColor`（**空串 = 出厂色**）。同一天稍后加的「波浪线」
    第三枚见下面的 24e。
    - **颜色不写死在 CSS 里，走一层变量**：`.reading-guide-dot` 的三档渐变与两层光晕、
      `.reading-guide-trail` / `.reading-line.passed .reading-line-text` 的那条线、
      `.guide-crawl` 那一段，全部读 `var(--guide-*, 兜底值)`。**兜底值就是原来那几个字面量**，
      而没自定义时 `guideColorVars` 返回空对象、一个变量都不写 —— 于是**出厂外观与从前一字不差**。
    - **一个颜色派生出几档**：挑了光点色就在 TS 里按比例混出来（高光往白里混 80%、暗边往黑里混 28%、
      光晕两层往黑里混 16% / 30%、那条线取它 @45%）—— **不用 `color-mix()`**（那要 Safari 16.2+，
      这个项目一路只用 Safari 14 就有的东西）。混色是纯函数（`mixHex` / `hexToRgba`），
      所以「挑个深蓝会不会配出一颗发灰的球」这种事能在 node 里算过再出图。
    - **两样的默认是「一套」**：出厂时光点与它划过的线本来就是同一支琥珀，所以**只改光点色时那条线
      跟着光点走**（不然蓝光点拖着一条琥珀线很怪）；**改下划线色则那条线单独变**（含下划线模式下
      那一段 —— 那道线本来就该是「同一支笔画的」）。色块显示的就是**当前这一档的出厂色**
      （下划线在「下划线」模式下出厂跟正文墨色），所以色块与屏幕上那条线总是同色。
24e. **再添一号「波浪线」（2026-10-10 加）：同样的导读方式、换一支笔**。用户要的是
    「增加波浪线导读，其导读方式和下划线一致，颜色和光点 / 下划线一样能自己换」——
    这也是「加一号领路的」最省力的一次：
    - **行为与长相分开**：走法（`guideCrawlAt` / `guideCrawlWidth`：宽度、步子、伸缩、
      折行怎么拆）**一个字没新写**，只在 `.reader-lines` 上多挂一个模式类（`guide-crawl` /
      `guide-wave`），`placeGuide` 那条分支从「下划线模式才爬」放宽成「**不是光点就爬**」。
      于是「同一套走法、两套笔迹」在代码里也是这个形状：**行为一份、长相两处**。
      再添第三号笔迹时，只要 `GUIDE_MARKERS` 加一枚 + 一组 CSS 就行。
    - **形状走 `mask`、颜色走 `background-color`**：波浪是一张可平铺的 SVG
      （`src/assets/guide-wave.svg`）。**不能**直接当 `background-image` 用 —— 那样 SVG 是
      隔离渲染的，`currentColor` 拿不到外面的颜色，用户挑的色就上不去；`mask` 只取形状、
      颜色留给 CSS 的 `background-color`，于是「画好的形状 + 可换的颜色」两样都要到了。
      `mask-size` 用 em 给（`--wave-h`）→ 字号一变波浪跟着变；地址只写一遍（`--wave-img`），
      `-webkit-mask-*`（Safari 14 只有带前缀的）与标准两条共用它，免得同一张图进包两次。
    - **线粗 / 波长的比值是「量」出来的**：已读行那条波浪用的是浏览器自带的
      `text-decoration-style: wavy`，它长什么样各引擎自己定。为了两处**同一个节奏**，
      把字号放到 200px 出图、写脚本解 PNG 数出它那条笔的「波长 / 振幅 / 线粗 ≈ 4.8 / 0.27 / 1」，
      波浪的**波长照着它定**、**振幅给到两倍**（0.6 × 线粗）—— 照 0.27 的话 1× 屏、20px 字号下
      振幅还不到一个像素，看着就是「没换」。中途试过用两段 `radial-gradient` 的圆弧拼波浪
      （纯 CSS、不加资产），在 2–3px 尺度上是一团扇贝边、不像波浪，才换成这张 SVG。
    - **每一号自己一支颜色变量**：第一版让 `.guide-wave` 把下划线那支 `--guide-crawl` 指到
      波浪线的颜色上（好复用「颜色 + 化掉」两条规则），但下划线色是**行内**写在 `.reader-lines`
      上的 —— 行内优先级高于 CSS 规则，于是**只改「下划线」色、波浪线也跟着变色**。
      现在波浪线读自己的 `--guide-wave-line`、化掉也另开一份 `reading-guide-wave-fade`
      （`var()` 在 keyframes 里照当前元素现算，借用那份同样会串台）。
      **教训**：行内写的自定义属性没法被同元素的规则「改道」，要隔离就另起一个变量名。
25. **手动挪位置 = 光点跟着回到屏顶那一行**：光点往前爬时先把这一行滚进视野（`followGuide`
    让它待在视野上方约 1/3，差半个行高才滚一次，画面是匀速往上爬），**它自己滚出来的那些不算
    「用户挪了位置」** —— `onScroll` 只看「光点那一行还在不在视野里」，不在（且手停了 120ms）
    才 `syncGuide(屏顶那一行)`。跳章 / 跳书签 / `↑ ↓` 走 `moveTo`，同一条 `syncGuide`。
26. **光点进度是界面自己的状态**：存在 `localStorage`（键 `paget.reading-guide.v1.<书 id>`），
    **不进内核** —— 光点读到第几行只存在本机。打开一本书时它是**优先的恢复位置**
    （光点总走在屏顶那一行前面，它才是「读到哪儿」的最新事实），导读关着时才按老规矩用
    `gui_position` / `progress.current_line`；每换一行写一次、离开阅读页再写一次。
    记录里还带一个 `rev`（当前 2）：**档位刻度**这类局部改动只动它、**不换键名** ——
    换键名会把「读到第几行」一起丢掉，而位置比档位金贵。老记录（没有 `rev`，档位还是
    6 档刻度）读回来时按**每行停留时间**就近折到 20 档刻度上（老 1 的 8s/行 ≈ 新 6 档、
    老 6 的 0.5s/行 = 新 20 档），快慢手感不变、位置照旧。
22. **提示走底部浮字**：错误 / 一次性提示不再占布局（否则顶栏收起来时会把书页顶下去），
    统一贴成 `.reader-toasts` 的底部浮字并 `pointer-events: none`；顺带能播报（`aria-live`）。
23. **挪位置串行（`runTurns`）**：`↑ ↓` 翻行与跳转都是一次异步取文，连按会同时发好几份，
    它们都以「还没更新的位置」为起点、又可能乱序落地 —— 结果就是界面跳到更靠后的地方、
    中间那段没了。所以用一个 `turning` 锁 + `pendingStep` / `pendingLine` 记账：
    **一次只发一份，落地后再以最新位置接着走**。
24. **位置牌**：`.reader-pos` 在跳转 / 翻行后亮 1.4s「第 X/Y 行 · P%」——
    顶栏收起时它就是「我在哪」，位置感就是上下文。
25. **书皮是「结果」，不动**：只剩左侧一块静态硬皮 `.book-cover`（`.book-stack` 是右下探出的纸边、
    书口）。曾试过让「书底」左右滑动模拟翻页（`book-base` + `sweepBase`），**已删除**；
    后来连「封面 + 封底两块」与 `.reader-sheet` 的翻页动效也一起随分页删掉了 ——
    滚动阅读里根本没有「翻页」这个动作。
26. **阅读页没有翻页动效，也别再加回来**：留下的只有丝带落下（`bookmark-drop`）与提示 / 位置牌的淡入。
    用户两次明确指出「书皮是结果、不是过程」。
    附带一条**已作废的坑**：CSS multicol 里各栏的 `offsetTop` 不保证按栏重置，
    而几百字的段落常比一栏还高 —— 当年用双栏分页时纵向判定会把一屏量成 1 行。
    那套「换栏信号」量法随分页一起删了，将来若再做 multicol，记得别再按纵向数行。
27. **改排版不重新取文**：`Aa` / 主题面板只改行内样式与 CSS 变量（含行距、段间距），不碰内核。
    `↑ ↓` 是按**行号**跳，改版式后同一行号仍是同一行，所以位置不会因为字号 / 行距变了而漂移。
28. **纸面配色 = 纯函数算出来的一组 CSS 变量**：`readerPalette(prefs)` 先取「预设主题 × 亮暗」
    的一套 `ReaderPalette`（纸色 / 纸边填充 / 纸边线 / 墨色 / 纸面的光 / 书脊的暗），
    再把 `customBg` / `customFg` **盖上去**；盖过之后纸边、纸边线与书脊的暗**重新派生**
    （`mixHex` 深浅 ±8%、`hexToRgba` 取墨色的透明度），否则绿纸会配出一圈棕边。
    结果贴成阅读页容器的行内 CSS 变量（`--paper` / `--paper-edge-fill` / `--paper-edge-line` /
    `--reader-ink` / `--reader-sheen` / `--reader-spine`），`.reader-page` / `.book-stack` 与
    `.reader-lines` 都用变量取色 —— **只改一次变量，整张纸一起变**，没有任何 TSX 里写死的颜色。
    主题 / 亮暗 / 自定义色与排版同在 `reader.prefs` 一份偏好里；自定义色为空串 = 跟随主题，
    未知主题 / 坏颜色在归一化时就被换掉，样式里永远进不去 NaN 或非法串。
29. **元数据编辑走内核，界面不做覆盖层**：书名 / 作者 / 标签是 `library.json` 里的权威字段，
    所以「属性」面板的保存走内核 `set_meta`（`BookPropsDialog` → `Shelf.saveMeta` → `coreRequest`），
    成功后重同步书架（标签还参与内核的模糊搜索，只改内存那一行会与搜索对不上）。
    没有走「界面侧另存一份改名」那条路：那会立刻出现第二份事实，书库与书架上会是两个名字。
    内核侧只动这三个标签（`library.set_metadata`），正文文件与阅读进度一概不碰。
30. **「书摆在第几位」是内核的数据，界面只留一份退路**：管理模式的顺序与隔板存在**内核**里
    （`wreader/shelf.py` → 与 `library.json` 并排的 `shelf.json`，两次 RPC `shelf_layout` /
    `set_shelf_layout`，别处看的是同一份）—— 摆法属于「你的书怎么放」，不属于
    「这台机器怎么显示」，所以它换机器 / 备份都该跟着走。但它**只是一份「偏好顺序」**：
    渲染时永远与内核这次给的书单**按 id 并**一次（`mergeOrder`）—— 存过的优先、新书接在后面、
    删掉 / 封印掉的书自动消失，所以内核那边永远是权威、界面这份不需要迁移脚本。
    隔板的位置同理挂在**书 id** 上（不是「第几格」）：书脊厚度与一排放几本都是算出来的，
    挂格子必然错位。**老内核**（随包内核冻得早，`shelf_layout` 回 `unknown method`）与
    内核没起来时，回落到本机 `gui_settings` 的 `shelf.layout` —— 两条路读出来的是同一个
    `normalizeLayout` 归一化过的形状，界面只多记一个 `home`，管理条上写着「内核 / 本机」。

## 关键调用链

- **同步书架**：`App.refresh` → `cachedShelf()`（先画缓存，瞬间） → `coreVersion()`（顺带当"内核还活着"的探针）
  → `sync_shelf`（内核 `list` → 覆盖写缓存 → 回行）。
- **打开一本新书**：`Shelf` 点击 → `bookCover` + `bookRecord`（顺带记"打开"事件） → `BookTransition` 过场
  → `Reader` → `text` / `toc` / `loadGuiPosition` → 60s 定时 `position` → 退出 `session`。
- **到期封印**：书房时钟每秒跳 → `expiredBooks(...)` 命中 → 量书脊坐标 → `archive_seal`
  （内核 `get_book` → `archive::seal` 写 zip → 内核 `remove`） → `SealDissolve` / `SealToast` → `onSync`。
- **找回**：`Archived` → `archive_restore`（白名单校验归档名 → `read_meta` → 解到临时目录 →
  内核 `import` → 内核 `position` 写回进度 / 书签 / 读完） → 删掉 zip → 刷新书架。
- **导入**：书架左边那只**藤条篮子** → `pick_import_paths`（macOS 是 `NSOpenPanel`，文件与文件夹同框多选；Windows / Linux 是 `desktop_picker`，只能二选一，所以界面先弹 `ImportPickMenu` 问一句「文件 / 文件夹」—— 那一档由 `import_picker_modes` 告诉前端） → 逐个内核 `import`（给的是目录时内核会**递归**找全里面的书）。
- **全文搜索索引**：`Reader.建立索引` → `index_book`（内核 `get_book` + `toc` → `chunk_plan` 切块 →
  内核 `text` 取每块 → 分词入库，超过 `MAX_INDEX_LINES` 就在报告里说明"只索引了前半部分"）。

## 必踩的坑（都在代码里留了注释）

1. **没有 epub.js**：内核只留着**转换后的 `.txt`**，原始 epub 不在 `~/.wreader`，epub.js 拿不到书也用不上 CFI。
   于是阅读页按行号向内核对 `text`；CFI 设计保留在 `positions.cfi` 列里。
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
11. **`.msi` 只能在 Windows 上打，别在 macOS 上试**：WiX 只跑在 Windows 上（Tauri 官方文档原话，
    本机 CLI 的 `--bundles` 连 msi 这个值都不列），**而且随包内核必须在同一台 Windows 上冻**
    （PyInstaller 不能交叉编译 —— macOS 上冻出来的是 Mach-O）。所以 Windows 那条路走
    `packaging/build_windows.py`（或 `.github/workflows/windows-installer.yml`），
    本机只能验到「Windows 配置能被 CLI 读进去 + 脚本跑得通」。
