"""Smoke test for a built `werd-core` binary -- run it on the frozen sidecar.

Building a binary only proves PyInstaller did not crash; it says nothing about
whether the *frozen* core can still find its data files, its handlers or
`~/.wreader`.  This script drives a throwaway copy of the real reading path
against the binary and then checks what landed on disk:

1. the protocol handshake (`ping`) returns a version;
2. `import` -> `list` -> `toc` -> `text` work on a small Chinese book, and an epub's
   **own cover** lands next to its converted text (that is where the GUI looks for it);
3. `position` and `session` write into **that** temp `$WREADER_HOME`, and the
   session unlocks achievements -- which only works when
   `wreader/data/achievements.json` made it into the bundle;
4. every method registered in `wreader/serve.py` can be *dispatched* without a
   missing module (this is what catches a too-eager `excludes` list in the spec);
5. closing stdin ends the process, and it leaves no orphan behind (a onefile
   build has a bootloader parent plus the real child -- both must go).

Nothing here touches the user's real library: `$WREADER_HOME` /
`$WREADER_NOVELS_DIR` point at a fresh temp directory that is deleted on exit.

Usage::

    python packaging/smoke_core.py src-tauri/binaries/werd-core-x86_64-apple-darwin
"""

from __future__ import annotations

# 逐行协议的 JSON
import json
# 给子进程准备隔离的数据目录
import os
# 找默认的内核仓库位置
import pathlib
# 从 serve.py 里抓方法名（不手抄一份会漂的清单）
import re
# 起二进制、收尾时查孤儿进程
import subprocess
# 打印用法与结果
import sys
# 临时目录
import tempfile
# 造一本带封面的 epub 用
import zipfile

# 烟测用的小书：两章、几行，够跑通导入 / 目录 / 正文 / 进度
BOOK = """第一章 科学边界

汪淼看到了一串数字在眼前跳动。
他抬头望向窗外的夜空。

第二章 台球

“三体世界就在我们眼前。”丁仪说道。
"""

# 方法名在 serve.py 里长这样：@_method("text")
_METHOD_RE = re.compile(r'@_method\("([^"]+)"\)')

# 冻结点缺模块时抛的错（说明 spec 的 excludes 砍过头了）
_MISSING_MODULE_HINTS = ("ModuleNotFoundError", "ImportError", "No module named")

# 带封面那本 epub 的封面字节（内容无关紧要，能对上就说明"搬对了"）
EPUB_COVER_BYTES = b"\x89PNG\r\n\x1a\npaget-smoke-cover"


def _write_epub_with_cover(target: pathlib.Path) -> pathlib.Path:
    """Write a minimal epub whose cover is declared the EPUB 3 way."""
    # container.xml 指向 opf
    container = (
        '<?xml version="1.0"?><container><rootfiles>'
        '<rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
    )
    # manifest 里既有正文章节，也有一张 properties="cover-image" 的图
    opf = (
        "<package><manifest>"
        '<item id="c1" href="text.xhtml" media-type="application/xhtml+xml"/>'
        '<item id="cover-img" href="cover.png" media-type="image/png"'
        ' properties="cover-image"/>'
        "</manifest><spine><itemref idref=\"c1\"/></spine></package>"
    )
    # 一本最小可读的 epub：容器 + opf + 一章正文 + 封面图
    with zipfile.ZipFile(str(target), "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/text.xhtml", "<html><body><p>封面这本的正文</p></body></html>")
        archive.writestr("OEBPS/cover.png", EPUB_COVER_BYTES)
    return target


def _fail(message: str) -> None:
    """Print one failure and stop."""
    # 退出码非 0，脚本就能被 build-core.sh 直接串起来
    raise SystemExit("FAIL: {}".format(message))


def _call(process: "subprocess.Popen[str]", method: str, params: dict) -> dict:
    """Send one request and return its `result` (raising on an `error`)."""
    # 协议是一行一个 JSON 对象
    request = json.dumps({"id": 1, "method": method, "params": params}, ensure_ascii=False)
    # 写一行、冲洗，内核才会处理
    process.stdin.write(request + "\n")  # type: ignore[union-attr]
    process.stdin.flush()  # type: ignore[union-attr]
    # 一问一答：读回一行就够了
    line = process.stdout.readline()  # type: ignore[union-attr]
    if not line:
        # 子进程没答话就没了：stderr 上有原因（已继承到终端）
        _fail("the sidecar exited without answering {}".format(method))
    answer = json.loads(line)
    if "error" in answer:
        # 内核自己报的错：原样带出去，别吞掉
        _fail("{} failed: {}".format(method, answer["error"]))
    return answer["result"]


