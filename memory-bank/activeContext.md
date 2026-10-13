# 当前焦点 — Paget

> 最后更新：**2026-10-13**。这是每次开始工作前**第一个要读**的文件。

## 当前焦点：阅读页（滚动阅读 + 拟物书签 + 排版与纸面主题可调 + 光点导读 + 上下两栏可呼出）

> 最近一次改动（2026-10-13）是**阅读页拆成上下两栏**：目录与书签挪到屏幕下方的下栏，
> 上栏只留「这本书 / 我在哪」，呼出的两块木头换成与书架右键卡片同一套木料，
> 选项文案改成大白话 —— 只动 `.github` 那处以外的前端（`views/Reader.tsx`、`App.css`、
> `PdfReader.tsx`、`readerConfig.ts`、`settingsText.ts`），见「本次改动（2026-10-13，第三十轮）」；
> 同一天早些时候还复核过 Windows 安装包那条 CI 工作流（含一次真跑暴露的编码 bug），
> 见「本次改动（2026-10-13）：复核 Windows 安装包那条 CI 工作流」；
> 再往前是**内核搬进仓库**（`core/`，2026-10-11 第二十九轮）：不再依赖仓库外的
> `../wreader`，界面上也不再出现 `werd` 字样（只给命令行前端用的那些设置项在界面上
> 一个都不列），见下面第一节「本次改动（2026-10-11，第二十九轮）」；
> 它的上一轮是**阅读相关的设置项全部搬进阅读页**（内核 `reader.*` 里界面真的会读的那几项：
> 顶栏那颗「阅读设置」，文字页与 PDF 图片模式都有），见「本次改动（2026-10-11，第二十八轮）」；
> 再往前是**阅读页的自动翻页（免手翻）**——文字页走「屏幕行」、PDF 图片模式一次翻一页，
> 与内核那套**同一个语义**（含弹题防作弊），见「本次改动（2026-10-11，第二十七轮）」；
> 再往前是**PDF 默认按图片浏览 + 阅读页那颗「转换成文字」**（界面用 pdf.js 画页面，抽文字那半是
> 内核的活；见「本次改动（2026-10-11，第二十六轮）」）；
> 它的上一轮是**导入新增 MOBI / AZW3 两种 Kindle 格式**（同一天，见第二节「第二十五轮」）；
> 再往前是**导读里多了一号「波浪线」**（走法与下划线完全共用一套 —— 那四五个字宽的一段线
> 自己往前挪、走过就化掉，只是笔迹是波浪的；波浪是一张可平铺的正弦波
> `src/assets/guide-wave.svg`，拿它做 `mask`、颜色仍由 `background-color` 给，于是**也能像
> 光点 / 下划线那样自己换颜色**，见下面第一节「本次改动（2026-10-10，第二十四轮）」）；
> 再往前是**光点与下划线的颜色可以自己换**（顶栏速度按钮那个浮层里两枚取色器：
> 光点那颗小球、以及它划过的那条线；颜色存 `reader.prefs`，**空串 = 出厂色**，
> 全部走 `var(--guide-*)` 而兜底就是原来那几个字面量 —— 所以不自定义时外观一字不差，
> 见「本次改动（2026-10-10，第二十三轮）」）；
> 再往前是**把导读的标记去掉「兔子」、只留光点与下划线**（`components/GuideRabbit.tsx`
> 那份像素画、`.guide-rabbit` 那套脚印轨迹与五个兔子专用函数全删；老存档里存着 `rabbit`
> 的记录按坏值回落成光点，行号 / 档位 / 开关一个不动 —— 书架上那只毛绒兔子没动，
> 见「本次改动（2026-10-10，第二十二轮）」）；
> 再往前是**把玩偶的「左 / 右 / 后」三面整个去掉、只留正面**（`facing` 字段、
> `TOY_FACINGS`、`data-facing` 属性与 App.css 里那整节侧身 / 朝后的画法全撤，
> 摆法面板上那排「前 / 左 / 右 / 后」的小方块也删了 —— 那一行于是整行成一颗按钮，
> 见「本次改动（2026-10-10，第二十一轮）」）；
> 再往前是**玩偶的「朝左 / 朝右」画成真侧面**（只剩一只眼、鼻子探到脸的最前面、
> 远侧那条腿被身子挡住……**这一节已被本轮整个撤掉**，只当决策记录留着，
> 见「本次改动（2026-10-10，第二十轮）」）；
> 再往前是**多只玩偶之间的间距可调**（面板里多一行「间距」滑杆，摆上两只以上才出现，
> 存本机 `paget.shelf-toy-gap.v1`、实时打在架上的 `.toy-row` 上；顺带把面板抽成独立的
> `ToyPicker` 组件好在 node 里点数，见「本次改动（2026-10-10，第十九轮）」）；
> 再往前是**修「摆件栏里换玩偶的那块面板被上方那栏挂件（木墙）挡住一半」**
> （面板从玩具上方弹出、被基类 `.shelf-rack` 的 `overflow: hidden` 裁在架子顶边 ——
> 是「裁」不是「盖」，改 `z-index` 没用；装饰层里没有要裁的东西，单独放开溢出即可，
> 见「本次改动（2026-10-10，第十八轮）」）；
> 再往前是**摆件架上那三只毛绒玩偶各自放不放、各自朝哪一面（前 / 左 / 右 / 后）**
> （三只可以同时摆上；**朝向那四套已在第二十一轮去掉，只剩正面**；
> 摆法存本机 localStorage、老的单只玩具键会迁过来，
> 见「本次改动（2026-10-09，第十七轮）」）；
> 再往前是**导读遇到空行一步跨过去**（三种标记在空行上都不再停几秒，见
> 「本次改动（2026-10-09，第十六轮）」）；
> 再往前是**导读里加一号「下划线」领路的**（四五个字宽、墨色笔直、走过就化掉，
> 见「本次改动（2026-10-09，第十五轮）」）；
> 再往前是**把设置页做成手绘风的方格纸清单**（每一项都说大白话，
> 见「本次改动（2026-10-09，第十四轮）」）；
> 再往前是**首屏报「内核没起来」时说清楚是哪一步不对**
> （见「本次改动（2026-10-09，第十三轮）」）；
> 再往前是**把成就页做成一整块暗色陈列板 + 纯金的铁十字勋章**（已授予镀金 / 未授予生铁 /
> 隐藏成就一个问号，见「本次改动（2026-10-07，第十一轮）」）；
> 更早几轮：统计页做成手绘风的「读书日记」、墙上三枚便利贴的字调大调深、
> 按效果图重画摆件架上的留声机与收音机、墙上那一栏改成便利贴、书架管理模式；
> 标题里这一节仍是阅读页的现状说明。

`src/views/Reader.tsx` 与 `App.css` 里阅读页那一节整体重做过。**数据路径没动**：
位置 / 书签 / 时长仍然全部经内核 RPC（硬性约束 1）。

- **书签变成一枚拟物丝带**（`.reader-bookmark`，纸页右上角，纯 CSS 画的带 V 形开口的布丝带）：
  点一下就在**屏顶那一行**插入书签（`saveCorePosition` 整份覆盖写 `progress.bookmarks`），
  再点一下拔出来；每次点击让按钮重挂载一次（`key={ribbonStamp}`）重放 `bookmark-drop` 落下的动画。
  插着时是饱和的红，没插是灰的。
- **底部那四个按钮早就删了**，改成键盘：`↑` / `↓` 翻**一行**（与终端同一套行号语义）、
  `←` / `→` / `空格` / `PageUp` / `PageDown` **滚一屏**（`Shift+空格` 往回滚）；
  上栏右侧写着提示（`.reader-keys`）。焦点在下拉框 / 输入框里时不抢方向键，
  焦点落在按钮上时空格留给按钮自己按下。
- **不会「丢上下文」/ 跳段**：`↑ ↓` 与跳章跳书签都过 `runTurns` 的队列 —— 一次只发一份 `text`
  请求，连按先记账，等上一发落地再以**最新位置**继续；`cursor` 也以内核回的
  `next.start` 为准。（滚动一屏是**像素**滚动，没有异步取文，按住连滚是安全的，不需要排队。）
- **位置小牌子** `.reader-pos`：跳转 / 翻行后亮 1.4s「第 X/Y 行 · P%」——
  两栏都收着时这是唯一的「我在哪」，位置感就是上下文（任一栏打开时不显示，避免重复）。
- **书皮是「结果」，不动**：只剩左侧那一块棕色竖向硬皮 `.book-cover`（右侧的封底 `.book-back`
  随「单栏 / 双栏」一起删了 —— 滚动阅读里没有「跨页」这回事）。
  阅读页**不再有翻页动效**：`.reader-sheet` 与 `sheet-turn-next/prev` 随分页一起删掉
  （丝带落下 `bookmark-drop`、位置牌 / 提示的淡入这些小动效还在）。
- **上下两栏默认都收着**（两块 `.reader-bar` 都是绝对定位浮层：上栏 `translateY(-100%)`、
  下栏 `translateY(100%)`，再加 `opacity:0 + inert`）：
  只有**点屏幕中间那一块**（`.container.reader` 的 `onClick` 按 `MIDDLE_BAND = x 25%~75% / y 18%~82%`
  的比例判断）才呼出 / 收起；点边缘、点书签、拖选文字、点两栏本身都不触发。
  浮层不占布局 → 呼出 / 收起时书页不会跳。开局亮一句「点屏幕中间呼出上下两栏」，3.5s 后自己消失。
  **两栏怎么分**（2026-10-13）：上栏 =「这本书 / 我在哪」（← 书架 · 书名 · 位置 · 保存位置 ·
  建立索引 · 快捷键提示），下栏 =「怎么读」（自动翻页 · 目录 · 书签 · 光点导读 · 档位 · Aa ·
  纸色 · 翻页设置）；下栏的面板往上长（`.reader-bar-bottom .reader-prefs`）。
- **一次性消息（error / notice / 🏆 / 正在往下接）改成底部浮字** `.reader-toasts`：
  两栏收着时也看得见，而且不挤动书页；点它们会穿透（`pointer-events: none`）；
  两栏呼出来时（容器挂上 `.bars-open`）自己抬到两块木头上方，免得压住按钮。
- **排版可调**（下栏 `Aa` → `.reader-prefs.reader-type` 面板）：**字体六款**
  （`默认` / `宋体` / `楷体` / `仿宋` / `圆体` / `等宽` —— 六枚胶囊，**每枚自己就用那款字体**
  写自己的名字，挑的时候一眼看出差别；全是**系统字体**、不联网，哪款缺了浏览器顺着列表往后找）、
  字号 **20–80px**（滑块 + 数字框）、
  **字重 100–900**（整百档，滑块 + 数字框）、**字距 -1–6px**（0.1px 步进）、
  **行距 1.2–3.4 倍**（0.05 一档，滑块 + 数字框）、**段间距 0–2.5em**（0.1 一档，段落之间额外留白）、
  左右 / 上 / 下边距（数字框，px）、「上下留白一样多」勾选后下边距跟着上边距（输入框禁用）。
  面板里每一行写的都是**大白话**（「字多大 / 笔画多粗 / 字与字之间 / 一行多高 / 两段之间 /
  左右留白 / 上边留白 / 下边留白」），顶上还有一句「这几项只改这台电脑上『读起来的样子』」
  （`.reader-prefs-lead`，2026-10-13 加）。
  偏好存 `gui_settings` 的 `reader.prefs`（`lib/readerPrefs.ts` 归一化 + 读写，写盘 400ms 防抖），
  在阅读页贴成 `.reader-lines` 的行内样式（字体走 `readerFontStack(prefs.font)`）；
  点面板外面（先只收面板，见 `swallowClick`）/ 按 `Esc` 收起。
- **纸面主题**（下栏「纸色」→ `.reader-prefs.reader-theme` 面板，与 `Aa` 同属 `panel` 状态、互斥）：
  四套预设 **羊皮纸 / 护眼绿 / 深空蓝 / 代码**，每套各有**亮 / 暗两版**；
  面板里「纸的样子」那一排是四套预设，「白天或夜里」那两枚胶囊就是亮 / 暗；
  其中**代码**主题是深蓝底白字（`#00008b` / `#ffffff`，像代码编辑器），
  **亮暗两版故意同色** —— 点白天 / 黑夜不会把它变样。
  再往下是两个 `<input type="color">`（**底色** / **字色**），选了就盖在预设之上
  （`customBg` / `customFg` 空串 = 跟随主题），旁边「清除自定义色」回到预设。
  整套配色由 `readerPalette(prefs)` 算出，贴成阅读页容器的 CSS 变量
  （`--paper` / `--paper-edge-fill` / `--paper-edge-line` / `--reader-ink` / `--reader-sheen` / `--reader-spine`），
  所以**纸面、书页堆叠、书口、纸面的光、书脊的暗、正文墨色**是一起变的；两栏与木纹背景不动。
  首次使用（`gui_settings` 里还没有 `reader.prefs`）时亮暗**跟随系统**，之后以用户选的为准。
- **光点导读**（「跟着光读」）：一行一个 `reading-line` 节点，当前行里挂**「领路的」**——
  **三种任选一种**（下栏那枚「档位」的浮层里切换，存本机）：
  - **光点**（默认）：一颗 14px 琥珀小球（`.reading-guide-dot`，`radial-gradient` + 两层 `box-shadow`）；
  - **下划线**（2026-10-09 加；当天按反馈改过一版，见文末）：**没有实体的那一位** ——
    **四五个字宽的一小段下划线自己就是领路的**（`GUIDE_CRAWLER_EM = 4.6`，跟着字号缩放；
    英文书下约两个单词）。它不是一只虫、也不是进度条，就**是字底下那道线挪了个位置**：
    **墨色、笔直、方头**，与已读行那条 `text-decoration` 同色同粗同高（20px 字号下 0.1em 粗、
    落在同一条轨迹线上），唯一的「活气」是**长度在一伸一缩**（2.2s 一轮，最长 4.6 个字 / 92px、
    最短 3.77 个字 / 75.4px）。两件事让它不像匀速推进：①**步子**是一折之内先慢后快再慢
    （`crawlStep` 的 smoothstep，两头几乎停住、中间那一段才快）→ 一步一顿；②**伸缩**是自己的
    节奏（`guideBreath` / `guideCrawlWidth`，**时钟只增不减**，所以换行 / 换档都不重来）。
    2.2s 这个数是**挑出来的**：二十档的每行停留时间没有一个与它成整数倍（最接近的也差 7%），
    免得每翻一行都踩在同一个相位上。
    这一段铺在**头的后面**（右端 = 正在走的那一头，左端 = 刚走过的四五个字），身子**顺着阅读
    顺序往回退**：一折铺不下就从**上一折的末尾**接着铺 —— 于是折行天然被拆成两条（上一折末尾
    一条、下一折开头一条），行首那一小段是从左边长出来的、行尾那一条右端正好压在行尾。
    它**复用轨迹条那几条**（`GuideCrawlBand[]`，一折一条，只有 left / top / width），
    每帧由 `Reader.tsx` 写成行内 style；长相全在 `.reader-lines.guide-crawl`。
    **走过的迅速化掉**：下划线模式下已读行那条**不再常驻** —— 刚读过时落成墨色，
    0.75s 内淡到没有（CSS 动画 `reading-guide-ink-fade`），所以正文里任何一刻能看到的
    都只有那一小段，「看着像在前进」就是从这儿来的。**当前行也不再有「走过的进度」**
    （那一段就是全部），`.reading-guide-marker` 这个 span 留着当**量尺寸的锚点**（里面是空的）。
    （从前还有第三种**兔子**：书架上那只毛绒兔子跳进正文，换成像素风、侧面朝右、在行间
    「探-缩-探-进」地跑，轨迹改铺一串梅花 / 月牙的脚印，一跳 = 每行停留时间的 1/5。
    **2026-10-10 按用户要求整个去掉**；当天晚些又补了一号「波浪线」（见下），
    那段历史见本文件「去掉『兔子』」一节。）
  - **波浪线**（2026-10-10 加）：同上「没有实体的那一位」，而且**走法一个字没新写** ——
    宽度 / 步子 / 伸缩 / 折行怎么拆全复用 `guideCrawlAt` / `guideCrawlWidth`，只把**笔迹**换掉：
    当前行那条从直条换成**一条波浪**，已读行那条从 `text-decoration` 的直线换成
    `text-decoration-style: wavy` 的波浪（「化掉」的动画另开一份 `reading-guide-wave-fade`，
    节奏与下划线那句 0.75s 一字不差）。波浪本身是 `src/assets/guide-wave.svg` 里那张可平铺的
    正弦波 —— **形状走 `mask`、颜色走 `background-color`**（所以用户挑的颜色照样能上），
    `mask-size` 用 em 给，字号一变波浪跟着变；线粗 : 波长 = 1 : 4.8 是**量过浏览器那支笔**定的
    （见第二十四轮那节），振幅比它粗一倍（不然 1× 屏、20px 字号下振幅还不到一个像素，看不出是波浪）。
  **那几样颜色都可以自己换**（浮层里三枚取色器，2026-10-10 加）：光点色（那颗小球，高光 / 暗边 /
  两层光晕都由它派生）、下划线色（它划过的那条线 —— 含下划线模式下那一段）与波浪线色
  （波浪线那一号那一段）。存 `reader.prefs` 的 `guideDotColor` / `guideLineColor` / `guideWaveColor`，
  **空串 = 出厂色**（光点琥珀；下划线在光点模式下是淡琥珀、在下划线模式下跟正文墨色；波浪线跟正文墨色）。
  颜色一律走 `var(--guide-*)`，CSS 里的兜底就是原来那几个字面量、没自定义时一个变量都不写 ——
  所以出厂外观与从前一字不差；只改光点色时那条线跟着光点走（出厂时本就是同一支琥珀），
  只改下划线色时那条线单独变。**波浪线自己一支变量**（`--guide-wave-line`，不去借下划线那支
  `--guide-crawl`）：下划线色是行内写在同一个元素上的，行内优先级更高，借来就会串台
  （只改了「下划线」色，波浪线也跟着变色）。
  **三种标记都沿这一行从左往右、在正文下方**走（落点压在一折文字内容框的下沿，见 `guideTrailY`）；
  **划过的轨迹是字底下一条琥珀下划线**（不是整段的底色）—— 已读行由 `.reading-line-text` 的
  `text-decoration` 画（`text-underline-offset: 0.25em` + `thickness: 0.1em`、
  `skip-ink: none`，`text-decoration-color` 过渡 0.4s；折行时一折一条、只到文字本身），
  当前行那条由量出来的 `.reading-guide-trail` 轨迹条负责（一折一条：走过的整条亮、
  正在走的那折从行首长到光点）；**下划线 / 波浪线这两号里这几条不再表示进度，它们就是那一段
  领路的线本身**（`guideCrawlAt` 一折给一条，见上面那两段）。
  **空行没有字就什么都不画**（领路的照走）。
  （从前还有第三条**兔子**轨迹：同一套轨迹改铺一串脚印 —— `.reader-lines.guide-rabbit` 一挂，
  字底下换上一张纯 CSS 画的底图（一格 5em × 1em 放两只：左半梅花、右半月牙），当前行那条按
  整只脚印长（`guidePrintWidth`）；**2026-10-10 去掉「兔子」时，组件、那三组规则、脚印底图与
  两个纯函数一起删了**。）
  轨迹层靠 `z-index: -1` + 行上 `isolation: isolate` 老实地待在字下面。
  位置**每帧直接写 `style.left/top`**（不走 React state），只有换行 / 换档 / 换标记 / 开关才渲染
  （一批正文两百行，每帧渲染一次会拖垮滚动）；rAF 循环不依赖 state，`dt` 夹在 120ms 以内。
  **速度刻度 20 档、按「每行停留时间」**：`1` 最慢 20s/行 … `20` 最快 0.5s/行（等比排，每格 ×0.82），
  默认 `10` 档 ≈ 3.5s/行（与原六档的「中速 3s」差不多）；**主控是下栏那枚「档位」按钮点开的小浮层
  里的滑杆**（1–20，按钮上写着当前档位；与 Aa / 主题共用 `.reader-prefs-wrap` 做法与 `panel` 状态，
  所以三块面板天然互斥），浮层里还有**标记胶囊**（光点 / 下划线 / 波浪线；从前还有一枚「兔子」，2026-10-10
  按用户要求去掉），`1–6` 是滑杆上的六个快捷落点
  （`1` 最慢、`6` 最快）、`0` 开关光点（下栏那枚开关上写着当前标记：`光点开 / 下划线开 / 波浪线开`）。
  换档时当前行**重新计时、不跳行**、左上角淡入档位牌（如「10档 · 3.5s/行」）2s 后淡出；
  拖滑杆会连发，所以进度**等手停下来再写**（400ms 防抖，与排版偏好同一个做法），换标记则当场写。
  一行折成几折就按几折走（`.reading-line-text` 的 `getClientRects()` 一折一条 rect，
  `guideDotAt` 把这一行的时间均摊上去、`guideTrailAt` 把轨迹按同样比例铺到那一折上）；
  到达行尾换下一行，**空行一步跨过去、一条也不花时间**（`stepGuideWalk` → `guideNextLine`：
  空行只是排版留下的缝，原来三种标记都会沿空行走满一整行的工夫，看着就是「停顿了好几秒」；
  开书恢复位置 / 手滚同步落在空行上也当帧纠正）；
  **正文快见底时导读自己接下一批**（`guideNeedsMore`，不等用户滚到底、
  也不等 `scroll` 事件 —— 滚到底时 `scrollTop` 被夹住就不再触发滚动事件，只挂在那儿会永远
  等不到），所以画面**跟着领路的往前滚**、当前行一直留在视野上方约 1/3，
  **书末停下**并提示「已到最后一页」（内核那边确认没有正文了也一样收住，见 `exhaustedAt`）。
  光点进度存本机 `localStorage`（键 `paget.reading-guide.v1.<书 id>`，每换一行写一次、
  离开阅读页再写一次），开书时**优先按它恢复位置**（光点总走在屏顶那一行前面），
  导读关着时才用 `gui_position` / `progress.current_line`。
  记录里带 `rev`（当前 2）：档位刻度从 6 档换成 20 档时**没换键名**，老记录读回来按
  「每行停留时间」就近折到新刻度（老 1 的 8s/行 ≈ 新 6 档、老 6 的 0.5s/行 = 新 20 档），
  位置与开关照旧 —— 换键名会把「读到第几行」一起丢掉；`marker` 是**纯新增字段**，
  老记录没有它（或者存着认不出来的值）→ 回落到光点，不需要换算（所以不用动 `rev`；
  后来加的「下划线」与「波浪线」也是这样，都是**纯新增**的取值；**2026-10-10 去掉「兔子」时
  同样没换键名** —— 老记录里那个值没人认了，按坏值回落成光点）。
  手动滚动 / 跳章 / 翻行后光点跟到屏顶那一行重新计时；光点自己往前爬时把当前行留在
  视野上方约 1/3（`followGuide` → `guideFollowTop`，差半个行高才滚一次 → 画面匀速往上爬），
  同一处顺手把「下一页」接上（`guideNeedsMore` → `appendScroll`）。
  纯逻辑与进度在 `lib/readingGuide.ts`（含 `guideBreath` / `guideCrawlWidth` / `guideCrawlAt`），
  移动 / 轨迹 / 键盘在 `views/Reader.tsx`（那几号「一段线自己往前爬」的走法完全共用，
  只有「挂哪个模式类」不同：`guide-crawl` / `guide-wave`），
  样式在 `App.css` 的「光点导读」一节（直条那号 `.guide-crawl`、波浪那号 `.guide-wave`，
  以及两条「已读下划线迅速化掉」的 `reading-guide-ink-fade` / `reading-guide-wave-fade`）；
  波浪的形状是 `src/assets/guide-wave.svg`（可平铺的正弦波，做 `mask` 用）。
  （从前那号**兔子**是 `components/GuideRabbit.tsx` 的像素画 + `.guide-rabbit` 那三组规则 +
  脚印底图 `--guide-prints` —— 2026-10-10 去掉时一并删干净了。）
- **只有一种浏览方式：纸页自己滚**（2026-10-05 把「分页 / 滚动」两个模式和「单栏 / 双栏」栏数
  整套删掉，见 `progress.md` 的决策演变）：`.reader-text` 是 `overflow-y: auto` 的那一块，
  离底 `SCROLL_PREFETCH_PX` 时 `appendScroll` 再向内核要 `SCROLL_CHUNK = 200` 行接在后面，
  于是能一路读到书末；**屏顶那一行用二分**从 `offsetTop` 里找出来，它既是顶上显示的位置、
  也是存回内核的位置。跳转落在已装好的这一批之外时由 `loadAt` 从目标行重新铺一批
  （并把滚动位置拉回顶部）。一屏滚多少按**像素**算（`SCROLL ratio 0.9`），
  不再需要「这一屏放得下几行」这种度量 —— `pageSize` / `viewport` / 量法都删了。
## 本次改动（2026-10-13，第三十轮）：阅读页拆成上下两栏

**需求**：用户两条原话 —— ①「阅读页点中心呼出的上方设置菜单，画风变成与书架一个色系的，尽量用大白话
说明选项改变了什么」；②「阅读页面的『目录』与书签部分，搬离上方的栏目，挪到屏幕下方的栏目中，
现在阅读页的功能设置比较多，请妥善安置上下两个栏目的设置选项」。

**两栏怎么分**：上栏只留「这本书 / 我在哪」，下栏装「怎么读」——

| 栏 | 装什么 | 为什么这么分 |
| --- | --- | --- |
| 上栏 `.reader-bar-top` | ← 书架 · 书名 · 位置（% + 行）· 保存位置 · 建立索引 · 快捷键提示 ·（PDF 才有）看图片 | 都是「整本书级」的事：离开、看书名与位置、把位置 / 索引落一下 —— 与「读的时候想调什么」无关 |
| 下栏 `.reader-bar-bottom` | 自动翻页 · **目录** · **书签** · 光点导读 · 档位 · Aa · 纸色 · 翻页设置 | 目录与书签是「跳回去」，与免手翻 / 导读 / 排版 / 纸色同一类：**读的时候随时要用的家伙**；自动翻页与「翻页设置」（它的节奏）也终于摆在一起，不再分居两处 |

**换画风**（与书架一个色系）：两块木头都用书架右键卡片（`.book-menu`）那一套 —— 同 `--wood-surface` +
木纹、同 `--shadow-md` 再叠一层厚投影、圆角 14px；栏里的按钮从「通用那套凸起的小木牌」换成**书架菜单行的
质感**（平时只是一行字，悬停 `rgba(255, 255, 255, 0.16)` 才亮，没有凹 / 凸），开着的那几枚（自动翻页 /
光点导读 / 档位 / Aa / 纸色 / 翻页设置）木色描边 + 一点强调色底。下栏的面板**往上长**
（`.reader-bar-bottom .reader-prefs`），上栏的照旧往下长；下栏呼出来时底部浮字自己抬到木头上方
（`.reader.bars-open .reader-toasts`），免得压住按钮。

**大白话**（用户要的第二件事）：每枚控件都有 `title` 说清「点了会怎样」（如「保存位置」＝「把当前这一行
存进书库（翻篇 / 离开时会自动存，这枚是手动保险）」）；面板里每一行都改成大白话，并各加一句交代
（`.reader-prefs-lead`）：

| 面板 | 改成了什么 |
| --- | --- |
| Aa（排版，`.reader-type`） | 字号 → **字多大**、字重 → **笔画多粗**、字距 → **字与字之间**、行距 → **一行多高**、段间距 → **两段之间**、左右 / 上 / 下页边距 → **左右留白 / 上边留白 / 下边留白**、「上下边距相等」→「上下留白一样多」；顶上交代「这几项只改这台电脑上『读起来的样子』—— 书库里的文件一个字都不动」 |
| 档位（光点导读） | 「速度」→ **走多快**；顶上交代「领路的是哪一号、走多快、什么颜色 —— 只改这台电脑上的样子，存在本机」 |
| 纸色（原「主题」） | 按钮「主题」→ **纸色**；面板里「主题」→ **纸的样子**、「亮暗」→ **白天或夜里**、「背景 / 字体」→ **底色 / 字色**（后者本来就容易误会：它是字色，不是字体）；顶上交代「预设只动颜色，字与版式一个字都不动」 |
| 翻页设置（原「阅读设置」） | 按钮「阅读设置」→ **翻页设置**（面板里就是自动翻页那四项，名字与内容终于对得上）；文字阅读页与 PDF 图片模式两边一起改 |

**顺手修掉的措辞不一致**：`lib/readerConfig.ts` / `lib/settingsText.ts` / `components/ReaderConfigPanel.tsx` /
`views/Reader.tsx` / `App.css` 里凡是写「阅读页顶栏那颗『阅读设置』」的地方，全部改成实际的位置与名字；
PDF 图片模式只摆上栏（它没有目录与书签，所以不摆下栏），`PdfReader.tsx` 的栏补上 `.reader-bar-top`
（位置类名共用；不补的话它跟着新版 `.reader-bar` 会丢掉「贴顶 + 上滑」那套动效）。

**怎么验证的**（本机）：`npx tsc --noEmit` → **exit 0**；`npx vite build` ✓（CSS 111.08 → **115.64 kB**、
JS 872.49 kB）；一个临时 SSR 冒烟（`/tmp/reader-bars-smoke.tsx`，走 Vite 自己的 `ssrLoadModule` 管道加载
`Reader` —— 它的依赖链里有 `pdfjs-dist/...?url` 那种 Vite 专属导入，直接 import 会被 Node 拒）
**ALL OK**，60 条逐项钉住：两栏都在 → 目录与书签在下栏且上栏一处都没有 → 两栏各自装了哪几样 →
每枚控件的 title → 面板里的大白话（面板没展开，查源码）→ 类名与 `App.css` **双向对账**
（渲染出的 `.reader-*` 类都有定义、新增的 6 条选择器都在）。**没装 Playwright，所以「看起来像不像书架」
仍是手工一眼的事**：`npm run tauri dev` 开一本有正文的书、点屏幕中间呼出两栏即可。

### 返工一次（当天第二次反馈）：点屏幕中间呼不出两栏

**用户原话**：「点击屏幕中间无法呼出两栏了」。

**根因**（我的 bug）：拆栏时把两栏的 `className` 写成了**死的字符串**
（`className="bar reader-bar reader-bar-top"`），漏掉原来那句 `` ${barOpen ? " open" : ""} `` ——
两栏于是永远停在「收着」的 `opacity: 0 + pointer-events: none + transform: 滑出屏幕` 上，点了不会有任何动静。
**同一个坑在 `components/PdfReader.tsx` 也有一份**（它那颗顶栏**默认展开**，写死等于整条工具栏看不见）。

**为什么当时的验证没抓住**（这次最该记住的一条）：SSR 冒烟与出图**都是手改字符串**把 `open` 塞进去，
才看到两栏、才截到图 —— **手造的最终态正好把这个 bug 盖住了**。SSR 折不了状态，这两条检查本来就只能看
「结构对不对」，不该由它替我造最终态。

**修法与加固**：两处都绑回 `barOpen`；冒烟里补两条 ——「默认不带 `open`」+「`open` 由 `barOpen` 驱动」
（SSR 折不了状态，只能查源码），并把 `PdfReader` 同一处也纳入；另加**一个 jsdom 真点击测试**
（`/tmp/reader-bars-click.js`，**10 条 ALL OK**）：把 `Reader` 挂进 DOM → 点屏幕中间 → 断言两栏拿到 `open`、
`inert` 被摘掉、容器挂上 `bars-open`；再点一下断言收起并重新 `inert`；再挂一次 `PdfReader` 断言
「顶栏默认展开（有 `open`）+ 点那颗『×』收起」—— 也就是**这次的回归以后会被真点击抓住**。

## 本次改动（2026-10-13）：复核 Windows 安装包那条 CI 工作流

**需求**：用户原话「Fix the following code in `.github/workflows/windows-installer.yml`」（问题清单是空的）。

