#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把内核冻成随包分发的那份 `paget-core`（macOS / Windows / Linux 都能跑）。

用法：

    python packaging/build_core.py [--core-root <内核仓库>] [--no-smoke]

它是 `packaging/build-core.sh` 的跨平台孪生。**Windows 上走的是这个**：那边的
`bash` 不一定有，而 MSI / NSIS 又只能在 Windows 上打（见 README 的「打包」），
所以那条路需要一个不带 shell 的入口。

## 内核从哪来（这一步最常卡住）

内核**就在这个仓库里**：`core/`（里面是 `wreader/` 包 + 它的 `tests/`）。
冻内核要的是「一个能 `import wreader` 的解释器 + 那份 `core/wreader/data/`」，**不是**把
源码树塞进安装包 —— 安装包里带的是这一步**冻出来的** `core/paget-core[.exe]`。
按这个顺序找内核：

1. `--core-root <目录>`（最明确，出错时先试它）；
2. `$PAGET_CORE_ROOT`；
3. 仓库自带的 `core/`；

三条都不成（比如 `core/` 被删了），还可以**从解释器里那份 `wreader` 反推**：只要能
`import wreader`，`wreader/data` 就在它的包目录里 —— 于是「不落地源码、直接
`pip install` 一份」也能冻。

四条都不成，会一次说清「试过哪些位置 + 两条出路」（见 `missing_core_report`）。

做的事与 build-core.sh 一一对应：

1. 找内核（见上）与能 `import wreader` 的解释器（`$PAGET_CORE_PYTHON` → 内核自己的
   `core/.venv`（Windows 在 `Scripts/`）→ PATH 上的 `python`）；
2. 在**临时目录**里按 `packaging/paget-core.spec` 冻结，工作树里不留 build/ 与 dist/；
3. 整目录覆盖到 `src-tauri/binaries/paget-core/`（`tauri.conf.json` 把它当 `core`
   资源发出去，Rust 侧按 `<resource dir>/core/paget-core[.exe]` 找它，见
   `core_client.rs` 的 `bundled_binary`）；
4. 用 `packaging/smoke_core.py` 真发一轮协议确认它能干活（`--no-smoke` 跳过）。

**冻结点是平台绑定的**：在 macOS 上跑出来的这份只能在 macOS 上跑。MSI 里要装的
是 Windows 上冻出来的那份（`paget-core.exe` + `_internal/`），所以「先冻内核」这一步
必须在要打包的那台 Windows 上做 —— PyInstaller 不能交叉编译。