def _try(process: "subprocess.Popen[str]", method: str, params: dict) -> dict:
    """Send one request and return the whole envelope (error or not)."""
    # 与 _call 一样，但把 error 也交回给调用方（方法扫描要看错误内容）
    request = json.dumps({"id": 1, "method": method, "params": params}, ensure_ascii=False)
    process.stdin.write(request + "\n")  # type: ignore[union-attr]
    process.stdin.flush()  # type: ignore[union-attr]
    line = process.stdout.readline()  # type: ignore[union-attr]
    if not line:
        _fail("the sidecar exited without answering {}".format(method))
    return json.loads(line)


def _pids(name: str) -> set:
    """Return the PIDs of processes called *name* (empty when `pgrep` says none)."""
    # pgrep 没找到时返回 1，不算异常
    result = subprocess.run(["pgrep", "-x", name], capture_output=True, text=True)
    # 每行一个 PID
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def _methods(core_root: pathlib.Path) -> list:
    """Read the registered method names out of `wreader/serve.py`."""
    # 找不到源码树就跳过这一步（不是失败：脚本仍能验阅读路径）
    source = core_root / "wreader" / "serve.py"
    if not source.is_file():
        return []
    # 抓装饰器里的名字，保持与内核同步
    return _METHOD_RE.findall(source.read_text(encoding="utf-8"))