**先查「是不是真的坏了」**（不靠眼看，逐条实测）：官方 workflow schema（`github-workflow.json`）下
**零错误**；每个 step 的键名 / `with` 参数逐项核过；工作流依赖的每条外部事实也都验了一遍 ——
`tauri build --help` 里 `--bundles` / `--ignore-version-mismatches` 都在，而且 help 原文写明
`tauri.windows.conf.json` **默认就会被合并**（所以不用 `-c` 指它）；`package-lock.json` 里有
`@tauri-apps/cli-win32-x64-msvc` / `@rolldown/binding-win32-x64-msvc` / `lightningcss-win32-x64-msvc`
（Windows 上 `npm ci` 真能装出原生件，不是「只在 macOS 生成的残缺 lockfile」）；`src-tauri/icons/icon.ico`
是真的 ICO（6 张图，Windows 打包要它）；`python packaging/build_windows.py --check` 在本机认出
**仓库自带的 `core/`**（所以工作流不需要 `PAGET_CORE_ROOT`）；`core/.venv/bin/python packaging/build_core.py`
**真跑了一遍**：临时目录冻结 → 装到 `src-tauri/binaries/paget-core/`（38.7 MB）→ `smoke_core.py` **PASS**。
结论：**结构上没坏**，缺的是「别默认 runner 上什么都齐」那几件小事。

**改了什么**（只动这一处 + 描述它的那一段文档）：

| 改动 | 为什么 |
| --- | --- |
| 加 `permissions: contents: read` | 默认 token 权限随仓库设置而变（新仓库常常全给），而这个工作流只读仓库 + 往 Artifacts 写 |
| 加 `timeout-minutes: 90` | 默认 6 小时：卡在下载 WiX / NSIS / WebView2 或编译挂着不动时，会白占一台 runner |
| `setup-node` 加 `cache: npm` | `npm ci` 每次都要重下同一批包（缓存键 = `package-lock.json` 的哈希） |
| `setup-python` 加 `cache: pip` + `cache-dependency-path: core/pyproject.toml` | 同上（chardet / requests / PyInstaller） |
| 新增 step「确保 MSI 的 VBSCRIPT 可用（缺了尽力打开，不挡路）」 | **README「Windows 上要注意的三件事」第一条**：MSI 那一步是 WiX 在干，而 `light.exe` 要系统的 VBSCRIPT（Win11 24H2 起它是可选功能、更新版 Server 上也不一定带着；Tauri 上游 docs issue #13752 记的是同一件事）。runner 上没人去「设置 → 可选功能」手动勾，于是写成「已经有 `vbscript.dll` 就什么都不做；没有才用 DISM 打开」——`continue-on-error` + 末尾 `exit 0` 保证它永远不挡后面的步骤（真缺了会在 MSI 那一步报 `failed to run light.exe`，这段日志就是把原因摆出来） |
| README 的「本机没有 Windows 机器时」那一段 | 它还在说「内核是公开仓库，直接 checkout 到 `core/` 并用 `PAGET_CORE_ROOT` 指过去」—— 那是内核搬进仓库**之前**的 CI 行为，与现在只 checkout 一次的工作流相反；按实际代码改掉（memory-bank 更新协议第 4 条：文件与实际不符 → 收尾时修正文件） |

**没改、但想清楚为什么不用改**（免得下一轮有人来「补」）：`windows-curses` / `core[windows]` 额外项不用装 ——
冻的是无头 sidecar（`paget_core.py` → `wreader.serve`，`paget-core.spec` 里 `excludes` 掉 `curses` / `rich`…），
`smoke_core.py` 自己只 import 标准库，所以那台解释器不装 curses 也能冻、能烟测（本机刚跑过的那一遍就是证据）；
`--ci` 不用加 —— GitHub 自己会设 `CI=true`（`tauri build --help` 里 `--ci  [env: CI=]`）。

**验证**：官方 schema 改完再跑一遍仍是零错误；`cat -n` 逐行核过缩进；README 那段与工作流开头
（第 10-11 行）现在口径一致（都写「只 checkout 一次、不用第二个仓库 / token」）。当天仓库推到了
**`github.com/zhangziluo/Paget`**（`main`，首个提交 `5f7bafc`），这条 CI 于是终于能真跑了 ——
第一次跑就抓到一个真 bug，见下。

### 同一天的第二次反馈：CI 第一次真跑，挂在 `UnicodeEncodeError`

**现象**（推 `v0.1.0` 标签触发）：`python packaging/build_windows.py --check` 在 runner 上直接红：

```
File "D:\a\Paget\Paget\packaging\build_windows.py", line 166, in main
    print(f"python  : {python} ({build_core.python_version(python)})  ← 冻内核用")
UnicodeEncodeError: 'charmap' codec can't encode character '\u2190' in position 35
```

**根因**（不是「中文不该打」，是「编码不该由系统区域设置决定」）：Windows 的 Python 只有**在控制台里**
才用 UTF-8（PEP 528）；stdout 一旦是管道（CI 日志、`> file`、被别的程序拉起来），它就退回系统
ANSI 代码页 —— runner 是英文系统，即 **cp1252**，连「←」都编不出来。本机用
`PYTHONIOENCODING=cp1252 python3 packaging/build_windows.py --check` **复现出一模一样的 traceback** ✓。

**一个必须分清的边界**（决定要不要动内核）：随包那份 `paget-core` 是 **PyInstaller 冻出来的**，它的
stdio 由引导器自己换成了 UTF-8 —— 做了个最小冻结实验并直接探冻结点：把 `PYTHONIOENCODING=cp1252`
塞进去，`stdout.encoding` 仍是 `utf-8`（同一个环境下**普通解释器**就变成 cp1252），协议往来也仍是
UTF-8 中文。所以**内核不用改**，要改的是那些用**普通解释器**跑的打包脚本。

| 文件 | 改动 |
| --- | --- |
| `packaging/build_core.py` | 新增 `use_utf8_stdio()`：① 把 `sys.stdout` / `sys.stderr` `reconfigure` 成 UTF-8；② 把 `PYTHONIOENCODING=utf-8` 写进环境，让后面拉起的 PyInstaller / `smoke_core.py` 一起继承。`main()` 第一行调用 |
| `packaging/build_windows.py` | `main()` 第一行 `build_core.use_utf8_stdio()`（同一个坑） |
| `packaging/smoke_core.py` | `main()` 开头同一个三行（**刻意重复而不是 import 兄弟脚本** —— 它一直只依赖标准库） |
| `.github/workflows/windows-installer.yml` | job `env` 再加 `PYTHONIOENCODING: utf-8` 兜底：`pip` / `PyInstaller` 这些不归我们管的 Python 工具也罩上（脚本自己也各钉了一道） |

**验证**（全在本机按 CI 的条件跑）：`PYTHONIOENCODING=cp1252 python3 packaging/build_windows.py --check`
→ 中文与「←」正常打印、按设计 `exit=1`；`PYTHONIOENCODING=cp1252 core/.venv/bin/python packaging/build_core.py`
→ **端到端 PASS**（临时目录冻结 → 装到 `src-tauri/binaries/paget-core/`（38.7 MB）→ `smoke_core.py`
打完中文书名并 PASS，`exit=0`）；`python -m py_compile` 三个脚本 ✓；工作流 schema 仍 **0 错误**
（98 行 / 10 个 step）。

## 本次改动（2026-10-11，第二十九轮）：内核**搬进仓库**（`core/`），界面上不再提 `werd`

> 上一轮是「阅读相关的设置项全部搬进阅读页」（第二十八轮），紧接在下面一节；
> 再往前是自动翻页（第二十七轮）、PDF 图片模式（第二十六轮）。

**需求**：用户原话「将 wreader 的部分彻底融进项目内核中，不要再调取文件夹外的 werd（wreader）。
同时用户也不需要单独调取 werd（wreader）部分设置里相关部分也不需要提。」

**先数清楚牵连面**（不猜）：`grep` 过一遍 —— 内核那时是仓库外并排的 `../wreader`，
打包链（`packaging/*.py` / `*.sh` / `*.spec`）、壳层（`core_client.rs` / `lib.rs` / `tauri.conf.json`）、
CI（`.github/workflows/windows-installer.yml`）与前端 ~25 个文件都在指它；界面**用户可见**的
`werd` 字样分布在十几处（设置页抬头、书架管理、统计页、成就页、数据页）。

**做法**：四步。

1. **内核源码进仓库**：`../wreader` 的 `wreader/` 包 + `tests/` + `pyproject.toml` + `LICENSE`
   复制成 **`core/`**（`rsync --exclude __pycache__/*.egg-info`；1.1 MB）。新写 `core/README.md`
   （它是谁的、怎么跑、怎么测、两个名字为什么没改）；`pyproject.toml` 里的
   `[project.scripts] werd = …` **删掉** —— 内核只给界面用（`python -m wreader.serve`），
   不再往用户机器上装一条命令行。`.gitignore` 加 `core/.venv/`、`core/*.egg-info/`、`core/.pytest_cache/`。
2. **本机建 venv**：`python3 -m venv core/.venv && core/.venv/bin/python -m pip install -e "core[dev]"`
   —— 探测内核时找的就是它（`core_client.rs` 的 `dev_interpreter_in` 改成
   **`<repo>/core/.venv/bin/python`**，Windows 上是 `Scripts/python.exe`，再退 `<repo>/.venv`；
   `dev_interpreter()` 从「上两级」改成「上一级」）。
3. **打包链**：`packaging/werd-core.spec` → **`paget-core.spec`**、`werd_core.py` → **`paget_core.py`**；
   `build-core.sh` / `build_core.py` / `build_windows.py` / `smoke_core.py` 的内核默认位置从
   「并排的 `../wreader`」改成 **仓库自带的 `core/`**；产物从 `src-tauri/binaries/werd-core/`
   改成 **`paget-core/`**（`tauri.conf.json` 的 `bundle.resources` 映射同步改）；
   环境变量 **`WREADER_CORE_COMMAND` / `WREADER_CORE_PYTHON` / `WREADER_ROOT` →
   `PAGET_CORE_COMMAND` / `PAGET_CORE_PYTHON` / `PAGET_CORE_ROOT`**；
   CI 里那次「clone 另一个仓库」整个删掉（内核就在 checkout 下来的仓库里）。
   出错提示也改了：不再教人去 clone 另一个仓库，而是「`core/` 不见了 → 重新拿一份仓库 / 设 `PAGET_CORE_ROOT`」。
4. **界面不再提 `werd`**：`settingsText.ts` 删掉 `scope` 机制与 `SCOPE_TAG`（那枚「终端 / 两处都管」
   的牌子），并删掉**只给命令行前端用**的那些项的措辞；`lib/readerConfig.ts` 改成**三档**
   （`reader` = 阅读页「阅读设置」里那 4 项；`app` = 留在「调一调」的 5 项；`hidden` = 界面上
   一项都不列的 11 项）；设置页抬头 / 那处交代 / 页脚、书架管理、统计页、成就页、数据页
   （连默认备份文件名 `wreader-backup.json` → `paget-backup.json`）全部改成不带 `werd` 的说法；
   `core_client.rs` 那句**会显示在界面上**的排障建议也改成了指 `core/`。

**两个名字故意没改**（写进 `core/README.md` 与 `techContext.md`）：Python 包名仍叫 `wreader`
（协议那条命令因此仍是 `python -m wreader.serve`），发行名与**数据目录 `~/.wreader`** 也不动 ——
动后者就是动用户已有的统计 / 成就 / 书库，收益只是名字好看。对外的东西（界面文字、构建产物名、
安装包里的路径、环境变量名）已经全部是 Paget 自己的了。

**几处值得记的取舍**：

1. **`core/` 不叫别的名字**：与 `src/`（前端）、`src-tauri/`（壳）并排，一眼看出「这是内核」；
   `packaging/` 默认就找它，`PAGET_CORE_ROOT` 仍可指向别处（「不落地源码也能冻」那条老路保留）。
2. **冻结点整目录重建**：产物名换了，旧的 `src-tauri/binaries/werd-core/` 直接删掉，
   重新冻出一份 `paget-core/` 并跑 `smoke_core.py`（**PASS**，见下）。
3. **措辞层的「范围牌子」整个撤掉，而不是改词**：那些项的牌子本来是为了说「这项只在终端里生效」，
   现在只给命令行前端用的项在界面上**一个都不列**，牌子也就没有存在的意义了；
   留着它反而要写「终端」两个字，正是用户不想再看到的。
4. **内核自己的 docstring 没动**：`core/wreader/*.py` 里仍有「`werd config`」这类说法 ——
   那是内核对自己那个命令行前端的说明（它还在包里，只是不再装命令、界面也不再提），
   不属于「界面设置里提它」这件事。
5. **加了一条 Rust 用例**：`dev_interpreter_looks_inside_the_repo`（造一棵假仓库，断言
   `dev_interpreter_in` 找的就是 `<root>/core/.venv/bin/python`）—— 「自包含」这条最容易悄悄回退。

**验证**（全部实测）：

| 做了什么 | 结果 |
| --- | --- |
| `core/.venv/bin/python -m pytest core/tests -q` | **790 passed**（收集 790；退出码 0） |
| `core/.venv/bin/python -m wreader.serve` + 一条 `ping` | `{"id": 1, "result": {"pong": true, "version": "0.1.0"}}` —— 仓库里这套开发环境能真起内核 |
| `bash packaging/build-core.sh` | 冻出 `src-tauri/binaries/paget-core/`，**`smoke_core.py` PASS** |
| `cd src-tauri && cargo test` | **47 passed**（46 + 新增那条；无 SKIP ⇒ 真拉起了内核） |
| `npx tsc --noEmit` / `npm run build` | exit 0 / ✓（产物 CSS 里已搜不到 `set-scope`） |
| `npx tsx /tmp/reader-config-check.ts` | **ALL OK: 31 条**（三档分家 4/5/11、面板一节、新键默认显示、`reconfigureAutoTurn`） |
| `npx tsx /tmp/settings-ssr-check.ts` | **ALL OK: 64 条**（整张设置页 SSR：11 个不露面的项**路径与名字都不在**、那 5 项照旧、面板那 4 行渲染得出来、范围牌子没了） |
| `npx tsx /tmp/autoturn-check.ts` | **2046 条**仍全过 |
| `grep -rn werd src/ src-tauri/src/ README.md` | **0 处**（`wreader` 只剩模块名 / 数据目录这类必须写的事实） |

**没动的**：内核的行为、数据文件（`~/.wreader`、`settings.toml`、`library.json` 一个字节没换地方）、
内核的 790 条测试一条没改（只是搬了目录，`pytest` 在新位置全过）。


- **书页拟物（外框全静态）**：左侧封面 `.book-cover` + 右下探出的书页堆叠 / 书口 `.book-stack`
  + 当前这张纸 `.reader-page`；正文 `.reader-lines` 直接是纸页里的那一层，
  滚动交给它的父级 `.reader-text`（`.reader-page` 是 flex 列，`min-height: 0` 一路传下来）。
## 本次改动（2026-10-11，第二十八轮）：阅读相关的设置项**全部搬进阅读页**，「调一调」不再兼职

> 上一轮是自动翻页（第二十七轮，同一天），紧接在下面一节；再上一轮是 PDF 图片模式。

**需求**：用户原话「与阅读相关的设置项，全部移动到阅读页，不需要从『调一调』设置处调整。」

**先数清楚有几项**（不猜）：从内核自己的接口问出来 —— `python -c "from wreader import config;
print(config.all_paths())"` → **20 项**，其中 **`reader.*` 13 项**（`page_scroll_step` / `page_overlap` /
`wheel_scroll_step` / `touch_scroll` / `status_bar_format` / `auto_save_interval` / 四个 `auto_scroll_*` /
`page_height` / `theme` / `store_history`），剩下 7 项是 `stats.*` ×4 + `library.novels_dir` +
`toc.patterns` + `toc.cache_dir`。分家就按这一节切：**13 项去阅读页，7 项留在「调一调」**。

**做法**：分界线只写一处，两个页面都从它取 ——

| 文件 | 干什么 |
| --- | --- |
| `src/lib/readerConfig.ts`（新，纯函数） | `isReaderSetting` / `partitionSettings`（分成两摞）+ `readerSections`（面板里的小节与顺序：自动翻页 / 翻页的手感 / 这一屏怎么显示 / 进度与存档，认不出的落到「其它」）+ 那句「与 `werd config` 同一份」的交代 |
| `src/components/CoreSetting.tsx`（新，从 `Settings.tsx` 里抽出来的） | 一行设置的**共用**渲染：`Item` / `CoreItem` / `Switch` / `kindOf` / `toDraft` / `sliderRange`。抽出来是因为同一批控件从此有两个地方渲染，各写一份迟早长歪 |
| `src/components/ReaderConfigPanel.tsx`（新） | 阅读页那块面板：`config_get` / `config_set` 直接打在 `settings.toml` 上（界面不留副本），每存一笔叫一声 `onSaved` |
| `src/styles/reader-config.css`（新） | 面板长得像顶栏那几块（木头），骨架仍用通用的 `.set-*`；开关 / 滑块 / 输入框**直接用 `App.css` 里那套木头底子**，只把纸上那几笔换成 `--wood-line` |

调用点两处（**两个阅读页都有**，因为两边都是「阅读页」）：文字阅读页顶栏加第三块浮层
（`Panel` 加 `"config"`，与 `Aa` / 主题 / 速度 天然互斥），**PDF 图片模式顶栏也挂同一颗**（它本来就是
同一个 `.reader-bar`，面板与文字页共用同一个组件）。左上角那枚「自动翻页中 · …」的小牌子改成**按钮**，
点它展开顶栏并打开「阅读设置」（顶栏收着时也能改节奏）。

**几处值得记的取舍**：

1. **搬的是「哪一节」，不是「哪几个键」**：按 `reader.*` 前缀整节切 —— 内核以后往这一节里加新键，
   它**自动**出现在阅读页，两个页面都不用改（认不出的键落到「其它」小节，措辞仍由 `settingWords` 兜底）。
   这也是为什么没写死 13 个路径。
2. **「调一调」原位置留一句交代**（「阅读的手感」那一块，写着 13 项、都搬去哪儿了），
   免得人以为这些设置丢了；分家算法仍是那同一个 `partitionSettings`。
3. **改完当场生效**：`useAutoTurn` 多一个 `reload`（`revision` +1 → 重读 `config_get`），
   存好一笔就叫它 —— 改完节奏不用关掉书再打开。重读走新加的 `reconfigureAutoTurn`：
   **只换节奏、并按新间隔从现在重排下一拍**（与终端改完速度就 `defer_auto_scroll` 同理），
   开关与屏上正等作答的题一律不动。
4. **技术名那一行在阅读页收起来了**（`showPath={false}`）：面板窄；要对照 `werd config` 时去
   「调一调」看完整的。元素 `id` 上仍带着路径（`htmlFor` 要用），不算露出来。
5. **测试又逮到一个真问题**：`reconfigureAutoTurn` 最初只换 `interval` 而不重排下一拍 ——
   于是把间隔从 60 秒调到 0.5 秒之后，用户还得再干等 60 秒才等到第一拍，**看着像没生效**。
   现在按新间隔从现在重排（终端也是这么做的）。

**验证**：`npx tsc --noEmit` **exit 0**；`npm run build` ✓（CSS 里搜得到 `.reader-config` / `.pdf-chip`）；
`npx tsx /tmp/reader-config-check.ts` → **ALL OK: 30 条**（13/7 分家、一项不丢不重、小节顺序、
内核新键落「其它」、空表、以及 `reconfigureAutoTurn` 的五种情形）；`npx tsx /tmp/settings-ssr-check.ts`
→ **ALL OK: 62 条**（把**整张设置页 SSR 出来**断言：13 个 `reader.*` 的路径与名字**一个都不在**、
原位置那句交代在且数目是 13、剩下 7 项照旧在、面板那 13 行也都渲染得出来）；
上一轮的 `autoturn-check.ts` 复跑 **2046 条**仍全过；`cargo test` **46 passed**（壳层没动）。

**没动的**：内核一行没改（`reader.*` 的键、默认值、`werd config` 的说明都不变，终端那边的行为
一个字没变）——所以**不用重建冻结点、不用重导书库**，两个前端仍然共用同一份 `settings.toml`。


  纸色 / 纸边 / 墨色走 CSS 变量（`--paper` / `--paper-edge-fill` / `--paper-edge-line` / `--reader-ink`），
  由**主题面板**在阅读页容器上整份覆盖（不再是 `:root` 里固定的昼夜两套）。
## 本次改动（2026-10-11，第二十七轮）：阅读页加**自动翻页**（免手翻），文字与 PDF 图片模式同一套

> 上一轮（第二十六轮，同样是 2026-10-11）是 PDF 默认图片浏览 + 「转换成文字」，紧接在下面一节。
> 再上一轮是 MOBI / AZW3。

**需求**：用户原话「自动翻页尚未实现，请添加，pdf阅读同样适用这个功能。」

**先把「尚未实现」查清楚**（不是猜的）：`grep` 过一遍 ——

* `../wreader/wreader/reader.py` 里**终端那一半是完整的**：`auto_scroll_interval` / `auto_scroll_step`
  （屏幕行）/ `set_auto_scroll` / `defer_auto_scroll` / `auto_scroll_tick` / `auto_scroll_pace` /
  `adjust_auto_scroll_speed`，外加一条**防作弊校验**（`auto_scroll_check_minutes` 到点弹一道四选一算术题，
  `auto_scroll_check_seconds` 秒没人作答就停 —— 见 `_make_auto_check_question` / `resolve_auto_check`）；
* 界面这边 `src/views/Reader.tsx` 里**一个 `auto_scroll` 都没有**（唯一命中的是「自动**保存**」），
  而设置页那四项又照常列着（`settingsText.ts` 里写着 `reader.auto_scroll_*`）——
  **值能改、没人读**，这就是「尚未实现」的确切含义。

**做法**：把终端那套语义**照抄一遍**（改一处就要两边一起改），拆成三层 ——

| 文件 | 干什么 |
| --- | --- |
| `src/lib/autoTurn.ts`（新，纯函数） | 状态机：`setAutoTurn` / `deferAutoTurn` / `tickAutoTurn` / `autoCheckDue` / `beginAutoCheck` / `resolveAutoCheck` / `autoCheckRemaining` / `autoTurnPace` + 出题 `makeAutoCheck`。时间由调用方给，所以 `npx tsx` 能一条条钉住 |
| `src/lib/useAutoTurn.ts`（新，React 壳） | 读内核那四项（`config_get`，读不到按终端默认值）、250 ms 心跳、**任何输入推后一整拍**、题超时自动停并把原因交给 `onStop`；两个阅读页共用 |
| `src/components/AutoCheckDialog.tsx`（新） + `src/styles/auto-turn.css`（新） | 校验题的卡片与「自动翻页中 · 每 5 秒 1 行」那枚小牌子（`App.css` 里 `@import` 这一份） |

两处调用点各给一个 `advance(step)`：

* **文字页**（`Reader.tsx`）：`textRef.scrollBy(step × 字号 × 行距)` —— 一屏行的高度 ≈ 字号 × 行距，
  与终端「一次走几行**屏幕行**」是同一个单位；**两拍之间位置一点没动 = 已贴底**才停（正在追加新批次时
  下一拍位置又会变，所以不会误判成"读到末尾"）；
* **PDF 图片模式**（`PdfReader.tsx`）：一次翻 `step` 页，`next >= 页数` 就停下；
  翻页走 `PdfPages` 新增的 `jump={{page, token}}`（token 每次加一，同一页连着跳也会重新滚，用 `scrollTo` 平滑过去）。

**几处值得记的取舍**：

1. **单位分两种口径**：文字是屏幕行、图片是页 —— 所以 `useAutoTurn` 收一个 `unit: "行" | "页"`，
   只影响提示里那句话；设置页的措辞也照着改了（`reader.auto_scroll_step` 的说明里写明
   「PDF 一次前进这么多页，5 秒一页偏快，读 PDF 时把间隔调到 20~60 秒」）。
2. **四项设置的 `scope` 从「终端」改成「两处」**：`settingsText.ts` 里这枚牌子是**实测**出来的，
   这一轮界面真的读了它们，所以必须同步改 —— 不然用户会以为改了没用。
3. **点哪一个选项都算作答**：与终端同一条规矩（题只证明人还在桌前，不考算术），
   所以 `resolveAutoCheck` 只问"作答了没有"，不问对错；倒计时走完或按「停下自动翻页」就当没作答 → 停。
4. **输入一律推后一整拍**（滚轮 / 按键 / 触摸 / 点击，`pointerdown` 覆盖鼠标与触摸）：
   与终端每次按键都 `defer_auto_scroll` 同理 —— 人在自己读的时候，计时器不许抢页面。
5. **测试逮到一个真 bug**：`deadline === 0` 在这套里是「**没排期**」（弹题期间就是这样），
   最初写的 `now < state.deadline` 会把它当成"早就过点"，于是**弹题时还会偷偷翻页**。
   改成 `!state.deadline` 一并挡住（`tickAutoTurn` 里那行注释写清了）。

**验证**：`npx tsc --noEmit` **exit 0**；`npm run build` ✓（55 modules，只有 pdf.js worker 那条老警告）；
`npx tsx /tmp/autoturn-check.ts` → **ALL OK: 2046 条** —— 含夹取范围（0.5~600 秒）、打开先等一整拍、
输入推后一整拍、到点不补课、弹题期间不翻页、超时停 / 作答继续并把下一拍排到一整拍之后、
`period = 0` 永不弹、节奏说法（「每 5 秒 1 行（12 行/分钟）」）、固定随机源出题，以及
**2000 道随机测验题的算术 / 取值范围 / 选项唯一性**不变量；最后一条是整幕时间轴（开 → 两拍 → 弹题 → 作答 → 继续）。

**没动的**：内核一行没改（终端那套本来就是对的；四项设置的内核说明在 `werd config` 里也照样成立），
所以**不需要重建冻结点、不需要重导书库**。位置 / 时长仍然只经内核 RPC（硬性约束 1）：自动翻页滚的
那一屏走的是**普通滚动回调**那条路，进度 / 书签 / 统计一张表都不用动。


## 本次改动（2026-10-11，第二十六轮）：导入再新增 **PDF**

> 上一轮（第二十五轮，同样是 2026-10-11）加的是 MOBI / AZW3，紧接在下面一节。

**需求**：用户原话「增加对pdf格式的支持。」，随后追加「pdf格式电子书，默认以图片的方式浏览，不走解析成文字。
阅读页面添加一个转换成文字的选项。」—— 第二点是这一轮的真正形状。

**做法**：PDF **默认按图片读**。导入只做便宜的事（内核 `library` 的图片模式分支：把 PDF 收进 `novels/`
（`<书名>_utf8.pdf`）、`pdf.page_count()` 数页数、取第一页封面），**不抽文字层**；阅读页用 **pdf.js**
把每一页画进 `<canvas>`（`components/PdfReader.tsx` + `PdfPages.tsx`），工具栏里有那颗「转换成文字」——
按下去才调内核新方法 `convert_pdf`（`wreader/pdf.py`，**1943 行**，只用标准库：对象与流、三种索引
（xref 表 / 交叉引用流 / 对象流）、过滤器、页树、`/ToUnicode` CMap、逐页重放文字操作符；子集字体 `/W`
为空时读 TrueType `hmtx`，否则 `Python` 会变成 `Py tho n`），抽完写 `<书名>_utf8.txt` 并切到文字阅读页。
**坐标一个新概念都没加**：pdf 的 `total_lines` 直接就是页数（一页 == 一行），所以进度、书签、读完判定、
统计、成就、`position` / `session` 全是原来那套；界面按书存「图片 / 文字」这个看法
（`gui_settings` 的 `reader.pdf_view`，见 `lib/pdfView.ts`）。

**Paget 侧**：

- **新增两个组件**：`components/PdfPages.tsx`（pdf.js 画布列：页面按统一尺寸铺开、当前页 ±3 页才渲染、
  走远的画布收回内存，滚动用 rAF 合并）、`components/PdfReader.tsx`（顶栏 / 缩放 / 页码 / 进度条 /
  「转换成文字」/「读文字」；位置、时长、成就照旧记账）。
- **新增两条命令**：`book_source`（`tauri::ipc::Response` 原样发 PDF 字节 —— 前端读不了磁盘，且几 MB
  的东西不能走 JSON）、`convert_pdf`（**唯一 async 的命令**：抽几百页要几十秒，`spawn_blocking` 丢给
  阻塞线程池，主线程不按住）。
- **缓存表加三列**：`format` / `pages` / `text_path`，`SCHEMA_VERSION` **1 → 2**（缓存整库重建，正好是它
  的设计）；`src/lib/pdfView.ts` 纯函数（偏好读写、`pageSlots`、`firstVisiblePage`、`pageLabel`）。
- 阅读页文字模式顶栏多一颗「看图片」（pdf 才有）；`ImportPickMenu` 那行小字加了 `/ .pdf`。
- **随包内核重新冻过**：`packaging/build-core.sh` → `src-tauri/binaries/werd-core/`（24M）。

**怎么验证的**：

- 内核：`pytest -q` **790 passed**（`tests/test_pdf.py` **27 项**，全部合成 PDF：图片模式导入、页树计数、
  扫描版拒绝转换、按需转换与幂等、RPC 那三个字段）、`npx pyright` **0 errors / 0 warnings**、
  `check_docs` OK / `check_doc_numbers` **ALL OK**。
- 真实书 `移动硬盘/python编程从入门到实践.pdf`（785 页、calibre 3.19 生成）：**导入 0.6 s**（原来要 44 s），
  记录 `format=pdf` / `pages=785` / `total_lines=785` / `text_path=""`，封面落成同名 `.jpg`；
  按「转换成文字」**44 s** 抽到 16,456 行 / 229,377 字 / 57 章，再按一次 0.07 s（幂等）；抽取质量仍然与
  Ghostscript 的 `txtwrite` 对照**去空白后逐字节一致**（424,055 字符）。
- 壳层：`npx tsc --noEmit` **exit 0**、`cargo test` **45 passed**、`npm run build` 成功
  （pdf.js worker 作为独立资源发出）；`lib/pdfView.ts` 那 25 条纯函数断言用 `npx tsx` 全过；
  pdf.js 在 Node 里真读那本 785 页的书（`numPages` 785 / 页面 612×792 都对）。
- 随包内核：`smoke_core.py` 现在走「图片模式导入 → 未转换时 `text` 报错 → `convert_pdf` → `text` 读得到」，
  **PASS**（28 个方法全部可派发、进程干净退出）。

**边界（照实说）**：**扫描版 PDF 反而能读了**（它就是一页页图，图片模式不需要文字层），但按「转换成文字」
会明确报 `no text could be read from …`；加密（`/Encrypt`）直接拒绝；多栏 / 竖排 / 复杂表格按原点顺序读，
版式语义不保留（所有 PDF 取字工具的老问题）；终端的 `werd read` 读不了还没转换的 PDF（报错里说清了怎么办）。


## 本次改动（2026-10-11，第二十五轮）：导入新增 **MOBI / AZW3** 两种 Kindle 格式

**需求**：用户原话「读取MemoryBank，增加对azw3和mobi格式的支持。」

导入这件事**主体在内核**（界面只把路径交给内核 `import`，硬性约束 1）：内核原先只认 `.txt` / `.epub`，
所以这一轮的主战场是 `../wreader`（内核源码**又回到这台机器上了** —— `techContext.md` 里 2026-10-09
那条「没有源码」的记录已过期）。

**内核侧（`../wreader`，改动最多）**：

- 新增 `wreader/mobi.py`（**668 行**，只用标准库）：PDB 容器与记录表、PalmDOC 头 + MOBI 头 + EXTH、
  三种压缩（不压缩 / **PalmDOC LZ77** / **HUFF-CDIC**）、AZW3 的 **KF8「骨架 + 碎片」拼装**
  （FDST 分段 + INDX/TAGX 索引 + 控制字节 + varint）、内嵌封面（EXTH 201 → 资源记录 → 按魔数认格式）
  与 EXTH 书名 / 作者（仅兜底）。
- `library.py`：`SUPPORTED_EXTENSIONS` **→ (`.txt`, `.epub`, `.mobi`, `.azw3`)**；`_run_external_tool`
  抽成通用的（`ebook-convert` 优先），epub / mobi 各留一个薄包装（测试里的 monkeypatch 名字没变）；
  `load_source_text` 按后缀分流到新的 `_load_mobi_text`；封面落盘与「重复导入补封面」改成 epub / mobi
  共用（`_save_cover` / `_backfill_cover`）。
- `cli.py` 的 `import` 帮助文案与「一本都没扫到」的提示同步。
- 文档：两份 README + `使用指南.md` 的格式列表 / 错误对照表 / 模块树 / 测试表；内核 memory-bank 六个文件。

**Paget 侧（三处小改）**：

