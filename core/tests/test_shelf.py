"""Tests for :mod:`wreader.shelf` -- where the books stand and who divides them.

The arrangement lives in a second, tiny document beside the index (``shelf.json``):
the GUI manage mode writes it, ``werd shelf`` reads it, and ``library.json`` stays
the only authority for *which* books exist.  These tests pin that split: a layout
can never invent a book, and losing the layout can never lose a book.
"""

# 延迟求值类型注解
from __future__ import annotations

# 直接读写 shelf.json（手改过的文件也要能读）
import json
# 类型注解
from typing import Any, Dict, List

# 临时家目录的类型（fixture 返回值）
from pathlib import Path

# pytest.raises
import pytest

# 被测模块 + 内核：造书、看布局与索引各自落在哪
from wreader import cli, config, library, serve, shelf

# 复用样例正文（conftest 是 tests/ 里的同级模块，见 test_library.py 里的说明）
from conftest import BOOK_LINES  # pyright: ignore[reportMissingImports]


def _add_book(home: Any, name: str) -> str:
    """Import one small book and return its id."""
    # 每本书的正文都多出自己的一行：内容不同 → id 不同（同一份正文会被判成重复导入）
    home.write_book(name, BOOK_LINES + (name,))
    # 导入回执里第一本就是刚写的那本
    return str(library.import_books(str(home.root / "books")).imported[0][0])


def _add_books(home: Any, names: List[str]) -> List[str]:
    """Import several small books and return their ids in the order given."""
    # 逐本导入（每本的正文都用同一个样例，但文件名不同 → 内容不同 → id 不同）
    return [_add_book(home, name) for name in names]


def _write_raw(text: str) -> None:
    """Drop *text* straight into shelf.json, the way a user hand-editing it would."""
    # 手改的前提是数据目录已经在（正常用起来时它一定在）
    shelf.shelf_file().parent.mkdir(parents=True, exist_ok=True)
    # 原样写进去：不经过任何归一化
    shelf.shelf_file().write_text(text, encoding="utf-8")


def test_a_missing_layout_reads_as_empty(home: Any) -> None:
    """A shelf that was never arranged is not an error: it is "title order"."""
    # 一开局没有 shelf.json
    assert not shelf.shelf_file().exists()
    # 读出来是空布局
    assert shelf.load_layout() == {"order": [], "dividers": [], "region": None}
    # 读一次不该顺手把文件建出来（只有真的改了才落盘）
    assert not shelf.shelf_file().exists()


def test_save_then_load_round_trips(home: Any) -> None:
    """What ``set_layout`` stores is exactly what the next read hands back."""
    # 摆一本真的书 + 一块挂了标签的隔板
    book_id = _add_book(home, "a.txt")
    # 整份写下去
    stored = shelf.set_layout(
        {
            "order": [book_id],
            "dividers": [{"id": "d1", "label": "诗词", "before": book_id}],
            "region": "d1",
        }
    )
    # 回来的就是落盘的那一份
    assert stored["order"] == [book_id]
    # until 也写出来了（缺省 = 这一区一直到书架末尾）
    assert stored["dividers"] == [
        {"id": "d1", "label": "诗词", "before": book_id, "until": None}
    ]
    assert stored["region"] == "d1"
    # 再读一次也一模一样
    assert shelf.load_layout() == stored
    # 文件就在索引旁边（备份 / 换机器时两个文件一起搬）
    assert shelf.shelf_file().parent == config.library_file().parent


def test_a_broken_file_reads_as_empty(home: Any) -> None:
    """A hand-mangled shelf.json must not take the shelf (or the reading) down."""
    # 写一个不是 JSON 的文件
    _write_raw("{oops")
    # 读出来当"还没摆过"
    assert shelf.load_layout() == {"order": [], "dividers": [], "region": None}


def test_hand_edited_values_are_normalised(home: Any) -> None:
    """Values typed by hand in shelf.json go through the same funnel as the GUI's."""
    # 手改一份：顺序里有重复与非字符串，隔板里有重复 id / 缺 id / 坏 before
    _write_raw(
        json.dumps(
            {
                "order": ["a", "a", 7, "", "b"],
                "dividers": [
                    {"id": "d1", "label": "  一首   诗  ", "until": "b"},
                    {"id": "d1", "label": "重复的"},
                    {"label": "没有 id"},
                    {"id": "d2", "before": 42, "until": 7},
                ],
                "region": "d9",
            }
        )
    )
    # 读回来：顺序去重、隔板去重、标签收空白、坏 before / until 落成最末、选不中的区域当没选
    layout = shelf.load_layout()
    assert layout["order"] == ["a", "b"]
    assert layout["dividers"] == [
        {"id": "d1", "label": "一首 诗", "before": None, "until": "b"},
        {"id": "d2", "label": shelf.DEFAULT_LABEL, "before": None, "until": None},
    ]
    assert layout["region"] is None