def main(argv: list) -> int:
    """Run the smoke test against ``argv[1]``."""
    # 用法：一个参数（二进制路径）
    if len(argv) != 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip().splitlines()[-1])
        return 2
    # 二进制必须真的存在，否则后面的报错会很难懂
    binary = pathlib.Path(argv[1]).resolve()
    if not binary.is_file():
        _fail("no such binary: {}".format(binary))
    # 默认按"两个仓库并排"找内核源码（方法扫描用）
    gui_root = pathlib.Path(__file__).resolve().parent.parent
    core_root = pathlib.Path(os.environ.get("WREADER_ROOT") or gui_root.parent / "wreader")
    # 进程名 = 文件名，用来查孤儿
    name = binary.name

    with tempfile.TemporaryDirectory() as tmp:
        # 隔离的数据目录：绝不碰用户真实的 ~/.wreader
        root = pathlib.Path(tmp)
        home, novels, books = root / "data", root / "novels", root / "books"
        books.mkdir(parents=True)
        # 写一本中文小书（内核导入时会转成 UTF-8 放进 novels/）
        (books / "刘慈欣-三体.txt").write_text(BOOK, encoding="utf-8")
        # 子进程环境：数据目录全部指向临时目录
        env = dict(os.environ)
        env["WREADER_HOME"] = str(home)
        env["WREADER_NOVELS_DIR"] = str(novels)
        # 老名字也清掉，免得继承到开发机上的真实数据
        env.pop("NR_HOME", None)
        env.pop("NR_NOVELS_DIR", None)
        # 起进程前先记下已有的同名进程，收尾时才能区分"自己漏的"和"早就有的"
        before = _pids(name)
        process = subprocess.Popen(
            [str(binary)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
        )

        # 1) 握手：能答话就说明冻结点真的起来了
        pong = _call(process, "ping", {})
        if not pong.get("pong"):
            _fail("ping did not answer with pong: {}".format(pong))
        print("  ping      -> version {}".format(pong.get("version")))

        # 2) 导入 → 书架 → 目录 → 正文
        imported = _call(process, "import", {"path": str(books)})
        if not imported.get("imported"):
            _fail("import brought nothing in: {}".format(imported))
        book_id = imported["imported"][0]["id"]
        print("  import    -> {} {}".format(book_id, imported["imported"][0]["title"]))

        # 书架里应当有这一本，且标题没被编码搞坏
        shelf = _call(process, "list", {})["books"]
        if len(shelf) != 1 or shelf[0]["title"] != "三体":
            _fail("unexpected shelf: {}".format(shelf))
        print("  list      -> {} book(s), first = {}".format(len(shelf), shelf[0]["title"]))

        # 目录：正则识别出的两章
        titles = [entry["title"] for entry in _call(process, "toc", {"book_id": book_id})["entries"]]
        if titles != ["第一章 科学边界", "第二章 台球"]:
            _fail("unexpected chapters: {}".format(titles))
        print("  toc       -> {}".format(titles))

        # 正文：按行号取，第一行就是第一章标题
        lines = _call(process, "text", {"book_id": book_id, "start": 0, "count": 2})["lines"]
        if not lines or lines[0] != "第一章 科学边界":
            _fail("unexpected text: {}".format(lines))
        print("  text      -> {}".format(lines[0]))

        # epub 的内嵌封面：导入这一刻就该落到正文旁边的同名图片（桌面壳就在那儿找它）
        _call(process, "import", {"path": str(_write_epub_with_cover(books / "带封面的小书.epub"))})
        shelf_now = _call(process, "list", {})["books"]
        epub_rows = [row for row in shelf_now if row["title"] == "带封面的小书"]
        if not epub_rows:
            _fail("the epub did not reach the shelf: {}".format(shelf_now))
        cover = pathlib.Path(epub_rows[0]["file_path"]).with_suffix(".png")
        if not cover.is_file() or cover.read_bytes() != EPUB_COVER_BYTES:
            _fail("the epub cover did not land next to the text: {}".format(cover))
        print("  cover     -> {} ({} bytes)".format(cover.name, cover.stat().st_size))

        # 3) 写回位置与阅读会话（GUI 退出时走的就是这条链）
        saved = _call(process, "position", {
            "book_id": book_id, "position": 4, "percentage": 55.6, "total": 9,
        })
        if not saved.get("saved"):
            _fail("position was not saved: {}".format(saved))
        session = _call(process, "session", {
            "book_id": book_id, "position": 8, "percentage": 100.0, "seconds": 600,
            "lines_read": 5, "ranges": [[0, 8]],
            "started": "2026-03-01T20:00:00", "ended": "2026-03-01T20:10:00",
        })
        if not session.get("saved"):
            _fail("session was not saved: {}".format(session))
        unlocked = [item["id"] for item in session.get("unlocked", [])]
        # 解锁要读到打包进去的成就定义，空就说明 data/ 没进二进制
        if not unlocked:
            _fail("no achievement unlocked -- is wreader/data/ in the bundle?")
        print("  session   -> saved={} unlocked={}".format(session["saved"], unlocked))

        # 落库检查：数据必须写进这个临时 home，且数字对得上
        progress = json.loads((home / "library.json").read_text(encoding="utf-8"))["books"][book_id]["progress"]
        if progress["total_time_seconds"] != 600 or not progress["finished"]:
            _fail("library.json looks wrong: {}".format(progress))
        if len(progress["sessions"]) != 1:
            _fail("expected exactly one session, got {}".format(progress["sessions"]))
        print("  library   -> line={} {}% sessions={} seconds={} finished={}".format(
            progress["current_line"], progress["percentage"],
            len(progress["sessions"]), progress["total_time_seconds"], progress["finished"]))

        # 4) 方法扫描：每个注册过的方法都要能被派发（缺模块会在这里现形）
        methods = _methods(core_root)
        if not methods:
            print("  methods   -> skipped (no wreader/serve.py next to this checkout)")
        else:
            for method in methods:
                answer = _try(process, method, {})
                message = str(answer.get("error", {}).get("message", ""))
                # 砍掉某个模块时，报错里会出现这些字样
                for hint in _MISSING_MODULE_HINTS:
                    if hint in message:
                        _fail("{} needs a module that is not in the bundle: {}".format(method, message))
                # 方法名没对上（通常是这份脚本与内核漂了，或者根本没注册进去）
                if "unknown method" in message:
                    _fail("{} is registered in serve.py but not in the binary".format(method))
            print("  methods   -> {} methods dispatch cleanly".format(len(methods)))

        # 5) 关掉 stdin：内核应当自己收尾退出，而且不留孤儿（onefile 有父子两个进程）
        process.stdin.close()  # type: ignore[union-attr]
        code = process.wait(timeout=30)
        if code != 0:
            _fail("the sidecar exited with {}".format(code))
        # 只把"这次新出现的"算作泄漏，避免误报开发机上别人的残留进程
        leaked = _pids(name) - before
        if leaked:
            _fail("the sidecar left orphan process(es) behind: {}".format(sorted(leaked)))
        print("  exit      -> 0, no orphan left")

    print("PASS: {} runs the reading core standalone".format(binary.name))
    return 0


if __name__ == "__main__":
    # 退出码透传给调用方（build-core.sh 靠它判断成败）
    raise SystemExit(main(sys.argv))