- `src/components/ImportPickMenu.tsx`：导入菜单那行小字 `可多选 · .txt / .epub` → `… / .epub / .mobi / .azw3`。
- `src-tauri/src/lib.rs`：两档文件面板的注释同步（**面板本身依旧不挡扩展名**，认不认由内核决定）。
- **随包内核重新冻过**：`packaging/build-core.sh` → `src-tauri/binaries/werd-core/`
  （24M，`smoke_core.py` **PASS**）。所以 `npm run tauri dev` / 打包出来的 `.app` 都直接认这两种格式，
  不依赖开发机上有没有 Calibre。

**怎么验证的**：

- 真实文件三本：`神圣罗马帝国之路·多瑙河畔`（.azw3，HUFF-CDIC + KF8）拼出的正文与 **KindleUnpack**
  对同一本书的结果**逐行一致**（同 1537 行、同字数）；`沸腾15年.mobi`、`巴别塔.mobi`（PalmDOC）正常；
  封面三取二命中。**再走一遍随包内核**：临时 `WREADER_HOME` 里 `import` 这两本 → 书架上 azw3 **1537 行**、
  mobi **5601 行**，`novels/` 里各落下一张同名 `.jpg` 封面，`toc` / `text` 都能取。
- 内核：`pytest -q` **763 passed**（新增 `tests/test_mobi.py` 15 项）、`npx pyright` **0 errors / 0 warnings**、
  `check_docs` **OK** / `check_doc_numbers` **ALL OK**。
- 壳层：`npx tsc --noEmit` **exit 0**、`cd src-tauri && cargo test` **45 passed / 0 failed**。

**边界（照实说）**：内置提取器**只取正文**（样式 / 图片（封面除外）/ 脚注丢），装了 Calibre 则用
`ebook-convert`；**加密书（DRM）明确报 `this book is DRM protected`**，不吐乱码。

## 本次改动（2026-10-10，第二十四轮）：导读里加一号**「波浪线」** —— 走法与下划线一样，笔迹是波浪

## 本次改动（2026-10-10，第二十四轮）：导读里加一号**「波浪线」** —— 走法与下划线一样，笔迹是波浪

**需求**：用户原话「增加波浪线导读，其导读方式和下划线一致。颜色和光点，下划线一样可以自定义更换。」

于是有了**第三号「一段线自己往前爬」的领路的**：宽度 / 步子 / 伸缩 / 折行怎么拆**一个字没新写**
（全是 `guideCrawlAt` / `guideCrawlWidth` 那一套），只有**笔迹**不同 —— 一条是**墨色笔直的直条**，
一条是**同一支笔画的波浪**；颜色也跟光点 / 下划线一样能自己换（浮层里第三枚取色器）。

| 文件 | 改动 |
| --- | --- |
| `src/assets/guide-wave.svg`（**新增**，19 行 / 1.2 kB） | 一张**可平铺的正弦波**：一个波长 48 × 一个波纹 22（中线 y = 11、振幅 6、线粗 10）；只当**形状**用，颜色由 CSS 给 |
| `src/lib/readingGuide.ts`（558 → 568 行） | `GuideMarker` 加 `"wave"`、`GUIDE_MARKERS` 多一枚胶囊（光点 / 下划线 / 波浪线）、`normalizeGuideMarker` 认它（坏值照旧回光点） |
| `src/lib/readerPrefs.ts`（539 → 560 行） | `ReaderPrefs` 加 `guideWaveColor`（**空串 = 出厂 = 跟正文墨色**）；`guideColorVars` 多写一条 `--guide-wave`；`guideSwatchColor(prefs, ink, marker)` 的第三个参数从「是不是下划线模式」换成**当前是哪一号**，返回里多一枚 `wave` |
| `src/views/Reader.tsx`（1,761 → 1,776 行） | `guideModeClass` 多一条分支（`guide-wave`）；`placeGuide` 的判据从「是不是下划线」改成「**不是光点就爬**」；浮层里多一枚「波浪线」取色器，「恢复出厂色」三样一起清；那一枚 marker span 反过来改成「光点模式才渲染小球」 |
| `src/App.css`（5,435 → 5,488 行） | 新增「波浪线模式」一节：`--guide-wave-line`（这一号的颜色）、`.reading-guide-trail` 的波浪底图（`mask` + `background-color`）、已读行的 `text-decoration-style: wavy` 与 `reading-guide-wave-fade` |

**几处值得记的取舍**：

1. **走法一个字没新写**：那几号「一段线自己往前爬」的**共用** `guideCrawlAt` / `guideCrawlWidth`，
   Reader 里只在 `.reader-lines` 上多挂一个模式类（`guide-crawl` / `guide-wave`）、
   `placeGuide` 那一条分支从「下划线模式才爬」放宽成「**不是光点就爬**」——
   于是「同样的导读方式、不同的笔迹」在代码里也是这个形状：**行为一份，长相两处**。
   动一个字都不必碰定时 / 折行 / 存档。
2. **波浪的「形状」与「颜色」分开**：波浪是一张可平铺的 SVG（`src/assets/guide-wave.svg`），
   但它**只当 `mask`**、颜色仍由 `background-color: var(--guide-wave-line)` 给 ——
   所以用户挑的颜色照旧能上（`background-image` 里的 SVG 是隔离渲染的，`currentColor` 拿不到
   外面的颜色；`mask` 只取形状、颜色留给 CSS，这是「想把画好的形状染色」的正路）。
   `mask-size` 用 em（`--wave-h`）给，字号一变波浪跟着变。地址只写一遍（`--wave-img`）——
   `-webkit-mask-*` 与标准两条都要它，不然同一张图会进包两次（实测省下约 1.3 kB）。
3. **线粗 : 波长 = 1 : 4.8 是「量」出来的，振幅故意粗一倍**：已读行那条用的是浏览器自带的
   `text-decoration-style: wavy`，它长什么样各引擎自己定。为了两处**同一个节奏**，把字号放到
   200px 出图、写脚本解 PNG 数出它那条笔的「波长 / 振幅 / 线粗 ≈ 4.8 / 0.27 / 1」，
   于是把波浪的**波长照着它定**；**振幅给到两倍**（0.6 × 线粗）—— 照它那个 0.27 的话，
   1× 屏、20px 字号下振幅还不到一个像素，看着就是「没换」（量出来的数在
   `src/assets/guide-wave.svg` 与那节 CSS 的注释里）。
   中途试过用两段 `radial-gradient` 的圆弧拼波浪（纯 CSS、不加资产），在 2–3px 尺度上
   是一团扇贝边、不像波浪 —— 才换成这张 SVG。
4. **波浪线自己一支变量，不去借下划线那支**：第一版让 `.guide-wave` 把 `--guide-crawl`
   指到波浪线的颜色上（好复用「颜色 + 化掉」两条规则），但下划线色是**行内**写在
   `.reader-lines` 上的，行内优先级比 CSS 规则高 —— **只改「下划线」色，波浪线也跟着变色**。
   现在波浪线读自己的 `--guide-wave-line`、化掉也另开一份 `reading-guide-wave-fade`
   （`var()` 在 keyframes 里是照当前元素现算的，借用那份同样会串台），两边彻底互不干涉。
   出图验过：只改下划线色（纯绿）时波浪线仍是墨色，只改波浪线色（玫红）时下划线那一号仍是墨色。
5. **存档一个字节没动**：`marker` 里的 `"wave"` 是**纯新增取值**，老记录没有它 → 回落到光点；
   `guideWaveColor` 同理（老记录没有这个键 → 空串 = 出厂）。行号 / 档位 / 开关 / 颜色一个不动。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 108.52 → **111.08 kB**、JS 364.65 → 365.33 kB；
多的那 2.5 kB 里约 1.3 kB 是那张内联进 CSS 的波浪），临时脚本把纯逻辑与颜色真跑一遍
**17 条 ALL OK**（名单三枚且字对得上、`normalizeGuideMarker("wave") === "wave"`、
坏值 / 老存档的 `rabbit` 仍回光点、出厂时 `guideColorVars` 返回空对象、只改波浪线时**只**写
`--guide-wave`、三样都改时八条变量齐、**只改下划线不影响波浪线**、坏颜色回落空串、
三枚色块的显示值（出厂时波浪线跟正文墨色）、`guideSwatchColor` 认得出当前是哪一号），
并出图核对过：**默认字号（20px）** / 28px / 出厂墨色 / 玫红波浪线 / 只改下划线色（不串台）/
下划线那一号（不受波浪线色影响），另有**放大 200px 的对照图**给上面第 3 条量尺寸。
核完即删（`src/__guard/` 与 `.guard-out/` 都不留在工程里）。本轮**没动 Rust**；
同日复核 MemoryBank 时把 `cd src-tauri && cargo test` 重跑了一遍：**45 passed / 0 failed**
（顺便把文档里三个对不上的测试数字统一成实测的 45，见 `progress.md` 待办 #1 —— 已关）。

**还差一步（等人）**：出图能代替的只有「波浪本身长什么样」，**真机上那一块浮层**量不到 ——
三枚取色器的排布（光点 / 下划线一行、波浪线一行）与平时字号下那条波浪的手感，
要请在 `tauri dev` 里目视一眼（见 `progress.md` 待办 #8；觉得粗 / 浅就改 `App.css` 的
`.guide-wave` 里 `--wave-h`，或改 `src/assets/guide-wave.svg` 里 `stroke-width` 与振幅的比值）。



## 本次改动（2026-10-10，第二十三轮）：光点与下划线的**颜色可以自己换**

> 这一轮当时是「两枚取色器」；**同一天的第二十四轮又添了「波浪线」那一枚**（连标记一起变成三种），
> 上面第一节是最新的 —— 下面这段留着当历史记录。

**需求**：用户原话「光点和下划线的颜色可以自定义更换」。

顶栏那枚速度按钮点开的小浮层里，**标记胶囊下面多了一排两枚取色器**（光点 / 下划线）。

| 文件 | 改动 |
| --- | --- |
| `src/lib/readerPrefs.ts`（442 → 539 行） | `ReaderPrefs` 加 `guideDotColor` / `guideLineColor`（**空串 = 出厂色**，坏值按空串收）；新增 `DEFAULT_GUIDE_DOT`（`#ffd27a`）/ `DEFAULT_GUIDE_LINE`（`#ffc864`）、**`guideColorVars(prefs)`**（挑的颜色 → 那串 CSS 变量：光点五档 + 那条线 + 下划线模式那一段；一个都没自定义时返回**空对象**）与 **`guideSwatchColor(prefs, ink, crawlMode)`**（两枚色块该显示什么） |
| `src/App.css` | `.reading-guide-dot` 的三档渐变与两层光晕、`.reading-guide-trail` 与 `.reading-line.passed .reading-line-text` 那条线、`.guide-crawl` 那一段，全改成 `var(--guide-*, 兜底值)` —— **兜底值就是原来那几个字面量**，所以不自定义时 CSS 与从前一字不差 |
| `src/views/Reader.tsx`（1,717 → 1,761 行） | 浮层里加「光点 / 下划线」两枚 `<input type="color">` + 一句小注 + 一枚「恢复出厂色」（与主题面板那一套同款）；`.reader-lines` 的行内样式铺开 `...guideColorVars(prefs)` |

**几处值得记的取舍**：

1. **颜色存 `reader.prefs`（本机全局），不跟着导读进度走**：进度（读到第几行 / 档位 / 标记）
   是**按书**存的，而「光点长什么颜色」与字号、纸色一样是「这台机器上读书的样子」，换一本书也该是同一个。
2. **颜色不写死在 CSS 里**：三处样式一律读 `var(--guide-*, 兜底)`, 而**没自定义时一个变量都不写** ——
   于是「出厂外观与从前一字不差」这件事是**结构上保证**的，不靠人肉比对。
3. **一个颜色派生几档、不用 `color-mix()`**：高光往白里混 80%、暗边往黑里混 28%、两层光晕 16% / 30%，
   那条线取这个色 @45% —— 都是 `mixHex` / `hexToRgba` 这类**纯函数**，能在 node 里算过、出图核对过再交。
   （`color-mix()` 要 Safari 16.2+，这个项目一路只用 Safari 14 就有的东西。）
4. **两样的默认是「一套」**：出厂时光点与它划过的线本来就是同一支琥珀，所以**只改光点色时那条线
   跟着光点走**（蓝光点拖着琥珀线会很怪）；**改下划线色则那条线单独变**（含下划线模式下那一段）。
   两枚色块显示的是**当前这一档的出厂色**（下划线在「下划线」模式下出厂跟正文墨色），
   所以色块与屏幕上那条线总是同色。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 108.23 → **108.52 kB**、
JS 362.94 → 364.65 kB）；临时脚本把颜色逻辑真跑一遍 **16 条 ALL OK**（出厂时 `guideColorVars`
返回空对象、坏颜色回落空串、`#0af` 收成 `#00aaff`、改光点时五档色都在且高光比中停亮 / 暗边比它暗、
那条线跟着光点 @45%、下划线模式那一段不动、改下划线时那条线换色而光点五档不写、四组色块显示值），
并用它算出的变量生成静态出图核对：**出厂（琥珀）/ 改光点（蓝）/ 改下划线（玫红）/ 下划线模式（玫红）**
四张，另加两张**探针图**（光点纯绿 → 小球与那条线一起变绿；下划线纯红 → 那条线变红而光点仍是琥珀）
—— 一眼看出变量真的接上了。核完即删。

## 本次改动（2026-10-10，第二十二轮）：导读的标记去掉**「兔子」**，只留光点与下划线

**需求**：用户原话「标记导读的形式，去掉"兔子"。光点和下划线保留」。

去掉的是**第二号领路的**（不是书架上那只毛绒兔子 —— 它还在摆件架上，一动没动）：

| 文件 | 改动 |
| --- | --- |
| `src/components/GuideRabbit.tsx` | **整份删掉**（125 行：18 × 12 像素画的「探 / 缩 / 进」三帧 + 「探-缩-探-进」那一跳） |
| `src/lib/readingGuide.ts` | `GuideMarker` 从三种收成两种（`dot` / `underline`）；`GUIDE_MARKERS` 少一枚胶囊；`normalizeGuideMarker` 只认 `underline`（**老存档里的 `rabbit` 当坏值回落成光点**）；兔子专用的 `GUIDE_PRINT_EM` / `guidePrintWidth` / `GUIDE_HOP_MIN_MS` / `GUIDE_HOP_MAX_MS` / `guideHopMs` 五个一并删 |
| `src/views/Reader.tsx` | 不再 import `GuideRabbit`；`guideModeClass` 只剩 `guide-crawl` 一条分支；`guide` ref 里的 `pitch`（脚印间距）删掉；`placeGuide` 不再把轨迹宽收成整只脚印；渲染那处只剩「光点 or 空（下划线模式）」 |
| `src/App.css` | 兔子那一整段删掉：`.reading-guide-rabbit` / `.rabbit-hop` / `.rabbit-frame*` 与四条 `@keyframes`、`--guide-paw` / `--guide-prints` 那张脚印底图、三条 `.reader-lines.guide-rabbit` 规则（原地留一小段说明） |

**一处取舍**：**不换存档键、不写迁移** —— 老记录里的 `marker: "rabbit"` 走到 `normalizeGuideMarker`
就是「不认识」，按坏值回落成光点；行号 / 档位 / 开关一个都不动（换键会把「读到第几行」一起丢掉）。
这与上一轮去掉玩偶那三个朝向时同一个道理。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 110.80 → **108.23 kB**、
JS 364.80 → 362.94 kB）；`grep` 确认 `GuideRabbit` / `guide-rabbit` / `--guide-prints` /
`guidePrintWidth` / `guideHopMs` 在代码里一个不剩（只剩注释里说明来历的那几句）；
另用临时脚本把纯逻辑真跑了一遍 **15 条 ALL OK**（名单恰好两枚且字对得上、`normalizeGuideMarker("rabbit")
=== "dot"`、老记录的行号 / 档位 / 开关原样保住、档位牌与「每行停留时间」不受影响），核完即删。

## 本次改动（2026-10-10，第二十一轮）：玩偶的「左 / 右 / 后」三面**整个去掉**，只剩正面

**需求**：用户原话「兔子、猫头鹰和乌龟的左/右/后三面去掉，只留正面」（上一轮刚把侧身画成真侧面，这一轮索性不要了）。

撤掉的范围是数据 · 组件 · 样式三处一起：

| 文件 | 改动 |
| --- | --- |
| `src/lib/toyPrefs.ts` | `ToyFacing` 类型、`TOY_FACINGS` 名单、`normalizeToyFacing` / `setToyFacing` / `toyFacingHint` 三个函数、`ToyPlacement.facing` 字段全删；`placedToys` 只回 `{ id, label }`；出厂摆法只剩 `{ on }`。**键名照旧 `paget.shelf-toys.v1`、不写迁移**（理由见下）|
| `src/views/Shelf.tsx` | `Plush` 去掉 `facing` 入参与 `data-facing` 属性；`ToyPicker` 去掉 `onFace` 与那排「前 / 左 / 右 / 后」小方块，**一行改成一颗按钮**（缩略图外面新包一层 `.toy-thumb`）；`Shelf` 里的 `faceToy()` 删除，架子上 `Plush` 的 `label` 只剩名字 |
| `src/App.css` | 「玩偶的朝向」整节删掉（换成一段说明），`--plush-flip` 镜像变量作废（`.plush` 基类那条 `transform: scaleX(...)`、`toy-bounce` 的四帧、`.toy-choice .plush` 里的镜像一并去掉）；猫头鹰面盘 `--plush-face-x` 退回写死的 `50%`；`.toy-facing` / `.toy-facing-btn` 两条样式删除；`.toy-choice` 从「2.5rem 圆钮」改成**铺满整行的按钮**，`.toy-thumb` 承接原来那 2.5rem 见方的一格；滑杆与读数改定宽（`flex: 1` → 5.2rem、3.6 → 3rem）|
| `src/styles/manage-mode.css` | `rabbit-alert` / `rabbit-intercept` 两条关键帧里那 6 处 `scaleX(var(--plush-flip, 1))` 去掉，只剩 `translateY + rotate`（镜像没了，带上它就是一句废码）|

**几处值得记的取舍**：

1. **画法整段删、不留开关**：正面那一套本来就是「默认什么都不写」，删掉另外三套之后 `data-facing`
   这个属性也没有存在的理由（`--plush-flip` 同理）。
2. **存档不换键**：老存档里多出来的 `facing` 直接忽略（`on` 还认），换键反而会把「哪几只摆着」
   一起丢掉 —— 代价只是老用户那格朝向悄悄没了（本来也要去掉）。
3. **那排方块删掉之后，行的宽度改由「间距」那行定**：间距那行（名字 + 滑杆 + 读数）比三行缩略图宽，
   多出来的宽度全落进 `.toy-name`（`flex: 1`），于是**整行就是一颗按钮**（点哪儿都算放上 / 取下，
   空白也在按钮里）。滑杆也不能再写 `flex: 1` —— 浏览器给 `input[type=range]` 的固有宽度是 129px，
   它会把面板撑得比那三行宽出一大截，三行就被甩出一片空白。
4. **缩略图那一格单独成 `.toy-thumb`**：原来 `.toy-choice` 自己就是那颗圆钮，现在它是整行按钮，
   里面那格继续用「绝对定位 + 半个盒子的负外边距」手工居中、缩到 `scale(0.42)`（老办法，一字未改）。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 113.83 → **110.80 kB**、
JS 365.74 → 364.80 kB）；`grep` 确认 `data-facing` / `--plush-flip` / `TOY_FACINGS` / `toy-facing`
在代码里一个不剩（只剩注释里说明来历的那几句）；把真实的 `ToyPicker` 连真实上下文
（`.study` → `.shelf-rack.decor` → `.decor-item.toy-item`）SSR 成静态页出图两张（三只都摆 / 只摆一只）
—— 三只时多一行「间距」、只摆一只时没有那一行，三只造型（兔子 / 猫头鹰 / 乌龟）都正常，
行的亮条与「摆着的那只」也对得上。

## 本次改动（2026-10-10，第二十轮）：玩偶的**朝左 / 朝右**画成真侧面（不再是「倾斜几度」）

> ⚠️ **这一整节已在第二十一轮撤掉**（用户要求只留正面）—— 这里留着当决策记录，
> 「真侧面是怎么画的」那份经验别再重走一遍。

**需求**：用户原话「兔子、猫头鹰和乌龟的『左/右』只是朝向倾斜了几度，没有变成左侧和右侧的朝向」。

先查清两件事：

1. **朝右那套本来就只挪了五官**（头挪到 54%、两只眼都还看得见、鼻子跟着偏一点）——
   一只正面朝你的玩具「脸偏一点」看着当然还是正面；
2. **朝左那格更不对**：侧面那套规则当时**只写在 `[data-facing="right"]` 下**，
   朝左只有一条 `--plush-flip: -1`，于是它 = **正面照镜子**（两只眼、鼻子朝下、四肢左右对称），
   「朝左 / 朝右」根本不成镜像 —— 第十七轮那句「朝左 = 朝右那套整只镜像」其实没成立。

| 文件 | 改动 |
| --- | --- |
| `src/App.css` | 「玩偶的朝向」那一节里，「侧过身」整段重写：**只剩一只眼**（远侧 `display: none`）、**鼻子探到脸的最前面且尖冲前**（`rotate(-90deg)` 把朝下的三角转成朝右）、**头 60% → 56% / 身子收窄到 2.4rem 且后让**、**远侧那条胳膊与后脚藏起来 + 近侧两条按「前 / 后」排开 + 前爪 `z-index: 3` 画到身子前面**、**耳朵改成一前一后叠着**、尾巴甩到身后；乌龟另加两处（尖尾巴 `scaleX(-1)` 掉头、后鳍改往后斜）。所有侧身规则改用 `.plush:is([data-facing="left"], [data-facing="right"])` —— **左右共用一份画法**，朝左只剩「整只镜像」这一件事 |
| `src/views/Shelf.tsx` | 只改 `Plush` 的注释（描述新的侧身画法），一行代码没动 |

**几处值得记的取舍**：

1. **「侧面」到底要动哪几样东西**：正面那套有一半在侧面是看不见的 —— 远侧那只眼、远侧那两条腿、
   正对着你的肚皮。只挪五官不够，**得把看不见的东西真的收掉**（`display: none`）才会有「转身」的感觉。
2. **鼻子用 `rotate(-90deg)` 把朝下的三角转成朝前**：不转的话，它落在脸的边缘还是个「朝下的鼻子」，
   看着像脸没转、只是鼻子挪了个位置。朝左那一遍由整只镜像负责，正好又转回来。
3. **左右共用一份画法，靠 `:is()` 而不是把每条规则写两遍**：侧身一共十几条，
   选择器列表要写两倍；`:is()` 一个选择器就够。用它也**不冒险** ——
   这个项目早就在用 `inset`（`.plush-head-group`）与 `repeating-conic-gradient`（龟壳），
   那些都要求 Safari 14.1+，而 `:is()` 从 Safari 14 就有。
4. **前爪得抬到身子前面**（`z-index: 3`）：基类里四肢（`1`）在身子（`2`）之后，正面看是靠
   「伸到轮廓外」才看得见的；侧面它落在身子**前半**上，压在后面等于没有。
5. **乌龟的壳不跟着收窄**：它是圆顶，正面看侧面看一样宽 —— 收窄反而像被挤扁，
   所以那条 `width / left` 用 `:not(.plush-turtle)` 绕开它。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 112.77 → 113.83 kB）；
`qlmanage` 出图逐只放大到 5 倍核对「朝右 / 朝左」—— 两侧互为镜像、且都只剩一只眼、
鼻子冲着脸朝的那边、远侧那条腿不见了、耳朵前后叠着、尾巴在身后；
另出「3 只 × 4 朝向」整表一张，确认**朝前 / 朝后一个字没变**。

## 本次改动（2026-10-10，第十九轮）：多只玩偶之间的**间距可调**

**需求**：用户原话「添加多个玩偶的时候，玩偶之间的距离也可以调节」。

**做法**：摆件架那个面板（从玩具上方弹出的 `.toy-picker`）里多一行 **「间距」滑杆**，
只在**架上摆着两只以上**时出现（一只也没有「之间」可言）；拖动它，架子上的几只立刻分开 / 挤紧，
并记在本机，下次打开还是这个间距。

| 文件 | 改动 |
| --- | --- |
| `src/lib/toyPrefs.ts`（169 → 232 行） | 新增 `TOY_GAP_MIN = -1` / `TOY_GAP_MAX = 1.6` / `TOY_GAP_STEP = 0.1` / `DEFAULT_TOY_GAP = -0.6` / `TOY_GAP_STORE_KEY = 'paget.shelf-toy-gap.v1'`，以及 `normalizeToyGap`（夹取 + 对齐台阶 + 挡掉 `null` / 空串等坏值）/ `loadToyGap` / `saveToyGap`。**间距另起一个键**（不塞进 `paget.shelf-toys.v1`，那份存档的形状是「每只一条 `{ on, facing }`」，塞数字就得动它全部读写点）—— 老用户零迁移 |
| `src/views/Shelf.tsx`（2,338 → 2,408 行） | `const [toyGap, setToyGap] = useState(loadToyGap)` + `applyToyGap`（归一化后写回本机）；`<span className="toy-row" style={{ "--toy-gap": `${toyGap}rem` }}>`；**面板整块抽成新的导出组件 `ToyPicker`**（行、朝向、间距那一行都在里面，DOM 位置不变、仍住玩具那个 `li` 里） |
| `src/App.css`（5,651 → 5,689 行） | `.toy-row .plush + .plush { margin-left: var(--toy-gap, -0.6rem) }`（+ 一条 `margin-left` 的过渡，拉滑杆时是「挪」不是「跳」）与 `.toy-gap-line` / `.toy-gap-slider` / `.toy-gap-value`（那一行与「兔子 / 猫头鹰 / 乌龟」同一列对齐，上面一道细线把它与「收放 / 朝向」三行分开） |

**几处值得记的取舍**：

1. **存的就是 CSS 的 `margin-left` 值**（rem），出厂 `-0.6rem` 正是从前写死的那一档 ——
   老用户升级后外观**一字不变**；一行 `var(--toy-gap, -0.6rem)` 就是全部「算式」。
2. **归一化先 `toFixed(1)` 再转回数字**：`6 * 0.1` 会算出 `0.6000000000000001`，
   直接写进 `style` 与滑杆的 `value` 会让滑杆对不齐台阶（拖到那一格会「跳」）。
   另外 **`null` / 空串要显式挡掉** —— `Number(null)` 与 `Number("")` 都是 0，
   不挡的话「没存过」会被读成「间距 0」。
3. **为什么要把面板抽成组件**：`Shelf.tsx` 的 render 已经 2000+ 行，而面板挂在组件内部
   state 上（平时收着），SSR 渲染 `Shelf` 根本看不到它 —— 抽出来之后能在 node 里**整块**
   渲染点数（摆两只才出现 / 一只时不出现 / 滑杆的 min-max-step-value 与读数）。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 112.44 → 112.77 kB、JS 364.62 → 365.74 kB）；
临时纯函数脚本 **43 条 ALL OK**（范围夹取、台阶对齐与浮点毛刺、坏值 / `null` / 空串、
滑杆递进来的字符串、存 `0` 要读成 `0`、坏 JSON、没有 window、`localStorage` 访问就抛）；
临时 SSR 冒烟 **26 条 ALL OK**（货架：间距真写进 `--toy-gap`、摆几只对得上；
面板：两只以上才出现那一行、min / max / step / value / 读数 / 读屏名字、三只的朝向与缩略图没被挤掉）；
`qlmanage` 出「间距 -0.6rem / 1.6rem」对照图两张 —— 前者三只搭在一起、滑杆在左端读数 `-0.6rem`，
后者明显分开、滑杆在右端读数 `1.6rem`。

## 本次改动（2026-10-10，第十八轮）：修「摆件栏换玩偶的面板被上方那栏挂件（木墙）挡住一半」

**需求**：用户原话「摆件栏切换玩偶的面板被上方的木『墙』挡住了一部分，请修复这个问题」。

**根因是「裁」不是「盖」**：换玩偶的面板 `.toy-picker` 是从玩具**上方**弹出的小卡片
（`bottom: calc(100% + 0.35rem)`，三行约 9rem 高），而摆件架这一层只有 8.8rem 高。
基类 `.study .shelf-rack` 有一条 `overflow: hidden`（原本是给**下层书排**裁书脊用的），
装饰层照搬了它 —— 于是面板的上半个被裁在架子顶边，看着就像被上面那栏挂件（木墙）截断。
所以改 `z-index` 没用（那管的是「盖」，这里是「裁」）。

| 文件 | 改动 |
| --- | --- |
| `src/App.css` | `.study .shelf-rack.decor` 单独加 `overflow: visible`（附一段注释说明为什么装饰层可以放开、面板靠原有 `z-index: 7` 盖住挂件栏） |

**两处确认**：
1. **装饰层里没有需要裁的东西** —— 最高的立式留声机 5.6rem、玩具连耳朵 5.9rem，都在
   这一层的可用高（8.8 − 0.95 = 7.85rem）之内，放开溢出不会让别的东西探出去。
2. **放开后盖得住、也放得下** —— 面板与挂件栏都在 `.study` 这同一个堆叠上下文里，面板所在的
   `.decor-item.toy-item` 是 `z-index: 7`、挂件栏（便利贴 / 时钟）是 2 / 6，所以面板在上面；
   纵向上屏幕顶部留得住（面板顶端离屏顶约 4.2rem，`.study` 自己的 `overflow: hidden` 裁不到）。

**验证**：`npx tsc --noEmit` exit 0、`npx vite build` ✓（CSS 112.44 kB）；
按本仓库惯例用 `qlmanage`（WebKit）出了「修复前 / 后」对照图两张 ——
前一张只剩最底一行「乌龟」、上面两行被裁掉，后一张三行（兔子 / 猫头鹰 / 乌龟）
完整地浮在挂件栏之上（图稿里先关掉动画，否则 `toy-picker-in` 会被停在 `opacity: 0` 那一帧）。

## 本次改动（2026-10-09，第十七轮）：摆件架上的三只玩偶**各自**放不放 + **各自**朝哪一面（前 / 左 / 右 / 后）

> ⚠️ 「朝哪一面」这一半后来变了两次：第二十轮把侧身重画成真侧面，第二十一轮**整个去掉**
> （只剩正面）。下面关于朝向的那些说明只当历史记录看 —— 现在玩偶没有 `facing` 了。

**需求**：用户原话「首屏的摆件栏，用户可以选择把三个玩偶兔子、猫头鹰、乌龟都放上去。玩偶的朝向也可以调四面。」

| 文件 | 改动 |
| --- | --- |
| `src/lib/toyPrefs.ts`（**新增**，206 行） | 摆法这份偏好独立成模块：`TOYS`（三只）/ `TOY_FACINGS`（前后左右）/ `ToyPlacement { on, facing }` / `DEFAULT_TOY_SETTINGS`（**只有兔子在架上、朝前**）/ `normalizeToySettings` / `placedToys` / `toggleToy` / `setToyFacing` / `toyFacingHint` / `loadToySettings` / `saveToySettings`（`localStorage`，键 `paget.shelf-toys.v1`） |
| `src/views/Shelf.tsx` | `toy`（选中哪一只）→ `toys`（三只各自的摆法）；`Plush` 收一个 `facing`、落在 `data-facing` 上；摆件架那一格改成 `.toy-row`（摆着的几只并排 + 一只也没摆时那个「＋」空位），**面板仍挂在这同一个 `li` 里**；面板从「一排圆钮」改成三行「缩略图（点它放上 / 取下）+ 名字 + 前 / 左 / 右 / 后」；开书过场里那只玩偶改成「架上摆着的第一只」（一只也没摆仍是兔子） |
| `src/App.css` | 新增「玩偶的朝向」一节：`--plush-flip`（朝左 = 整只 `scaleX(-1)`）、朝右那套「五官与重心偏过去、尾巴甩到另一侧」、朝后「藏起五官与肚皮 + 后脑一道长缝 + 猫头鹰的头换成背羽色 + 乌龟只剩壳」；`.toy-row`（相邻两只搭 0.6rem）/ `.toy-empty`；面板改成三行小卡片 |
| `src/styles/manage-mode.css` | 兔子那两条关键帧（`rabbit-alert` / `rabbit-intercept`）与 `toy-bounce` 的 `transform` 前面补 `scaleX(var(--plush-flip, 1))` —— **关键帧里的 transform 会顶掉基础那条**，不带上镜像的话，朝左那只一悬停 / 一进管理模式就突然正过来 |
| `README.md` / `memory-bank/*` | 「摆件架」那一段、偏好去处（`techContext` / `productContext`）、文件表与决策史 |

