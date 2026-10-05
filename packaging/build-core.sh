#!/usr/bin/env bash
#
# Build the frozen reading core and install it where Tauri expects a sidecar.
#
#   packaging/build-core.sh [--no-smoke]
#
# What it does, in order:
#
# 1. finds the Python that can import `wreader` (the core checkout's own venv,
#    `$WREADER_CORE_PYTHON`, or whatever `python3` is first on PATH);
# 2. freezes `packaging/werd-core.spec` in a scratch directory, so no build
#    leftovers ever land in the working tree;
# 3. copies the result to `src-tauri/binaries/werd-core/`, which
#    `tauri.conf.json` ships as the `core` **resource** -- the app then starts
#    `<resource dir>/core/werd-core` (see `CoreCommand::resolve` in
#    `src-tauri/src/core_client.rs`);
# 4. runs `packaging/smoke_core.py` on the installed file (skip with --no-smoke).
#
# The binary is what the shipped app runs, so it must speak the same protocol and
# write the same `~/.wreader` files as `python -m wreader.serve`.  Step 4 is what
# proves that; do not skip it before a release build.
#
# WHY one directory and not one single file (PyInstaller's `--onefile`):
# measured on the development machine (Intel macOS), answering one `ping`:
#
#   python -m wreader.serve        0.7 s
#   this onedir build              1.1 s
#   the same things as --onefile  12-24 s
#
# A onefile build unpacks its payload into a fresh temp directory on **every**
# launch, and macOS rescans that newly written executable every time.  That cost
# would land on the user's first screen, so the app ships the directory instead.
# (A single file would also not fit through Tauri's `externalBin` name-triple
# convention without rebuilding the shell per architecture.)
#
# NOTE: PyInstaller is not a dependency of the core project (the core stays a
# plain library + CLI).  Install it into the interpreter this script picks, e.g.
#   ../wreader/.venv/bin/python -m pip install pyinstaller

set -euo pipefail

# 脚本自己所在目录 = packaging/；仓库根是它的上一级
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_root="$(dirname "$here")"
# 无论从哪个目录调用，后面的相对路径都按仓库根算
cd "$gui_root"

# 默认按"两个仓库并排"找内核；换布局就设 WREADER_ROOT
if [[ -n "${WREADER_ROOT:-}" ]]; then
  core_root="$(cd "$WREADER_ROOT" && pwd)"
else
  core_root="$(cd "$gui_root/../wreader" && pwd)"
fi
# 导出给 spec 用，两边看到的是同一个路径
export WREADER_ROOT="$core_root"

# 跑 PyInstaller 的解释器：显式指定 > 内核 venv > PATH 上的 python3
if [[ -n "${WREADER_CORE_PYTHON:-}" ]]; then
  python="$WREADER_CORE_PYTHON"
elif [[ -x "$core_root/.venv/bin/python" ]]; then
  python="$core_root/.venv/bin/python"
else
  python="$(command -v python3 || true)"
fi
if [[ -z "$python" || ! -x "$python" ]]; then
  echo "error: no usable Python found (set WREADER_CORE_PYTHON)" >&2
  exit 1
fi

# 必须先能 import wreader：否则冻结出来的会是个空壳
if ! "$python" -c "import wreader" >/dev/null 2>&1; then
  echo "error: $python cannot import wreader -- install the core first:" >&2
  echo "       $python -m pip install -e \"$core_root\"" >&2
  exit 1
fi

# PyInstaller 只能由那个解释器提供（它要和自己要冻结的解释器同源）
if ! "$python" -m PyInstaller --version >/dev/null 2>&1; then
  echo "error: PyInstaller is not installed for $python -- run:" >&2
  echo "       $python -m pip install pyinstaller" >&2
  exit 1
fi

# 目标三元组只用来报告架构（资源是按目录发的，配置里不写三元组）
triple="$(rustc -vV | sed -n 's/^host: //p')"
if [[ -z "$triple" ]]; then
  echo "error: cannot read the host triple from rustc" >&2
  exit 1
fi
# Tauri 打包时按这个相对路径找资源源（见 tauri.conf.json 的 bundle.resources）
target="src-tauri/binaries/werd-core"

# 构建与产物都放临时目录，工作树里不留 build/ 与 dist/
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

echo "core      : $core_root"
echo "python    : $python ($("$python" -V 2>&1))"
echo "pyinstall : $("$python" -m PyInstaller --version)"
echo "triple    : $triple"
echo "building  : (this takes a minute)"

# --noconfirm 覆盖旧产物；workpath/distpath 都指向 scratch
"$python" -m PyInstaller \
  --noconfirm \
  --distpath "$scratch/dist" \
  --workpath "$scratch/build" \
  "$here/werd-core.spec"

# 装到 Tauri 期望的位置：整目录覆盖（旧产物一并清掉，免得留着一份误导人的旧内核）
rm -rf "$target"
mkdir -p src-tauri/binaries
cp -R "$scratch/dist/werd-core" "$target"

echo "installed : $target/werd-core ($(du -sh "$target" | cut -f1) total, $(file -b "$target/werd-core" | cut -d, -f1,2))"

# 默认验一遍：能编出来不等于能干活
if [[ "${1:-}" == "--no-smoke" ]]; then
  echo "smoke     : skipped (--no-smoke)"
else
  echo "smoke     :"
  # 用同一个解释器当客户端（它本来就是这个仓库的开发环境）
  "$python" "$here/smoke_core.py" "$target/werd-core"
fi

echo
echo "next      : npm run tauri build -- --ignore-version-mismatches   # 打包成 .app / .dmg"
echo "            (the sidecar lands in the bundle as Resources/core/werd-core)"
echo "            (the flag is needed while this machine is on rustc 1.87 -- see README「打包」)"
