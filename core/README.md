# core —— Paget 的内核（Python）

这个目录是 Paget 的**内核源码**：书库索引、阅读位置、时长统计与成就、目录识别、
格式转换（txt / epub / mobi / azw3 / pdf）全在这里；界面（`../src/` 的 React 与
`../src-tauri/` 的 Rust）**一点都不重算**这些。

2026-10-11 起它**就在项目里**：早先内核是仓库外并排的一个 checkout（`../wreader`），
界面在 dev 与打包时都要去外面找它。现在克隆 Paget 一个仓库就能跑、能打包，不再需要
第二个 checkout（见 `memory-bank/activeContext.md` 那一轮）。

## 跑起来

```bash
python3 -m venv core/.venv
core/.venv/bin/python -m pip install -e "core[dev]"
```

界面的 dev 构建会自己找 `core/.venv/bin/python`（见 `src-tauri/src/core_client.rs`
的 `dev_interpreter_in`）；随包分发的那份是 `packaging/build-core.sh` 冻出来的
`src-tauri/binaries/paget-core/`，由 `tauri.conf.json` 当 `core` 资源发出去。

## 测试

```bash
core/.venv/bin/python -m pytest core/tests -q
```

`tests/` 一律跑在临时的 `$WREADER_HOME` 上，**不碰**真实的书库。

## 与界面共用什么

- **数据目录**：默认 `~/.wreader`（`$WREADER_HOME` 可改）；Paget 开发 / 便携运行时
  指向项目根的 `.wreader/`（见 `src-tauri/src/lib.rs` 的 `use_project_data_root`）。
- **设置**：`settings.toml`。界面里所有设置（「调一调」那一页、阅读页顶栏的
  「阅读设置」）改的就是这一份，不再需要命令行。

## 两个名字**故意**没改

- Python 包名仍是 `wreader`（所以协议那条命令仍是 `python -m wreader.serve`）；
- 发行名（pip metadata）也仍是 `wreader`。

改它们要连 `wreader/env.py` 的「editable 安装」判定、数据目录名（`~/.wreader`，
动它就是动用户已有的统计与成就）与既有测试一起改，收益只是名字好看 —— 所以留着，
只把**对外**的部分（界面文字、构建产物名、安装包里的路径）换成了 Paget 自己的。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `wreader/serve.py` | 无头内核：stdin 一行一个 JSON 请求，stdout 一行一个 JSON 回复 |
| `wreader/library.py` / `pdf.py` / `mobi.py` | 导入与格式转换（PDF 默认只收文件 + 数页数，抽文字是另一条按需的路） |
| `wreader/reader.py` | 终端阅读器（curses）：`a` 键的自动翻页、走法都在这儿；界面那套与它同一个语义 |
| `wreader/stats.py` / `achievements.py` | 时长、统计报告与 48 条成就定义（`data/achievements.json`） |
| `wreader/config.py` | `settings.toml` 的 schema 与默认值 |
| `wreader/data/` | 必须跟着包走的资源（成就定义），冻结内核时会原样收集 |
| `tests/` | pytest：内核自己的 790 条（跑在临时 `$WREADER_HOME` 上） |