**几处值得记的取舍**：

1. **三只是「各自放不放」，不是「单选一只」**：一份存档里三只各带 `{ on, facing }`，面板一行一只。
   架子上一只也没有时留一个虚线「＋」空位（与下层书架头一格那只藤篮同理：空着的地方自己就是入口），
   不然把这个入口也一起关了。
2. **朝前 = 默认姿势，一条 CSS 都不用写**：四套画法里三套是新增的覆盖规则，只有「朝前」是白拿的。
   这样「出厂样子 / 老用户原来的样子」与加功能之前**一字不差**（出图比过）。
3. **朝左 = 朝右那套整只镜像**：只画一边（朝右：五官与肚皮往脸冲的那边挪、远侧那只眼挤小一圈、
   尾巴甩到另一侧），朝左把同一套 `scaleX(-1)` 镜一下 —— 一份画法两个方向。
   ⚠️ **这一条当时没兑现**：规则只写在 `[data-facing="right"]` 下，朝左那只等于「正面照镜子」；
   2026-10-10（**第二十轮**）才把侧身整套重画成真侧面，并用 `:is([data-facing="left"], …)` 让左右共用一份画法。
4. **`--plush-flip` 写成数值 1 / -1，而不是一整条 transform**：面板缩略图要在后面接 `scale(0.42)`，
   第一个值若是 `none`，`none scale(0.42)` 是**非法组合**、整条声明被丢掉（第一版就这么踩了：
   缩略图大小不一、还溢出面板）。
5. **`data-facing` 挂在同一个元素上，那几条选择器不能带空格**：要写
   `.plush[data-facing="back"].plush-turtle .plush-head`；写成 `…] .plush-turtle …`（多一个空格）
   就变成「后代」，一条也匹配不到 —— 而通用那几条照旧生效，现象是「五官藏了、头却没藏」。
6. **「没写到的项 = 没摆」，只有「整个存档不存在」才是出厂样子**：不然只存了一只的存档会莫名多出兔子
   （迁移老键时也踩过这个）。
7. **仍存 `localStorage` 而不是 `gui_settings`**：这一项**首屏第一帧就要摆对**，而 `gui_settings`
   是异步读的 —— 走它会出现「先摆出厂那只、再跳成你选的」。更早那一版只记「选中哪一只」
   （键 `shelf_toy`），首次读新键时把它迁过来：那只放上、其余收着。
8. **面板还是挂在那同一个 `li` 里**：管理模式量玩具位置（`querySelector(".decor-item.toy-item")`）、
   `manage-look` / `intercept`、点面板外关掉（`toyRef`）都按「架上只有一格玩具」写的 —— 保持一格，
   这些一个字没动；三只一起进管理模式时各演各的（兔子抬头 / 乌龟缩头 / 猫头鹰张望）。
9. **并排时相邻两只搭上 0.6rem**：省地方（三只并排也只占 12.6rem，台灯照旧贴右端），
   也像挤在一起坐着的玩具。这个数有依据：每只造型离自己的左右边各还空着约 0.3rem
   （身子 2.75rem 居中、前爪离边 0.28rem）。

**验证**：`npx tsc --noEmit` **exit 0**；`npx vite build` ✓；临时纯逻辑脚本 **34 条 ALL OK** ——
名单 / 朝向归一化 / 只在架上的项 / 放上取下 / 换朝向（含收着的那只也记得住）/ 坏值一律朝前 /
存读往返 / 老键迁移 / 老键里是已删掉的动物 / 隐私模式（localStorage 抛异常）/ 没有 window（SSR）；
临时 SSR 冒烟 **15 条 ALL OK** —— 真渲染 `Shelf`（`react-dom/server` + 假 `localStorage`）：
出厂只摆一只兔子且朝前、三只都写进 DOM 且 `data-facing` 对得上、一只也不摆时留着「＋」空位、
开书过场的玩偶跟着架上第一只、老存档迁移、坏存档回落；`qlmanage` 出图核对了
**三只 × 四个朝向共 12 格**、面板三行、以及**整屏书房**三张（三只并排时留声机 / 收音机 / 台灯
位置不变；出厂态与加功能之前一字不差；只摆一只乌龟时那格就是它自己）。


**需求**：用户原话「三种导读标记，遇到空行都停顿了好几秒钟。应该自动跳过空行，直接走下一行正文」。

**三个文件**：

| 文件 | 改动 |
| --- | --- |
| `src/lib/readingGuide.ts`（521 → 589 行） | 新增 `isBlankLine`（「没有字」只留**一个**判断，`null` / `undefined` 也算空）、`guideNextLine(lines, from)`（从这一行往后找第一条有字的行，没有就 -1）、`stepGuideWalk(lines, state, dt, duration)`（**一帧的推进**：把 `stepGuideClock` 与「空行不花时间」串成一步；`stopped` = 这批再没有有字的行了）。`stepGuideClock` 原样留着 |
| `src/views/Reader.tsx`（1,723 → 1,736 行） | `stepGuide` 每帧只调一次 `stepGuideWalk`：`stopped` → `atBatchEnd()`（接下一批 / 收住并说「已到最后一页」），`moved` → `land()`（清 rect、重渲染、存本机、跟滚），否则 `placeGuide`。渲染那两处（`.blank` 类与段首）与量行那处改用 `isBlankLine` |
| `README.md` | 「光点导读」那一节补一段「空行不占时间」 |

**几处值得记的取舍**：

1. **空行是 0 时间，不是「走得快一点」**：一步跨过去、连 `elapsed` 都不给。原来光点 / 兔子是
   沿空行的整宽慢慢挪过去（那条线上一个字都没有），下划线那一段更糟 —— 空行不画轨迹条，
   那一整行的工夫干脆什么都看不见。跨过去时**余量照样带走**（落在空行上当帧纠正、跨过多条时
   也只花一帧），所以长跑不漂。
2. **抽成 `stepGuideWalk`，而不是在 `Reader` 里把两个函数拼起来**：这样「空行不花时间」能对着
   **真实调用路径**下断言（拼在组件里的话，测试只能复制一份逻辑来模拟）。`stepGuideClock`
   没动 —— 它那条「一次只走一行、换行时把超出的时间带走」的断言照旧管用。
3. **「没有字」只留一个判断**：渲染的 `.reading-line.blank`、段首的算法、导读跳空行都用
   `isBlankLine`。原来各写各的 `line.trim() === ""`，迟早会分家（比如一边认 `\u00a0` 一边不认）。
4. **尾巴上只剩空行**：不住在空行上，直接算「这批到头了」→ 还有下文就接下一批，书末就收住
   并说「已到最后一页」。所以**书尾那几行空行不再白等几秒**，提示也来得更早。
5. **不碰别的**：换行节奏（每行停留时间）、20 档刻度、三种标记的长相、进度存档一个字节没动；
   空行本来也不画下划线 / 轨迹条，所以「跳过」在画面上只是「不再停顿」。

**验证**：`npx tsc --noEmit` **exit 0**；`npx vite build` ✓；临时纯函数脚本 **22 条 ALL OK** ——
`isBlankLine` 与老规则 `trim() === ""` 在 11 个样本上逐字等价（含不断行空格 / 全角空格 / 零宽空格、
`null`），`guideNextLine` 的落点 / 连跳 / `-1`（尾全是空行、整批全空、越界、不是数组）/ 坏 `from`；
`stepGuideWalk` 落在空行上当帧纠正、换行跨空行时余量带走（990 + 20 → 10）、同一行内一格一格走、
一帧最多一行、尾巴全空 → `stopped`；最后**把整批走一遍**（40 行里插 10 条空行，含开头一条与
中间连着三条）：落点正好是有字的 30 行、**任何一帧都不落在空行上**、总帧数与「没插空行的同一批」
相差 ≤ 1 帧 —— 也就是空行真的 0 时间。

## 本次改动（2026-10-09，第十五轮）：导读里加一号「下划线」领路的 —— 四五个字宽、墨色笔直、走过就化掉

> ⚠️ 这一节里写的「三种标记」后来少了一种：2026-10-10（**第二十二轮**）按用户要求
> **去掉「兔子」**，只剩光点与下划线。下面关于「三枚胶囊 / 三种标记」的说法只当历史记录。

**需求**：用户原话「导读部分增加下划线导读，宽度为四-五个中文字（两个英文单词长度），
不是机械匀速『前进』，而是感觉带有一点呼吸，生命感的爬虫一样」。
**当天按反馈改了一版**（见这节末尾那条「改版」）：「下划线导读需要改动，它就是黑色笔直的下划线，
走过的轨迹迅速消失，只有四五个中文字，或者两个单词的长度，从视觉角度看就是在『前进』」。

**四个文件**：

| 文件 | 改动 |
| --- | --- |
| `src/lib/readingGuide.ts`（388 → 521 行） | `GuideMarker` 加 `"underline"`（`GUIDE_MARKERS` 三条胶囊、`normalizeGuideMarker` 认它、坏值照旧回光点）；新增这一段下划线的**纯逻辑**：`GUIDE_CRAWLER_EM`（4.6em ≈ 四五个中文字 / 约两个英文单词）、`GUIDE_CRAWLER_BREATH` / `_BREATH_MS`（±18% / 2.2s）、`guideBreath`、`guideCrawlWidth`、`GuideCrawlBand` + `guideCrawlAt`（一折一条，只有 left / top / width —— 粗细 / 颜色交给 CSS），内部 `crawlStep`（smoothstep） |
| `src/views/Reader.tsx`（1,675 → 1,723 行） | guide ref 加**自己的时钟** `clock`（每帧 `+= dt`，只增不减）与 `crawl`（一段最长多宽 = 字号 × 4.6em）；`placeGuide` 多一条下划线分支（**复用轨迹条那几条**，每条只写 left / top / width —— 高度不再由 JS 写，那条线多粗由 CSS 说）；`.reader-lines` 的类改成 `guideModeClass`（`guide-rabbit` / `guide-crawl`）；下划线模式下 `.reading-guide-marker` 里是空的（只当量尺寸的锚点，不能省） |
| `src/App.css`（5,421 → 5,452 行） | `.reader-lines.guide-crawl .reading-guide-trail`：**墨色**（`var(--reader-ink)`）+ **方头**（`border-radius: 0`），粗细照旧吃 `.reading-guide-trail` 的 0.1em —— 与已读行那条 `text-decoration` 同色同粗同高；再加 `.reader-lines.guide-crawl .reading-line.passed .reading-line-text` 的 `reading-guide-ink-fade` 动画（0.75s，22% 处才开始淡）让走过的**迅速化掉** |
| `README.md` | 「光点导读」那一节从「光点 / 兔子」两条改成**三条**，写清那一段的宽度、笔直的长相与「走过就化掉」 |

**几处值得记的取舍**：

1. **当成「第三种领路的」加进去，而不是改掉原来那条轨迹**：用户说的是「**增加**下划线导读」，
   而且点明了宽度（四五个中文字）—— 所以加一枚标记胶囊（光点 / 兔子 / 下划线，存本机）
   比动老的那两条稳妥：老用户的「读到第几行 / 档位」一个都不动，`marker` 这个字段本来就是
   纯新增（认不出来的值回光点）。
2. **宽度按「字」算**：`4.6em`（一个汉字 ≈ 1em，英文一个单词 ≈ 0.5em → 约两个单词），
   而且**只按最长那一拍定标**（缩回来那一拍 3.8 个字），所以一整轮都在「四五个字」里。
   跟着字号缩放的那一套照旧：调用方按 `fontSize × GUIDE_CRAWLER_EM` 算好 px 放进 ref。
3. **「不是机械匀速」拆成两件事**：①**步子** —— 一折之内先慢后快再慢（smoothstep），
   两头几乎停住、中间才快，一折走完的时间不变（所以换行的节奏不受影响）；
   ②**伸缩** —— 长度在 3.77–4.6 个字之间一伸一缩（2.2s 一轮）。
   **只有长度在动**：粗细 / 颜色 / 落点一律不动（改版时把「又长又细还抬头 ↔ 又短又粗」那套
   删了 —— 一条会变粗变细的线一眼就看出是「另一个东西」，而它要的就是「一条下划线」）。
4. **伸缩的时钟必须与 `pct` 分开**：`pct` 每换一行就归零，拿它当相位就是「一换行抽一下」
   的机械感；所以 ref 里单放一个只增不减的毫秒时钟，换行 / 换档都不重来。
5. **2.2s 是挑出来的**：二十档的每行停留时间（0.5–20s）没有一个与它成整数倍（最接近的也差 7%）
   —— 不然到每一行行尾都伸到同一拍上，又变成机械感。挑法写在一张一次性脚本里跑了一遍。
6. **身子铺在头的后面，而且顺着阅读顺序往回退**：折行时几折都是从行首那个 x 起头的，
   拿区间硬套会在折行处算错（第一版就写错了，靠断言抓出来）；按「一折铺不下就退到上一折的
   末尾接着铺」算，折行天然被拆成两条（上一折末尾一条、下一折开头一条），行首那段从左边长出来、
   行尾那条右端正好压在行尾。
7. **复用轨迹条那几条 DOM**：一折一条本来就是现成的（空行 0 条也天然对上「没字不画」），
   只是这几条在下划线模式下不再表示进度，它们**就是**那一段领路的下划线；长相靠 `.guide-crawl`
   那个模式类切 —— 该模式类只管**颜色与方头**，位置 / 长度每帧由 JS 写（所以行内优先）。
8. **改版（当天按反馈）**：第一版是一只**琥珀色、圆头、带暖光、还会变粗抬头**的「虫」，
   用户看了说「它就是黑色笔直的下划线，走过的轨迹迅速消失……从视觉角度看就是在『前进』」——
   于是三处一改：①换成**墨色 + 方头 + 与已读下划线同一条线**（连粗细都用同一个 0.1em），
   让它**就是**字底下那道线；②已读行那条下划线在这个模式下**不再常驻**，用一条 0.75s 的
   CSS 动画（`reading-guide-ink-fade`，前 22% 保持墨色）「亮一下就走」，所以身后不会积起
   一条越来越长的下划线；③`GuideCrawlPose`（宽 / 高 / 抬头三件套）直接删掉，换成只有宽度的
   `guideCrawlWidth`，`GuideCrawlBand` 也去掉 `height` —— **一件事只留一个数**，
   少写一半代码。`tsc` 与断言脚本跟着改，老的两号标记（光点 / 兔子）一行没动。

**验证**：`npx tsc --noEmit` **exit 0**；`npx vite build` ✓（CSS 109.27 → **109.73 kB**）；
临时纯函数脚本 **39 条 ALL OK**（三处：宽度 —— 最长 4.6 个字 / 92px、最短 3.77 个字 / 75.44px、
一整轮都在四五个字之间、跟着 12/20/36/80px 字号同比例、坏 em / 坏时钟不抛；
时钟 —— 2.2s 一圈、`0 → +1 → 0 → -1`、二十档都不是它的整数倍；落点 —— 右端就是头、
与已读行同一条线、行首从左边长出来、折行退回上一折末尾且加起来还是那一段、
「不是机械匀速」中间比平均快 35%+ 而两头几乎停住，外加光点那两条老几何没被碰坏）；
`qlmanage` 出图三张逐格看过 —— 下划线模式那张：四行「已读」分别是刚走过（墨色）/ 化到一半 /
快没了 / 早就没了，三条「当前行」分别是 92px、75.44px 与折行的两条（上一行末尾一小截 +
本行开头一小截），方块端头、与已读下划线同粗同色；放大 2 倍那张把「这一折的内容框」涂出来
对照，确认那一段与 `text-decoration` 压在同一条线上；第三张光点模式作对照，琥珀下划线没被影响。

## 本次改动（2026-10-09，第十四轮）：设置页做成手绘风的方格纸清单 + 每一项都说大白话

**需求**：用户原话「把设置页面也做成手绘风，并且把每个项目尽量用大白话的方式转述一下」。

**四个文件**：

| 文件 | 改动 |
| --- | --- |
| `src/lib/settingsText.ts`（**新增**，286 行） | **措辞层**（纯函数，一个数值都不翻译）：`settingWords(path)` 一项一项给「大白话名字 + 一句话 + 单位 + 管哪儿（`scope`）」；`sectionWords(name)` 给节的大白话标题与引言；`plainValue(path, value)` 把值也说成人话；`SCOPE_TAG` 是那三枚牌子的字 |
| `src/views/Settings.tsx`（390 → 501 行） | 一页方格纸：`Settings` 管取数（`config_get` / `paths` / 两个本机偏好），**新导出 `SettingsSheet`** 管排版（数据全由外面递进来、没有 hooks，SSR 直接渲染它 —— 与 `StatsSheet` 同一个理由）。每一项排成四层：名字 + 牌子 + 控件 → 一句话 → 技术名 + 「现在：…」+ 保存 |
| `src/styles/settings-page.css`（**新增**，534 行） | 纸页（方格 + 页边竖线 + 胶带 + 折角 + 不对称圆角 + 两道零模糊描边）、荧光笔小标题、虚线清单、**铅笔勾选框 / 铅笔滑块线 / 写在横线上的填空**、窄屏收窄 |
| `src/App.css` | 顶部 `@import` 加这一份；删掉 `.settings` / `.setting-row` / `.setting-key` / `.setting-path` 四组木头卡片（只留 `.switch*` / `.slider*` / `.text-input` 三样控件底子给新纸页重画） |
| `README.md` | 两处「设置 → 书架 → 动态书脊厚度 / 导入飞行动画」改成新名字（「书架的样子」→「书脊厚薄跟着字数走」/「导入时让封面飞一下」）；「调一调」那一节补上手绘风与措辞层 |

**几处值得记的取舍**：

1. **方格纸，不是横格稿纸** —— 统计页那纸日记是横格（写字的地方），设置是一格一格的清单，
   方格更像手上那张清单；两页共用同一套做法（纯 CSS、`--hand-font`、胶带 + 折角），只是底纹不同。
2. **技术名不删**：每一项底下留一行 `reader.page_scroll_step`。大白话是给眼睛的，
   这一行是给排查用的 —— 与终端 `werd config`、`settings.toml` 逐字对得上。
3. **「管哪儿」那枚牌子是实测的，不是猜的**：内核 `reader.*` 13 项里绝大多数只给终端阅读器用
   （界面的字号 / 行距 / 纸色走阅读页顶栏 `Aa`，存本机 `gui_settings`）。其中
   `reader.store_history` 特意验过：把它关掉再走内核 `session`（界面记录的正是这条路），
   统计照样 +600 秒（2026-10-09，拿一次性的 `WREADER_HOME` 在 `/tmp` 里跑了两遍对照）——
   所以它标「终端」，界面的统计一秒都不会被它关掉。
4. **认不出来的键回落**：`settingsText.ts` 只认它认识的那些路径，其余一律「键名当名字、
   没有说明、不给范围」。内核以后加新设置项，这一页不必同步跟上，但也不会替它编一句假说明。
5. **顺手修掉一个真 bug**：布尔那一行是「勾选即保存」，而原来的 `save()` 从 `draft` 里现读值 ——
   `setDraft` 要等下次渲染才生效，于是它读到的是**上一轮**的草稿：第一次勾选反而把旧值写了回去
   （开关看着打开了，`settings.toml` 里还是关的）。现在 `save(row, raw)` 的 `raw` 由调用方递进来
   （就是它刚设进去的那个字符串），这个 off-by-one 没有了。
6. **截图改掉的三处**：勾选框的圆角歪太多会变成一个圆团团（改成只歪一点点）；页眉右边得给折角
   留位置（不然「重新读一遍」压在折出来的纸角上）；「书库文件都在哪儿」四行改成
   **一行一项**（名目在上、路径在下）—— 挤成两列时那几句人话会折行折得很难看。

**验证**：`npx tsc --noEmit` **exit 0**；`npx vite build` ✓（CSS 102.9 → **109.27 kB**，
打出来的 CSS 里搜得到 `.settings-sheet` / `.set-scope` / 勾选框那个 `content: "✓"`，
样式表大括号 53/53 配平）；临时 SSR 冒烟 **51 条 ALL OK**（6 个大白话小节标题、23 个格子、
范围牌 15 终端 + 5 两处 + 2 界面、`name|value` 计数、人话值「60 分钟」「还没设 —— 按默认的
~/novels」「此刻时间 ｜ 章节名 ｜ 读了多久」、陌生项回落、措辞层纯函数 12 条）；
`qlmanage` 出图一张逐项看过（就是它逼出了上面第 6 条那三处）。

## 本次改动（2026-10-09，第十三轮）：首屏报「内核没起来」时，说清楚是哪一步不对

**需求**：用户原话「开发的时候，首屏上提示 `core transport failed: the core exited without answering`」。

**根因**（本机一步步复现，不是猜的）：

1. `tauri dev`（debug 构建）里 `CoreCommand::resolve` **不看**随包内核（故意的，见 `auto_command_with`），走 `dev_interpreter()`；
2. `dev_interpreter_in(parent)` 的第二个候选是 `<parent>/.venv/bin/python`，而 `parent` = `/Users/zhangziluo/Downloads` ——
   那里**恰好躺着**一个和内核无关的 venv：`/Users/zhangziluo/Downloads/.venv`（`pip list` 只有 `pip`）；
3. 于是解析出来的命令是 `/Users/zhangziluo/Downloads/.venv/bin/python -m wreader.serve`，
   实测 → `ModuleNotFoundError: No module named 'wreader'`、**exit 1**；
4. 子进程一启动就死 → stdout 立刻 EOF → `request()` 读到 0 → `CoreError::Transport("the core exited without answering")` → 首屏 `<p class="error">`。

**为什么以前查不出来**：Python 那句真正的原因走的是内核的 **stderr**，而 stderr 是 `inherit` 的 ——
它只落在跑 `tauri dev` 的那个终端里，用户在**应用里**只看到一句「没有回答就退出了」，两边对不上。

> ⚠️ 顺带一个本机事实：**这台开发机上 `../wreader` 已经没有了**（`~/.zshrc` 里
> `alias werd=…/Downloads/wreader/.venv/bin/werd` 已是悬空路径，Spotlight 也只剩冻结点里那份）。
> 所以 `tauri dev` 想跑起来得显式指内核（下一节）。

**改了什么**（都在 `src-tauri/src/core_client.rs`）：

| 改动 | 为什么 |
| --- | --- |
| 内核 stderr 从 `inherit` → **管道 + 一条读线程**（`watch_stderr`），读到的每行仍 `eprintln!` | 终端里的行为一字不变，但同一条流**另外**留一个「最近 16 行」的尾巴（`STDERR_TAIL_LINES`），出错时能贴到界面上 |
| 新增 `StderrLog`（`Mutex<StderrState>` + `Condvar`）与 `CoreClient::explain()` | 管道断了（写失败 / 读失败 / EOF）时统一产出：**哪个动作失败** + **整条命令** + **内核自己说的那句话** |
| 等尾巴用 `settle_text(STDERR_SETTLE = 200 ms)` 有界等待，**不是 `join()`** | 子进程已死时读线程立刻 EOF（这次等待零成本）；「stdout 关了、进程还活着」时也不能把界面卡住 |
| `installation_hint(command)`：只在命令带参数（= 解释器那条路）时追加「装内核 / 换解释器」 | 随包冻结点起不来是安装包坏了，`pip install -e .` 帮不上忙，不给噪声 |
| `CoreClient` 多两格：`command_line`（整条命令）、`stderr: Arc<StderrLog>` | 「到底用的哪个解释器」以前只能靠猜 |

**没动的东西**：解析顺序一行没改 —— 开发构建仍**不**自动退回随包冻结点（那会把 `../wreader`
的改动盖在旧二进制后面），只是把「显式指冻结点」这条走法写进 README。

**现在这条报错长这样**（本机真实故障路径的原文，一行就是界面上那一行）：

```text
core transport failed: the core exited without answering (`/Users/zhangziluo/Downloads/.venv/bin/python -m wreader.serve`) -- the core said: /Users/zhangziluo/Downloads/.venv/bin/python: Error while finding module specification for 'wreader.serve' (ModuleNotFoundError: No module named 'wreader') -- install the core into that interpreter (`pip install -e .` in the wreader checkout), or point WREADER_CORE_PYTHON / WREADER_CORE_COMMAND at one that has it
```

**这台机器上想立刻把 `tauri dev` 跑起来**（三选一，README 的「跑起来」一节也写了）：

```bash
# ① 把内核装回开发解释器（需要 `../wreader` 源码）
../wreader/.venv/bin/pip install -e ../wreader
# ② 指一个装了内核的解释器
WREADER_CORE_PYTHON=/path/to/python npm run tauri dev
# ③ 没有源码时，用随包那份冻结点（功能一样；改内核源码不再生效）
WREADER_CORE_COMMAND="$PWD/src-tauri/binaries/werd-core/werd-core" npm run tauri dev
```

③ 实测可用：`version` → `{"version": "0.1.0"}`、`list` → 书院那本书都在（数据在 `<repo>/.wreader`，
由 `use_project_data_root()` 指过去）。

**验证**：`cargo test` **45 项全过**（40 → 45）+ `cargo build` 零警告。新增的 5 条：
尾巴封顶且丢空行、几行拼成一行（界面上是 `<p>`，换行会被折叠）、没读到 EOF 时不死等、
提示只对解释器出现、以及 `#[cfg(unix)]` 那条**真起一个 `/bin/sh` 假内核让它死**、
断言整条报错里真带着它自己的 stderr 与出路。

**README**：修掉 `npm instal` 的错字，并补一节「首屏写着 core transport failed…」，
把上面三种走法摆出来。

## 本次改动（2026-10-07，第十二轮）：Windows 打包（MSI + `-setup.exe`）

**需求**：用户原话「打包成 msi/windows 安装程序」。

先把结论摆前面：**`.msi` 只能在 Windows 上打**。Tauri 官方文档原话是「`.msi` installers
can *only be created on Windows* as WiX can only run on Windows systems」；本机 CLI 连
`--bundles` 列出的可选值都只有 `ios | app | dmg`（宿主是 macOS 时它根本不列 msi）。
**比这条更硬的是内核**：随包的 `core/werd-core` 是 PyInstaller 冻出来的，而 PyInstaller
不能交叉编译 —— macOS 上冻出来的是 Mach-O，塞进 MSI 只会得到一个起不来的 sidecar。
所以「出一份能用的 Windows 安装程序」这件事**必须落在一台 Windows 上**
（真机 / 虚拟机 / CI runner）。

这轮因此做的是**把仓库改成「在 Windows 上一条命令就能出包」**，外加一条不用 Windows 机器的路：

| 文件 | 是什么 |
| --- | --- |
| `src-tauri/tauri.windows.conf.json`（新，20 行） | Windows 专属覆盖：Tauri **只在打 Windows 时**把它合进 `tauri.conf.json`，macOS 的包一个字节都不受影响 |
| `packaging/build_core.py`（新，204 行） | `build-core.sh` 的跨平台孪生；**Windows 上冻内核走它**（那边不一定有 bash，venv 的可执行文件也在 `Scripts/` 而不是 `bin/`） |
| `packaging/build_windows.py`（新，213 行） | 一条命令：查环境 → `npm ci` → 冻内核（含烟测）→ `tauri build --bundles msi nsis` → 报产物 |
| `.github/workflows/windows-installer.yml`（新，70 行） | 没有 Windows 机器时走这条：在 GitHub 的 `windows-latest` 上跑同一套流程，产物进 Artifacts |

**`tauri.windows.conf.json` 里定下的几件事**（值都对着 Tauri 自己的源码核过，不是猜的）：

| 键 | 值 | 为什么 |
| --- | --- | --- |
| `bundle.targets` | `["msi", "nsis"]` | 基础配置写的是 `"all"`；这里写明只打这两种 |
| `bundle.windows.wix.language` | `"zh-CN"` | Tauri 自带一张 WiX 语言表（`tauri-bundler/src/bundle/windows/msi/languages.json`），`zh-CN` 在里面 = **langId 2052 / codepage 936**；**表里没有的文化会被拒**，所以这个值不是随手写的 |
| `bundle.windows.wix.upgradeCode` | `b315b518-bd3b-5d3a-8ba7-da61bfb205ac` | `npx tauri inspect wix-upgrade-code` 打出来的默认值。**不写死的话它由 `productName` 推** —— 改个名字，MSI 就成了「另一个应用」，用户机器上会装出两份 |
| `bundle.windows.nsis.languages` | `["SimpChinese"]` | Tauri 内置这份翻译（`nsis/languages/SimpChinese.nsh`，`LANG_SIMPCHINESE`），所以那份安装向导整个是中文 |
| `bundle.windows.nsis.installMode` | `"currentUser"` | 装到 `%LOCALAPPDATA%`、**不弹 UAC**。对照：MSI（WiX）是 per-machine，装进 `Program Files`，**要管理员** |
| `bundle.windows.webviewInstallMode` | `downloadBootstrapper`（把默认值显式写出来） | 联网下 WebView2 引导程序；要离线装就换 `offlineInstaller`（包大 ~127 MB） |

**这个文件写的是严格 JSON、不放注释**：CLI 只在编译进了 `config-json5` 特性时才会对 `.json`
也试一遍 JSON5（`tauri-utils/src/config/parse.rs` 里那句注释是带 feature 门控的），没必要赌；
每一条的理由全部记在这里。

**怎么验证的**（MSI 本身在这台机器上打不了 —— 这正是这轮的结论；能验的是「仓库已经就绪」）：

- `npx tauri build --no-bundle -c src-tauri/tauri.windows.conf.json`：**这份配置真能被 CLI 读进去**
  （`WixConfig` / `NsisConfig` 都是 `deny_unknown_fields` —— 写错一个键名就当场报错，而它一路编到了
  `Compiling paget`）✓ 用的 `--no-bundle`，不留产物。
- `python3 -m py_compile packaging/build_core.py packaging/build_windows.py` ✓
- `python3 packaging/build_windows.py --check` 在本机（macOS）**把内核那三项全认出来了**
  （venv Python 3.13.3 / PyInstaller 6.22.3 / 内核仓库路径），然后按设计在「本机不是 Windows」
  处 `return 1`，并列出三条能出安装包的路 ✓
- **`python3 packaging/build_core.py` 真跑了一遍**（新脚本的端到端验证）：临时目录冻结 → 整目录装到
  `src-tauri/binaries/werd-core/` → `smoke_core.py` **ALL OK** ✓ 也就是说，在 Windows 上换成
  Windows 解释器、产出 `werd-core.exe`，走的是同一条代码路径。
- CI 工作流：`ruby -ryaml` 解析通过（`jobs=installers`、10 个 step）✓ 真跑要等仓库有 GitHub 远端。
- 顺带核过 **Rust 侧本来就是 Windows 安全的**：`core_client.rs` 的 `sidecar_name()` 在 Windows 上
  找的就是 `werd-core.exe`；`main.rs` 带 `windows_subsystem = "windows"`（不进控制台窗口）；
  `objc2*` 那几个依赖挂在 `[target.'cfg(target_os = "macos")'.dependencies]` 下，Windows 根本不编。

**Windows 上两个已知限制 / 坑**（都写进了 README 的「打包 → Windows」）：

- **MSI 需要 Windows 的 VBSCRIPT 可选功能**（Win11 24H2 起默认移除），少了会报
  `failed to run light.exe`；`-setup.exe` 那一路不受影响。
- **两个包都没签名** → 用户装的时候会看到 SmartScreen 警告（要消掉得买代码签名证书）。

**同一天补完的第二段：Windows 的「＋」导入**（原先是三个限制里的第三个，当场做掉了）。
`pick_import_paths` 现在收一个 `mode`，非 macOS 走 `desktop_picker`：

