"""The shelf layout: the order of the books and the dividers between them.

The index (``library.json``) says *which* books you have.  This module says *where*
they stand, and it is a second, tiny document beside it::

    ~/.wreader/shelf.json

    {
      "order":    ["<book_id>", ...],
      "dividers": [{"id": "d...", "label": "诗词",
                    "before": "<book_id>", "until": "<book_id>"}],
      "region":   "d..."
    }

Why a file of its own instead of a field on every book: the arrangement is one
*list* and a divider is not a book at all.  Folding both into ``library.json``
would make every other reader of that index (the terminal reader, the statistics,
``werd data export``) learn about a shelf concept it does not need, and it would
put two very different kinds of change behind the same file.  Nothing here is
required for reading: a missing ``shelf.json`` simply means "title order, no
dividers", which is exactly what the shelf looked like before.

The rules live here once -- the GUI (``paget/src/lib/shelfManage.ts``) mirrors
them, but the kernel is the authority:

* ``order``    -- unknown ids are dropped when writing (the index is authoritative:
                  a book that was deleted must not linger) and duplicates collapse
                  to the first occurrence.  Books the layout never heard of are
                  *not* a problem: :func:`ordered_books` puts them after the
                  arranged ones, in title order.
* ``dividers`` -- a divider is a **pair of boards** around one stretch of the shelf:
                  the opening board stands before a book (``before``) and the closing
                  one before another book (``until``) -- the region is what lies
                  between them.  ``until`` missing (a layout written before pairs
                  existed) or ``null`` both mean "no closing board: the region runs to
                  the right end of the shelf".  Anchors are **book ids**, never "slot
                  3": the shelf re-flows whenever the window narrows, so a numeric slot
                  would drift.  ``before: null`` means "after the last book"; an anchor
                  that no longer exists falls back to ``null``.
* ``labels``   -- at most :data:`MAX_LABEL_CHARS` characters (code points);
                  an empty label falls back to :data:`DEFAULT_LABEL`.
* ``region``   -- the divider whose area new imports land in; ``null`` = the end.
"""

# 延迟求值类型注解
from __future__ import annotations

# json：读写 shelf.json（它是纯文本，用户随时能手改与备份）
import json
# 路径类型
from pathlib import Path
# 类型注解
from typing import Any, Dict, List, Optional, Tuple

# 同包：文件位置（与索引并排）+ 原子写 + 取书单
from . import config, library

# 对外暴露的东西：读 / 写 / 归一化 + 两个渲染用的视图
__all__ = [
    "DEFAULT_LABEL",
    "MAX_LABEL_CHARS",
    "SHELF_FILENAME",
    "UNASSIGNED_LABEL",
    "ShelfError",
    "empty_layout",
    "load_layout",
    "normalise_layout",
    "ordered_books",
    "save_layout",
    "set_layout",
    "shelf_file",
    "shelf_regions",
]

# 布局文件名：与 library.json 并排（$WREADER_HOME 一改，它也跟着走）
SHELF_FILENAME = "shelf.json"
# 标签最多几个字（码点）
MAX_LABEL_CHARS = 6
# 新隔板还没命名时叫什么
DEFAULT_LABEL = "未命名区域"
# 第一块隔板之前那一段叫什么（它不是一个"未命名区域"，而是"还没分区"）
UNASSIGNED_LABEL = "未分区"


class ShelfError(Exception):
    """Raised when a shelf layout cannot be read or written."""


def shelf_file() -> Path:
    """Return the layout's own file -- always beside the library index."""
    # 与 library.json 同一个目录：备份 / 换机器时两个文件一起搬
    return config.library_file().with_name(SHELF_FILENAME)


def empty_layout() -> Dict[str, Any]:
    """Return a layout with nothing arranged yet."""
    # 没有顺序、没有隔板、没有选中区域：也就是"标题顺序的书架"
    return {"order": [], "dividers": [], "region": None}


def label_text(raw: Any) -> str:
    """Return *raw* as a shelf label: whitespace collapsed, at most 6 characters."""
    # 不是字符串 / 空串 / 全空白 → 默认名
    text = " ".join(str(raw).split()) if isinstance(raw, str) else ""
    if not text:
        return DEFAULT_LABEL
    # Python 的字符串本来就按码点下标，直接切片不会切掉 emoji 的一半
    return text[:MAX_LABEL_CHARS]


