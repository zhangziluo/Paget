# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for `paget-core`, the reading core that ships with the app.

The desktop bundle must not ask the user to install Python, so the core travels
as a frozen executable and Tauri declares it as `bundle.externalBin`.  It is a
**console** build on purpose: the sidecar speaks one JSON object per line on
stdin/stdout, and a windowed build would have no stdio at all.

Build it through `packaging/build-core.sh` (that script also finds the
interpreter, names the file after the target triple and smoke-tests the result);
this file only describes *what* goes into the binary:

* `core/wreader/data/` must be collected **under its package directory**: the core
  reads the 48 achievement definitions through
  `importlib.resources.files("wreader") / "data" / "achievements.json"`
  (`core/wreader/stats.py`), so the data has to land where a package's data belongs,
  not at the bundle root.
* the terminal front end's heavy extras are excluded.  `rich` (and its
  `pygments` / `markdown_it` / `mdurl` chain) plus `curses` are imported by
  `core/wreader/reader.py` and `core/wreader/cli.py` only -- neither is in the sidecar's
  import graph (`core/wreader/serve.py` -> `session` / `library` / `config` / `stats`
  / `toc` / `transfer` / `achievements` / `env` / `geo` / `lock`), and the whole
  point of the sidecar is that those are *not* dragged in.
* `requests` is **kept**: `core/wreader/geo.py` imports it lazily behind the optional
  geography achievements, and the frozen core should behave exactly like the
  interpreter inside `core/.venv` rather than raise on a path the kernel handles.
* the distribution metadata (`wreader-0.1.0.dist-info`) is deliberately **not**
  copied: `core/wreader/env.py` treats its `direct_url.json` as the proof of an
  editable install, and a frozen binary is not one.  Shipping the metadata would
  silently unlock the "runs from an editable install" achievement.
"""

import os
import pathlib

# PyInstaller 把 SPECPATH 注进命名空间 = 本文件所在目录（packaging/）
spec_dir = pathlib.Path(SPECPATH)  # noqa: F821 - 由 PyInstaller 注入
# 仓库根：packaging/ 的上一级
gui_root = spec_dir.parent
# 内核就在本仓库里：<repo>/core（2026-10-11 起；换布局就设 PAGET_CORE_ROOT 指过去）
core_root = pathlib.Path(os.environ.get("PAGET_CORE_ROOT") or gui_root / "core")

# 成就定义走 importlib.resources，必须落到包目录那一层（详见文件头注释）
datas = [(str(core_root / "wreader" / "data"), "wreader/data")]

a = Analysis(  # noqa: F821 - PyInstaller 提供
    [str(spec_dir / "paget_core.py")],
    # 让分析器直接看到源码树里的 wreader 包（不依赖 venv 里那份可编辑安装的元数据）
    pathex=[str(core_root)],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # 终端前端专用的重家伙，冻结点里一行都不需要
    excludes=["curses", "rich", "pygments", "markdown_it", "mdurl"],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)  # noqa: F821 - PyInstaller 提供

# onedir（而不是 onefile）是**实测**选的：见 packaging/build-core.sh 的注释。
# 这里 exe 与它的一堆依赖分开放，运行时原地启动，不每次解包。
exe = EXE(  # noqa: F821 - PyInstaller 提供
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="paget-core",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # 必须保留控制台：协议就走 stdin/stdout
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# 目录产物：dist/paget-core/{paget-core,_internal/}
coll = COLLECT(  # noqa: F821 - PyInstaller 提供
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="paget-core",
)