| 那一步 | 怎么做的 |
| --- | --- |
| 两档从哪来 | 系统对话框做不到 macOS 那个面板的「文件与文件夹同框」（Windows 的 `IFileOpenDialog` 开 `FOS_PICKFOLDERS` 就只能选文件夹、不开就只能选文件），所以新增命令 `import_picker_modes`：macOS 回 `["panel"]`、其余平台回 `["files","folder"]`。界面按它决定「一按就开面板」还是「先问一句」 |
| 小菜单 | 新增 `components/ImportPickMenu.tsx`（110 行）：两项 —— **选文件（多选）** / **选文件夹（内核会递归找全里面的书）**；挂在篮子右侧、量完自身尺寸后夹回窗口。**样式复用右键菜单那张木色卡片**（`.book-menu`），只多 3 条规则（遮罩 / `min-width` / 那行小字的字号） |
| 为什么配一层遮罩 | `.import-pick-scrim` 压在篮子上面：这一下 `pointerdown` 落在它身上 = 关掉菜单。这样「再点一次篮子」不会变成「关掉又立刻打开」（那正是「点菜单外收起」的经典坑） |
| 只在需要时出现 | 菜单只在 `pickerModes.length > 1` 时弹；macOS（`["panel"]`）那条路一个字节没变 —— 冒烟里有一条专门钉这个 |
| blocking 与线程 | `blocking_pick_files` 的文档明说**不能在主线程上调**（会和事件循环互相等死），而同步命令恰好就在主线程上跑 —— 所以 `desktop_picker` 把这次等待丢给一条临时线程（`std::thread::spawn(...).join()`） |
| **怎么让「只能在 Windows 上跑」的代码过类型检查** | 这是这段的关键：`tauri-plugin-dialog` **不加 target 门控**（写在 `[dependencies]` 里），`desktop_picker` 模块也**不 cfg 掉**、只在调用处 cfg —— 于是它在开发机（macOS）上照样参与编译，`blocking_pick_files` / `into_path()` / `DialogExt` 这些用法是真编译器校过的，不是照文档猜的。插件本身只在非 macOS 上 `.plugin(init())` 注册（macOS 用不到，不必白多一份 JS API） |

这一段怎么验的：`cargo build` **零警告**（`tauri-plugin-dialog` 在 tauri 2.11.6 + rustc 1.87 下解到 **2.7.3**、rfd 0.16）；
`cargo test` **40 passed / 0 failed**（38 → 40：`mode` 解析的六种输入 + 菜单档数跟着平台）；
`npx tsc --noEmit` exit 0；`npx vite build` ✓；临时 SSR 冒烟 `importpick-smoke.tsx` **24 条 ALL OK**
（默认档下 DOM 里没有那个菜单、两项的 role 与文案、三个类名与 `App.css` **双向**对账、遮罩 25 < 卡片 30 的 z 序、
**命令名与入参在 TS 与 Rust 两侧一一对得上**）；`qlmanage` 出图一张（菜单与篮子并排、2× 放大）——
出图时踩到一条：`.book-menu` 的 `animation: book-menu-in` 首帧是 `opacity: 0`，**`qlmanage` 会把入场动画停在 0 帧**，
图稿里得先 `animation: none`，否则整张卡片就是「看不见」（第一版就白出了一张）。

**同一天的第二次反馈：Windows 上跑起来报「找不到内核仓库在哪」**（用户真机上的问题）。
先把话答清楚：**源仓库不进安装包** —— MSI 里装的是这一步**冻出来的** `core/werd-core.exe` +
`_internal/`；但「冻」必须在**那台 Windows 上**做（PyInstaller 不能交叉编译），所以那台机器上
得先有一份 `wreader` 能被 `import`。原先脚本只认「两个仓库并排」与 `$WREADER_ROOT`，失败时
也只丢一行，于是这次把它做松、把话说全：

| 改动 | 说明 |
| --- | --- |
| **四级查找** | `--core-root`（新参数）> `$WREADER_ROOT` > 并排的 `../wreader` > **从解释器里那份 `wreader` 反推**（`import wreader` → 它的包目录的上一级）。最后这一级让「**不落地源码**、直接 `pip install "git+https://github.com/zhangziluo/wreader.git"`」也能冻出内核 |
| **报错说全** | `missing_core_report`：先列出**每条路试过的具体路径**，再给三条可照抄的出路（clone 到旁边 / 设 `WREADER_ROOT` / pip 装一份 + 指 `WREADER_CORE_PYTHON`），并且开头就写明「源仓库不进安装包」 |
| **修掉一个真 bug** | PATH 上连 `python` 都没有时，探测那步会抛 `FileNotFoundError` **盖掉**那条友好报错（`find_python` 与 `core_root_from_python` 都补了 `except OSError`） |
| **mac 那条也补齐** | `build-core.sh` 原来在 `cd "$WREADER_ROOT"` 处就炸（只丢一句 `No such file or directory`），现在同样打三条出路；README 的 Windows 一节补了「前置：那台 Windows 上得先能拿到内核」 |

怎么验的：`build_windows.py --check` 在本机把内核认成「来自 并排布局」✓；`build-core.sh`
真跑一遍冻结 + 烟测 **PASS** ✓；四级查找与报错文案**逐条跑过**（并排 / 显式指错后退回并排 /
从解释器反推 / `$WREADER_ROOT` / `--core-root` 各自的来源标签）✓；`build-core.sh` 指错时
打三条出路并 `exit 1` ✓。

## 本次改动（2026-10-07，第十一轮）：成就页做成暗底金徽章的「勋章墙」

**需求**：用户原话「成就页面做成暗色底，纯金色的成就徽章镶嵌在上面，徽章模仿铁十字皇室勋章的感觉」。

整页重做，动了三个文件 + 一个新文件（**取数路径一个字没动**）：

- 新增 `styles/achievements.css`（503 行）：陈列板与那枚铁十字，由 `App.css` 顶部 `@import` 进来。
- `views/Achievements.tsx` 147 → 342 行：拆成 `Achievements`（取数、保留加载 / 出错两态）+
  **`AchievementsBoard`**（数据由外面递进来的整块渲染，导出来给冒烟用）+ `Medal` / `MedalDefs` 两个小组件。
- `App.css` 5,504 → 5,422 行：原来那一节徽章墙（`.badges` / `.badge` / `.medal` / `.badge-bar`）整段删掉
  （`.group` 是设置页 / 数据页共用的，留着）。

**那尊铁十字是怎么画的**（纯 CSS + 内联 SVG，不引图片、不引 web font）：

| 那一步 | 怎么做的 |
| --- | --- |
| 十字轮廓 | 内联 SVG 的 `path`（`viewBox` 100×100）：十二个折点（四臂外张 —— 臂尖宽 36、腋下 16，臂尖落在 10/90）+ **四个 `Q`**：控制点就是腋下原来那个尖角，两端沿相邻的边各缩回 45%，于是弧朝章心凹进去。**`clip-path` 的 `polygon` 只能给折线**，这是选 SVG 的唯一原因 |
| 章体 | 三层同一条路径叠出来：外框（放大 7%）→ 章面 → 斜面（`linearGradient` 左上受光、右下背光），再加章心那个圆盘与一圈刻线 |
| 金属 | 镀金 / 生铁各一套渐变（章面 / 外框 / 章心三支），**只定义一份**（`AchievementsBoard` 里那个 0×0 的 `<svg class="ach-defs">`，整墙的章都引它） |
| 「镶嵌」 | 凹槽 = 同一条路径放大 17%、填一道「上暗下亮」的渐变，**再沿上缘描一道细金线** —— 暗板上光靠阴影看不出「嵌进去」（第一版没有这道线，出图一看是平的） |
| 章心花纹 | 成就自己那枚符号：`deviceOf()` 从内核的 `📖 开卷有益` 里把符号摘出来敲在章心，`plainName()` 从名字里去掉（同一枚符号不写两遍）；正则连着吃变体选择符（`🗄️`）与 ZWJ 组合（`🧑‍💻`） |
| 三档状态 | `is-gold` 已授予（章面镀金 + `drop-shadow` 一圈暖光，光贴着十字轮廓走）/ `is-iron` 未授予（同一尊章但**没上金**，符号压成灰的，底下一条细金条报 `current/required`）/ `is-secret` 隐藏成就（生铁 + 章心一个问号）。**生铁是默认态**（`fill` 基色），只有 `.is-gold` 才覆盖成金 —— 否则隐藏成就会跟着基色一起变金（出图抓到的漏洞） |

**这一页与统计页同一个讲究**：数据由外面递进来，`AchievementsBoard` 能在 node 里整块渲染出来点数；
暗底是**这一页要的样子、不跟昼夜走**（颜色收在 `.container.ach-page` 自己的变量里，不去动全局变量）；
尺寸一律 rem；已授予的比例仍由内核的 `unlocked` 数出来，进度仍由 `current / required` 算出来。

**怎么验证的**：

- `npx tsc --noEmit` **exit 0**；`npx vite build` ✓（CSS **97.11 → 102.9 kB / gzip 22.44 → 23.59 kB**，
  JS 351.13 kB / gzip 108.29 kB —— 新样式表 503 行是主要增量）。
- 临时 SSR 冒烟 `/tmp/paget-key/achievements-smoke.tsx`（**42 条**）**ALL OK**：纯函数 7 条
  （符号摘取的四种 + 名字去掉符号的三种）+ 整块板子 25 条（金 3 / 铁 3 / 问号 1、每枚章两层 `<svg>`、
  两节标题、`3 / 7 枚已授予` 与 43% 金条、**名字里的符号只出现一次**、**隐藏成就的真名与条件一个字都不在
  HTML 里**、进度按内核口径（`95117/1000000`、`2小时30分钟/10小时`）、授予时间走 `shortStamp`、
  旧类名一个不剩、渐变只定义一份）+ 加载 / 空 / 出错 3 条 + 样式表 7 条（**四份样式表与 `App.css` 的
  大括号配平**、`@import` 在、打出来的 CSS 里那枚章仍有尺寸、没谁被套进别的选择器底下）。
- 出图两张（`qlmanage`）：`/tmp/pv3/ach-body.html`（整页，按真机 1100 宽、墙上 5 列摆）与
  `/tmp/pv3/ach-medals.html`（金 / 铁 / 问号三档放大到 8rem）—— 十字形状、腋下那四个内凹的弧、斜面、
  凹槽那道金线、章心的符号、金属三档逐项看过。**深色木纹下那一套没出图**（`qlmanage` 只按浅色渲染），
  但这页的板子本来就是固定暗色，只有板子外面那圈木头会跟着昼夜变。

**踩到的坑**（已记进下面「会话级注意事项」）：

- **CSS 漏一个 `}`，后面整段规则会被当成前面那条选择器的后代**：`.ach-gauge` 那条少了收尾，
  于是从 `.ach-block` 到文件结尾全并成了 `.ach-gauge .ach-*` —— 样式表照样"编译通过"、页面照样渲染，
  只有那枚章回到 SVG 的默认尺寸（巨大）与默认黑色填充。**眼睛看着出图不对才回头查**；
  现在冒烟里加了「五份样式表的大括号配平」与「打出来的 CSS 里那枚章仍有尺寸」两条守它。
- 出图量比例要当心：`qlmanage` 的缩略图是**把整页缩放成方形**（页面四周那几条波纹就是边缘拉伸出来的），
  量像素前先在页里放一根已知长度的标尺，不然会把「视口字号不同」误判成布局错。

## 本次改动（2026-10-07，第十轮）：统计页做成手绘风的「读书日记」

**需求**：用户原话「把统计页面做成手绘风的书页，尽量用说人话的方式，把阅读数据重新调整」。

整页重做，动了四个文件 + 两个新文件：

- 新增 `lib/statsText.ts`（115 行）：**措辞**层（纯函数，一个数字都不重算）。
- 新增 `styles/stats-page.css`（516 行）：整页手绘风样式，由 `App.css` 顶部 `@import` 进来。
- `views/Stats.tsx` 196 → 289 行：拆成 `Stats`（取数，保留加载 / 出错两态）+
  **`StatsSheet`**（数据由外面递进来的整页渲染，导出来是给冒烟用的）。
- `App.css` 5,613 → 5,504 行：把原来那一节统计样式（`.cards` / `.card` / `.goal` / `.heatmap` /
  `.heat` / `.heat-0..4` / `.heat--1` / `.heat-legend*`）**整段删掉**，只留那根通用 `progress`
  （书架的书脊 `.spine-progress` 还在用）。
- 顺带两处：`lib/format.ts` 的 `duration()`、以及手写体字体栈提到全局 `--hand-font`。

**手绘风是怎么来的**（纯 CSS，不引图片、不引 web font —— 与书房其余几节同一套做法）：

| 那一笔 | 怎么画的 |
| --- | --- |
| 那一页纸 | `--paper` 打底 + **横格**（`repeating-linear-gradient`，1.9rem 一条）+ **页边竖线**（2.6rem 处一道，暖红）+ **不对称圆角**（四角半径各不同，像手工裁的）+ **两道 0 模糊描边**（一深一淡，像描了两遍的铅笔稿） |
| 左上角的胶带 / 右上角的折角 | `.stats-sheet::before` / `::after`（折角是 225° 斜切的纸背色 + 一道折痕线） |
| 小标题 | 底下抹一道**荧光笔**（`h3::after`，两端圆度不同、歪 0.6°） |
| 账本那一行行 | 名目 + 中间一根虚线（`.stats-leader`，`border-bottom: dashed`）+ 数目 |
| 热力格子 | **铅笔小方格**：四角圆度各不同、每三格歪 1.6°/-1.2°；浓淡不用颜色深浅，用**斜线涂色的疏密**（lv1 稀 → lv3 密 → lv4 涂实） |
| 目标条 / 占比条 | 手画的圆角框 + 里面一道「描红」（斜纹涂色） |
| 按钮 | 纸页上的按钮不再是木头凸起那枚，改成**铅笔描边**（`.stats-tools button`） |
| 整页颜色 | 全部收在本页变量里（`.container.stats-page` 那一节），深色木纹下一整套反过来（铅笔线变暖白、空槽变暗、描边变暖光） |

**阅读数据重新排的**（这是需求里「重新调整」那半句）：

| 改前 | 改后 |
| --- | --- |
| 八张木头卡片平铺（总时长 / 今日 / 本周 / 本月 / 连续 / 读完 / 成就 / 最长一次）+ 独立的每日目标条 + 表格 + 热力图 | 四节顺着读：**今天**（大字 + 一句人话 + 描红的目标条）→ **这些天**（这一周 / 这个月 / 从第一页到现在）→ **坚持**（连击 + 最久的一次 + 翻开过 / 读完 / 生词 / 译文 / 勋章 + 凌晨那句）→ **每本书读了多久**（占比条） |
| 界面从来没露过 `vocab_count` / `translations` / `night_seconds` | 露出来了：**记下的生词** / **查过的译文** / **凌晨 0~4 点读的**（`nightSentence`：超过一半在凌晨就顺手认领「夜猫子」） |
| 每本书一张表，带一列裸的书 id | 书名 + **占比条** + 时长；书 id 收进悬停提示（它是内核的坐标，画在纸上没用） |
| 热力图图例是内核 CLI 的原话（`0` / `<20m` / `1h+`） | 「没读 / 不到 20 分钟 / 20 ~ 40 分钟 / 40 分钟 ~ 1 小时 / 1 小时以上」（`format.heatLabel` 那份留着，终端那边仍与内核逐字一致） |

**说人话那一层（`lib/statsText.ts`）的讲究**：一个数字都不重算，入参全是 `StatsReport` 里现成的秒数 /
天数 / 计数；单独抽出来是为了能在 node 里钉住 —— 措辞最容易被改坏、又最不容易看出来。

- **今天没读说「还没翻开书」，不说「0 分钟」**（`todayHeadline`）；账本里那几行同理（`durationWords`：
  一秒没读就是「还没读」，一排「0 秒」比什么都像机器吐出来的）。
- **没达标报「还差多少」**（`goalSentence`）：差多少才是接下来要做的事；达标才报喜。
- **连击那句必须交代规矩**（`streakSentence`）：内核 `stats.streak_days` 是**今天读满 30 分钟才算今天**，
  不够就从昨天往前数（不归零）—— 所以分三种说法，别让人以为「连着 7 天」里已经含了今天。
- `goalPercent` 用内核那一条整除规矩（不足 1% 不算）；`bookShare` 给占比条兜 **2% 下限**（占比再小也看得见一小截）。

**两处顺带**（都与这一页有关，但改的是别处）：

- `duration()` **整点不再拖一个「0 分」**（`9 小时 0 分` → `9 小时`）—— 内核 `stats.format_hours` 本来就是这规矩，
  书架右键菜单的「时长」与阅读页退出时那句提示跟着一起变好。
- 手写体字体栈从 `styles/sticky-note.css` 提到 `App.css` 的 `:root`（`--hand-font`），
  便利贴那一份改成 `--note-font: var(--hand-font)` —— 一页日记与三枚贴纸共用一份，不再各写一套。

**踩到的坑**：

- `qlmanage` 只给**方形**缩略图，长页面下半个会被裁掉 → 出图拆成三张（上半页 / 每本书 + 页脚 / 空状态），
  预览里加一段 `.trim section:nth-of-type(-n+4){display:none}` 把上面几段收起来才看得到下半段。
- `vite build --ssr <入口> --outDir smoke-out` 会**清空 outDir**：连着打两个入口（冒烟与出图脚本），
  前一个的 `.js` 就没了 —— 报 `MODULE_NOT_FOUND` 就是这个，用完重打一次即可。
- 措辞里多打的空格（「一天读满 30 分钟 就算一天」）**第一轮冒烟就报了** —— 中文句子里单位后面不该留空格；
  这就是把措辞单独抽一层 + 冒烟的价值（页面照样渲染得很正常，眼睛看不出来）。

**怎么验证的**：

- `npx tsc --noEmit` **exit 0**；`npx vite build` ✓（CSS **91.85 → 97.11 kB / gzip 21.32 → 22.44 kB**，
  JS 345.88 kB / gzip 106.99 kB —— 新样式表 516 行是主要增量，删掉的旧统计样式抵掉一部分）。
- 临时 SSR 冒烟 `/tmp/paget-key/stats-smoke.tsx`（**46 条**）**ALL OK**：
  纯函数 17 条（五档人话 / 今天两种 / 目标四种说法 / 连击三种说法 / 凌晨三种 / 完成度 / 占比 / 账本时长）+
  纸页渲染 21 条（页眉与两个按钮 + Esc 提示 / 今天大字与人话 / 目标条 73% / 四个小节 / 账目逐项 /
  7 行 × 6 列热力图与 12 格留白 / 图例五档 / 每本书的 36%·24%、没书名回落到 id /
  **书 id 不出现在正文里**（只在 `title` 属性里）/ 旧的 `cards`·`heat*`·`table`·`progress` 一个不剩）+
  极端两种 + 加载态 8 条。
- 出图三张（`/tmp/pv2/stats-body{,-2,-3}.html` → `qlmanage`，**1× 真实尺码**）逐项看过：
  纸 / 胶带 / 折角 / 横格 / 页边线、铅笔格子热力图（含涂实那一档）、账本虚线、荧光笔小标题、
  每本书的占比条与页脚、空状态（一排「还没读」而不是「0 秒」）。
  **深色木纹下那套颜色没出图**（`qlmanage` 只按浅色渲染），只核对过变量；
  建议 `npm run tauri dev` 在真机上把浅色 / 深色各过一眼 ——「像不像手写的」自动化测不了。

## 本次改动（2026-10-07，第九轮）：便利贴的字调大、调深

**需求**：用户原话「墙上的三枚便利贴字样有点浅了，字重调深一点，同时字体应该再调大几号」。
只动 `src/styles/sticky-note.css` 一个文件的三行值，组件、交互、尺寸、`App.css` 全没碰。

**改了什么**（`.sticky-note .sticky-note-face` 那一节）：

| | 改前 | 改后 |
| --- | --- | --- |
| `font-size` | `0.6rem` | **`0.72rem`**（+20%） |
| `font-weight` | 没写（400） | **`600`** |
| 米黄 `--note-ink` | `#4a3a1c` | **`#33270e`** |
| 淡粉 `--note-ink` | `#5b3540` | **`#401d27`** |
| 淡绿 `--note-ink` | `#39492b` | **`#24311a`** |
| `color` 的兜底值 | `#4a3a1c` | **`#33270e`**（和米黄那档对齐） |

**两条取舍**：

- **为什么是 0.72rem**：纸上能写字的地方是 `3rem − 2 × 0.18rem`（内边距）= **2.64rem**；
  三枚贴纸里最长的文案是「调一调」三个字 —— `3 × 0.72rem + letter-spacing ≈ 2.2rem`，
  还留着约 16% 余量（实测「调一调」的墨迹是 3.09em ≈ 2.22rem），不会被 `.sticky-note-text` 那句
  `text-overflow: ellipsis` 截成「调…」；
  再往上抬到 0.8rem（2.4rem）就只剩 9%、稍微被压一点就会出省略号，所以停在 0.72rem。
  翻到背面那枚（`is-flipped`，纸展开成 5.2 × 3rem）宽度够 6 个字一行，
  最长的句子（`STICKY_FORTUNES` 里 10 个字）仍是一句话两行，离纸底还有富余。
- **为什么写 600 而不是 700**：`--note-font` 那一串手写体（翩翩体 / 手札体 / 楷体）多半只有一档字重，
  600 和 700 在这类字体上都是**渲染器合成加粗**、视觉上几乎一样，取小的那个（笔画糊得少一点）。

**怎么验证的**（这次没有改结构，所以主要靠出图对照 + 既有的两条冒烟）：

- `npx tsc --noEmit` exit 0；`npx vite build` ✓（CSS 91.8 kB / gzip 21.3 那一档）。
- 临时 SSR 冒烟 `sticky-smoke.tsx`（31 条里属于便利贴的那 22 条）**ALL OK**；
  `decor-smoke.tsx` 也 ALL OK —— 顺带补上了上一轮 `App.css` 只改了注释、冒烟没重跑的那一次。
- **同图对照出图**：`/tmp/pv2/ink-preview.mjs` 生成「1× 真实尺码 / 1b 夜里发黄 / 2 正面 4× 旧 vs 新 /
  3 背面 2.6× 旧 vs 新」一页（`ink.html` → `ink.html.png`），确认新的一档确实更黑更粗、句子没溢出。
- **量了一遍而不是靠眼睛**：`/tmp/pv2/measure.mjs` 把出图转成 BMP、按行/列剖面找「纸」与「墨」的包围盒。
  一页里放一个已知尺寸的 `3rem × 2rem` 参照方块，量到 **468 × 312px（宽高比 1.500）**，
  于是这次出图的标尺是 **1rem = 156 渲染像素**；再量「调一调」那枚正面，
  墨迹列剖面是 `51..93 / 96..155 / 176..276 / 294..335 / 338..397` ——
  **正好三段字（调 / 一 / 调，每段再被笔画分成两截）**，右边距留着一大截，坐实了没有截断。

**踩到的坑（值得记下来）**：出图快照（`qlmanage`）的**排版视口只有约 1088px**，
而图会被放大到 1600px —— 一页里塞四枚贴纸时它们会被 flex **压窄**（`.sticky-note` 是
`flex-shrink: 1`），于是「调一调」真的成了「调…」。第一眼差点当成改动把字挤爆了，
量过参照方块才认出是**预览页自己的窄视口造成的假象**（真应用里 `.study-wall` 那一栏：
三枚贴纸 10.3rem + 时钟 8.2rem + 工具栏 10.8rem + 三个 0.8rem 的缝 ≈ 36rem，
而 1100px 的小窗里可用约 65rem，压根压不着）。另外**放大不要用 `zoom`**：
它和便利贴那层 `preserve-3d` 一起用时会整块被裁掉，改成 `transform: scale()`（不重排）
或干脆抬根字号。这两个工具都留在 `/tmp`，不进仓库。


## 本次改动（2026-10-07，第八轮）：留声机与收音机按新效果图重画

**需求**：用户给了一张效果图（现在归档在 `design/IMG_20261007_142023.png`，左留声机、右收音机），
说「请按照这张图片将收音机和留声机改掉」。**只动这两件装饰**：摆件栏那一排的其他三件
（黑胶唱片、毛绒玩具、台灯）与顺手带到的 `README.md` / memory-bank 文档，其余一个字没动。

**现状**（改完之后，摆件栏那一节就该按这几条理解）：

- **留声机 `.decor-item.gramophone`：格子 4.9 × 5.6rem**（从前是横躺的 7.6 × 3.9rem —— 参考图里
  这台机器是立着构图的，喇叭口一直顶到格子上沿；摆件架可用高 7.85rem，装得下）。
  23 个 `span`，**DOM 顺序就是遮挡顺序**（后画的压住先画的），坐标全是 `left/bottom`（rem，
  原点 = 格子左下角），一件一件对着图量的：
  `箱脚 ×2 → 底座两级（g-plinth / g-step）→ 箱身 g-base（两端立柱在渐变里）→ 铜铭牌 g-plaque
  → 顶板 g-top → 唱片 g-disc（红标签与轴心是 ::before / ::after）→ 小圆钉 g-stud
  → 摇柄（轴 / 立杆 / 手柄）→ 唱臂（轴座 / 臂 / 唱头）→ 银肘套 g-collar（+ 扳手 + 顶上铜箍）
  → 竖管 g-pipe → 喇叭锥 g-flare → 弯肩 g-elbow → 铜箍 g-ferrule → 花瓣口 g-mouth`。
- **喇叭锥的 28 个折点不是手算的**：一次性算稿 `/tmp/paget-key/gramo-shape.mjs` 按「喉口 (0.66, 3.58)
  → 喇叭口中心 (3.56, 4.22)」这条轴，把半宽按 `0.2 + 1.077·t^2.2`（指数张开的凹曲线）采样成上／下轮廓，
  到口沿那半圈再**沿口沿椭圆的左半圈取样**回来 —— `clip-path` 会连子元素一起裁，外轮廓得自己把口沿描圆。
- **花瓣口**：口沿椭圆 1.94 × 2.60rem 按 **5 瓣**做半径调制（花瓣伸到 1.055、瓣间收到 0.945），
  所以描点用的盒子是 2.047 × 2.743rem（比基准椭圆大 5.5%），盒里每个径向渐变的色阶都乘过 0.948。
  **不引 mask**：靠「面在外、淡瓷/铜在里」的分层顺序，也能只在靠外那一圈画出东西（这里画的是 5 道筋）。
- **黑胶那叠从留声机右边搬到了左边**（参考图里最左就是留声机，右边要留给摇柄）：`rotate` 全部取正
  （正角顺时针、上沿往右倒、倒进留声机那一侧），**DOM 也挪到留声机前面** —— 后画的木箱才压得住
  最里面那张的顶端。`margin-right: -1.78rem` 是按「第 5 张转 13° 后，它的右表面在顶板左上角那个
  高度（2.66rem）上正好过顶板左脸」反推的（冒烟里把这条接触线也算了一遍，差 0.016rem）。
- **收音机 `.decor-item.radio`：格子 5.4 × 3.4rem**（1.7:1，比参考图里那个比例量出来的），
  16 个 `span`：`木脚 ×2 → 木壳 r-case → 面板 r-face（右边那道竖缝是格栅区与控制区的分界）
  → 横百叶格栅 r-grille（`repeating-linear-gradient` 周期 0.26rem，铺下七道半）
  → 三行小铭牌 r-mark → 表盘 r-dial（两根针 + 中心铜轴是它的孩子）→ 大旋钮 r-knob-big
  → 三枚小旋钮 r-knob → 侧面小旋钮 r-side-knob`。
  **小件按 `nth-child` 定位**：小铭牌是第 6/7/8 个孩子、大旋钮第 10、下面那两枚第 12/13。
- **表盘怎么只在外圈画刻度（不用 mask）**：中间一块不透明的瓷面（到 71% 为止）+ 外圈一层淡瓷
  （从 71% 起），刻度是两层 `repeating-conic-gradient`（30° 一格 + 90° 四个粗的）压在两层之间 ——
  中心那截刻度被上面的瓷面盖掉，只剩靠外的一小截。旋钮：外圈一圈滚花齿（三档明暗的 conic）
  + 中间的抛光铜面（只铺到 76%）+ 一层极细的放射拉丝。
- **像不像**这件事自动化不了：`qlmanage`（= WebKit）出图对着参考图改了三轮 —— 蜘蛛网一样的放射筋、
  玻璃球一样的旋钮、椭圆形的顶板（害得唱片「够不着」木箱）、锥体下沿与弯肩之间那道缺口，
  都是这一轮出图看出来的。

**验证**：`npx tsc --noEmit` exit 0、`npm run build` 成功、
临时 SSR 冒烟 `/tmp/paget-key/decor-smoke.tsx`（31 条：DOM 形状与顺序、App.css 里 43 条规则与
32 个类**双向**对账、带 nth-child 的 11 条逐条核对、每件零件都在格子里、黑胶那条接触线）、
`qlmanage` 出图（整排白天 + 夜里、留声机 ×6、收音机 ×6）。



## 本次改动（2026-10-07，第七轮）：墙上那三个入口改成便利贴

**现状**（改完之后，主屏最上面那一栏就该按这几条理解）：

- **`components/StickyNoteNav.tsx` 就是墙上那一栏的三枚便利贴**（统计 / 成就 / 设置）：
  它替掉了原来的**日历挂件**、**玻璃徽章盒**与**黄铜齿轮**；**数字时钟还在**（`Clock`，仍是纯展示、
  不可点）。贴纸上的文案是生活化的（「日记」「勋章」「调一调」），**真名与快捷键写在 `title` /
  `aria-label` 里** —— 生活化不等于让人猜。
- 一枚贴纸是一个 `<button>`，**里外三层各管一件事，别把它们并到一层去**：
  外层 `.sticky-note` 管位置偏移 + 倾斜 + 捏起 / 撕下 / 贴回，里层 `.sticky-note-card` 管 3D 翻转，
  再里是两张纸面 `.sticky-note-face.front` / `.back`。
- **样式在 `styles/sticky-note.css`**（由 `App.css` 顶部 `@import`）。和纸是**纯 CSS** 三层渐变叠出来的，
  **没有图片资产、也没有 web font** —— 任务书里的 `note-paper.png` 与「中文手写体」按仓库既有约定
  换成了纯 CSS 纹理与**系统手写体栈**（翩翩体 / 手札体 / 楷体 → cursive）。颜色是**顺着 id 列表循环发**的
  （三枚正好三色各一枚 —— 每枚各自哈希会撞色）、倾斜按各自 id 的哈希（都复用 `hashText`）：
  看着随机，每次打开都一样。
- **两条容易踩回去的坑**：①`button:active:not(:disabled)` 的权重是 (0,3,0) 且在 `@import` 之后，
  便利贴的状态规则必须带 `.sticky-notes .sticky-note` 前缀**并加 `:not(:disabled)`** 才压得住它，
  否则拖的时候会被按成 `translateY(1px)`；②**正反两面别靠 `backface-visibility` 藏**（离屏 WebKit
  快照不认它，背面那张镜像会盖住正面 —— 出图时纸上空空才发现），这里两面各用 `opacity` 控显隐。
- **拖拽不改版面**：偏移写在 `transform` 上（`--note-dx` / `--note-dy`），贴纸仍旧占着它在那一栏里的
  格位，所以拖完那一栏不会重排。松手吸附（离原位 28px 内回原位、否则吸 8px 格），位置存本机
  `paget.sticky-note.v1`（SSR / 隐私模式读不到 = 都在原位）。
- **「贴回」为什么用模块变量**：面板一开 `App.tsx` 就把 `Shelf` 卸下了，回来时是重新挂载 ——
  所以「上一次撕下的是哪一枚」只能记在模块作用域的 `lastTornId` 里，挂载那一眼补播「从上方飞回」。
  **别**把它写进卸下时的清理：撕下那一下正是「先记记号、再开面板」，清理会把记号抹掉。
- **连点 5 下翻面与「点一下开面板」是同一段逻辑**：点一下先只是「被捏起来」（`.is-lifting`），
  `STREAK_MS`（300ms）内没有后续点击才真撕下去开面板；攒够 5 下改成翻面、面板不开。
  背面那句话会把纸**展开一档**（长宽各放一档 + 允许折行），不然 48px 宽只够显成「书架满…」。
- **22:00–次日 6:00 纸边发黄**：整纸 `filter: sepia` + 边缘一圈 `box-shadow: inset`。
  **别改回 `radial-gradient` 的百分比尺寸** —— 压缩后再渲染会整个失效（试过，纸上什么都不发生）。

## 本次改动（2026-10-07，第六轮）：移除整套「隔板 / 区域」功能

用户要求：「把隔板给删掉」，并选定范围是**彻底移除**（删组件、清纯逻辑、管理条去掉区域胶囊
与 `＋ 隔板`、清样式与文档；`shelf.layout` 只留 `order`）。

- **删掉的文件**：`components/Divider.tsx`（一块板）、`components/RegionTag.tsx`（区名标签）、
  `components/useLabelDraft.ts`（就地改名 —— 只服务上面两个）。