def test_labels_are_capped_and_empty_ones_fall_back(home: Any) -> None:
    """A label is at most six characters; an empty one is the default name."""
    # 八个汉字 → 截到六个；emoji 也按码点数，不会被切掉半个
    assert shelf.label_text("一二三四五六七八") == "一二三四五六"
    # 全是空白 → 默认名
    assert shelf.label_text("   ") == shelf.DEFAULT_LABEL
    # 根本不是字符串 → 默认名
    assert shelf.label_text(None) == shelf.DEFAULT_LABEL
    # 码点：七个 emoji 截成六个
    assert len(shelf.label_text("🙂🙂🙂🙂🙂🙂🙂")) == shelf.MAX_LABEL_CHARS


# 参数化：几份坏输入都要落回默认标签
@pytest.mark.parametrize("raw", [None, 7, "", "   ", "\n\t"])
def test_a_label_that_is_not_a_label_falls_back(raw: Any) -> None:
    """Anything that is not usable text becomes the default region name."""
    # 坏输入一律回默认名，绝不把空串写进文件
    assert shelf.label_text(raw) == shelf.DEFAULT_LABEL


# --------------------------------------------------------------- 顺序与分区


def test_arranged_books_come_first_the_rest_keeps_title_order(home: Any) -> None:
    """Imports that arrived after the last arrangement never push the shelf around."""
    # 三本书（文件名决定正文，所以 id 各不相同）
    alpha, beta, gamma = _add_books(home, ["alpha.txt", "beta.txt", "gamma.txt"])
    # 只把 gamma 排到最前（beta 没被摆过）
    shelf.set_layout({"order": [gamma]})
    # 摆过的在前，没摆过的按标题序接在后面
    assert [book_id for book_id, _book in shelf.ordered_books()] == [gamma, alpha, beta]


def test_without_a_layout_the_order_is_the_title_order(home: Any) -> None:
    """No arrangement on disk = exactly what the index already gives."""
    # 造两本书
    _add_books(home, ["one.txt", "two.txt"])
    # 与 library.list_books()（标题序）逐一对上
    assert [item[0] for item in shelf.ordered_books()] == [item[0] for item in library.list_books()]


def test_regions_split_right_after_each_divider(home: Any) -> None:
    """A divider leads the stretch of books on its right."""
    # 四本书
    first, second, third, fourth = _add_books(
        home, ["1.txt", "2.txt", "3.txt", "4.txt"]
    )
    # 顺序就是导入的先后；一块叫"诗词"的隔板挂在第三本前面
    shelf.set_layout(
        {
            "order": [first, second, third, fourth],
            "dividers": [{"id": "d1", "label": "诗词", "before": third}],
        }
    )
    # 第一区是"还没分区"的那两本，第二区是隔板右边那两本
    regions = shelf.shelf_regions()
    assert [region["id"] for region in regions] == [None, "d1"]
    assert [region["label"] for region in regions] == [shelf.UNASSIGNED_LABEL, "诗词"]
    assert [[item[0] for item in region["books"]] for region in regions] == [
        [first, second],
        [third, fourth],
    ]
    # 每本书恰好出现在一区里
    flat = [str(item[0]) for region in regions for item in region["books"]]
    assert sorted(flat) == sorted([first, second, third, fourth])


def test_a_divider_at_the_end_owns_an_empty_region(home: Any) -> None:
    """``before: null`` means "after the last book", so that region starts empty."""
    # 两本书 + 一块挂在最末的隔板
    first, second = _add_books(home, ["a.txt", "b.txt"])
    # 布局：顺序照旧，隔板挂在最末
    shelf.set_layout(
        {
            "order": [first, second],
            "dividers": [{"id": "d1", "label": "待整理", "before": None}],
        }
    )
    # 末尾那一区没有书；两本都留在第一区
    regions = shelf.shelf_regions()
    assert [item[0] for item in regions[0]["books"]] == [first, second]
    assert regions[1]["books"] == []