为什么是 onedir 而不是 onefile：见 build-core.sh 的注释（实测冷启动 12–24 s vs 1.1 s）。
"""

from __future__ import annotations

# 解析命令行
import argparse
# 进程环境（把 PAGET_CORE_ROOT 递给 spec）
import os
# 覆盖旧产物
import shutil
# 拉起 PyInstaller / 烟测
import subprocess
# 解释器与退出码
import sys
# 构建与产物都放临时目录
import tempfile
from pathlib import Path

# 本文件所在目录 = packaging/；仓库根是它的上一级
HERE = Path(__file__).resolve().parent
GUI_ROOT = HERE.parent

# Tauri 打包时按这个相对路径找资源源（见 tauri.conf.json 的 bundle.resources）
TARGET = GUI_ROOT / "src-tauri" / "binaries" / "paget-core"

# 冻结点在 Windows 上带 .exe（core_client.rs 的 sidecar_name 也是这么认的）
EXE_SUFFIX = ".exe" if os.name == "nt" else ""


def repo_core() -> Path:
    """内核在仓库里的位置：`<repo>/core`（2026-10-11 起内核是本仓库的一部分）。"""
    return (GUI_ROOT / "core").resolve()


def resolve_core_root(explicit: str | None) -> tuple[tuple[str, Path] | None, list[tuple[str, str]]]:
    """按优先级找内核源码树，返回（(来源标签, 路径) or None，试过的清单）。

    优先级：`--core-root` > `$PAGET_CORE_ROOT` > 仓库自带的 `core/`。
    这三条**只认真的放着 `wreader/` 包**的目录 —— 指错了就当没指，好过拿一个空目录去冻。
    """
    tried: list[tuple[str, str]] = []
    for label, raw in (
        ("--core-root", explicit),
        ("$PAGET_CORE_ROOT", os.environ.get("PAGET_CORE_ROOT")),
        ("仓库自带", str(repo_core())),
    ):
        if not raw:
            tried.append((label, "（没给）"))
            continue
        path = Path(raw).expanduser().resolve()
        if (path / "wreader").is_dir():
            return (label, path), tried
        tried.append((label, f"{path}（没有 wreader/）"))
    return None, tried


def core_root_from_python(python: str) -> Path | None:
    """从解释器里那份 `wreader` 反推内核根目录（源码树与 site-packages 都认）。

    这是第 4 条路：`import wreader` 能成，就说明有一份 `core/wreader/data/`，spec 要的正是它。
    于是「不落地源码、直接 pip install git+…」也能冻出内核来。
    """
    try:
        probe = subprocess.run(
            [
                python,
                "-c",
                "import pathlib, wreader; print(pathlib.Path(wreader.__file__).resolve().parent.parent)",
            ],
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if probe.returncode != 0:
        return None
    path = Path(probe.stdout.strip() or ".")
    return path if (path / "wreader").is_dir() else None


def missing_core_report(tried: list[tuple[str, str]], python: str | None, from_python: str) -> str:
    """一条路都走不通时，把「试过什么 + 两条出路」一次说完。

    内核是本仓库的一部分，所以这里的正解几乎总是「把 `core/` 找回来」——
    不再有「去 clone 另一个仓库」那种说法。
    """
    setenv = "set" if os.name == "nt" else "export"
    lines = [
        "error: 找不到内核（wreader）—— 冻内核这一步要的是「一份 wreader 包 + 一个能 import 它的解释器」。",
        "       （**不是**要把源码塞进安装包：安装包里带的是这一步冻出来的 core/paget-core[.exe]。）",
        "",
        "试过这些位置：",
    ]
    lines += [f"  {label:<16}{path}" for label, path in tried]
    lines.append(f"  {'解释器里的那份':<16}{python or '（没找到能 import wreader 的解释器）'} → {from_python}")
    lines += [
        "",
        "两条路，挑一条：",
        "  ① 仓库自带的那份内核不见了：重新拿一份 Paget（`core/` 就在里面），或者",
        f"     {setenv} PAGET_CORE_ROOT=<那份 wreader 包的上一级目录>",
        "  ② 不落地源码，直接装进「要用来冻内核的那个 Python」：",
        f"     {setenv} PAGET_CORE_PYTHON=<那个 python>    # 冻内核与烟测都用它，它得能 import wreader",
    ]
    return "\n".join(lines)


def find_python(hint: Path | None) -> str:
    """挑一个能 `import wreader` 的解释器。

    顺序：`$PAGET_CORE_PYTHON` → 内核自己的 venv → PATH 上的 `python`。
    返回的是可执行文件路径（或名字，交给 subprocess 去 PATH 里找）。
    """
    candidates: list[str] = []
    if os.environ.get("PAGET_CORE_PYTHON"):
        candidates.append(os.environ["PAGET_CORE_PYTHON"])
    # venv 的可执行文件在 Windows 上是 Scripts/python.exe，其它平台是 bin/python
    if hint is not None:
        candidates.append(str(hint / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")))
    candidates.append(shutil.which("python") or "python")

    tried: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        # 显式路径要真的存在；只给名字的（PATH 上的）直接试
        if os.sep in candidate and not os.path.exists(candidate):
            continue
        tried.append(candidate)
        try:
            probe = subprocess.run([candidate, "-c", "import wreader"], capture_output=True, text=True)
        except OSError:
            # 只给了名字、PATH 上又没有这个解释器（精简 PATH / Windows 上常见）—— 当它不可用
            continue
        if probe.returncode == 0:
            return candidate
    raise SystemExit(
        f"error: 没有找到能 import wreader 的解释器（试过：{tried or '（一个可用的都没有）'}）\n"
        f"       装法： <python> -m pip install -e \"{repo_core()}\"\n"
        f"       （内核就在本仓库的 core/ 里；装完用 PAGET_CORE_PYTHON 指给这个脚本 —— 它是冻内核与烟测都要用的那个解释器。）"
    )


def pyinstaller_version(python: str) -> str:
    """确认那个解释器自带 PyInstaller，并返回版本号。"""
    probe = subprocess.run([python, "-m", "PyInstaller", "--version"], capture_output=True, text=True)
    if probe.returncode != 0:
        raise SystemExit(
            f"error: {python} 没有 PyInstaller -- 装上再来：\n"
            f"       {python} -m pip install pyinstaller"
        )
    return probe.stdout.strip()


def directory_size(path: Path) -> int:
    """整棵目录的字节数（用来报体积，不引第三方库）。"""
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def install(built: Path) -> None:
    """整目录覆盖到 Tauri 期望的位置（旧产物一并清掉，免得留着一份误导人的旧内核）。"""
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(built, TARGET)


def freeze(python: str, root: Path) -> Path:
    """在临时目录里冻结并装好，返回装到位的那个可执行文件。"""
    # 构建与产物都放临时目录，工作树里不留 build/ 与 dist/
    with tempfile.TemporaryDirectory(prefix="paget-core-") as scratch:
        dist = Path(scratch) / "dist"
        work = Path(scratch) / "build"
        # PAGET_CORE_ROOT 导出给 spec 用，两边看到的是同一个路径
        env = {**os.environ, "PAGET_CORE_ROOT": str(root)}
        print("building  : (this takes a minute)")
        subprocess.run(
            [
                python,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--distpath",
                str(dist),
                "--workpath",
                str(work),
                str(HERE / "paget-core.spec"),
            ],
            check=True,
            cwd=str(GUI_ROOT),
            env=env,
        )
        built = dist / "paget-core"
        if not built.is_dir():
            raise SystemExit(f"error: PyInstaller 没有产出 {built}")
        # 临时目录随 with 一起消失，所以先把产物装到位再走
        install(built)
    return TARGET / ("paget-core" + EXE_SUFFIX)


def python_version(python: str) -> str:
    """解释器的版本串（报环境用）。"""
    return subprocess.run([python, "-V"], capture_output=True, text=True).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="冻结内核到 src-tauri/binaries/paget-core/")
    parser.add_argument(
        "--core-root",
        help="内核源码树在哪（优先于 $PAGET_CORE_ROOT；默认就是本仓库的 core/）",
    )
    parser.add_argument("--no-smoke", action="store_true", help="冻结完不跑协议烟测")
    args = parser.parse_args()

    # 先按三条「显式位置」找内核；同时把解释器定下来 —— 它自己也可能就是第 4 条路
    # （wreader 装在 site-packages 里，源码树根本不在机器上）
    found, tried = resolve_core_root(args.core_root)
    python = find_python(found[1] if found else None)
    if found:
        root, how = found[1], f"（来自 {found[0]}）"
    else:
        root = core_root_from_python(python)
        how = f"（从 {python} 里那份 wreader 反推）"
    if root is None:
        raise SystemExit(missing_core_report(tried, python, "import 得到，但找不到 wreader/ 包目录"))

    pyinstall = pyinstaller_version(python)

    # 先报环境再动手（出问题时这一屏就是现场）
    print(f"core      : {root} {how}")
    print(f"python    : {python} ({python_version(python)})")
    print(f"pyinstall : {pyinstall}")
    print(f"platform  : {sys.platform} -> {TARGET / ('paget-core' + EXE_SUFFIX)}")

    binary = freeze(python, root)

    size = directory_size(TARGET) / (1024 * 1024)
    print(f"installed : {TARGET} ({size:.1f} MB total)")

    if args.no_smoke:
        print("smoke     : skipped (--no-smoke)")
    else:
        print("smoke     :")
        # 用同一个解释器当客户端（它本来就是这个仓库的开发环境；不通过就别往下打）
        subprocess.run([python, str(HERE / "smoke_core.py"), str(binary)], check=True)

    # 下一步：Windows 出 MSI / NSIS，其它平台出 .app / .dmg
    if os.name == "nt":
        print("\nnext      : python packaging/build_windows.py")
    else:
        print("\nnext      : npm run tauri build -- --ignore-version-mismatches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