- **`lib/shelfManage.ts`（698 → 290 行）**：`ManageLayout` 只留 `order`；删掉 `ManageDivider` /
  `DividerRole` / `ManageRegion` / `ShelfItem` / `ManagePick` / `normalizeLabel` / `nextDividerId` /
  `shelfItems` / `spotOf` / `regionsOf` / `regionInsertIndex` / `insertIntoRegion` / `regionTails` /
  `isDragged` / `moveDivider` / `shiftDivider` / `addDividerAnchor` / `newDividerPair` / `anchorAt` /
  `LABEL_MAX_CHARS` / `DEFAULT_REGION_LABEL` / `UNASSIGNED_REGION_LABEL` / `DIVIDER_REM`；
  `orderIndexAt` / `squeezeIds` 从「格子序列（书 + 板）」改成直接吃 `order: string[]`；
  `ManageDrag` 只剩 `{ id, title }`（拖的是一本书）。留下的：`normalizeLayout` / `readLayout` /
  `writeLayout` / `mergeOrder` / `orderIndexAt` / `gapInRow` / `squeezeIds` / `moveBook` / `nudgeStep` /
  `shiftBook` / `renameTouched` / `renamedTitle` 与那批拖拽常量。
- **`components/BookshelfManager.tsx`（404 → 394 行）**：props 去掉 `regions` / `activeRegion` /
  `onPickRegion` / `onAddDivider`；管理条去掉那排区域胶囊与 `＋ 隔板` 按钮；浮起卡片不再分
  「书脊 / 宣纸标签」两态（`.drag-ghost.divider` 一并删掉），提示行改成
  「点一下书脊选中，再用方向键挪位置 · 拖动也能排序」。
- **`views/Shelf.tsx`（2,395 → 2,264 行）**：删掉 `items`（格子序列）/ `itemWidths` /
  `dividersById` / `manageRegions` / `emptyRegionIds` / `regionTagByBook` / `grabDivider` /
  `pickDivider` / `addDivider` / `renameDivider` / `removeDivider` / `pickRegion` / `selectRegion` /
  `activateRegion` / `renameRegion`，以及导入时那段 `insertIntoRegion`；新增 `bookIds`
  （`visible` 的 id 数组，与格子下标同序），分屏直接用 `spineWidths`；`picked` 从 `ManagePick`
  收成一个「书 id 或 null」，方向键那一层只认书；`BookSpine` 去掉 `region*` 一组 props。
- **`styles/manage-mode.css`（915 → 562 行）**：删掉 `.shelf-divider*` / `.divider-*` /
  `.region-tag*` / `.manage-regions` / `.manage-region*` / `.manage-add` / `.drag-ghost.divider` 几节；
  `App.css` 里 `.study .spine-card` 的 `position: relative` 保留（改注释：它现在只是选择模式
  那枚勾选圈的定位基准）。
- **数据**：`.wreader/shelf.json` 去掉 `dividers` 与 `region`，只剩 `order`（读旧文件也安全 ——
  `normalizeLayout` 只认 `order`，多出来的键直接忽略）。
- **文档**：`README.md` 管理模式那一节重写（只剩拖书排序 / 点一下选中 + 方向键排序 / 跨屏 /
  玩偶 / 布局存内核）；`memory-bank/systemPatterns.md` 的 `shelfManage` / `Shelf.tsx` /
  `BookshelfManager` 三行改写，`Divider` / `RegionTag` / `useLabelDraft` 三行删掉。

**验证**：`npx tsc --noEmit` → **exit 0**；`npx vite build` → ✓ **42 modules**（CSS 79.9 → **77.89 kB**、
JS 348.79 → **338.76 kB**）。
**没能验的**：真机上看一眼管理条（现在只剩「完成 / ☑️批量编辑」，窄窗口下不该留空档）与
拖动落点的手感 —— 这两处改动最大，建议在浏览器里过一遍。

> ⚠️ `/tmp/paget-key/` 与 `/tmp/paget-check/` 里那几份临时冒烟 / 断言脚本
> （`pick-smoke.tsx` / `pair-smoke.tsx` / `pairmain.ts` / `pickmain.ts`）引用的模块已被删掉，
> **现在跑不起来了**；它们本来就不进仓库，留着只当历史记录。


## 本次改动（2026-10-07）：书架管理模式（锤子入口 / 宣纸隔板 / 拖书排序 / 跨屏 / 玩偶反应 / 批量编辑）

> 入口按用户选的方案放在**右上角工具栏那把锤子🔨**上（不是统计整页）：点了就地进 / 出，
> 不跳页 —— 于是 `views/Stats.tsx` 与 `App.tsx` 一行没动。任务书里那份文件清单
> （`src/pages/*`、`src/styles/`）与本仓库对不上，落成了下面这一套：组件在
> `src/components/`，纯逻辑进 `src/lib/`，样式确实是单独一份 `src/styles/manage-mode.css`
> —— 由 `App.css` 顶部 `@import` 进来，入口仍然只有 `App.css` 一个。

**数据**（`lib/shelfManage.ts`，纯函数；键 `shelf.layout`，内核不认识它）：

    { "order": ["<书 id>", ...],
      "dividers": [{ "id": "d…", "label": "诗词", "before": "<书 id>" }],
      "region": "d…" }

- `order` 与内核书单**每次渲染时按 id 并**（`mergeOrder`）：存过的顺序优先，内核新加的书接在
  最后，删掉 / 封印掉的书自动消失 —— 这份表永远不需要「迁移」，也没有第二份事实。
- **这份布局现在存在内核里**（`shelf.json`，与 `library.json` 并排，由 `../wreader` 的
  `wreader/shelf.py` 管）：换机器 / 备份 / 终端 `werd shelf` 看到的都是同一份。
  两次 RPC：`shelf_layout`（读）与 `set_shelf_layout`（整份写，落盘前丢掉内核不认识的书 id）。
  **老内核 / 内核没起来**时回落到本机 `gui_settings` 的老键（`lib/shelfManage.ts` 的 `readLayout`
  返回 `home: "kernel" | "local"`，管理条右边有个「内核 / 本机」小标签把这个写出来）。
- 隔板的位置挂在**某本书前面**（`before`；`null` = 最末），不是挂在「第几格」：书脊厚度按字数算、
  一排放得下几本按窗口宽度算，只有挂住某一本才稳。**锚点那本书不在了就落到最末**（别删隔板）。
- 隔板**两种模式都占一格**（`shelfItems(order, dividers)`）：它是书架上的陈设，退出管理模式之后照样
  立在那儿（普通模式渲染成静态的一块，不响应指针）。只有**搜索过滤**那一处不画隔板 —— 过滤后的
  书单里锚点多半不全，硬画会把几块隔板全挤到排尾。**关键**：量落点坐标的 `measureSlots` 只收
  `[data-slot]`，所以隔板也得带 `data-slot`，否则「落点缝号」与格子序列会错开一位。
- 选中那一区（`region`）就是新导入的书要落进去的地方。

**交互**：
- 锤子 = `.icon-button.manage-toggle`（`aria-pressed` 跟着模式走）；进模式时 `main` 上多一个
  `.study.manage`，书排播 `manage-sink`（下沉 + 左右各 0.28° 的轻震）。
- 管理条（`components/BookshelfManager.tsx`）：区域胶囊（名字 + 本数，点一下选中）、`＋ 隔板`、
  完成、提示；**拖拽的浮起卡片、落点指示线、边缘翻屏环**也在这一层。它只管交互：指针每动一下
  向父组件要一个「落在第几屏第几排第几个缝」（`hitAt`，坐标由 `views/Shelf.tsx` 在拖起来 /
  翻屏 / 布局变时量一次并缓存），落点**变了**才回调；卡片与指示线的位置**直接写 style**，
  不每帧渲染（与阅读页光点同一条理由）。
- 隔板（`components/Divider.tsx`）：宣纸标签（竖排、选中时盖一枚朱印），点一下那枚标签就地改名
  （6 个字，`normalizeLabel` 归一化；按下与抬手那次 `click` 若超过 4px 就当作刚在拖、不进改名 ——
  键盘在标签上按回车没有指针坐标，一律按「点一下」算）；**点板子 = 选中它**（第五轮起，
  选中后可用方向键挪，见下面第五轮那一节）。
  薄板下部一枚 ✕ 删掉这一块（`removeDivider`，**书一本不动**、被删的正好是选区时把选区一并清掉）；
  **拖动交给父组件**（`onGrab` → `grabDivider`）—— 与拖书同一条管线，所以能一路拖到别的屏，
  原来那套「只改自己与左右两格 transform」的本地拖法已删掉。
  普通模式（`managing = false`）画成静态陈设：薄板与标签都在，不点 / 不改 / 不拖 / 没有 ✕。
- 拖书 / 拖隔板**同一条管线**：`views/Shelf.tsx` 的 `armDrag` 是共用的「准备手势」（移动超过
  `DRAG_THRESHOLD_PX`(4px) 才真的起来），`grabBook` / `grabDivider` 只是把「拖什么」包成
  `ManageDrag`（`kind: "book" | "divider"` + id + 浮起卡片上写的字），落点由 `dropDrag` 按 `kind`
  分叉去 `moveBook` / `moveDivider`。两个回调都做成稳定引用，是因为书脊卡片是 `memo` 的。
  落点左右**各挤最近的一本**（`squeezeIds` →
  `.squeeze` = `scaleX(0.8)`；松手后 CSS 的弹簧曲线 420ms 回弹 = 需求里的「弹性恢复」）；
  原位那格留空、书脊化淡到 30%（就是「原屏保留半透明缩略图」）；落空 / `Esc` = 什么都没发生。
- 跨屏：指针进到左右 96px 里开始计时，**满 300ms** 翻一屏并**重新计时**（一直按着就一直翻；
  到头 / 到尾那一侧只亮不进展）；`←` / `→` 也能翻（拖拽中 `overlayOpen` 把它让给管理那一层，
  两边都翻会一次跳两屏）。翻完书排播 `turn-in-next/prev` 的滑入。
- 玩偶：`.toy-item.manage-look` 让当前那只玩具开始反应（兔子抬头张望 / 乌龟缩头 /
  猫头鹰左右张望）；拖着的书压到它头顶时（`hitAt` 里顺手算了 `overToy`）加 `.intercept` ——
  兔子跳起来拦一下，乌龟缩更深、猫头鹰张望更急。
  **动画动的都是「头 + 耳朵」那一组**（`Plush` 里把 ears 与 head 包进
  `.plush-head-group`：`position: absolute; inset: 0`，转轴 `50% 2.6rem`）。踩过的坑：原来 ears 与 head
  是**两个平级元素**，动画却只动 `.plush-head` —— 而它的基础 `transform` 是 `translateX(-50%)`，
  动画一上来就把那条居中位移顶掉，头往右跳一截、耳朵留在原地，看着就是「**头耳分离**」（猫头鹰
  是角羽留在原地、头转走了）。绑成一组后抬头 / 转头 / 缩头都动这一层，头和耳朵永远连着；
  这一层没有基础 transform，所以关键帧里也不必再叠 `translateX(-50%)`。App.css 加
  `.plush-head-group` 一节，manage-mode 的 `rabbit-look-up` / `owl-scan` / 乌龟缩头 / 两条 `.intercept`
  一并改到这一层（z-index 仍取 3：四肢 4 之前、身子 2 之后，堆叠关系与从前一致）。
- 导入落区：`doImport` 同步完之后，**管理模式下**把新书插进选中那一区
  （`insertIntoRegion`），再起飞行动画 —— 落点是动画挂载后才量的，这一次 `setLayout` 与
  `setFlight` 在同一批提交里，所以书正好飞向那一区。
- **跨屏飞行（导入飞行动画 M2，同一天做的）**：新书落在别的屏上时，`ImportFlight` 先请
  父组件**翻到第一本新书所在的那一屏**（`flightLandingPage` + `onTurn`，翻屏动画照常播），
  翻过去之后那几根书脊就在 DOM 里了 —— 于是照常飞、照常落地；落在**更前 / 更后**那些屏上的
  朝那一屏的方向**飞出画外**再淡出（`.import-fly.offscreen`，终点由 `flightEnd` 算）。
  用户最后停在新书那一屏，正好看见自己刚导入的书。
- **批量编辑**（同一天做的第二个子状态）：管理条上的 `☑️ 批量编辑` 把管理模式切成**选择态** ——
  书脊右上角出现一枚勾选圈（`BookSpine` 的 `selecting` / `selected` / `onToggleSelect`），
  点一下勾 / 取消勾；勾选存在 `views/Shelf.tsx` 的 `Set<string>` 里，**跨屏多选**不丢。
  选择态里 `grabBook` 直接早退（不拖）、`main` 上多一个 `.select-mode`（整根书脊换成「点」的手感、
  选中的那本抬起来 + 暖色描边）。管理条随之换成 全选 / 清空 + **改书名…** / **标记已读** /
  **标记未读** / **删除**：删除与改名先开弹窗（复用 `ConfirmDeleteDialog` + 新增 `BatchRenameDialog`），
  确认后逐本调用内核 `set_meta` / `finish` / `remove`，**每本开始前把进度写出去**（`batchNotice`，
  与导入回执同一行），某一本失败就继续做其余的、回执里列出失败项。改书名的四条规则
  （前缀 / 后缀 / 查找 / 替换）是 `lib/shelfManage.ts` 的纯函数 `renamedTitle` / `renameTouched`
  （**先替换、再拼前后缀**），弹窗拿选中的第一本**实时预览**；老内核时三个动作按能力探针禁用。
  `返回排序` / 退出管理模式都会把勾选清掉（进出不写任何数据）。

**验证**（都实跑过，数字是实测）：
- `npx tsc --noEmit` → **exit 0**；`npx vite build` → ✓ 42 modules，CSS 69.6 → **79.9 kB**
  （批量编辑那一节样式约 +1.9 kB）。
- **批量改书名的纯函数**：把 `lib/shelfManage.ts` 与一个 `core` 桩编成 CJS 后 node 跑
  **17 条断言**全过 —— 前缀 / 后缀 / 查找替换 / 多处全替换 / 删段 / 「先替换再拼前后缀」的顺序 /
  `find` 空则不替换 / 都没填 = identity，并回归 `normalizeLabel` / `mergeOrder` / `moveBook`。
- **「头耳分离」的修复用 qlmanage 出图核对**（WebKit）：把兔子 / 猫头鹰的动画用
  「负延迟 + `animation-play-state: paused`」冻结在峰值那一帧（30% / 35%），新旧两版并排 ——
  旧版兔子整颗头右移脱离长耳、猫头鹰一角羽飞离头部，新版两者严丝合缝
  （`/tmp/pv/plushcompare.html.png`、只出新版的 `/tmp/pv/plushmanage.html.png`）。
- `/tmp/manage-check.ts`（`npx tsx` 跑；那份纯逻辑里 `import "./core"` 无扩展名，node 的类型擦除
  跑不了）→ **ALL OK：63 条** —— 顺序合并 / 隔板锚点 / 分区不重不漏 / 挪到第几位 /
  哪两本被挤扁 / 指针落在第几个缝 / 「任何一本拖到任何一个缝」的遍历不变量，
  外加「内核问不到时回落到本机」（脚本里没有 Tauri，正好走这一支）。
- `/tmp/manage-smoke.tsx` → **ALL OK：24 条** —— 隔板渲成宣纸标签、管理条每区带本数、
  **普通模式没有**管理条 / `data-row`、锤子与 `aria-pressed`、拖起来才出现的浮起卡片。
  （其中「普通模式没有隔板格」这一条后来被**推翻**了：隔板现在是常驻陈设，见下面
  「隔板常驻书架 / 可删 / 可跨屏拖」。）
- `/tmp/importflight-check.ts` → **ALL OK：46 条**（M2 的 11 条：落地屏 / 往哪边飞 / 终点在画外）；
  `/tmp/importflight-smoke.tsx` → **ALL OK：6 条**（跨屏那几本照旧渲出来、带 `.offscreen`）。
- 家族回归（`npx tsx`）：guide 109 / prefs 27 / theme 17 / shelf 36 / reader-smoke 12 /
  shelf-smoke 17 条，全部 ALL OK。
- **内核侧**（`../wreader`）：新增 `wreader/shelf.py`（265 行）+ `tests/test_shelf.py`（25 项），
  `pytest -q` → **743 passed**；`tools/check_docs` **OK**、`check_doc_numbers` **ALL OK**、
  `check_comments` **3825**。两份 README 与它自己的 memory-bank 都已同步（数字对拍过了）。

**踩到的两个坑**：
1. `shelfItems` 起初遇到「锚点那本书不在了」会把隔板**整块丢掉**，而 `regionsOf` 是把它算到
   最末 —— 两边对不上就会让隔板在界面上凭空消失。现在两边一致（都算最末），`manage-check` 钉住了。
2. `/tmp/node_modules` 那条软链被一次 `npm i`（在 `/tmp` 里跑的）换成了真目录，`react` 立刻
   解析不到、`tsc -p /tmp/tsconfig.json` 一片红。按 `/tmp/tsconfig.json` 写明的办法重建软链即可
   （旧的挪成 `/tmp/*.npm-install-bak` 留档）。

## 本次改动（2026-10-07，第五轮）：区名标签一区一枚 + 点一下选中、方向键排序

用户的三句话是这一轮的题面：**「在管理书架的模式下，每本书都不留白色书框，只在一个书区
（多本书下方的白色框架上）留一个标签就行。标签挂在最下方的书框上，就像是一个沾上去的白条
一样」**、**「拖动书排序的时候，允许直接选择一本书，再用键盘上下左右方向键调整顺序」**、
**「隔板也允许直接选择，再用键盘上下左右方向键调整顺序」**（「白色书框」= 书下面那段白挡板，
与第四轮是同一个说法）。

- **区名标签：一个区一枚**（`lib/shelfManage.ts` 的 `regionTails` + `views/Shelf.tsx` 的
  `regionTagByBook`）：只贴在这一区**最靠下那一本**（区内最后一本）下面那段白挡板上，
  其余书下面都留白 —— 一枚「沾上去的白条」就够了。取名尾那一枚的理由：书架一排排从左往右、
  从上往下读，区内最后一本正是这一区里位置最靠下的那一本。算的是**可见书目**：搜索过滤时
  这一区若只剩前面几本，名字落在「剩下那几本里最靠下的一本」上，不会整区没了名字；
  谁也没圈住的那一段（`id: null`）不贴。第四轮那张「每本书 → 区」的地图（`regionByBook`）
  随之删掉（它的活并进了 `regionTails`）。
- **方向键排序（书 + 隔板）**：
  - 新增 `ManagePick = { kind: "book" | "divider"; id }` 状态（`views/Shelf.tsx` 的 `picked`）：
    「手上拿着的那一件」，一次只有一件，再点同一件或 `Esc` 就是放开。
  - `nudgeStep(key)`：`←` `↑` = -1、`→` `↓` = +1、其余回 0 —— 书架是横着排的，上下与左右
    同义（四个键都用来调顺序，不用记哪个键才是横的）；判定抽成纯函数，键位才钉得住。
  - `shiftBook(order, id, step)`：在 `order` 里挪一位；已经在最前 / 最后就**返回同一个数组**
    （调用方据此知道「这一下没动」，不写盘、不重渲染）。
  - `shiftDivider(order, dividers, id, step)`：**一整对板**一起挪 —— 两头的锚点各前移（后移）
    一本书，于是「这一区管着哪几本」原样不变、只是整段换了地方（**与拖单块板不是一回事**：
    拖起始板是改边界）。起点已经在最前 / 终点已经在最末就**挪不动**（硬挪会把这一区挤出去而
    缩水）；终点越过最后一本 = `until: null`（右板收起来，与拖动同一套语义）。
  - 交互：点书脊（`BookSpine` 的 click，管理模式下原本是空动作）与点板子（`Divider` 的 click，
    原本是「选中这一区 + 就地改名」）现在都是**选中**；方向键优先归选中的那一件
    （**没选中时 `←` / `→` 照旧翻屏**）；挪完记一笔 `followPick`，渲染后的 `useLayoutEffect`
    按新的分屏翻到它那一屏（书按自己算，隔板按**起始板**那本书算，`before: null` 就是最后一屏）；
    书被删 / 封印、隔板被删时把选中放开；进批量编辑 / 退出管理模式也一并收掉。
  - **改名改从标签进**：板子上那枚标签（空区，`Divider` 的 `clickLabel`，拦掉冒泡免得又变回
    「选中」）与书下面那枚 `RegionTag`（有书的区）。板子从此只管「选中 / 拖」。
- **管理条**（`components/BookshelfManager.tsx`，404 → 429 行）：选中时多一枚
  「已选中「书名 / 区名」」胶囊与一枚「取消选中」，提示那行跟着换成
  「← ↑ 往前一位 · → ↓ 往后一位 · Esc 放开（放开后 ← → 才是翻屏）」。
- **样式**（`styles/manage-mode.css`，870 → 915 行）：`.study.manage .spine-card.picked .spine`
  （抬起来 + 暖色描边，与批量编辑「勾上」同一套语言）、
  `.study.manage .shelf-divider.picked .divider-board`（两道薄板一起亮）、`.manage-picked` 胶囊；
  区名标签那一段注释改成「一区一枚，贴区内最后一本」。
- **验证**：`npx tsc --noEmit` exit 0、`npm run build` ✓（JS 348.79 kB / CSS 83.20 kB）；
  `/tmp/paget-check/pickmain.ts` **44 条**全过（`nudgeStep` 四个键 + 别的键不认、
  `shiftBook` 的头 / 尾 / 不在架上**同一个数组**、`shiftDivider` 的整区挪 · 空区一起走 ·
  贴到两头挪不动 · 别的隔板引用不变 · 挪完分区照旧算得出来、`regionTails` 的每区一枚 ·
  过滤后落点 · 未分区不贴 · 整架一区只贴最末）；旧的 `pairmain.ts` **31 条**、`main.ts`
  **17 条**仍全过；`/tmp/paget-key/pick-smoke.tsx` **13 条**（SSR：`picked` 只在管理模式下出现、
  板子话术改成「点板子则选中」、空区标签仍是按钮、管理条默认提示写着方向键、一进来没有选中）
  与旧的 `pair-smoke.tsx` **22 条**全过。
  **没能验的**：书架那一层「`regionTails` 的结果贴到某一本上」只能在纯函数层钉住 —— SSR 拿不到
  布局（`readLayout()` 在 effect 里，SSR 跑不到），真机上请看一眼「区内只有最后一本下面有白条」；
  方向键的手感（每挪一位自动翻屏跟不跟得上、`↑` `↓` 与 `←` `→` 同义别不别扭）也要你在浏览器里试。
  另外 `pair-smoke.tsx` 里那条检查的**文案**现在只对了一半（「点它 = 选中 + 改名」应为
  「点它 = 选中；改名走标签」），断言本身（板子照旧画出来）仍然成立，那份临时脚本没动。

## 本次改动（2026-10-07，第四轮）：隔板成对（起止两块板）+ 区名贴到书下面那段白挡板上

用户的两句话是这一轮的题面：**「添加的隔板，应该是一次添加两块」**、**「重命名的『标签』贴在
隔板之间的白色书框上；如果隔板之间间隔一个以上的书框，则每个白色的书框都会自动显示一个『标签』」**
（追问后确认「白色书框」指的是**书下面那段白挡板**）。于是把「一块板管一个区的左边界」改成
**「一块隔板 = 一对板」**，区名也从板上搬到书下面的挡板上。

**为什么必须动内核的数据结构**：旧模型里「区到哪儿为止」是靠**下一块板**推出来的 ——
于是最后一段永远没有右边界，标签也只能挂在板上。补一个右锚点之后，一块隔板就是一个**封闭的区**。
两条路都问过用户，选了「改内核」这条（另一个选项是界面侧塞两条同 id 的记录，会被终端
`werd shelf` 当成两块各自独立的隔板）。内核侧改动见 `../../wreader/memory-bank/activeContext.md` ㊹。

- **数据（`shelf.json` 的 `dividers`）**：每块多一个 `until`（结束板挂在哪本书前面）。
  `until: null` / **缺字段**（老布局）= 这一区一直到书架末尾、**右边不立板** —— 老数据读出来
  与从前逐字一致：`regionsOf` 换成「区 = `[before, until)`，谁也没圈住的书回「未分区」，
  两区重叠时**起点靠后的那一对认领**」，对老数据（每块板 `until` 都是 null）算出来的分区
  与旧模型「后一块板接管右边那一段」逐字相同（📌 有了这一条，升级之后书架长得和从前一样）。
- **`lib/shelfManage.ts`（482 → 589 行）**：`ShelfItem` 多认 `role`（`DividerRole = "open" | "close"`）；
  `shelfItems` 把一对板分别落在 `before` / `until` 两处（**同一处先立结束板、再立起始板** ——
  两区交界处是背靠背的两块），`until === null` 那块不画；`ManageDrag` 变成「书 | 隔板（带 role）」
  的判别式联合；新增 `isDragged`（一对板共用 id，落点判定得连 role 一起比）、
  `addDividerAnchor`（＋隔板插哪儿：这一屏最后一本之后；已经是最后一本时退到**它前面**，
  否则右板会落在书架外头）、`newDividerPair`（起止同处 = 并排的空区）；`moveDivider` 多收一个
  `role`（起始板改 `before`、结束板改 `until`），并**不许两块板互相穿过**：越界就把这一区收成
  空区（贴在另一块板那儿），结束板拖到书架最末 = 收起右板。
- **`components/RegionTag.tsx`（新，73 行）**：贴在书下面那段白挡板上的区名小标签。
  区内的书**每本一枚**（同一区同名）；普通模式是一枚静态陈设，管理模式下点一下 = 选中这一区
  （**不切换** —— 点它就是为了改名）+ 就地改名。它长在书脊那个 `<li>` 里，所以按下 / 点击
  都 `stopPropagation`（不然会把书拖起来或打开）。
- **`components/useLabelDraft.ts`（新，55 行）**：板上的标签与书下面的小标签共用同一段
  「点一下 → 变输入框 → 回车 / 失焦保存、`Esc` 取消、空着落回未命名区域」的状态机。
- **`components/Divider.tsx`（155 → 151 行）**：现在只画**一块板**（起始 / 结束），
  空区才带那枚宣纸标签（有书的区名字已经贴在书下面了，板上不再重复）；点板子 = 选中 + 就地改名；
  板下那枚 ✕ 删的是**一整对**；`onGrab` 连 `role` 一起交出去。
- **`views/Shelf.tsx`（2,305 → 2,395 行）**：`emptyRegionIds`（哪些区没圈到书 → 名字落在板上）、
  `regionByBook`（书 → 区，值是 `manageRegions` 里的对象本身，**身份稳定**，不给 `memo` 的书脊
  添乱）、`selectRegion`（不切换的选中）+ 两个稳定回调（`activateRegion` / `renameRegion`，走 ref）；
  `addDivider` 改成 `newDividerPair(addDividerAnchor(...))`；拖拽那一路认 `role`。
- **`styles/manage-mode.css`（827 → 870 行）**：`.region-tag` / `.region-tag-text` / `.region-tag-input`
  —— 一格宽的小纸片（`height: 0.95rem`、`font-size: 0.56rem`、纸纤维 + 一道水痕，与板上那枚标签
  同一块调色板），**整枚留在格子内**（`.study .shelf` 是 `overflow: hidden`，探出格子一角会被裁掉）；
  选中那一区在名字前盖一枚朱印。`App.css` 给 `.study .spine-card` 补了 `position: relative`（它是
  这枚标签的定位基准；顺手也把选择模式那枚勾选圈的基准摆回格子内）。
- **管理条文案**：`＋ 隔板` 的提示改成「插一对并排的隔板（再拖开，圈住想归到这一区的书）」，
  排序态的提示改成「点书下面那枚小标签改区名」，胶囊里 `id: null` 那一个改成
  「没被任何区圈住的那些书」（旧文案还写着「第一块隔板之前这一段」，那套边界已经没了）。
- **验证**：`tsc --noEmit` exit 0、`vite build` ✓（JS 345.8 kB / CSS 82.51 kB）、
  `/tmp/paget-check/pairmain.ts` **31 条**全过（一对板的两处落点 / 并排的空区 / `until: null`
  不立板 / 老布局逐字照旧 / 重叠时后起的认领 / 两块板各自的拖动与夹紧 / ＋隔板的落点 /
  `isDragged` 分不分得清两块板），旧的 `main.ts` **17 条**仍全过（书序那一路没动）；
  `/tmp/paget-key/pair-smoke.tsx` **22 条**（SSR 渲染两个组件：role 进 class、空区才带标签、
  ✕ 只删一整对、普通模式静态）全过；`/tmp/pv/pair.html` 与 `pair2.html` 用真 CSS 出图看过一眼
  （qlmanage PNG：标签贴在书脚、朱印在名字前、并排的一对与老布局照旧）。
  **没能验的**：起不了图形窗口，真机的拖拽手感、标签在窄书脊上会不会挤、`until: null`
  那次「右板消失」是否让人困惑，都要你在浏览器里看一眼。

## 本次改动（2026-10-07，第三轮）：键盘快捷键（管理书架 · 统计 · 成就 · 设置）

用户要「管理书架、成就、统计、设置各配一个键盘快捷键」。四个键都是**单键**（与这里已有的
`/` 搜索、`←` `→` 翻屏同一套手感，手不用离开主键区）：**`M` 管理模式 / `S` 统计 / `A` 成就 /
`G` 设置**（`G` = 齿轮那一页，默认落在「设置」标签）。

- **键位表只有一份**（新文件 `src/lib/shortcuts.ts`）：`SHORTCUTS` + `shortcutFrom`（哪一个键算数）
  + `shortcutKey`（屏上印大写）+ `isTypingTarget`（输入框里不抢键）+ `pageKeyAction`（挂件页里按键
  该做什么）。处理器与界面提示（挂件 / 锤子的 `title`、返回按钮的 `title`）都读它，免得两处写拧。
- **判定与落地分开**：`App.tsx` 那段只剩三行 setState —— 「哪个键算数、什么时候不算数」全在纯函数里，
  于是 node 里钉得住（42 条断言）。规矩：带 `⌘` / `Ctrl` / `Alt` / `Shift` 的一概不算（留给系统）、
  **长按重复不算**（否则 `M` 会把锤子切来切去）、焦点在输入框 / 文本域 / contentEditable 里不算
  —— 只有 `Esc` 例外（它没有「在输入框里」的语义）。
- **书房（`views/Shelf.tsx`）**：`M` = 那把锤子（`toggleManage`），`S` / `A` / `G` = 三个挂件的回调；
  界面开着东西时（搜索遮罩 / 过场 / 右键菜单 / 弹窗 / 换玩具的面板 / 正在拖）一律不抢 ——
  复用现成的 `overlayOpen`。悬停提示里带上键：「统计（按 S）」「成就（按 A）」「设置与数据（按 G）」
  「管理模式：…（快捷键 M）」（进了管理模式就变成「完成…」）。
- **挂件页（`App.tsx`）**：四个键都是**「去哪儿」**——`S` / `A` 切到统计 / 成就，`G` 切到设置
  （并把齿轮里的页签拨回「设置」：从「数据」页按 `G` 也是切标签，不会把人送回书架），`M` 回书房并
  直接进管理模式；**回程统一交给 `Esc`**（三个返回按钮的提示都补上了「（Esc）」）。为此 `Desk`
  的页签改成**受控**（`tab` / `onTab` 从 `App.tsx` 来）—— 页签藏在组件里的话，按 `G` 只能整页
  关掉再打开，语义就拧了。
- **顺手补的一件事**：锤子原来在「去统计页看一眼再回来」时**会丢**（书房被挂件页顶掉就重新挂载，
  `managing` 是它自己的 state）。现在 `App.tsx` 记着它：`Shelf` 新收两个可选 prop
  `initialManaging`（挂载那一次读）与 `onManageChange`（开 / 关都往外报），于是回来时手里还拿着锤子，
  而 `M` 从挂件页回书房也就是 `setManaging(true) + setOverlay(null)` 两行。
  （`initialManaging` 在 SSR 里看得见 —— 见下面那条冒烟。）

**验证**：`npx tsc --noEmit` → **exit 0**；`npx vite build` → ✓（JS 343.17 kB / CSS 81.06 kB）。
- `/tmp/paget-key/check.ts` → **ALL OK：42 条**（`node` 直接跑，走 node 自带的类型擦除）：
  四个单键与大小写 / 修饰键与长按不算 / 别的键一概不算 / 键位表自身一致性 / `isTypingTarget` 六种目标 /
  `pageKeyAction`（`Esc` → 回书房、`M` → 回书房进管理模式、`S` / `A` / `G` → 切页）。
