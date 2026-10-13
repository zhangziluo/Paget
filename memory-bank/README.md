# MemoryBank — Paget

这个目录是 Paget 的**长期记忆**：把「它是什么、为什么这样做、怎么搭的、现在到哪一步」
沉淀成文件，让新的会话（或新的人）读完就能接手，不必重新摸索整个代码库。

> 做法沿用内核那一套（内核源码 2026-10-11 搬进本仓库的 `core/`，它原来那份 `.clinerules/`
> 没一起搬）；**Paget 目前还没有自己的 `.clinerules/`**，
> 所以读取/更新协议先写在本文件里。

## 文件职责（读取顺序）

| 文件 | 内容 | 什么时候读 |
| --- | --- | --- |
| `projectbrief.md` | **根基**：定位、核心功能需求、硬性技术约束、明确的非目标 | 任何任务开始前 |
| `productContext.md` | 为什么做、给谁用、体验目标、关键产品决策与理由、兼容承诺 | 涉及需求取舍时 |
| `systemPatterns.md` | 分层架构、模块职责表、设计模式、关键调用链、必踩的坑 | 改代码之前 |
| `techContext.md` | 依赖、环境、环境变量、文件位置、配置项、常用命令、测试基础设施 | 装环境 / 跑命令时 |
| `activeContext.md` | **当前焦点**：最近改动、验证证据、待办优先级、会话级注意事项 | 每次开始工作前 |
| `progress.md` | 整体状态、已完成功能清单、待办、已知问题表、决策演变史 | 汇报进度 / 排优先级时 |

## 读取协议（任务开始时）

1. **任何任务开始前**：先读 `activeContext.md`，再读 `projectbrief.md`。
2. **着手改代码前**：加读 `systemPatterns.md`（架构 + 坑清单）与 `techContext.md`（命令 + 约束）。
3. **涉及需求取舍时**：加读 `productContext.md`。
4. 不凭记忆假设项目状态；文件里写下的才算数。发现文件与实际代码不符时，
   **先按实际代码工作，收尾时再修正文件**。

## 更新协议（何时更新哪个文件）

| 触发 | 要更新的文件 |
| --- | --- |
| 每完成一段工作（不论大小） | `activeContext.md` —— 写清改了什么、为什么改、怎么验证的 |
| 状态 / 已完成清单 / 待办 / 已知问题有变化 | `progress.md` |
| 做了方向性取舍 | `progress.md` 的「决策演变」表 |
| 架构、模块职责、设计模式、关键调用链有变化 | `systemPatterns.md` |
| 依赖、命令、配置项、测试规模有变化 | `techContext.md` |
| 项目定位或硬性约束真的变了 | `projectbrief.md`（谨慎，很少动） |
| 用户说 **"update memory bank"** | **全部 6 个文件逐一复核** |

## 写作纪律

- **只写事实**。凡数字（源码行数、测试项数、版本、配置项个数）必须先**实测**再写。
  别写会随操作变化的计数（提交数、SHA）—— 落笔即过期。要写就写稳定事实或判据。
- **记录失败与坑**：试过又放弃的方案、被回退的改动，比成功记录更值钱。
- **过期就改**：不要把"以后再说"当成已完成。
- **不制造第二个事实来源**：同一事实只写在最合适的那个文件里，别处只放链接。
- 中文为主、代码标识符用英文，与项目其余文档一致。

## 本目录现状（2026-10-05 建库快照；规模与验证两行 2026-10-07 复核）