def test_two_dividers_on_one_anchor_the_later_one_owns_the_books(home: Any) -> None:
    """Same anchor twice: the one written later (further right) leads the books."""
    # 三本书 + 两块挂在同一处的隔板
    first, second, third = _add_books(home, ["a.txt", "b.txt", "c.txt"])
    # 两块隔板都挂在第二本前面
    shelf.set_layout(
        {
            "order": [first, second, third],
            "dividers": [
                {"id": "d1", "label": "甲", "before": second},
                {"id": "d2", "label": "乙", "before": second},
            ],
        }
    )
    # 后挂的那块领走这一区的书，前一块是空区
    regions = shelf.shelf_regions()
    assert [[str(item[0]) for item in region["books"]] for region in regions] == [
        [first],
        [],
        [second, third],
    ]


def test_a_pair_owns_the_stretch_between_its_two_boards(home: Any) -> None:
    """A divider is a pair of boards: its region ends where the closing one stands."""
    # 四本书，按这个先后摆好
    first, second, third, fourth = _add_books(home, ["a.txt", "b.txt", "c.txt", "d.txt"])
    # 一对板：起始板挂在第二本前面，结束板挂在第四本前面 → 这一区只有第二、三本
    shelf.set_layout(
        {
            "order": [first, second, third, fourth],
            "dividers": [{"id": "d1", "label": "诗词", "before": second, "until": fourth}],
        }
    )
    # 分区视图：两板之间那两本归 d1，剩下的（第一本与第四本）都还在"还没分区"那一段
    regions = shelf.shelf_regions()
    # 区的先后：先是"还没分区"那一段，再是这一对板
    assert [region["id"] for region in regions] == [None, "d1"]
    # 第四本在结束板右边，谁也没圈它 → 回到"还没分区"（按书架先后排在最后）
    assert [str(item[0]) for item in regions[0]["books"]] == [first, fourth]
    # 两板之间那两本归这一区
    assert [str(item[0]) for item in regions[1]["books"]] == [second, third]


def test_a_pair_whose_boards_touch_owns_nothing(home: Any) -> None:
    """Two boards on one spot: the region is empty, every book stays unarranged."""
    # 两本书
    first, second = _add_books(home, ["a.txt", "b.txt"])
    # 一对并排的板（刚加出来、还没拖开的样子：before === until）
    shelf.set_layout(
        {
            "order": [first, second],
            "dividers": [
                {"id": "d1", "label": "未命名区域", "before": second, "until": second}
            ],
        }
    )
    # 这一区一本都没圈到；两本书都还在"还没分区"那一段（顺序不变）
    regions = shelf.shelf_regions()
    # 区的先后
    assert [region["id"] for region in regions] == [None, "d1"]
    # 两本书都还在"还没分区"那一段
    assert [str(item[0]) for item in regions[0]["books"]] == [first, second]
    # 而这一区是空的
    assert regions[1]["books"] == []


def test_a_closing_board_can_be_left_out(home: Any) -> None:
    """``until: null`` = no closing board: the region runs to the right end."""
    # 三本书
    first, second, third = _add_books(home, ["a.txt", "b.txt", "c.txt"])
    # 起始板挂在第二本前面，没有结束板
    shelf.set_layout(
        {
            "order": [first, second, third],
            "dividers": [{"id": "d1", "label": "诗词", "before": second, "until": None}],
        }
    )
    # 第二、三本归这一区（一直到书架末尾），第一本留在"还没分区"
    regions = shelf.shelf_regions()
    # 第一本谁也没圈
    assert [str(item[0]) for item in regions[0]["books"]] == [first]
    # 第二、三本归这一区（一直到书架末尾）
    assert [str(item[0]) for item in regions[1]["books"]] == [second, third]


def test_overlapping_pairs_the_later_start_wins(home: Any) -> None:
    """Two pairs over the same books: the one starting last owns them (as in the GUI)."""
    # 四本书
    first, second, third, fourth = _add_books(home, ["a.txt", "b.txt", "c.txt", "d.txt"])
    # 一对从第一本圈到末尾，另一对只圈中间两本 —— 两段重叠
    shelf.set_layout(
        {
            "order": [first, second, third, fourth],
            "dividers": [
                {"id": "d1", "label": "全部", "before": first, "until": None},
                {"id": "d2", "label": "中间", "before": second, "until": fourth},
            ],
        }
    )
    # 中间那两本归后起来的那一对；两头归先起来的那一对（没有书落在"还没分区"）
    regions = shelf.shelf_regions()
    # 区的先后：先是"还没分区"，再按起点先后排这两对
    assert [region["id"] for region in regions] == [None, "d1", "d2"]
    # 没有书落在"还没分区"
    assert [str(item[0]) for item in regions[0]["books"]] == []
    # 两头归先起来的那一对
    assert [str(item[0]) for item in regions[1]["books"]] == [first, fourth]
    # 中间那两本归后起来的那一对（起点更靠后）
    assert [str(item[0]) for item in regions[2]["books"]] == [second, third]


