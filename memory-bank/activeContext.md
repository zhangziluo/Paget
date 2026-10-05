# 当前焦点 — Paget

> 最后更新：**2026-10-05**。这是每次开始工作前**第一个要读**的文件。

## 当前焦点：文档同步 + 版本控制（2026-10-05 收尾）

限时 / 封印功能（见 `progress.md` §8、`systemPatterns.md` 模式 #6 / #7 / #8 与坑 #6）落地后留下了三处
「文档对不上代码」，本轮全部修掉，**未动任何代码**：

- **README 测试数字**：26 → **38**，并拆到模块（`lib.rs` 3 / `db.rs` 14 / `archive.rs` 9 / `core_client.rs` 12），
  补上 `archive.rs` 的用例说明。
- **README 补写限时 / 封印 / 已归档**：新增一节（`shelf.deadlines`、归档目录 `archived/<sha8><rand>.zip`、
  `paget-archive.json`、`archive_seal` / `archive_restore`、⏳ 与 `SealDissolve` / `SealToast`），
  并把齿轮从「设置 + 数据」改口为「设置 / 数据 / 已归档」、右键菜单补上「设置限时」。
- **版本控制**：`git init` + 首次提交。提交只含源码 / 配置 / 打包脚本 / memory-bank；
  `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/binaries/`（冻结内核，约 24 MB）、
  `.wreader/` 全在 `.gitignore` 里。**本地仓库，仍不推 GitHub**（见 `projectbrief.md` 非目标）。

## 验证证据（2026-10-05 实测）

| 命令 | 结果 |
| --- | --- |
| `cd src-tauri && cargo test` | **38 passed / 0 failed**（0.9s） |
| `git status`（首次提交后） | 干净：无未跟踪、无未提交 |
| `git ls-files` | **71 个文件 / 约 1.0 MB**（最大 `src-tauri/icons/icon.icns` 136 KB） |
| `npx tsc --noEmit` | **exit 0**（本轮未改 TS，沿用上一轮） |
| 构建产物（上一轮，2026-10-05 10:58） | `dist/index.html` + `assets/index-*.js`(276,991 B) + `index-*.css`(50,265 B) |
| 打包产物（更早一次，2026-10-04） | `src-tauri/target/release/bundle/macos/Paget.app`、`dmg/Paget_0.1.0_x64.dmg` |

> 本轮只改了 README / `.gitignore` 与 memory-bank，**未动任何代码**。若要发版，先 `packaging/build-core.sh`
> 再 `npm run tauri build -- --ignore-version-mismatches`。

## 本机数据现状

- `.wreader/library.json`：**2 本书** —— 《70回本》（作者 水浒传，4894 行，0.0%）、
  《西游记》（作者 unknown，8352 行，1.0%）。
- `.wreader/` 累计阅读 **183 秒**（`2026-10-03`: 65、`2026-10-04`: 99、`2026-10-05`: 19）。
- `.wreader/novels/`：`70回本_utf8.txt`(2.4 MB)、`西游记_utf8.txt`(2.1 MB)。
- 归档目录 `<app data dir>/archived/` 目前**没有**封印（书架上一本限时书都没设）。

## 待办（按优先级）

1. **前端没有自动化测试**：目前只有 `tsc --noEmit`。`deadlines.ts` / `coverGenerator.ts` / `format.ts`
   这类纯函数最容易补单测（Vitest）。
2. **`positions.cfi` 列仍是预留**：阅读页走行号，CFI 只有表结构，等"直接打开一个 epub"。
3. **rustc 升级后清掉 workaround**：等 rustc ≥ 1.90，`cargo update -p tauri -p tauri-plugin-opener`
   后就能删掉 `--ignore-version-mismatches`（坑 #8）。
4. **可考虑给 Paget 建 `.clinerules/memory-bank.md`**：把读取/更新协议从 `memory-bank/README.md`
   抽出去，与 `../wreader` 的做法对齐。

## 会话级注意事项

- **Paget 现在是本地 git 仓库**（2026-10-05 `git init` + 首次提交），但**只在本机、没有远端**：
  查改动 `git status` / `git diff` 即可。提交前确认 `src-tauri/binaries/`、`.wreader/`、`target/`、
  `node_modules/`、`dist/` 都没被带上（都已在 `.gitignore` 里）。
- 改任何会写 `~/.wreader` 的逻辑前，先确认它走的是内核 RPC，而不是直接写文件（硬性约束 1）。
- 时间戳一律用 `coreStamp()`（本地秒级）；**不要**引入 `toISOString()`（硬性约束 5）。
- 跨项目提示：本会话另在 `../wreader/tests/test_library.py` 修掉一条 Pylance「无法解析导入 conftest」
  的告警（加 `# pyright: ignore[reportMissingImports]` + 中文说明）；那条属于 **wreader** 的进度，
  若要记账应写进 `../wreader/memory-bank/activeContext.md`，**不属于 Paget**。