def normalise_layout(raw: Any) -> Dict[str, Any]:
    """Return *raw* as a layout document with every documented field present.

    Used for both directions: a hand edited ``shelf.json`` and a payload from the
    GUI go through the very same funnel, so a bad value can never reach the file
    (or the shelf) in a shape the other side does not expect.
    """
    # 不是对象（缺省 / 数组 / 手改成了字符串）就当空布局
    source = raw if isinstance(raw, dict) else {}
    # 顺序：只留非空字符串，重复的只认第一处
    order: List[str] = []
    seen: set = set()
    for book_id in source.get("order") or []:
        if not isinstance(book_id, str) or not book_id or book_id in seen:
            continue
        seen.add(book_id)
        order.append(book_id)
    # 隔板：id 必须是非空字符串且不重复；label / before 缺了都有默认
    dividers: List[Dict[str, Any]] = []
    known: set = set()
    for entry in source.get("dividers") or []:
        # 手改成了字符串 / 数字的项：丢掉
        if not isinstance(entry, dict):
            continue
        divider_id = entry.get("id")
        # 没有 id 或 id 撞了：这块隔板认不出来
        if not isinstance(divider_id, str) or not divider_id or divider_id in known:
            continue
        known.add(divider_id)
        # 起始板挂在哪本书前面
        before = entry.get("before")
        # 结束板挂在哪本书前面（缺这个字段 = 旧布局：这一区一直到书架末尾，没有右板）
        until = entry.get("until")
        dividers.append(
            {
                "id": divider_id,
                "label": label_text(entry.get("label")),
                # 挂在某本书前面；null / 坏值 = 最末
                "before": before if isinstance(before, str) and before else None,
                # 同上：null / 坏值 / 缺字段 = 这一区一直到书架末尾（右板收起）
                "until": until if isinstance(until, str) and until else None,
            }
        )
    # 选中的区域必须真的是上面某一块隔板，否则当作没选
    region = source.get("region")
    return {
        "order": order,
        "dividers": dividers,
        "region": region if isinstance(region, str) and region in known else None,
    }


def load_layout() -> Dict[str, Any]:
    """Read the layout; a missing or broken file means "nothing arranged yet"."""
    # 目标文件（与索引并排）
    path = shelf_file()
    # 还没摆过：空布局。**不写盘** —— 只有真的改了才落盘，免得平白多出一个文件
    if not path.exists():
        return empty_layout()
    try:
        # 纯文本 JSON：坏文件只影响这一份布局，书还是照样能读
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # 读不动 / 不是 JSON：当作还没摆过（回到标题顺序）
        return empty_layout()
    # 手改过的值也照规矩收敛一遍（坏 label / 坏 before 在这里就被换掉）
    return normalise_layout(raw)


def save_layout(document: Any) -> Path:
    """Write *document* to ``shelf.json`` atomically and return its path."""
    # 落盘前再收一遍：调用方给的对象可能来自 RPC
    payload = normalise_layout(document)
    # 与索引同一个原子写（先写 .tmp、再 os.replace）；
    # 写不进去就是"布局没存住"，包成领域错误，别把 OSError 漏到 RPC / CLI 那一层
    try:
        library.write_json(shelf_file(), payload)
    except OSError as exc:
        raise ShelfError("cannot write {}: {}".format(shelf_file(), exc)) from exc
    return shelf_file()


