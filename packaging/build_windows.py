#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Windows 上一条命令出安装程序：MSI + NSIS 的 `-setup.exe`。

用法（在 **Windows** 上、仓库根目录）：

    python packaging/build_windows.py [--check] [--no-npm] [--no-core] [--bundles msi nsis]

四步：查环境 → `npm ci` → 冻内核（`packaging/build_core.py`）→ `tauri build`，
最后把两个安装包的路径与体积打出来。`--check` 只做第一步，不构建。

**为什么不能在 macOS 上打 MSI**：WiX 只能在 Windows 上跑（Tauri 官方原话：`.msi`
installers can *only be created on Windows* as WiX can only run on Windows systems），
而且这里的 Python 内核也得在 Windows 上冻一遍（PyInstaller 不能交叉编译，见
`build_core.py`）。所以本机 macOS 上只会走 `--check`。

两个安装包的分工（配置在 `src-tauri/tauri.windows.conf.json`）：

  .msi（WiX）       装到 Program Files，**要管理员**；企业分发、GPO 走这个。
  -setup.exe（NSIS）默认只给当前用户装到 %LOCALAPPDATA%，**不要管理员**。

注意：MSI 需要 Windows 的 **VBSCRIPT 可选功能**（Win11 24H2 起默认被移除，少了它
会报 `failed to run light.exe`）。在「设置 → 应用 → 可选功能 → 更多 Windows 功能」
里勾上再试。
"""

from __future__ import annotations

# 解析命令行
import argparse
# 环境变量（找 Program Files 下的 vswhere）
import os
# 找 node / npm / rustup
import shutil
# 拉起 npm / PyInstaller / Tauri CLI
import subprocess
# 用来跑同目录的 build_core.py
import sys
from pathlib import Path

# 同目录的兄弟脚本（packaging/ 不是包，但脚本直接跑时它自己就在 sys.path 上）
import build_core

# 本文件所在目录 = packaging/；仓库根是它的上一级
HERE = Path(__file__).resolve().parent
GUI_ROOT = HERE.parent

# Tauri CLI 的 Node 入口。用它而不是 `npx`：Windows 上 npx 是 .cmd，交给 subprocess
# 容易被 CreateProcess 的解析坑到；node 一直是 .exe，路径可确定。
CLI_JS = GUI_ROOT / "node_modules" / "@tauri-apps" / "cli" / "tauri.js"

# 默认两个都打：MSI 给「要装进 Program Files」的场合，NSIS 给免管理员的场合
DEFAULT_BUNDLES = ("msi", "nsis")

# MSI 那一步的提醒（只在收尾时唠叨一次，不在流程中间挡路）
VBSCRIPT_HINT = (
    "若 light.exe 报错：MSI 需要 Windows 的 VBSCRIPT 可选功能（Win11 24H2 起默认移除），"
    "在「设置 → 应用 → 可选功能 → 更多 Windows 功能」里勾上。"
)


def run(cmd: list) -> None:
    """跑一条命令并把它原样打到屏幕上（失败就抛，不续跑）。

    Windows 上 `npm` 是 `npm.cmd`：`.cmd` / `.bat` 交给 `CreateProcess` 的解析有歧义
    （MSDN 那条注释要求显式走命令解释器），所以这里统一包一层 `cmd.exe /c`。
    """
    if os.name == "nt" and str(cmd[0]).lower().endswith((".cmd", ".bat")):
        cmd = ["cmd.exe", "/c", *cmd]
    print(f"\n$ {' '.join(str(part) for part in cmd)}")
    subprocess.run([str(part) for part in cmd], cwd=str(GUI_ROOT), check=True)


def which(name: str) -> str:
    """在 PATH 上找可执行文件（Windows 上也会认 .cmd / .exe）。"""
    found = shutil.which(name)
    if not found:
        raise SystemExit(f"error: PATH 上没有 {name}")
    return found


def check_node() -> str:
    """Node 与 npm：前端先 `npm ci`，Tauri CLI 本身也是 Node 脚本。"""
    node = which("node")
    which("npm")
    version = subprocess.run([node, "-V"], capture_output=True, text=True).stdout.strip()
    return f"node {version} ({node})"


def check_rust() -> str:
    """Rust 工具链：官方只支持 MSVC 目标，缺了就提前说清楚。"""
    rustc = which("rustc")
    which("cargo")
    version = subprocess.run([rustc, "-V"], capture_output=True, text=True).stdout.strip()
    rustup = shutil.which("rustup")
    if rustup:
        installed = subprocess.run(
            [rustup, "target", "list", "--installed"], capture_output=True, text=True
        ).stdout
        if "x86_64-pc-windows-msvc" not in installed:
            raise SystemExit(
                "error: 缺少目标 x86_64-pc-windows-msvc -- 跑：rustup target add x86_64-pc-windows-msvc"
            )
    return f"{version} ({rustc})"


def check_msvc() -> str:
    """MSVC 工具链：rustc 自己会用 vswhere 找，这里只是提前给一句人话。"""
    vswhere = (
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Microsoft Visual Studio"
        / "Installer"
        / "vswhere.exe"
    )
    if not vswhere.is_file():
        return "MSVC    : 没找到 vswhere —— 装 Visual Studio Build Tools 的「使用 C++ 的桌面开发」"
    found = subprocess.run(
        [
            str(vswhere),
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
        ],
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not found:
        return "MSVC    : 没找到「使用 C++ 的桌面开发」那一组组件"
    return f"MSVC    : {found.splitlines()[0]}"


def main() -> int:
    # Windows 上先钉住 stdio 编码（同一个坑：管道 + cp1252 打不出中文与「←」）
    build_core.use_utf8_stdio()

    parser = argparse.ArgumentParser(description="Windows 上打 MSI + NSIS 安装包")
    parser.add_argument(
        "--core-root",
        help="内核源码树在哪（优先于 $PAGET_CORE_ROOT；默认就是本仓库的 core/）",
    )
    parser.add_argument("--check", action="store_true", help="只查环境，不构建")
    parser.add_argument("--no-npm", action="store_true", help="跳过 npm ci / npm install")
    parser.add_argument("--no-core", action="store_true", help="跳过冻内核（用已经装好的那份）")
    parser.add_argument(
        "--bundles",
        nargs="+",
        default=list(DEFAULT_BUNDLES),
        choices=list(DEFAULT_BUNDLES),
        help="要打哪些安装包（默认两个都打）",
    )
    args = parser.parse_args()

    # 先报环境：内核那几十行判定与 build_core.py 共用同一段代码，两边不会各说各话
    # （找不到内核时会打一整屏「试过哪些位置 + 三条出路」，见 missing_core_report）
    found, tried = build_core.resolve_core_root(args.core_root)
    python = build_core.find_python(found[1] if found else None)
    if found:
        root, how = found[1], f"来自 {found[0]}"
    else:
        root = build_core.core_root_from_python(python)
        how = f"从 {python} 里那份 wreader 反推"
    if root is None:
        raise SystemExit(build_core.missing_core_report(tried, python, "import 得到，但找不到 wreader/ 包目录"))
    print(f"host    : {sys.platform}")
    print(f"python  : {python} ({build_core.python_version(python)})  ← 冻内核用")
    print(f"core    : {root}（{how}）")
    print(f"pyinst  : {build_core.pyinstaller_version(python)}")
    print(f"sidecar : {build_core.TARGET / ('paget-core' + build_core.EXE_SUFFIX)}")

    if os.name != "nt":
        # 不是 Windows：不必再查 node / rust，直接把「为什么不行」说清楚
        print(
            "\n本机不是 Windows —— MSI 只能在 Windows 上打（WiX 只能在 Windows 上跑）。\n"
            "NSIS 虽然能从 macOS 交叉编，但随包分发的那份内核必须在 Windows 上冻\n"
            "（PyInstaller 不能交叉编译），所以这里止步于环境检查。\n"
            "三条能出安装包的路：\n"
            "  ① 找台 Windows 跑 `python packaging/build_windows.py`；\n"
            "  ② GitHub Actions 的 windows-latest（见 .github/workflows/windows-installer.yml）；\n"
            "  ③ Windows 虚拟机（Parallels / VMware / UTM 都行，装 Rust + Node + Python）。"
        )
        return 1

    print(f"node    : {check_node()}")
    print(f"rust    : {check_rust()}")
    print(check_msvc())

    if args.check:
        print(f"\n提示：{VBSCRIPT_HINT}")
        return 0

    if not args.no_npm:
        # 有锁文件就用锁文件（可复现），没有才退回 install
        run([which("npm"), "ci"] if (GUI_ROOT / "package-lock.json").is_file() else [which("npm"), "install"])

    if not args.no_core:
        # 冻内核：MSI 里装的就是这一份 paget-core.exe（build_core.py 会先跑协议烟测）
        # 把上面定下来的内核位置显式递下去，免得子脚本再猜一次
        run([sys.executable, str(HERE / "build_core.py"), "--core-root", str(root)])

    if not CLI_JS.is_file():
        raise SystemExit(f"error: 没找到 Tauri CLI（{CLI_JS}）-- 先跑 npm ci")
    # `--ignore-version-mismatches` 是给 rustc 偏旧的机器留的（见 README 的「打包」）；
    # 版本对得上时它什么都不做，所以无条件带上。
    run([which("node"), str(CLI_JS), "build", "--bundles", *args.bundles, "--ignore-version-mismatches"])

    # 报产物：MSI 与 NSIS 落在 src-tauri/target/release/bundle/<格式>/ 下
    print()
    found_any = False
    for bundle in args.bundles:
        folder = GUI_ROOT / "src-tauri" / "target" / "release" / "bundle" / bundle
        pattern = "*.msi" if bundle == "msi" else "*-setup.exe"
        for artifact in sorted(folder.glob(pattern)):
            found_any = True
            print(f"built   : {artifact} ({artifact.stat().st_size / 1024 / 1024:.1f} MB)")
    if not found_any:
        raise SystemExit("error: 没找到安装包产物 -- 看上面的构建输出")

    print(f"\n提示：{VBSCRIPT_HINT}")
    print("       这两个包都没签名，用户下下来会看到 SmartScreen 警告；要消掉就得买")
    print("       Windows 代码签名证书，再配 bundle.windows.certificateThumbprint。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