def test_a_legacy_layout_still_splits_after_each_divider(home: Any) -> None:
    """A layout written before pairs existed reads exactly as it always did."""
    # 三本书 + 两块老式隔板（只有 before，没有 until）
    first, second, third = _add_books(home, ["a.txt", "b.txt", "c.txt"])
    # 手写一份"老的" shelf.json，原样丢进文件
    _write_raw(
        json.dumps(
            {
                "order": [first, second, third],
                "dividers": [
                    {"id": "d1", "label": "一", "before": first},
                    {"id": "d2", "label": "二", "before": second},
                ],
                "region": None,
            }
        )
    )
    # 读进来：每块隔板都补上 until = None（这一区一直到书架末尾，没有右板）
    layout = shelf.load_layout()
    assert [divider["until"] for divider in layout["dividers"]] == [None, None]
    # 分区还是老口径（后起来的认领）：d1 领第一本，d2 领第二、三本，第一段是空的
    regions = shelf.shelf_regions()
    assert [[str(item[0]) for item in region["books"]] for region in regions] == [
        [],
        [first],
        [second, third],
    ]


def test_order_can_only_hold_books_the_index_knows(home: Any) -> None:
    """``library.json`` is the authority: a layout cannot invent (or keep) a book."""
    # 一本真书 + 一个凭空捏造的 id
    book_id = _add_book(home, "real.txt")
    # 布局里混进一个不存在的 id
    stored = shelf.set_layout({"order": [book_id, "ghost", book_id], "dividers": []})
    # 捏造的丢掉、重复的收一次
    assert stored["order"] == [book_id]


def test_a_divider_whose_book_is_gone_slides_to_the_end(home: Any) -> None:
    """Losing an anchor must not lose the label the user typed."""
    # 两本书 + 挂在第一本前面的隔板
    first, second = _add_books(home, ["a.txt", "b.txt"])
    # 先摆好
    shelf.set_layout(
        {
            "order": [first, second],
            "dividers": [{"id": "d1", "label": "要留住的名字", "before": first}],
        }
    )
    # 再拿一份把锚点写成已经不在的 id 的布局（相当于那本书被删了）
    stored = shelf.set_layout(
        {
            "order": [second],
            "dividers": [
                {"id": "d1", "label": "要留住的名字", "before": "gone", "until": "gone"}
            ],
        }
    )
    # 隔板还在、标签也还在，只是两头都落到了最末（结束板也没了）
    assert stored["dividers"] == [
        {"id": "d1", "label": "要留住的名字", "before": None, "until": None}
    ]
    # 于是它领着的那一区是空的（书都留在"还没分区"那一段）
    regions = shelf.shelf_regions()
    assert regions[1]["books"] == []


# --------------------------------------------------------------- 落盘方式


def test_the_layout_file_is_beside_the_index(home: Any) -> None:
    """``shelf.json`` lives next to ``library.json``: one directory to back up."""
    # 布局文件的位置
    layout: Path = shelf.shelf_file()
    # 与索引并排（$WREADER_HOME 一改，两个文件一起走）
    assert layout.parent == config.library_file().parent
    # 文件名就是文档里写的那个
    assert layout.name == shelf.SHELF_FILENAME


def test_writing_is_atomic_and_leaves_no_temporary_file(home: Any) -> None:
    """A half written shelf must never be readable: write .tmp, then replace."""
    # 摆一次（真书，内核才认这个 id）
    book_id = _add_book(home, "a.txt")
    # 写一份带中文标签的布局
    shelf.set_layout({"order": [book_id], "dividers": [{"id": "d1", "label": "诗词"}]})
    # 正式文件在
    assert shelf.shelf_file().exists()
    # 临时文件不留下（os.replace 是原子改名）
    assert not shelf.shelf_file().with_name(shelf.SHELF_FILENAME + ".tmp").exists()
    # 纯文本 UTF-8：手看 / 手改都行，中文标签不是转义过的
    assert "诗词" in shelf.shelf_file().read_text(encoding="utf-8")