- `/tmp/paget-key/smoke.tsx` → **ALL OK：23 条**（SSR 渲染冒烟）：三个挂件与锤子的提示里都带着键、
  挂件自己的标签没被顶掉、**`initialManaging` 真的让根节点带上 `manage`**（且默认不带、管理条只在
  管理模式里出现）、三个挂件页的返回按钮都写着「（Esc）」、**齿轮页签受控**（`tab` 说哪个亮就哪个亮、
  只有一个亮、挂的是对应那一段）。
- 跑法变了：仓库里**没有装 `tsx`**（`npx tsx` 会去网上找、离线环境下会卡住），所以纯逻辑脚本改成
  `node /tmp/paget-key/check.ts`（那份 `shortcuts.ts` 没有任何 import，正好够用），
  渲染冒烟改成「仓库自己的 vite 打一个临时 SSR 包」：`cp /tmp/paget-key/smoke.tsx <repo>/smoke/` →
  `npx vite build --ssr smoke/shortcuts-smoke.tsx --outDir smoke-out` → `node smoke-out/shortcuts-smoke.js`
  → 删掉这两个临时目录（跑完 `git status` 里不该多出东西）。

## 本次改动（2026-10-07，第二轮）：隔板常驻书架 / 可删 / 可跨屏拖

用户验收时提的两条：「退出管理书架模式之后，隔板也不见了」「隔板本身也可以删除、挪动到其他屏幕的书架上」。

- **隔板常驻**：`items` 改成两种模式都算隔板（只有**搜索过滤**时不画），`Divider` 多一个
  `managing` 开关 —— 普通模式渲染成**静态陈设**（薄板 + 标签都在，`cursor: default`、没有 ✕、
  不响应指针），管理模式下才可改名 / 拖 / 删。批量编辑（`selecting`）时传 `managing && !selecting`：
  那会儿只操心书，免得挨着书的 ✕ / 标签被顺手点到（拖动那一路本来就被 `armDrag` 挡着）。
- **可删**：薄板下部一枚小 ✕（指着这块隔板时才亮起来），`removeDivider` 只从 `dividers` 里摘掉它、
  并把选区一并清掉 —— **书一本不动**（顺序、位置都不变），那一区散回「未分区」。
- **可跨屏拖**：不再用本地 `dx`（一翻屏隔板的 DOM 就换了，指针捕获会丢），改走**与拖书同一条管线**：
  新类型 `ManageDrag`（`kind: "book" | "divider"` + id + 浮起卡片上写的字）穿在 `dragging` 里，
  `grabBook` / `grabDivider` 共用 `armDrag`，`dropDrag` 按 `kind` 分叉 `moveBook` / `moveDivider`；
  `BookshelfManager` 的 `drag` 收这个统一对象，浮起卡片在拖隔板时改画成一枚**窄宣纸标签**。
  **顺带修掉一个潜伏的错位**：`measureSlots` 只量 `[data-slot]`，而隔板以前没有 `data-slot` ——
  于是书架上有隔板时「落点缝号」会与格子序列差一位（比如把一块隔板拖到排尾会落错地方）。
  现在隔板也带 `data-slot`（只管理模式写，普通模式不量坐标）。

**验证**：`npx tsc --noEmit` → **exit 0**；`npx vite build` → ✓（CSS 81.06 kB，此前 79.92 kB）；
`/tmp/paget-check/divmain.ts`（与一个 `core` 桩一起编成 CJS、node 跑）→ **PASS 20 条**：
两种模式都占格 / 搜索过滤摘掉隔板 / `gapInRow` 的缝号与格子序列一一对齐 / 拖隔板到最左 - 原位 -
跨区 - 排尾 / `anchorAt` 跳过正被拖的那块自己 / 拖书的 `orderIndexAt` / `squeezeIds`（拖隔板挤两侧的书、
拖书时跳过自己）/ 删隔板后**书序不动**且那一区回到「未分区」/ 锚点那本书没了隔板落到最末；
老断言（`/tmp/paget-check/main.ts`）**17 条**照旧全过。样式用 `qlmanage` 出图核对：
`/tmp/pv/d1.html.png`（普通模式的隔板）、`d2.html.png`（管理模式的 ✕ + 正被拖走的化淡）、
`d3.html.png`（拖隔板时跟着指针的那张浮起卡片）。

## 本次改动（2026-10-06）：导入飞行动画 M1 —— 新书从藤条篮子一本本飞上书架

导入完不只是一行「新增 N 本」的回执了：**这一批新书的封面会从篮口飞向各自的格子**，
配一张计数器便签，能跳过。分四段（`src/components/ImportFlight.tsx` + `src/lib/importFlight.ts`）：

- **阶段机**（仿 `BookTransition` / `SealDissolve`：回调进 ref + 计时器只依赖 `phase`）：
  `stack`（篮口先摆出这一批的封面，`STACK_MS` 520ms）→ `flying`（逐本起飞、逐本落地 +1）
  → `settling`（全部归位，计数器停留 `HOLD_MS` 1500ms 再淡 `COUNTER_FADE_MS` 420ms 收场）。
- **节奏随数量调**（`flightSchedule`，纯函数、临时脚本钉住）：1 本直飞无计数器；
  2–5 本每 `300ms` 一本；6 本以上加密到 `150ms` 并把单本飞行提速 20%（`FLY_MS 800 → 640`）。
  —— 排队等待不该随数量线性变长（十本一本挨一本要十几秒，没人愿意站着看）。
  10 本以上暂时仍走 6+ 那一档（每 3 本并行起飞是后面的里程碑）。
- **飞行物三层各管一个 transform 维度**（同元素上叠两个 keyframes 会互相覆盖）：
  `.import-fly` 位移（起飞点 → 落点，走直线）/ `.fly-arc` 上拱 + ±5° 轻微旋转 /
  `.fly-card` 缩放（升起 `0.3→1` 300ms，落地弹性 `1.2→1` 200ms + 亮一下化掉）。
  坐标 / 延迟 / 三段时长全由 TSX 算好塞进自定义属性（与 `.book-stage` 的 `--fly-x` 同一套做法），
  `@keyframes` 里**不写死任何坐标**；起飞点 = 篮口正中（`.basket` 那个盒子的 55.4% 处，
  与 CSS 的篮子 5.6rem / 篮身 2.5rem 是一对），落点 = 书脊正中，顶点抬 `max(18px, 高低差×0.28)`。
- **落点必须等 DOM**：书脊是父组件这次提交才画上去的，所以量落点在 `useLayoutEffect`
  （提交之后、画之前，第一帧就带着坐标、不会看见「从篮口跳到书脊」），而且**只量一次**（`measured` ref）。
  量不到（这本书落在别的屏上）那一本**直接归位、不飞**，计数照算 —— 跨屏飞行留待后续。
- **飞行物只是过场、不改数据**：书在飞之前就已经在架上了（父组件 `await onSync()` 之后才起动画），
  所以不需要隐藏真书脊、也不需要跨屏翻页。`App.refresh` 因此改成**返回刷新后的书单**
  （`onSync: () => Promise<BookRow[]>`，出错回 `[]`），`Shelf.doImport` 拿它和导入前的 id 集合
  一比就得到「刚进来的那几本」；起飞点也在导入**之前**量好（导完书架会重排）。
- **跳过**：整层 `position: fixed` 的透明遮罩 `onClick` + `Esc` —— 剩下的书瞬间全部归位，
  计数器直接显示 `N/N`，照常停留 1.5 秒淡出。
- **计数器**：一张贴在篮口正上方 60px 的便签（米白纸 + 墨边 + 歪 1.4°），数字换一个就重挂一次
  （`key={landed}`）所以是「滚」进来的；一本时不出现。篮子贴着屏幕左边，所以中心往右夹一道
  （`COUNTER_MIN_X` 78px），别半个身子探出窗外。
- **开关**：**设置 → 书架 → 导入飞行动画**（`gui_settings` 的 `shelf.import_flight`，
  `normalizeImportFlight` 只认明确的 `"off"` 才算关，其余一律当开、与「动态书脊厚度」同一套做法）。
  关掉就完全不建这一层（`doImport` 里判）。

**验证**：`npx tsc --noEmit` exit 0、`npm run build` 成功；
纯函数 + CSS 变量对账用 `node /tmp/importflight-check.ts`（35 条断言：节奏取值 / 坏值夹回 /
TSX 给的 CSS 变量与 App.css 真正读的**逐一对得上** / 九个 `@keyframes` 都挂上了 /
卡片负偏移正好是尺寸的一半 / 篮口比例与 `.basket` `.bk-body` 对得上）；
外观用 qlmanage（= WebKit）出图逐帧核对（`/tmp/pv/flight2-{a..d,z1..z3}.html.png`）。

**两个坑**（下次出图别再踩）：①**qlmanage 不跑 JS** —— 想让页面自己量 rect 再写进 CSS 变量是白费，
`.dbg` 是空的、封面停在写死的 fallback 坐标上；②`animation-delay: calc(var(--x) - var(--freeze))`
那种「冻结」写法**在 WebKit 出图里不生效**（停在 0% 帧），要直接把负延迟写在元素上；
另外入场动画（`opacity: 0` 起手）与数字那条 `counter-roll` 都会让快照拍到「看不见」的那一帧，
预览里得 `animation: none` 掉。

## 本次改动（2026-10-06）：书架头一格「＋导入」换成一只藤条篮子（一本书 + 几张残页 + 提手）

用户提的一条：「将书架上左边的『+导入』，替换成『放了一本书，和一些残页，带把手的藤条篮子。』」
**功能一个字没改** —— 那格还是导入入口（点它照样弹系统文件浏览器），换掉的只是这一格的画法：
原来那圈虚线空书位 + 「＋ / 导入」两行字，现在是一只纯 CSS 画的静物。

- **按钮变成透明的**：`.add-book` 去掉边框 / 底色 / 阴影，`justify-content: flex-end` ——
  篮子坐在格子底下（与书脊同一条架面），上面那片空档留着透出墙面。
  `.spine-card.add-slot` 仍是 `height: 12rem`，宽度仍是 `SPINE_MIN_REM`（4.2rem）：
  **这个宽度是 `packShelfRows` 的 `firstRowExtra` 算进去的**，不能随手加宽
  （否则一排会多算一本、右端那本被 `.study .shelf { overflow: hidden }` 裁掉）；
  篮子自己画成 3.6rem 宽，装在格里正好。
- **篮子是七层叠出来的**（DOM 顺序 = 遮挡关系，全部绝对定位在 `.basket` 里）：
  `提手 → 书 → 三张残页 → 篮身 → 篮口收边`，外加 `.basket::after` 那道落在挡板上的接触影。
  后画的挡住先画的，于是书与残页是「从篮口探出来」的，提手则是挂在**后沿**上
  （它两条腿的下半截也正好被收边压住）。
- **篮身**：`clip-path: polygon(2% 0, 98% 0, 88% 100%, 12% 100%)` 切出「上宽下窄」的编筐；
  藤条 = 竖藤（亮）+ 横编（暗）两层 `repeating-linear-gradient`，再叠一道上下渐变当明暗、
  左右两条内影把圆口做出厚度。**`clip-path` 会连 box-shadow 一起裁**（老坑，见留声机那条）——
  所以撕了口的那张残页改用 `filter: drop-shadow`（阴影跟着形状走），而不是 box-shadow。
- **提手一定得高过书与残页**：第一版提手 2.2 × 1.7rem，被书和残页盖得只剩一条边，
  出图才发现「看不出有把手」→ 篮子整体加高到 5.6rem、提手 2.5 × 2.7rem
  （弧顶顶到 4.8rem，而书顶 3.85rem、最高的残页 3.35rem），把手这才一眼看得见。
  提手四边深浅不同（左上亮、右下暗）= 光从左上来，与全屋的光照方向一致。
- **提示小字平时藏着**（`.add-hint`，`opacity: 0`）：这一格要的就是「摆着一只篮子」这个画面；
  鼠标移上去 / 键盘聚焦 / 正在导入时才浮出来（浮在格子上半段），免得这只篮子看着不像能点。
  原来那两行「＋ / 导入」没了，语义改由 `title` 与 `aria-label` 带（`导入电子书` / `导入中…`），
  小字本身 `aria-hidden`。
- **「导入中」的表达重做**：原来是「虚线框 + 半透明」，现在改成**篮子轻轻起伏 + 篮口透出暖光**
  （`basket-busy` 1.5s），并且**不把它压暗**（覆盖 `button:disabled` 的 `opacity: .5`）——
  忙碌感全在那两下动效上。键盘聚焦也不再描整个 12rem 高的格子，改描篮子自己（2px accent、offset 2px）。
- **夜里**：`.study.night .basket { filter: brightness(0.78) saturate(0.95) }`（它站在幕布之下）+
  篮口收边补一圈暖光；hover / 导入中那两条夜里各有一条 `filter` 覆盖，免得光晕被压暗吃掉。
- **顺带把「＋」这个说法清干净**：`Shelf.tsx`（8 处注释 + 空书架那行提示）、
  `lib/shelfLayout.ts`（3 处）、`lib/core.ts` 与 `views/Data.tsx`（英文注释
  `the shelf's "＋" button` → `wicker-basket button`）、`README.md`（两处；顺手把 README 里
  过时的「竖着立的黑胶唱片」改成「靠在留声机木箱侧面的一叠」）。
  空书架提示现在是「点书架左边那只藤条篮子导入电子书」。
- 验证：`npx tsc --noEmit` exit 0、`npm run build` 成功；`qlmanage` 出图
  （`/tmp/pv/basket.html.png` 白天 / 夜里两排、`/tmp/pv/basketzoom6.html.png` ×6 细节 + 旁边一本书当基准、
  `/tmp/pv/basketstates.html.png` ×4 的 hover / 导入中两个状态）。放大截图这次踩了一个新坑
  （已记在下面「会话级注意事项」）：内层 `transform-origin: 0 100%` 的盒子若是普通流 div，
  会先溢出裁剪框、原点落到框外，出图变成「篮子下半截 + 一片空墙」。

## 本次改动（2026-10-06）：书架毛绒玩具只留三只 + 猫头鹰改成「头身分色」

- **玩具名单从 5 只收到 3 只**（`views/Shelf.tsx` 的 `TOYS`）：删掉小猫、小狗，只留
  **兔子 / 猫头鹰 / 乌龟**；`App.css` 里 `.plush-cat` / `.plush-dog` 两整段塑形样式随之删掉，
  原来那条 `.plush-rabbit .plush-ear::after, .plush-cat .plush-ear::after` 的共享规则
  收回成兔子专用。**没做数据迁移**：`readToy()` 本来就「只认名单里的 id」，
  老存档里存着 `cat` / `dog` 的会回落成兔子（`TOYS[0]`），不必清 localStorage。
- **猫头鹰不再头身同色**（用户反馈「猫头鹰头身颜色一致，要有真实猫头鹰那种头身不一的感觉」），
  全部在 `.plush-owl` 一节里改，几何尺寸一律没动：
  - 身子 / 翅膀 / 尾巴 / 爪子走 `--plush-hi/mid/lo`，从原来的浅暖棕**整体压深一档**
    （`#c2a173 / #97764c / #64492b`，原来是 `#ecd9b6 / #cbaa76 / #a3803f`）；
  - 头另立两套变量：`--plush-face-hi/mid`（奶油色面盘）与 `--plush-crown-hi/mid/lo`（深色冠羽）。
    `.plush-owl .plush-head` 用三层 `background-image` —— 绒点纹理 + **浅色面盘**
    （`radial-gradient(ellipse 46% 60% at 50% 72%)`，中间奶油、外沿化开并留一圈深色描边）
    + 深色冠羽底，于是「脸浅、背深」一眼分得开；**那对角羽**也跟着冠羽走色（不再跟身子同色）；
  - 另外两处补丁：**翅膀上横着一道道的羽纹**、**胸口浅底竖羽纹**（`--plush-belly` 浅一档、
    `opacity: 0.85`）。**眼睛不做单独造型**：第一版试过「琥珀色大眼 + 深色眼圈」，
    **用户否掉**（要求「和兔子一样的眼睛」）→ 删掉那三条覆盖、直接用共享的 `.plush-eye`；
    为此把 `--plush-ink` 对齐成 `#46311f`（与其他动物同一支墨色，喙也跟着它），
    于是猫头鹰的眼睛与兔子**逐字节一致**。
- 验证：`npx tsc --noEmit` → exit 0；`npm run build` → 成功。
  **外观已经截图验证过了**：本机没有无头浏览器，但 **macOS 自带的 `qlmanage` 就是 WebKit**，
  用它把「内联了 `dist/assets/index-*.css` 的临时 HTML」出成 PNG 就能真看效果
  （做法见下面 2026-10-06 那条「怎么截图看外观」）。靠这招发现并修掉一个 WebKit 渲染坑：
  头上一开始加了 `box-shadow: 0 0 0 0.06rem rgba(72, 51, 28, 0.35)` 当描边，
  **WebKit 在百分比椭圆圆角上会把 spread 阴影按矩形画出来** —— 放大后头周围浮出一圈
  淡淡的方框；现已删掉（只留原来的内阴影，观感不变）。

## 本次改动（2026-10-06）：留声机喇叭从「口朝左的侧视图」改成「斜 45° 支出来、口朝屏幕」

用户提的一条：「留声机的喇叭口对着屏幕的斜 45 度角，而不是朝着左边」。
改的几乎只有 `App.css` 里留声机那一节，`Shelf.tsx` 只删掉一个 `<span>`：

- **喇叭改成斜 45° 的锥子**：容器自己仍旧「口在左、喉在右」横着画，
  再用 `transform-origin: 100% 50%` 绕**右端中心** `rotate(45deg)` 转上来 ——
  那个点就是伸进木箱里的**轴心**（容器摆 `left: 0 / top: 2.1rem`、4.75 × 2.6rem，
  于是轴心落在 x=4.75rem、离架面 0.5rem 处，正在木箱内部）。
  转完喇叭从木箱左上角探出来、尾段被木箱挡掉（DOM 里木箱仍排在喇叭后面），
  而且**锥子的下沿正好咬在木箱左上角**（到 x=2.7rem 处恰好是 1.55rem ＝ 木箱顶面），
  看着就是「从箱子里支起来的一支喇叭」；探出木箱的那一段（沿轴线）约 2.6rem。
- **口沿是个「宽高比 = cos45°」的椭圆**：`::after` 画 **1.84 × 2.6rem**、
  `border-radius: 50%`（0.707 ≈ cos45°）—— 正是「口平面与屏幕成 45° 斜角」时该看到的那个扁口。
  里侧的黑口 + 一圈亮铜口沿全画在 `radial-gradient` 的色阶里
  （`#1a1007 0 44%` → `#8a6330 72%` → `#f2e0b0 90%` → `#b98b44 100%`），
  另叠一层偏下的暖铜光当「碗」的内壁。
- **外轮廓 `polygon` 得沿椭圆左半圈取样**（15° 一个点、共 19 个折点）：
  因为 **`clip-path` 会把子元素一起裁掉** —— 只留 `0 0 / 0 100%` 两个角的话，
  圆口会被切成方的，而且口沿那道亮圈正好被切掉。
  这与上一版踩到的「`clip-path` 会连 box-shadow 一起裁」是同一族坑。
- **`.g-arm` 整段删掉**：喇叭改斜支之后，那根铜杆的位置落在木箱内部、整根看不见，
  留着只是一根隐形的杆 —— CSS 删净，`Shelf.tsx` 里的 `<span className="g-arm" />` 也删。
- **木箱（`.g-base`）一个字没动**：它的位置是「木箱右侧面 = 唱片那一格 li 左边缘」
  那条链的锚点，所以黑胶那叠零位移。
- 验证：`npx tsc --noEmit` exit 0、`npm run build` 成功；`qlmanage` 出图
  （`/tmp/pv/horn.html.png` 全景 + ×4 + ×6、`/tmp/pv/hmeasure.html.png` 带参照线、
  `/tmp/pv/rack2.html.png` 白天 / 夜里两版）。
  中间**否掉过一版「短喇叭」**（锥长 3.6rem、口 2.25rem、铜圈只占 13% 半径、黑口到 58%）：
  出图像个「黑气球挂在铜锥上」，于是锥子加长到 4.75rem、口沿铜圈加厚到 28% 半径、
  黑口收到 44%，这才读得出「喇叭」。

## 本次改动（2026-10-06）：摆件架三件事 —— 留声机横躺 / 一叠黑胶侧着靠上去 / 台灯挪到最右

用户提的两条。改动都在 `views/Shelf.tsx` 的摆件栏与 `App.css` 对应的几节：

- **留声机 = 横躺的木箱 + 一支从木箱左上角斜 45° 支出来的锥形喇叭**：格子 7.6 × 3.9rem，
  宽扁木箱（`.g-base` 4.7 × 1.55rem）在右半边、木箱右脸压在 x=7.4rem 上（= 下一格 li 的
  `margin-left: -1.8rem` 的锚点，所以留声机与黑胶是一组的）。喇叭不再是「口朝左的正侧视图」
  —— 它绕自己的右端中心转了 45°、口朝屏幕斜着张开（细节见上面那节「留声机喇叭改成斜 45°」）。
  原来撑喇叭的那根铜杆（`.g-arm`）已经删掉。
- **黑胶唱片 = 「侧过来看是一片薄片」的五张一叠，斜靠在留声机木箱的右侧面上**。
  这中间**否掉过一版**：第一版是「同一颗 6rem 圆盘 `rotate(-4deg) scaleY(0.45)` 压扁 = 斜躺」，
  用户说「不是要斜躺，而是横过来成一个薄片靠在留声机上，为了增加视觉度，可以是有四五张唱片堆在一起」。
  现在的做法：`li.vinyl` 里**五个 `.v-disc`**（`Shelf.tsx` 里五条 `<span className="v-disc" />`），
  每张是 **0.38 × 3.4rem 的竖长椭圆**（≈1:9，盘面几乎看不见），五张**近乎平行**地摞着：
  `transform-origin: 50% 100%`（压在下沿）+ `rotate(-9°…-13°)`（贴着木箱那张最立、往外每张多歪 1°）
  + `left: 0.37 / 0.55 / 0.73 / 0.91 / 1.09rem`（每张错开 0.18rem）。
  于是**下沿扇形散开**（一眼数得出是五张）、**上沿齐平**；`left` 是按「最里面那张的顶端
  落在 x≈0.03rem」反推出来的 —— 而 **`li` 的左边缘就是木箱的右侧面**，靠一个负边距钉住：
  `margin-left: -1.8rem`（架子每格间隔 1.6rem，往左拉回 1.8rem，多出的 0.2rem 让最里那张
  略微压上木箱），整叠就真的「倚」在木箱上，顶上那截探出箱顶（箱 1.55rem、碟 3.4rem）。
  单张盘面三层 `background-image`：一条**细横线 = 侧着看到的琥珀色标签边**、极淡竖条纹 = 盘纹、
  `linear-gradient(90deg, #5a5a5a 0 18%, …)` 左边那 18% 是**每张露出来时看到的那条受光盘边**
  （错开 0.18rem 露出的正是它，所以五张分得开）。旧的一整段（6rem 圆盘 + `.v-label` + `.v-hole`）删净，
  `title` 改成「黑胶唱片 ×5」。
- **台灯挪到这一排的最右边**：DOM 里从「第一件」搬到**最后一件**，CSS 里给它
  `margin-left: auto` —— 剩下的空间全留在它左边，前面摆几件、多宽都不影响，
  它永远贴着架子右端。
- **跟着灯走的两处光**（不然「灯在最右、光还在最左」就穿帮了）：
  `.shelf-rack.decor::before`（装饰架上灯脚那一小块）与 `.shelf-rack.books::before`
  （漏到下层书脊上的那块），坐标从 `at 2.3rem 92%` 这种左偏写法
  镜成 `at calc(100% - 2.3rem) 92%`。
- **层级补丁**：灯排在玩具**右边**之后，`.decor-item` 的 `filter` 各自成层 ——
  玩具那格的 `z-index` 必须高过灯的 6，否则「换玩具」的弹出面板会被灯挡住；
  基础规则与 `.study.night` 那条都提到 **7**。

**怎么截图看外观（以后改纯 CSS 的物件都能用）**：本机没有无头浏览器、也不用装，
**macOS 自带的 `qlmanage` 就是 WebKit**：写一个临时 HTML，把
`dist/assets/index-*.css` 内联进 `<style>`，再接上要看的标记，
`qlmanage -t -s 1200 -o /tmp/pv /tmp/pv/x.html` → 同目录得到 `x.html.png`。
摆件架全景、×3 / ×6 放大的单件、夜里那套光照都是这么看过的。

**尺寸对不对得靠参照物，不能靠眼睛**（缩略图上看比例会骗人）：放大的临时 HTML 里
给它一套「坐标系参照」——把 `li.vinyl` 的左边缘画成红线、再按「li 左边缘 = 木箱右侧面」
反推木箱的虚线框；出图后**红线与虚线框严丝合缝**，就证明那叠碟片真的搭在木箱上。
基线同理：把 `.decor-shelf` 的 **content-box 底边**画成红线、给 `.g-base` 加 `outline`，
可以直接看出「碟片底」和「木箱底」是不是同一条架面。

喇叭改斜 45° 那次也是这么量的：把木箱顶边（`bottom: 1.55rem`）与左边线（`left: 2.7rem`）
画成红线、把喇叭容器**未旋转时**的框画成蓝色虚线、再把轴心点上绿点 —— 出图后
「锥子下沿正好咬在两条红线的交点」且「绿点落在木箱内部」，就说明它真的从箱子里支出来、
尾段被挡干净了（`/tmp/pv/hmeasure.html.png`）。

**改 CSS 里成段的中文注释要留神**：`editor` 工具对多行中文 `old_text` 常常匹配不上，
而 `read_files` 吐出来的文本偶尔还会**少一个字**（实测把「低而宽」后面那个「的」吞掉过，
于是照着读到的文本去匹配必然失败）。现在的做法：**写一个带断言的 node 脚本**
（`old` 命中次数必须 = 1，否则报错跳过），改完再用 `git diff` / `sed -n` 复核
（脚本在 `/tmp/pv/patch*.mjs`、`/tmp/pv/memo.mjs`）。


## 本次新增（2026-10-05）：「属性」面板可编辑元数据

右键菜单 →「属性」从**只读清单**变成**可编辑表单**：书名 / 作者 / 标签三行输入框 + 保存，
其余（总字数 / 添加时间 / 最后阅读）仍是只读。

- **数据走内核**：书名 / 作者 / 标签是 `library.json` 里的权威字段，界面不许直接写它（硬性约束 1），
  所以这一轮在 `../wreader` 补了内核方法与协议，再在界面侧接线：
  - `library.set_metadata(book_id, title, author, tags)` —— 只改这三项标签后落盘，
    正文文件、章节表、阅读位置、时长与成就**一概不动**；空书名抛 `LibraryError`，
    空作者落成 `"unknown"`（与 `_normalise_book` 同一规则），标签收列表或逗号分隔字符串；
    存盘文件**故意不改名**（`file_path` 是存储细节，书名以索引为准）。
  - `serve.py` 新增 `set_meta`（方法数 **24 → 25**）：三个字段都可选、只写传了的那些，
    回执是清洗后的 `{"book_id","title","author","tags"}`；缺 id / 未知 id / 空书名都明确报错。
  - 冻结点已重出：`bash packaging/build-core.sh` → `installed : src-tauri/binaries/werd-core/...`
    + `smoke_core.py` **PASS**（`methods -> 25 methods dispatch cleanly`）；并真发了一轮协议验过
    `set_meta` → `list` 立刻改名、空书名回 `LibraryError`。
- **前端接线**：`lib/core.ts` 加 `setBookMeta()`（薄包装）+ `coreCapabilities()` 多探一个 `set_meta`；
  `lib/types.ts` 加 `BookMeta`（回执形状）；`BookPropsDialog` 自己维护草稿 / 忙状态 / 报错
  （保存失败留在弹窗里，不去页脚找），`Shelf.saveMeta` 成功后 `setDialog(null)` + `props.onSync()`
  —— 标签参与内核模糊搜索，必须重同步，不能只改内存那一行。
- **老内核降级**：探不到 `set_meta` 就把编辑框换成原来的只读清单 + 一句原因，与菜单禁用同一套理由。

## 本次新增（2026-10-05）：行距与段间距可调

`Aa` 面板多了两项排版：**行距**（`lineHeight`，1.2–3.4 倍，0.05 一档，默认 **1.95** —— 就是原先
`.reader-lines` 里写死的那个 `line-height`）与**段间距**（`paraSpacing`，0–2.5em，0.1 一档，默认 **0**）。

- 行距就是 CSS `line-height`（无单位倍数，随字号一起缩放），作为标量行内贴到 `.reader-lines`；
  段间距走 CSS 变量 `--reader-para-gap`，只由**段首那一行**（自己有字、上一行是空行）的
  `margin-top: calc(0.55em + var(--reader-para-gap))` 吃掉 —— 值是 0 时与空行下边距折叠后
  和原先**一模一样**，所以升级后默认外观不变。
- 段首判定在渲染那一层（看 `slice.lines[index - 1]` 是不是空行），**不碰内核**：行号仍是唯一坐标，
  改行距 / 段间距既不重新取文也不动位置（与改字号同一条路，见 `systemPatterns.md` 的 #19 / #27）。
- 这一批的**第一行不判段首**：跨批时看不到上一批的末行，宁可少一次留白也不误加。
- 归一化新增 `clampStep(value, low, high, digits)`（行距两位小数、字距一位小数共用）；
  老数据没有这两个键 → 各取默认值。
- `Aa` 面板行数变多，顺手给 `.reader-prefs` 加了 `max-height: calc(100vh - 7rem)` +
  `overflow-y: auto`：矮窗口里让面板自己滚，不会顶出屏幕。

## 本次新增（2026-10-05）：主题多一套「代码」

主题面板第四枚按钮：**代码** —— 背景 `#00008b`、文字 `#ffffff`（需求点名的两个值）。

- `ReaderTheme` 加 `"code"`；`READER_THEMES` 加这一项（`hint` 写明色值与「亮暗同色」）；
  `READER_PALETTES` 加 `code`；`normalizeTheme` 认它（其余坏值仍回落羊皮纸）。
- **亮暗两版故意同色**：`light` / `dark` 共用同一份 `CODE_PALETTE` —— 深蓝底白字本来就是暗色，
  点「白天 / 黑夜」不该把用户点名的颜色改掉。数据上仍是「每套两版」，
  不必在 `readerPalette` 里为它开特例。
- 纸边 `edgeFill = #141494`（= 底色向白混 8%，与自定义色那条规则一致）；
  纸边线 / 纸面的光 / 书脊的暗照旧由 `readerPalette` 从墨色与底色派生
  （深色纸 → `rgba(255,255,255,.22)` / `rgba(255,255,255,.16)` / `rgba(0,0,0,.66)`）。
- 白字压深蓝的对比度 **15.3:1**（WCAG AAA 的门槛是 7:1）。
- 布局：第四枚按钮在原宽度（19rem）下会被 `overflow: hidden` 的胶囊裁掉，所以主题面板放宽到
  `min(23rem, 86vw)`、胶囊内边距 `0.7rem → 0.6rem`（四枚算下来约 14rem，可用约 17rem）。

## 本次修复（2026-10-05）：清掉 `../wreader/wreader/library.py:36` 的「无法解析导入 chardet」

**结论：内核代码没毛病，是 IDE 配置问题，`library.py` 一个字符都没动。**

- **根因**：Pylance 解析第三方导入用的是「工作区选中的解释器」。Paget 工作区此前没有任何
  Python 配置（`.vscode/` 里只有 `extensions.json`），于是回落到 PATH 上的 `python3`
  （本机 `/usr/local/bin/python3` 3.14.7；`/usr/bin/python3` 3.9.6）—— 两个都没装 chardet。
  而 `../wreader/.vscode/settings.json` 与它的 `[tool.pyright] venvPath/venv` 只在
  「以 wreader 为工作区根」时生效（Pylance 不读 `[tool.pyright]`，见内核 `techContext.md`）。
- **改法**：新建 `Paget/.vscode/settings.json`（**被 `.gitignore` 忽略，属于本机 IDE 配置**）：
  `python.defaultInterpreterPath` → `${workspaceFolder}/../wreader/.venv/bin/python`；
  `python.analysis.extraPaths` → `../wreader`（源码根，与内核那份设置一致）+
  `../wreader/.venv/lib/python3.13/site-packages`（兜底，防止解释器选择被工作区状态盖掉）。