- 建立于 **2026-10-05**，由当时的会话依据实际代码、`cargo test` 与 `tsc --noEmit` 生成。
- 规模实测（2026-10-10 复核，随第二十四轮「波浪线导读」再核一遍）：
  `src/`（TS/TSX）**11,765 行 / 32 个文件**、`src/`（CSS）**7,891 行 / 6 个文件**
  （`App.css` 5,488 + `styles/manage-mode.css` 562 + `styles/stats-page.css` 516 +
  `styles/settings-page.css` 534 + `styles/achievements.css` 503 + `styles/sticky-note.css` 288），
  另有资产 `src/assets/`（`wood-texture.svg` 21 行 / 1.5 kB、`guide-wave.svg` 19 行 / 1.2 kB）。
  第二十四轮：`lib/readingGuide.ts` 558 → 568 行、`lib/readerPrefs.ts` 539 → 560 行、
  `views/Reader.tsx` 1,761 → 1,776 行、`App.css` 5,435 → 5,488 行、新增 `src/assets/guide-wave.svg`
  （19 行 / 1.2 kB；它会被 Vite 内联进 CSS —— 同一张图只留一份，见 `systemPatterns.md` 的 24e）。
  第二十三轮：`lib/readerPrefs.ts` 442 → 539 行、`views/Reader.tsx` 1,717 → 1,761 行、
  `App.css` 5,423 → 5,435 行。
  第二十二轮：删掉 `components/GuideRabbit.tsx`（125 行，文件数 33 → 32）、
  `lib/readingGuide.ts` 589 → 558 行、`views/Reader.tsx` 1,736 → 1,717 行、`App.css` 5,585 → 5,423 行。
  第二十一轮：`App.css` 5,762 → 5,585 行、`views/Shelf.tsx` 2,408 → 2,380 行、
  `lib/toyPrefs.ts` 232 → 203 行（`styles/manage-mode.css` 只把两条关键帧里的镜像去掉、行数未变）。
  第二十轮只动 CSS：`App.css` 5,689 → 5,762 行（侧身那十几条重画、并换成 `:is(…)` 一份管左右），
  TS/TSX 一行没变 —— `Shelf.tsx` 只改了 `Plush` 的注释。
  第十九轮：`lib/toyPrefs.ts` 169 → 232 行、`views/Shelf.tsx` 2,338 → 2,408 行、`App.css` 5,651 → 5,689 行。
  第十七轮：新增 `lib/toyPrefs.ts`（169 行）、`views/Shelf.tsx` 2,300 → 2,338 行、
  `App.css` 5,452 → 5,651 行、`styles/manage-mode.css` 只在三条关键帧里加了个镜像（行数未变）。
  第十六轮只动了 TS：`lib/readingGuide.ts` 521 → 589 行、`views/Reader.tsx` 1,723 → 1,736 行。
  第十五轮：`lib/readingGuide.ts` 388 → 521 行、`views/Reader.tsx` 1,675 → 1,723 行、
  `App.css` 5,421 → 5,452 行。）
  （`App.css` 5,504 + `styles/manage-mode.css` 562 + `styles/sticky-note.css` 288 + `styles/stats-page.css` 516；
  另 1 个 SVG 资源）。
  （2026-10-07 第六轮移除「隔板 / 区域」后：删掉 `Divider.tsx` / `RegionTag.tsx` / `useLabelDraft.ts`
  三个文件、`shelfManage.ts` 698 → 290 行、`Shelf.tsx` 2,395 → 2,264 行、`manage-mode.css` 915 → 562 行。
  第十轮（统计页改手绘风）后：`App.css` 5,613 → 5,504 行、`Stats.tsx` 196 → 289 行，
  新增 `lib/statsText.ts`（115 行）与 `styles/stats-page.css`（516 行）。）
  建库那天的旧数是 TS/TSX **10,515 行 / 22 个文件**，之后几轮陆续加了
  `readingGuide` / `readerPrefs` / `importFlight` / `shortcuts` / `shelfLayout` / `statsText`
  / `ImportPickMenu` 与新组件；
  `src-tauri/src/` **3,408 行 / 5 个 `.rs`**；`packaging/` **1,640 行 / 7 个文件**（5 个 `.py` + 1 个 `.sh` + 1 个 `.spec`
  —— 第十二轮加了 `build_core.py` + `build_windows.py`，用来在 Windows 上出 MSI / NSIS；
  2026-10-13 复核：`build_core.py` 326 / `build_windows.py` 229 / `smoke_core.py` 383 行）；
  另有 `src-tauri/tauri.windows.conf.json`（20 行）与 `.github/workflows/windows-installer.yml`（98 行，2026-10-13 复核后）。
- 验证实测：`cd src-tauri && cargo test` → **45 passed / 0 failed**（2026-10-10 复核重跑）；
  `npx tsc --noEmit` → **exit 0**（无类型错误）、`npx vite build` ✓（CSS 111.08 kB / JS 365.33 kB，2026-10-10 第二十四轮后）。
- **Paget 是本地 git 仓库**（2026-10-05 `git init` + 首次提交）：只在本机留历史，**没有远端、不推 GitHub**
  （2026-10-07 明确定的，见 `projectbrief.md` 非目标）。提交 71 个文件 / 约 1.0 MB。
- 项目根还有（都**不进**版本控制，见 `techContext.md`）：`.wreader/`（开发期数据，131 MB）、
  `dist/`（前端产物，一秒重建）、`src-tauri/binaries/paget-core/`（冻结点内核，39 MB、约 1 分钟重建）、
  `src-tauri/target/`（cargo 编译缓存 —— **2026-10-07 收尾时 `cargo clean` 清空过，收回 5.8 GB**；
  那块目前是空的，第一次 `tauri dev` 会重新编出来，账目见 `techContext.md` 的「磁盘占用与回收」）。