def test_the_layout_never_rewrites_the_index(home: Any) -> None:
    """Two documents, one authority: arranging the shelf cannot touch library.json."""
    # 两本书 + 一份索引快照
    first, second = _add_books(home, ["a.txt", "b.txt"])
    before = config.library_file().read_text(encoding="utf-8")
    # 把顺序倒过来（顺手加一块隔板）
    shelf.set_layout({"order": [second, first], "dividers": [{"id": "d1", "label": "诗"}]})
    # 索引一个字节都没变
    assert config.library_file().read_text(encoding="utf-8") == before


# --------------------------------------------------------------- RPC 与命令行


def test_the_sidecar_reads_and_writes_the_layout(home: Any) -> None:
    """``shelf_layout`` / ``set_shelf_layout`` are what the GUI's manage mode calls."""
    # 一本真书（内核只接受它认得的 id）
    book_id = _add_book(home, "a.txt")
    # 还没摆过：拿回来的是空布局（不是错误）
    empty = serve.handle_request({"id": 1, "method": "shelf_layout", "params": {}})
    # 空布局就是"标题顺序、没有隔板"
    assert empty["result"] == {"layout": {"order": [], "dividers": [], "region": None}}
    # 写一份进去（形状与 GUI 传的一模一样）
    written = serve.handle_request(
        {
            "id": 2,
            "method": "set_shelf_layout",
            "params": {
                "layout": {
                    "order": [book_id],
                    "dividers": [{"id": "d1", "label": "诗词", "before": book_id}],
                    "region": "d1",
                }
            },
        }
    )
    # 回执里就是落盘的那一份
    assert "error" not in written
    assert written["result"]["layout"]["order"] == [book_id]
    assert written["result"]["layout"]["region"] == "d1"
    # 再读一次：与刚写下的那份逐字相同
    again = serve.handle_request({"id": 3, "method": "shelf_layout", "params": {}})
    assert again["result"]["layout"] == written["result"]["layout"]


def test_the_sidecar_normalises_a_nonsense_payload(home: Any) -> None:
    """Bad input becomes an empty layout -- a GUI bug must not look like a core crash."""
    # layout 传了个字符串（客户端写错类型）
    response = serve.handle_request(
        {"id": 1, "method": "set_shelf_layout", "params": {"layout": "nope"}}
    )
    # 不报错：收成空布局
    assert "error" not in response
    assert response["result"]["layout"] == {"order": [], "dividers": [], "region": None}


def test_werd_shelf_prints_the_regions(home: Any, capsys: pytest.CaptureFixture[str]) -> None:
    """``werd shelf`` shows what the GUI arranged, region by region."""
    # 两本书 + 一块挂在第二本前面、叫"诗词"的隔板
    first, second = _add_books(home, ["a.txt", "b.txt"])
    shelf.set_layout(
        {"order": [first, second], "dividers": [{"id": "d1", "label": "诗词", "before": second}]}
    )
    # 跑命令
    assert cli.main(["shelf"]) == 0
    out = capsys.readouterr().out
    # 两个区都在：第一个还没名字，第二个是隔板上那几个字
    assert "unassigned" in out
    assert "诗词" in out
    # 末尾给出布局文件的位置（"摆在哪"的权威就是它；长路径会被终端折行，所以只认文件名）
    assert "shelf.json" in out


def test_werd_shelf_json_prints_the_document(home: Any, capsys: pytest.CaptureFixture[str]) -> None:
    """``--json`` is the scriptable view: the layout document itself."""
    # 空布局也要能打（字段齐全，脚本不用自己兜默认值）
    assert cli.main(["shelf", "--json"]) == 0
    # 成就那行提示可能排在前头：只取花括号那一段，再按 JSON 解
    out = capsys.readouterr().out
    payload = json.loads(out[out.index("{") : out.rindex("}") + 1])
    # 字段一个不少
    assert payload == {"order": [], "dividers": [], "region": None}


def test_werd_shelf_says_so_when_the_library_is_empty(
    home: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    """An empty shelf explains itself instead of printing bare tables."""
    # 一本书都没有
    assert cli.main(["shelf"]) == 0
    out = capsys.readouterr().out
    # 提示怎么导入，并指出布局文件在哪
    assert "werd import" in out
    assert "shelf.json" in out