def set_layout(layout: Any) -> Dict[str, Any]:
    """Replace the whole layout and return what was stored.

    Book ids the index does not know are dropped: ``library.json`` is the
    authority, and an id that is not in it (a book deleted here, or a shelf.json
    carried over from another machine) must not linger forever.  A divider whose
    anchor went away keeps its place at the end instead of disappearing --
    losing a label the user typed is worse than a divider that slid to the right
    end of the shelf.
    """
    # 先归一化：顺序 / 隔板 / 标签都收敛一遍
    payload = normalise_layout(layout)
    # 库里认得的书 id
    known = {str(book_id) for book_id, _book in library.list_books()}
    # 只留认得的书，且保持归一化之后的先后
    payload["order"] = [book_id for book_id in payload["order"] if book_id in known]
    # 隔板的锚点认不得就落到最末（与 GUI 的 shelfManage.ts 同一条规矩）；
    # 两头都收：起始板（before）与结束板（until），后者缺省 = 这一区一直到书架末尾
    payload["dividers"] = [
        dict(
            divider,
            before=divider["before"] if divider["before"] in known else None,
            until=divider["until"] if divider["until"] in known else None,
        )
        for divider in payload["dividers"]
    ]
    # 落盘（原子写，失败会把异常抛给调用方）
    save_layout(payload)
    return payload


def ordered_books() -> List[Tuple[str, Dict[str, Any]]]:
    """Return ``(book_id, record)`` pairs in shelf order.

    The arranged books come first, in the order the layout says; everything the
    layout never heard of (imported after the last arrangement) follows in title
    order, so a fresh import never pushes the arranged books around.
    """
    # 布局里的先后：书 id -> 名次
    rank = {book_id: index for index, book_id in enumerate(load_layout()["order"])}
    # 索引里的全部书（library.list_books 已经是标题序）
    rows = library.list_books()
    # 摆过的按布局排（list.sort 稳定，标题相同的书也不会乱）
    arranged = [item for item in rows if str(item[0]) in rank]
    arranged.sort(key=lambda item: rank[str(item[0])])
    # 没摆过的接在后面，保持标题序
    fresh = [item for item in rows if str(item[0]) not in rank]
    return arranged + fresh


def shelf_regions() -> List[Dict[str, Any]]:
    """Return the shelf split into its regions (what ``werd shelf`` prints).

    Each row is ``{"id": <divider id or None>, "label": str, "books": [(id, record)]}``.
    A divider owns the stretch **between its two boards**: from the book it stands
    before (``before``) up to the book its closing board stands before (``until``);
    ``until: null`` means "all the way to the right end of the shelf".  Two boards on
    the same spot make an empty region (a divider that was just added, waiting for
    books); a divider whose ``before`` and ``until`` are swapped is empty too.

    The first row carries ``id: None`` and holds every book **no** divider claims --
    that stretch is not "an unnamed region", it is "not arranged into a region yet".
    Overlapping regions resolve the same way the GUI does: a book belongs to the
    region that starts last among those covering it (so a legacy layout, where every
    divider ran to the next one, reads exactly as it always did).
    """
    # 布局 + 摆好顺序的书单
    layout = load_layout()
    books = ordered_books()
    # 书 id → 它在上面这份书单里的下标（锚点换算用）
    position = {str(item[0]): index for index, item in enumerate(books)}
    # 每一区算成 [start, end) 两头的下标；锚点认不得 / 缺省都当最末
    spans: List[Tuple[int, int, Dict[str, Any]]] = []
    for divider in layout["dividers"]:
        # 起始板：`before` 缺省（或锚点那本书已经不在库里）→ 从最末开始（空区）
        start = position.get(divider["before"], len(books))
        # 结束板：`until` 缺省 → 一直到书架最末；两头反了也当空区（max 兜住）
        end = position.get(divider["until"], len(books)) if divider["until"] else len(books)
        spans.append((start, max(start, end), divider))
    # 区的先后就是在书架上的先后（起点相同则保持文件里的先后：排序稳定）
    spans.sort(key=lambda span: span[0])
    # 第一区是"还没分区"的那一段，之后每块隔板领它自己两板之间的那一段
    regions: List[Dict[str, Any]] = [{"id": None, "label": UNASSIGNED_LABEL, "books": []}]
    for _start, _end, divider in spans:
        regions.append({"id": divider["id"], "label": divider["label"], "books": []})
    # 一本书归"圈住它、且起点最靠后"的那一区（同一处两块板时后挂的那块认领）
    for index, item in enumerate(books):
        owner = 0
        for offset, (start, end, _divider) in enumerate(spans):
            if start <= index < end:
                owner = offset + 1
        regions[owner]["books"].append(item)
    return regions
