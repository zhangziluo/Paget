#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把**开发用的书架**恢复成「只有一本用户手册」的样子。

用法（在仓库根目录）：

    python3 packaging/seed_dev_shelf.py [--home <数据目录>] [--keep-others]

做的事：清空 `core/` 那份开发数据目录里的书，再把 `docs/Paget 使用手册.txt` 导进去 ——
于是 `npm run tauri dev` 打开书架，看到的正好是这一本（2026-10-14 用户要求）。

几条规矩：

1. **只动开发数据**：默认目标是仓库里的 `.wreader/`（壳层在 debug 构建下用的就是它，
   见 `src-tauri/src/lib.rs` 的 `prepare_core_data_root`）。**装出去的 app 那份数据**
   （`~/Library/Application Support/com.paget.gui/core`、`%LOCALAPPDATA%\\com.paget.gui\\core`）
   不在默认目标里；真指到那儿会先拦一下，要 `--force` 才动手 —— 那里面是用户的书。
2. **读写都走内核**（`python -m wreader.cli clear` / `import`），不自己去改 `library.json` ——
   与"数据只能由内核写"这条硬约束一致，索引、缓存与正文目录才不会错位。
3. `--keep-others` 只补手册、不清别的书（默认是清）。
"""

from __future__ import annotations

# 解析命令行
import argparse
# 与内核说话的那一行 JSON
import json
# 进程环境（把 WREADER_HOME 递给内核）
import os
# 拉起内核的命令行 / 协议
import subprocess
# 报错与提示
import sys
from pathlib import Path

# 同目录的兄弟脚本：借用它的「找内核 / 找解释器」那两段，免得两边各写一份
import build_core

# 本文件所在目录 = packaging/；仓库根是它的上一级
HERE = Path(__file__).resolve().parent
GUI_ROOT = HERE.parent

# 开发用的数据目录（与壳层 debug 构建里那个默认值一致）
DEV_HOME = GUI_ROOT / ".wreader"
# 手册的源文件（这本就是开发书架上那唯一一本）
MANUAL = GUI_ROOT / "docs" / "Paget 使用手册.txt"
# 手册的作者：内核从文件名推不出来时写的是 unknown，这里顺手改成人看的名字
MANUAL_AUTHOR = "Paget"
# 装机版数据的标志性路径片段：指到这些地方就先拦一下
USER_DATA_HINTS = ("Application Support/com.paget.gui", "AppData", "com.paget.gui")


def is_user_data_dir(home: Path) -> bool:
    """这个目录看起来是不是「装出去的 app」的数据目录（那里是用户的书，别乱清）。"""
    text = str(home)
    return any(hint in text for hint in USER_DATA_HINTS)


def run_core(python: str, home: Path, args: list[str]) -> None:
    """用**开发数据目录**跑一条内核命令（`WREADER_HOME` 显式递进去，绝不碰别处）。"""
    env = {
        **os.environ,
        "WREADER_HOME": str(home),
        "WREADER_NOVELS_DIR": str(home / "novels"),
    }
    cmd = [python, "-m", "wreader.cli", *args]
    print(f"\n$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(GUI_ROOT), env=env, check=True)


def call_core(python: str, home: Path, method: str, params: dict) -> dict:
    """按内核的协议发一条请求（一行 JSON 进、一行 JSON 出）返回它的 result。

    脚本**绝不自己去改 `library.json`** —— 数据只能由内核写（改了就得同步索引 / 缓存 / 正文目录，
    那是内核的活）。
    """
    env = {
        **os.environ,
        "WREADER_HOME": str(home),
        "WREADER_NOVELS_DIR": str(home / "novels"),
    }
    request = json.dumps({"id": 1, "method": method, "params": params}, ensure_ascii=False)
    done = subprocess.run(
        [python, "-m", "wreader.serve"],
        cwd=str(GUI_ROOT),
        env=env,
        input=request + "\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    lines = [line for line in (done.stdout or "").splitlines() if line.strip()]
    if not lines:
        raise SystemExit(
            f"error: 内核没有回答 {method}（stderr: {(done.stderr or '').strip()[:200]}）"
        )
    reply = json.loads(lines[-1])
    if "error" in reply:
        raise SystemExit(f"error: 内核拒绝了 {method}：{reply['error'].get('message')}")
    return reply.get("result", {})


def main() -> int:
    # Windows 上先钉住 stdio 编码（与 build_core.py 同一个坑）
    build_core.use_utf8_stdio()

    parser = argparse.ArgumentParser(description="把开发用的书架恢复成「只有一本用户手册」")
    parser.add_argument(
        "--home",
        default=os.environ.get("WREADER_HOME") or str(DEV_HOME),
        help="开发数据目录（默认 <repo>/.wreader，也可以给 $WREADER_HOME）",
    )
    parser.add_argument(
        "--keep-others",
        action="store_true",
        help="只补手册，不清掉别的书",
    )
    parser.add_argument("--force", action="store_true", help="即使目标像「装出去的 app 的数据」也照做")
    args = parser.parse_args()

    home = Path(args.home).expanduser().resolve()
    # 装机版那份数据先拦一下：那里面是用户的书，不是开发数据
    if is_user_data_dir(home) and not args.force:
        print(
            f"error: {home} 看起来是「装出去的 app」的数据目录 —— 那里的书不该被这个脚本清掉。\n"
            f"       开发数据默认在 {DEV_HOME}；确实要动这里就加 --force。",
            file=sys.stderr,
        )
        return 1
    # 手册得在
    if not MANUAL.is_file():
        print(f"error: 找不到手册 {MANUAL}", file=sys.stderr)
        return 1

    # 内核源码树与能 import wreader 的解释器：与 build_core.py 共用同一段判定
    found, tried = build_core.resolve_core_root(None)
    if not found:
        print(build_core.missing_core_report(tried, None, "这个脚本要先能找到 core/"), file=sys.stderr)
        return 1
    core_root = found[1]
    python = build_core.find_python(core_root)

    print(f"数据目录: {home}")
    print(f"内核    : {core_root}（来自 {found[0]}）")
    print(f"解释器  : {python}")

    # 1) 清空（默认）—— 时长与成就留着，只是把书都移出书库
    if not args.keep_others:
        run_core(python, home, ["clear"])
    # 2) 把手册导进去（内核会把正文转成 UTF-8 放进 novels/ 并登记进书库）
    run_core(python, home, ["import", str(MANUAL)])
    # 3) 顺手把作者写上：内核从文件名推不出来时写的是 unknown（`set_meta` 就是界面「属性」那条路）
    for row in call_core(python, home, "list", {}).get("books", []):
        if (row.get("title") or "") == MANUAL.stem:
            call_core(python, home, "set_meta", {"book_id": row["id"], "author": MANUAL_AUTHOR})
            print(f"\n作者写成 {MANUAL_AUTHOR}：{row['id']}")
            break
    # 4) 把结果摆出来（顺手当验证）
    run_core(python, home, ["list"])

    print("\n好了 —— `npm run tauri dev` 打开书架，看到的应该就是《Paget 使用手册》这一本。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