- **对照实验**（把内核包复制到 `/tmp/pylance_sim/pkg`，用三份 pyright 配置模拟 Pylance 的解析路径）：
  无 venv / 无 extraPaths → **4 errors / 1 warning**（含 `library.py:36 Import "chardet" could not be
  resolved`、`rich.console` / `rich.table` / `requests`）；指向 venv → **0 errors / 0 warnings**；
  解释器仍是错的、只靠 `extraPaths` 指到 venv 的 site-packages → **0 errors / 0 warnings**。
  真实内核仓库 `npx pyright` = **0 errors / 0 warnings**，`.venv/bin/python -c "import chardet"` = 7.6.0。
- **注意**：这是一份**本机文件**，fresh clone 不会有；换机 / 重建 venv（Python 版本变了）时
  `extraPaths` 里那条 `python3.13` 会失效，需照 `techContext.md` 的「IDE（Pylance）」一节重建。

## 本次修复（2026-10-05）：书架书多了之后的卡顿（内核读取缓存 + 书架少重算）

- **症状**：首页加书到二三十本之后整体发涩，越加越明显。量化下来根因**不在书架、在内核**：
  `library.json` 本机已经 **67 本 / 1.1MB**，而内核**每次 RPC 都要重新读盘 + `json.load` +
  逐本 `_normalise_book`**（一次 `list` 59–175ms），界面一次交互要发好几条（刷书架、取正文、
  取目录、存位置…），于是整体发涩。
- **修**（`../wreader/wreader/library.py`）：把「解析」拆成 `_parse_library(path)`，新增
  **`read_library()`** —— 按「路径 + `mtime_ns` + 大小 + inode」认文件，同一份只解析一次，
  命中就直接给内存里那一份（**只读：改它不算数**）；**`load_library()` 保持每次全新快照**，
  改书库照旧 `load_library()` + `save_library()`（后者顺带把缓存换成刚写下去的那份）。
  别的进程（终端 `werd`、手改、同步进来）写完签名就变、缓存自动作废；带 inode 是为了
  「临时文件 + 改名」的原子写。只读热路径（`get_book` / `list_books` / `recent_books` /
  `search_books` / `serve` 的 `stats` / 各成就统计 / 导出）换成 `read_library()`；
  **改书的调用点一行没动** —— 漏改最多是「没享受到提速」，不会把没落盘的改动留在缓存里。
- **书架侧**（`src/views/Shelf.tsx`）顺手治了三处「书越多越亏」的地方：①**时钟拆成独立组件**
  （`<Clock />`）—— 原来墙上的秒针每秒 setState，整面书架（一屏最多四十张卡片）跟着重算一遍；
  ②**书脊卡片 `memo`** + 稳定回调（`openBook` / `openMenu` 走 `useCallback`）—— 鼠标贴边亮箭头、
  开右键菜单这些书架自己的状态不再牵动每张卡片；③导入时**逐个路径报进度**
  （「正在导入第 3/12 个：书名」）—— 内核转换 + 建索引本来就慢，但用户看得见它在动。
  限时到期检查改成**自己每秒跳**（原来靠时钟的重渲染顺带跑）。



| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0**（无类型错误） |
| `npm run build` | **成功**（本轮书脊厚度改完重跑）：`dist/assets/index-*.css` 63.43 kB / `index-*.js` 311.87 kB（gzip 14.25 / 96.42 kB） |
| 临时脚本（`/tmp/shelf-check.ts`，`npx tsx` 跑） | **ALL OK**：36 条断言 —— **书脊厚度**（三万字以下/空/坏值一律保底 4.2rem、一百二十万字以上封顶 7.6rem、中段严格单调、**对数曲线的判据：字数翻倍增加的是等量的一截**）、**书名长度与字号**（汉字 1 / 拉丁 0.55 / 空格不算、超长截到 60、十来个字就是 1rem（外观不变）、越长越小、缩到 0.5rem 为止、8 字正好塞满 8.4rem 那一栏）、厚度模式归一化、**打包成排**（正好放得下 / 窄 1px 就换排 / 厚书更早换排 / 主屏第一排让出「＋」/ 一本不漏顺序不乱 / 坏值不死循环）、**排 → 屏**（主屏永远一排、其余三排、末尾补空排、空书架也留一屏）、**翻屏**（进退一屏、两头停在原地、只有一屏时不动、坏值收拢、一路按 → 到尾再按住就停）、**端到端**（同样 60 本：短篇 2 屏主屏 15 本 vs 百万字 3 屏主屏 9 本；每排都不超宽；混合 67 本 3 屏主屏 12 本） |
| 临时脚本（`/tmp/shelf-smoke.tsx`，同上） | **ALL OK**（exit 0）：17 条 —— `Shelf` 用 `react-dom/server` 渲一遍不炸；主屏打 `main` 模式类、窗 / 挂件栏 / 摆件架都在、**`.shelf-rack books` 只出现一次（只有一排书）**、带 `shelf dynamic` 类、不出现 `.shelf-nav` 与「回到主屏」；**每本书的厚度写进了 DOM**（八百字 → `--spine-w:4.2rem` + `--spine-depth:0`、十万字 → 曲线中段那个值、两百万字 → 7.6rem + depth 1，薄 < 中 < 厚）、**字数未知那本标了 `data-spine="unknown"` 并按保底摆**、**长书名（12 字）字号缩到 1rem 以下、四个字的仍是 1rem**、每一格都带 `--spine-w`；分屏信息 `第 1 / N 屏`（N>1）、一屏装得下时不出、空书架仍是一排 + 「＋」 |
| 临时脚本（`/tmp/prefs-check.ts`，`npx tsx` 跑） | **ALL OK**：`normalizeReaderPrefs` 27 条断言（默认值 / 老数据 / 范围夹取 / 0.05 与 0.1 档位 / 坏值落回下限 / 存盘往返；**字体六款**：名单就是那六款、默认 =「默认」那款（升级后外观不变）、每款都有名字与字体族、字体族都以通用族收尾、宋楷仿是衬线、坏值（`comic-sans` / 空 / null / 缺键）一律回落默认、`readerFontStack` 认款且坏值兜默认），与 ㉑ 起的「临时脚本不进仓库」惯例一致 |
| 临时脚本（`/tmp/theme-check.ts`，同上） | **ALL OK**：17 条断言 —— 面板四枚与调色板键一一对应、`code` 的 paper/ink 就是点名的两值、`edgeFill` 等于 +8% 白混合、**亮暗同色**、深色纸的三样派生、`normalizeTheme` 认它（坏值仍回落）、自定义色仍能盖过它、存盘往返，以及白字压深蓝的对比度（15.3:1 ≥ 7:1） |
| 临时脚本（`/tmp/guide-check.ts`，同上） | **ALL OK**：109 条断言 —— 20 档刻度（1 档 20s / 20 档 0.5s、严格单调、等比 ±0.02、都取到 10ms 的整、默认 10 档 3480ms）、档位与**标记**归一化（越界 / 小数 / 坏值 / `on` 只认明确 `false`；标记只认 `rabbit`，其它回光点）、档位牌与标记文案、兔子两件配套（**脚印间距 2.5em（跟字号走：20px 字号 → 50px 一只 ≈ 两三个字）与「收成整只脚印」**（49→0 / 50→50 / 120→100 / 差一点退回上一只 / 坏值与 pitch 为 0→0）、**一跳 = 每行停留时间 / 5 夹在 160–1200ms**（1 档 1200、10 档 696、20 档 160，单调））、`localStorage` 往返与坏数据、**老记录（6 档刻度、没有 marker）换算**（老 1→新 6、老 3→新 11、老 6→新 20；位置与开关照旧、标记回落光点）、`guideTrailY` / `guideDotAt` 的落点、`guideTrailAt` 的「走到哪儿轨迹长到哪儿」、`stepGuideClock` 的「每行停留时间 ± 一帧、一次只走一行、跑 199 行不漂」、**跟着滚两条判定**（`guideFollowTop` 的带子 / 半个行高不动 / 贴顶夹到 0；`guideNeedsMore` 的 900px 边界；外加**把「跟读」整条路走一遍**的模拟：不接下一批时光点最后停在屏幕最下面（626px，就是用户看到的那条 bug），接上之后 2000 行一路读下来始终待在带子里、一次也没「想滚却滚不动」） |
| 临时脚本（`/tmp/reader-smoke.tsx`，同上，**直接在 `/tmp` 跑**：靠 `/tmp/node_modules` 软链 + `/tmp/tsconfig.json` + 文件头 JSX 运行时 pragma，见本节末三个坑） | **ALL OK**（exit 0）：12 条 —— `Reader` 用 `react-dom/server` 渲一遍不炸、顶栏那枚开关（默认「光点开」）与 `1–6 光点换速` 提示都在、**那枚速度按钮上写着当前档（默认「10档 · 3.5s/行」）且浮层是收着的（`aria-expanded="false"`、`reader-guide-panel` 不渲染）**、**默认标记是光点（兔子那一套整个不渲染）**、档位牌换档前不出现、`loadGuideProgress` 在没有 `window` 时安全回落（开书即「光点开 · 10档 · 3.5s/行」）；夹具先补齐了 `BookRow` 的 `file_path` / `finished` / `tags`（少这几个过不了 `tsc`） |
| `cd src-tauri && cargo test` | **38 passed / 0 failed**（本次未动 Rust，沿用上一轮实测；2026-10-10 复核时重跑为 **45 passed**，见 `techContext.md`） |
| 读取缓存实测（`../wreader`，本机 67 本 / 1.1MB 书库） | `list` handler **59ms → 0.4ms**、`get_book` handler **0.06ms**（`stats` 2.4ms 是报表计算本身）；`tools/check_doc_numbers.py` **ALL OK**、`check_docs.py` **OK** |
| `pytest`（`../wreader`） | **718 passed**（本轮新增 5 项：`tests/test_library.py` 的读取缓存语义；上一轮 713） |
| `npx pyright`（`../wreader`） | **0 errors, 0 warnings** |
| `/tmp/pylance_sim/` 三份 pyright 对照配置（验 Pylance 解析路径，见上一节） | 无 venv / 无 `extraPaths` → **4 errors / 1 warning**（含 `library.py:36 chardet`）；指向 venv → **0/0**；只靠 `extraPaths` 指 site-packages → **0/0** |
| `tools/check_doc_numbers.py` / `check_docs.py` | **ALL OK** / **OK** |
| `packaging/build-core.sh`（Paget） | **PASS**：冻结点重出并过 `smoke_core.py`（25 个方法派发干净） |

> 本轮新增的纯函数（字重吸附整百、字距一位小数、行距 / 段间距档位、主题 / 颜色归一化、
> `readerPalette` 的预设与自定义色派生）用一份**临时**脚本实测过（全过，后来加了「代码」主题，
> 断言共 33 条），**但没有留在仓库里**——前端仍然只有 `tsc --noEmit` 这道静态门禁（见待办 1）。

> 界面验证仍是**手工**：`npm run tauri dev` 开一本有正文的书就能试「点屏幕中间呼出顶栏」、
> 丝带、`↑ ↓` 逐行（不跳段、亮位置牌）、`← →` / `空格` 滚一屏、跳章 / 跳书签、
> `Aa` 面板（**字体** / 字号 / 字重 / 字距 / 行距 / 段间距 / 边距）与主题面板（四套预设 × 亮暗 + 自定义色）、
> **光点导读**（**顶栏那枚速度按钮点开**：浮层里选**标记**（光点 / 下划线）与拖滑杆换档（1 最慢 …
> 20 最快，左上角跟着亮「n档 · x.xs/行」的档位牌）、`1–6` 六个快捷档、`0` 开关、
> 关书再开从上次那一行接着导、书末停下）；**下划线**要专门看两件事：它像不像「字底下那道线
> 挪了个位置」（不像虫、也不像进度条），以及一伸一缩的节奏顺不顺。
> **注意**：领路的移动 / 轨迹 / 跟随滚动**没有**自动化验证（本机没有可用的无头浏览器，
> 也没装 Playwright）—— `guideLineMs` / `stepGuideClock` /
> `stepGuideWalk`（**空行不花时间**就断在这儿）/ `guideDotAt` / `guideTrailAt` / 进度读写这些纯逻辑
> 有上面那份临时脚本，渲染路径有
> `react-dom/server` 的冒烟（速度按钮上的当前档位、默认标记是光点也在这道冒烟里），
> 但「领路的压在轨迹线上」「当前行那条轨迹与已读行那条落在同一个高度」（轨迹下划线是
> `0.25em` ↔ `guideTrailY` 一对常量）、**最慢那档到底够不够慢**，只能靠 `npm run tauri dev` 眼睛看
> （前端没有自动化测试，见待办 1）。
>
> 顺带记两个坑，都是**临时脚本**的事（都在工程外，不动仓库）：
>
> 1. `/tmp` 里的脚本向上找不到工程的 `node_modules`，裸包（如 `react-dom/server`）既过不了
>    `tsc` 也 import 不进来（IDE 报「找不到模块」）；`tsx`（esbuild）同样套不上工程的
>    `jsx: react-jsx`（tsconfig 的 `include` 只有 `src`），`.tsx` 退回 classic JSX 会报
>    `React is not defined`。
> 2. `/tmp/reader-smoke.tsx` 的解法（2026-10-05 实测：12 条断言 **ALL OK** / exit 0，单文件
>    `tsc` 0 error）：①`ln -s <repo>/node_modules /tmp/node_modules` 补上依赖解析 —— VS Code
>    与 `tsx` 都靠它（`/tmp` 被清掉就重建；去掉软链实测会退回那条 `TS2307`）；②同目录再加一份
>    `/tmp/tsconfig.json`（`moduleResolution: bundler` + `jsx: react-jsx`，`include` 就是这几个
>    临时脚本）—— IDE 不再用「推断工程 + 默认选项」去解析工程外的文件，那条
>    「找不到模块 react-dom/server」就是它治好的（改完配置 / 重建软链后
>    `TypeScript: Restart TS Server` 一下）；③文件第 1 行声明自动 JSX 运行时 pragma
>    （`@jsxRuntime automatic @jsxImportSource react`），于是**不用**再拷进 `src/`，直接
>    `npx tsx /tmp/reader-smoke.tsx`。踩过的坑：别在同一个文件的说明注释里再写一次那条
>    pragma 的字面量 —— esbuild 取「最后一条」，值非法的那条会把文件头的自动运行时顶掉，
>    又退回 classic。
> 3. **`tsx` 4.23.x 的新坑**（2026-10-05 撞上，与仓库无关、只影响这个脚本）：它转译**被引入的
>    那个 `.tsx`**（`Reader.tsx`）时不再读工程里的 `jsx: react-jsx`，退回 classic ——
>    `React.createElement` 找不到 `React`，报 `React is not defined`（**纯 `.ts` 的三个校验
>    不受影响**，所以只有冒烟会犯；`--tsconfig` / `TSX_TSCONFIG_PATH` 都治不了）。脚本里补一句
>    `import * as React from "react"` + `globalThis.React = React` 就好（渲染发生在 import 之后，
>    所以 ESM 的提升不影响；自动运行时下这行是多余的、留着也无害），**不用**改仓库里任何文件。

## 本次改动（2026-10-05）：书房排布改成「一排一格」（用户提的三条）

**现状**（改完之后书架就该按这几条理解）：

- **主屏**（`main` 上的 `.study.main`）= 书房全景：窗 → 墙上那一栏（三枚便利贴 —— 「日记」/「勋章」/
  「调一调」，见 `components/StickyNoteNav.tsx` —— 加数字时钟、同步那几个小圆钮）→ 摆件架 → **只有一排书**（这一排的头一格是那只**藤条篮子**）。两层之间、以及这排书
  下面，各是一块**白色挡板**（`.shelf-rack.decor::after` 与 `.shelf-rack.books::after` 同一套样式）。
- **主屏是「悬空」排布**（用户要求：首屏别空、书架像挂在墙上）：窗 `clamp(5.4rem, 13vh, 7.8rem)`
  （比原先高一档）、摆件架 `margin-top: 1rem`（往下压一点）、**那一排书不为拉满整屏** ——
  `.study.main .shelf-rack.books { flex: 0 1 auto; height: 14rem }`（14rem = 12rem 书脊上限
  + 内边距 1.1 + 0.5 + 网格 0.4rem，改内边距就要一起改）。于是留白全落在书架**下面**
  （900px 高的窗上约 250px 墙面），挡板在主屏那道投影也加深（`0 16px 26px rgba(0,0,0,.5)`）
  —— 影投在墙上就是「悬空」的来源；`.page-info` 改 `margin: auto 0 0` 沉到底当页脚。
  **想少留一点白**：把窗再调高、或给 `.study` 主屏加个上内边距把整摞往下推。
- **第二屏起**（`.study.shelves`）= **整面书架**：窗 / 挂件栏 / 摆件架都 `display: none`，
  最上面直接就是一排书，一共**三排**、每排下面一块白挡板；右上角浮一枚 **⌂ 回到主屏**
  （主屏不显示它）。用模式类而不是条件渲染，是为了不去动那两百行 JSX 的缩进。
- **书脊厚度按总字数算**（动态模式，默认开）：`spineWidthRem(字数)` 做**对数**映射，夹在
  `SPINE_MIN_REM = 4.2`（保底，短篇 / 诗 / 字数未知都走这档）与 `SPINE_MAX_REM = 7.6`（封顶）之间，
  两个锚点是 `SPINE_LOG_LOW = 30k` / `SPINE_LOG_HIGH = 1.2M`（**中文按字、英文按词**，量级可比；
  需求给的概念是 5k / 500k，这里按同一思路拉开，好让常见长篇落在曲线中段）。
  厚度同时换算成 `--spine-depth`（0–1）给侧边那道阴影；书名的字号由 `spineTitleFontRem(书名)`
  按「字长 / `SPINE_TITLE_ROOM_REM = 8.4rem`」算，长书名自动缩（十来个字以内算出来正好 1rem，
  所以普通书脊外观不变），缩到 0.5rem 为止才轮到 CSS 省略号兜底。三个数都作为 CSS 变量
  （`--spine-w` / `--spine-depth` / `--spine-title-size`）写在一格上。
- **一排摆几本 = 按厚度一本本累加**：`useLayoutEffect` + `ResizeObserver` 量第一条书排的 `<ul>`
  宽度，`packShelfRows(每本厚度, 一排宽, 缝, 主屏第一排给那只藤条篮子留的宽)` 贪心打包成排，
  再 `planShelfPages(排)` 按「主屏 1 排、其余每屏 3 排」切屏（末尾补空排 —— 排高不跳、
  白挡板数不变）。所以**没有「一屏固定多少本」这种数**，`PAGE_SIZE = 40` 与旧的
  `booksPerRow` / `shelfPages` / `shelfRows` 都删了。缝 `0.5rem` 与 `App.css` 的 `.shelf` 的
  `gap` 是一对（`SPINE_GAP_REM`）。`/tmp/shelf-check.ts` 31 条断言钉住（含端到端：
  同样 60 本，短篇 2 屏主屏 15 本 vs 百万字 3 屏主屏 9 本）。
- **书脊那一排现在是 flex**：`.shelf.dynamic .spine-card { flex: 0 0 auto; width: var(--spine-w) }`
  （排不满的那一排右端留白 —— 「错落」就是这个意思）；`.shelf.uniform` 才是等宽平分这一排。
  `.shelf-rack.books` 里那个 `<ul>` 的宽度就是 `packShelfRows` 的输入，两边一致，不会挤溢出。
- **「动态书脊厚度」开关**在**设置页**（`views/Settings.tsx` 新增的「书架」一节）：开 =
  按字数（默认）、关 = 全体等宽。它存本机 `gui_settings` 的 `shelf.spine_mode`（`SPINE_MODE_KEY`，
  内核不认识它，与「置顶」同一个做法），值只认 `uniform`，其余都当动态（`normalizeSpineMode`）。
  书架开书时读一次就够 —— 设置页是另一个整页，离开它回来时书架是**重新挂载**的。
- **右上角那一组**：`current > 0` 才渲染「回到主屏」；「跳到第几屏」的输入框在
  `totalPages >= JUMP_MIN_PAGES`（= 4，也就是「书超过三屏」）时才出现，回车或点「跳转」直达、
  越界自动夹回。**同一个表单变量**挂在两处（主屏在墙上栏右端、其余屏在 `.shelf-nav` 浮层里）——
  别把它做成组件：写在 render 里的组件每次都是新类型，输入框会被重挂、打字打到一半丢焦点。
- **键盘也能翻屏**：`←` / `→` 与两侧那对 `‹ ›` 走同一条路（`stepPage(current, totalPages, ±1)`），
  已经在头 / 尾时**不 `preventDefault`**（按键留给系统）。守着四条不翻屏的线：正在输入框里打字
  （`typing`）、搜索遮罩开着、开书过场中（`stage`）、以及 `overlayOpen`（右键菜单 / 弹窗 /
  换玩具面板开着 —— 翻屏会让浮着的菜单指着一本已经不在那儿的书）。
  **这个 effect 必须写在分屏算完之后**（它读 `totalPages` / `current`，写在前头会 TDZ）。
- **只有主屏那一排有那只藤条篮子**（导入入口；后面的屏是纯书架，不占书位）—— 想导入就回主屏。

## 本机数据现状

- `.wreader/library.json`：**2 本书** —— 《70回本》（作者 水浒传，4894 行，0.0%）、
  《西游记》（作者 unknown，8352 行，1.0%）。
- `.wreader/` 累计阅读 **183 秒**（`2026-10-03`: 65、`2026-10-04`: 99、`2026-10-05`: 19）。
- `.wreader/novels/`：`70回本_utf8.txt`(2.4 MB)、`西游记_utf8.txt`(2.1 MB)。
- 归档目录 `<app data dir>/archived/` 目前**没有**封印（书架上一本限时书都没设）。

## 待办（按优先级）

0. **导入飞行动画的后续里程碑**：①**跨屏飞行** ✅ **2026-10-07 做掉了**（翻到第一本新书那一屏再飞，其余朝那一屏飞出画外）；
   ②**10 本以上每 3 本并行起飞**（`flightSchedule` 里已经留了那一档的位置）；
   ③**`../wreader` 内核那三个新成就**（要动内核 + 重打 `src-tauri/binaries/werd-core`）。
   ④**重打冻结点内核**：2026-10-07 给内核加了 `shelf_layout` / `set_shelf_layout`（书架布局）
   —— 开发构建走 venv 已经能用，但**打包进 `.app` 的那份冻结点**还是旧的，得跑
   `packaging/build-core.sh` 再 `npm run tauri build -- --ignore-version-mismatches`；
   在那之前，随包版本的书架布局会走本机 `gui_settings` 那条退路（管理条上写着「本机」）。
1. **前端没有自动化测试**：滚动追加 / 跳转落点、丝带状态、主题 / 颜色归一化这些逻辑
   只能手测或临时脚本；`readerPrefs.ts` / `readingGuide.ts` / `deadlines.ts` / `coverGenerator.ts`
   这类纯函数最容易先补单测（Vitest）—— 光点导读的 `stepGuideClock` / `stepGuideWalk`
   （含「空行一步跨过去、一条也不花时间」）/ `guideDotAt` /
   `guideTrailAt`、**跟着滚的 `guideFollowTop` / `guideNeedsMore`** 已经在临时脚本里验过
   （109 + 22 条断言），但**还没进仓库**。
2. **滚动模式往回滚会重建一屏**：`moveTo` 目标落在已加载段之外时用 `loadAt` 重取（滚动位置回顶）。
   前进方向有预取所以基本碰不到，回头方向会跳一下。
3. **`positions.cfi` 列仍是预留**：阅读页走行号，CFI 只有表结构，等"直接打开一个 epub"。
4. **rustc 升级后清掉 workaround**：等 rustc ≥ 1.90，`cargo update -p tauri -p tauri-plugin-opener`
   后就能删掉 `--ignore-version-mismatches`（坑 #8）。
5. **可考虑给 Paget 建 `.clinerules/memory-bank.md`**：把读取 / 更新协议从 `memory-bank/README.md`
   抽出去，与 `../wreader` 的做法对齐。
6. ~~**Windows 上「＋」导入按钮还没有实现**~~ ✅ **2026-10-07 做掉了**：`pick_import_paths` 收
   `mode`（`files` / `folder`），非 macOS 走 `lib.rs` 的 `desktop_picker`（`tauri-plugin-dialog`
   → `IFileOpenDialog`），界面在那些平台上先弹 `components/ImportPickMenu.tsx` 问一句
   （两档由 `import_picker_modes` 告诉前端）。**只在 Windows 上跑的那段代码靠「不加 target
   门控、让它在 macOS 上一起编译」保它一直过类型检查** —— 但真装到 Windows 上弹不弹得出来，
   仍然要那边的人眼看一次。
7. **Windows 安装包没有签名**：两个包（`.msi` / `-setup.exe`）都会触发 SmartScreen。要消掉得买
   Windows 代码签名证书，再往 `tauri.windows.conf.json` 里加 `certificateThumbprint` / `timestampUrl`。

## 会话级注意事项

- **Paget 是本地 git 仓库**（2026-10-05 `git init` + 首次提交，无远端）；改了哪些文件看 `git status` / `git diff`。
- ⚠️ **这台开发机上现在没有 `../wreader` 源码**（2026-10-09 核实：`~/.zshrc` 里
  `alias werd=…/Downloads/wreader/.venv/bin/werd` 已是悬空路径，Spotlight 也只剩冻结点里那份）。
  于是 `tauri dev` 的内核必须**显式指**：`WREADER_CORE_COMMAND="$PWD/src-tauri/binaries/werd-core/werd-core"`
  （实测可用，数据在 `<repo>/.wreader`）或 `WREADER_CORE_PYTHON=<装了 wreader 的解释器>`。
  别顺手把它写进代码里当默认：开发构建**故意不认**随包冻结点（见第十三轮那节）。
- **内核的 stderr 是「管道 + 一条读线程」**（`watch_stderr`），每行仍 `eprintln!` 到终端，
  尾部 16 行留在 `StderrLog` 里给报错用。**别把它改回 `Stdio::inherit()`** —— 那样首屏又会
  只剩一句「the core exited without answering」，真正的原因（`ModuleNotFoundError` 之类）
  只落在跑 `tauri dev` 的终端里，两边对不上。
- **`.msi` 只能在 Windows 上打，别在 macOS 上试**：WiX 只在 Windows 上跑（本机 CLI 的 `--bundles`
  连 msi 这个选项都不列），而且随包内核是 PyInstaller 冻出来的、**不能交叉编译**。Windows 那条路走
  `python packaging/build_windows.py`（一条命令：查环境 → npm ci → 冻内核 → tauri build）。
  **2026-10-07 定了不推 GitHub**，所以 `.github/workflows/windows-installer.yml` 那条 CI 路只是
  留在仓库里备用 —— 真出包得找一台 Windows(真机或虚拟机)。
- Windows 专属的打包配置单独放 `src-tauri/tauri.windows.conf.json`（**严格 JSON，别加注释**，
  理由写在第十二轮那节）：Tauri 只在打 Windows 时才合并它，改它不会碰到 macOS 的包。
- **给非 macOS 平台写的 Rust 代码，别用 `#[cfg(not(target_os = "macos"))]` 把整个 `mod` 藏起来**：
  那样它在开发机上根本不参与编译，写错了也没人告诉你。做法是「**模块照常编译、只在调用处
  cfg**」（`lib.rs` 的 `desktop_picker` 就是这么写的），依赖也照常写在 `[dependencies]` 里，
  只在 `.plugin(init())` 那一处 cfg —— 于是那段只在 Windows 上跑的代码，每次在 macOS 上
  `cargo build` 都会过一遍类型检查。代价只是一个 `allow(dead_code)` 注释。
- **出图看带入场动画的东西要当心**：`animation` 的首帧（多半是 `opacity: 0`）会被 `qlmanage`
  停在原地，整块看着像「没渲染出来」—— 图稿里先 `animation: none` 再看（`.book-menu` 就这样
  白出过一张空图）。
- **验交互的自动检查，别自己造最终态**（2026-10-13 的教训）：那天拆阅读页两栏时把 `className` 写死、
  漏了 `` ${barOpen ? " open" : ""} ``，两栏永远收着 —— 而 SSR 冒烟与出图**都是手改字符串把 `open`
  塞进去**的，正好把 bug 盖住，最后是用户点出来的（同一天 `PdfReader.tsx` 也有同一份）。所以：
  结构检查只管「结构对不对」，**状态→外观这条链要真点一下**（`/tmp/reader-bars-click.js` 那种
  jsdom 挂载 + `dispatchEvent` 的做法，10 条断言；本轮之后它守着这条回归）。
- **`src-tauri/target/` 不是资产，是可回收的编译缓存**：2026-10-07 收尾时量到它有 **5.4 GB**
  （仓库总共 5.8 GB），其中大部分是几个月里依赖升升降降留下的**旧版本产物**（`debug/deps` 里
  4,321 个条目、光 `tauri` 同名 70 份），cargo 自己从不回收。`cd src-tauri && cargo clean`
  一次收回 5.8 GB / 16,224 个文件，代价只是**下一次** `tauri dev` 重编约 6 分钟。
  **别跟它一起删的两样**：`.wreader/`（131 MB，开发用的书库数据）与
  `src-tauri/binaries/werd-core/`（39 MB，随包内核 —— 那是产物不是缓存）。
  详细账目见 `techContext.md` 的「磁盘占用与回收」。
  ⚠️ **但清完别开着编辑器**：`cargo clean` 之后 rust-analyzer 会自己把 `target/` 编回来
  （实测清空 1 小时后回到 1.7 GB）—— 想真把这块留白，先关掉这个工作区窗口再 clean。
- 改任何会写 `~/.wreader` 的逻辑前，先确认它走的是内核 RPC，而不是直接写文件（硬性约束 1）。
- 时间戳一律用 `coreStamp()`（本地秒级）；**不要**引入 `toISOString()`（硬性约束 5）。
- 阅读页**只有滚动一种读法**：位置永远是「看得见的第一行」（滚动回调用二分算出来），
  不是「第几页」。跳转落在当前批次之外会重新铺一批并回到顶部；
  不要再用 `pageSize` / `mode` / `columns` 这些已经不存在的概念去理解它。
- 光点导读有三条**别拆的约束**：①速度是「**每行**停留时间」，不按字数 / 像素换算
  （需求：每行都要被完整导读到，不受行长影响）；②**只有换行 / 换档 / 开关才走 React 渲染**，
  每帧的位置更新直接写 `style`（一批正文两百行，每帧渲染会拖垮滚动）；
  ③光点进度**不进内核**（存 `localStorage`，按书分键）—— 别顺手并进 `gui_settings`，
  除非内核那边也要认它。
- **改摆件 / 静物这类「纯 CSS 的物件」时**：`qlmanage` 放大截图那个架子有个坑 —— 想让
  `transform: scale(N)` 的画面停在下沿，内层盒子的 `transform-origin` 必须**真的落在裁剪框的下沿上**：
  普通流的 div 会先溢出裁剪框、原点跟着跑到框外，出图就成了「物件下半截 + 一片空墙」。
  做法：外层 `position: relative; overflow: hidden` 且**宽高都写死**（外层若是 flex 项，宽度也得写死
  —— 绝对定位的子元素撑不开它，会得到 0 宽的裁剪框），内层 `position: absolute; left: 0; bottom: 0`
  再 `transform-origin: 0 100%`。
- **改样式表一定要数大括号**：`src/styles/*.css` 里漏一个 `}`，**后面的规则会被并成前面那条选择器的后代**
  （2026-10-07 成就页就踩到：`.ach-gauge` 少一个收尾，`.ach-block` 到文件结尾全变成 `.ach-gauge .ach-*`，
  于是那枚章回到 SVG 默认尺寸 + 默认黑色填充）。它**不会让 `vite build` 失败**，页面也照样渲染，
  只能靠「打出来的 CSS 里搜关键选择器」或出图看。改完样式表顺手跑一次
  `/tmp/paget-key/achievements-smoke.tsx`（最后七条就是干这个的）。
- **`qlmanage` 的缩略图是整页缩放成方形**（页面四周那几条波纹 = 边缘拉伸出来的），所以拿它量像素前
  得先在页里放一根已知长度的标尺；不然「视口字号和真机不一样」会被误判成布局错。
