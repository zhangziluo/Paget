"""Tests for :mod:`wreader.achievements` — the event log and the unlock check.

Everything here stays offline and terminal free: the state file lives in the
throwaway ``$WREADER_HOME`` from ``conftest`` and the definitions are injected.
"""

# 延迟求值类型注解
from __future__ import annotations

# 构造状态文件内容
import json
# 注入固定时间，让日期相关断言可预测
from datetime import datetime, timedelta
# 类型注解：fixture 的返回类型写在属性里
from typing import Any, Dict, List

# pytest.raises / parametrize
import pytest

# 被测模块 + 书库（造旧数据用）与 stats（定义加载）
from wreader import achievements, library, stats


# ------------------------------------------------------------------ word counting
def test_count_words_counts_cjk_characters_and_latin_tokens() -> None:
    # 中文：一个字算一个；英文：一个 token 算一个
    assert achievements.count_words("你好世界") == 4
    assert achievements.count_words("hello world") == 2
    # 混排：两种口径相加
    assert achievements.count_words("你好 world") == 3


def test_count_words_ignores_punctuation_digits_and_spaces() -> None:
    # 标点、数字、空白都不计入（规格只认汉字与英文单词）
    assert achievements.count_words("你好，world! 123") == 3
    assert achievements.count_words("   ") == 0


def test_count_words_tolerates_non_text() -> None:
    # 非字符串（None / 数字）按 0 处理，不要抛异常
    assert achievements.count_words(None) == 0  # type: ignore[arg-type]
    assert achievements.count_words(123) == 0  # type: ignore[arg-type]


# ------------------------------------------------------------------ line ranges
def test_merge_ranges_sorts_merges_and_drops_empties() -> None:
    # 重叠、(5,9) 与 (3,4) 都要并进 (0,9)；(12,20) 独立；(9,9) 是空区间被丢掉
    assert achievements.merge_ranges([(0, 5), (5, 9), (12, 20), (3, 4), (9, 9)]) == [
        (0, 9),
        (12, 20),
    ]


def test_uncovered_words_counts_a_range_once() -> None:
    lines = ["你好世界", "hello there friend"]
    # 第一次读：4 个汉字 + 3 个单词
    words, counted = achievements.uncovered_words(lines, [], 0, 2)
    assert words == 7
    # 区间被记下来了（半开区间 [0, 2)）
    assert counted == [(0, 2)]


def test_uncovered_words_counts_nothing_on_a_reread() -> None:
    lines = ["你好世界", "hello there friend"]
    # 同一段再读一次：一个新字都不加（这就是"按行号去重"）
    words, counted = achievements.uncovered_words(lines, [(0, 2)], 0, 2)
    assert words == 0
    assert counted == [(0, 2)]


def test_uncovered_words_counts_only_the_new_part_of_an_overlap() -> None:
    lines = ["你好世界", "hello there friend"]
    # 只统计过第 0 行，第二轮读 0..2：只该算第 1 行的 3 个单词
    words, counted = achievements.uncovered_words(lines, [(0, 1)], 0, 2)
    assert words == 3
    assert counted == [(0, 2)]


def test_uncovered_words_clamps_to_the_text() -> None:
    lines = ["你好"]
    # 右端越界（读到第 99 行）不该 IndexError，也不该算进不存在的字
    words, counted = achievements.uncovered_words(lines, [], -5, 99)
    assert words == 2
    assert counted == [(0, 1)]


# ------------------------------------------------------------------ weekend rule
@pytest.mark.parametrize(
    "start, end, seconds, expected_day, expected_seconds",
    [
        # 周六 10:00-12:00：整段都算周末
        ("2026-09-26T10:00:00", "2026-09-26T12:00:00", 7200, "2026-09-26", 7200),
        # 周五 22:00 跨到周六 01:00：记在结束那天（周六）
        ("2026-09-25T22:00:00", "2026-09-26T01:00:00", 10800, "2026-09-26", 10800),
        # 周日整天
        ("2026-09-27T09:00:00", "2026-09-27T10:00:00", 3600, "2026-09-27", 3600),
        # 周三：不算周末
        ("2026-09-23T10:00:00", "2026-09-23T11:00:00", 3600, "", 0),
        # 时间戳坏掉：不记
        ("", "", 3600, "", 0),
        # 时长为 0：不记
        ("2026-09-26T10:00:00", "2026-09-26T12:00:00", 0, "", 0),
    ],
)
def test_weekend_seconds_attributes_the_session(
    start: str, end: str, seconds: int, expected_day: str, expected_seconds: int
) -> None:
    # 返回 (记到哪一天, 多少秒)；工作日只回空串
    assert achievements.weekend_seconds(start, end, seconds) == (
        expected_day,
        expected_seconds,
    )


# ------------------------------------------------------------------ state file
def test_empty_state_has_every_section() -> None:
    state = achievements.empty_state()
    # 结构固定：调用方不必到处 setdefault
    assert state["version"] == achievements.STATE_VERSION
    assert state["unlocked"] == []
    assert state["counters"] == {}
    assert state["metrics"]["days_opened"] == []
    assert state["metrics"]["words_read"] == 0
    assert state["books"] == {}


def test_save_and_load_state_round_trip(isolated_home) -> None:
    # 造一份内容齐全的状态
    state = achievements.empty_state()
    state["unlocked"] = [
        {"id": "x", "name": "X", "unlocked_at": "2026-01-01T00:00:00"}
    ]
    state["counters"]["daily_open"] = 3
    state["metrics"]["days_opened"] = ["2026-01-01"]
    state["books"]["b1"] = {"words": 42, "counted": [[0, 3]]}
    # 落盘：默认写进数据目录
    path = achievements.save_state(state)
    assert path == achievements.state_path()
    # 文件是纯文本 JSON，用户能手改、能备份
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["unlocked"][0]["name"] == "X"
    # 读回来逐项一致
    back = achievements.load_state()
    assert achievements.unlocked_ids(back) == ["x"]
    assert back["counters"]["daily_open"] == 3
    assert back["metrics"]["days_opened"] == ["2026-01-01"]
    assert back["books"]["b1"] == {"words": 42, "counted": [[0, 3]], "colors": []}


def test_load_state_is_empty_on_a_fresh_install(isolated_home) -> None:
    # 全新环境：状态文件还不存在，读出来是空状态（而不是报错）
    assert achievements.state_path().is_file() is False
    state = achievements.load_state()
    assert state["unlocked"] == []
    # 只读不写：不碰盘上不存在的文件
    assert achievements.state_path().is_file() is False


def test_load_state_rejects_broken_json(isolated_home) -> None:
    target = achievements.state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("{oops", encoding="utf-8")
    # 坏文件明确报错，由调用方决定怎么办
    with pytest.raises(achievements.AchievementsError) as excinfo:
        achievements.load_state()
    assert achievements.STATE_FILENAME in str(excinfo.value)


def test_load_state_normalises_hand_edited_values(isolated_home) -> None:
    target = achievements.state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                # 老的"映射式"解锁写法
                "unlocked": {"legacy": True},
                # 计数写成字符串、还有无法转换的坏值
                "counters": {"daily_open": "7", "bad": "x"},
                "metrics": {
                    # 重复日期、混进数字、负数、字符串秒数
                    "days_opened": ["2026-01-02", "2026-01-02", 5],
                    "early_open": "1",
                    "weekend_seconds": {"2026-01-03": "60"},
                    "words_read": -3,
                },
                # 倒挂的区间、非区间的垃圾
                "books": {"b": {"words": "10", "counted": [[5, 3], [0, 2], "junk"]}},
            }
        ),
        encoding="utf-8",
    )
    state = achievements.load_state()
    # 解锁 id 从映射的键来
    assert achievements.unlocked_ids(state) == ["legacy"]
    # 计数转 int，坏值退成 0
    assert state["counters"] == {"daily_open": 7, "bad": 0}
    # 日期去重排序
    assert state["metrics"]["days_opened"] == ["2026-01-02", "5"]
    assert state["metrics"]["early_open"] == 1
    # 负数夹回 0
    assert state["metrics"]["words_read"] == 0
    # 倒挂区间被丢掉，只留有效的
    assert state["books"]["b"] == {"words": 10, "counted": [[0, 2]], "colors": []}


def test_load_state_seeds_once_from_the_legacy_library_block(isolated_home) -> None:
    # 老版本把解锁记录写在 library.json 里
    document = library.load_library()
    document["achievements"] = {
        "unlocked": [
            {"id": "old", "name": "老成就", "unlocked_at": "2026-01-01T00:00:00"}
        ],
        "progress": {},
    }
    library.save_library(document)
    assert achievements.state_path().is_file() is False
    # 第一次读：迁移过来（名字与时间戳都保留）
    seeded = achievements.load_state()
    assert achievements.unlocked_ids(seeded) == ["old"]
    assert seeded["unlocked"][0]["name"] == "老成就"
    # 迁移只做一次：写盘后再把索引清空，也不该影响已迁移的记录
    achievements.save_state(seeded)
    document["achievements"]["unlocked"] = []
    library.save_library(document)
    assert achievements.unlocked_ids(achievements.load_state()) == ["old"]


# ------------------------------------------------------------------ events
def test_record_event_tracks_days_and_the_early_hour() -> None:
    state = achievements.empty_state()
    # 同一天打开两次：算两次"打开"，但只算一天
    achievements.record_event(state, "daily_open", {}, now=datetime(2026, 9, 23, 6, 30))
    achievements.record_event(state, "daily_open", {}, now=datetime(2026, 9, 23, 20, 0))
    assert state["counters"]["daily_open"] == 2
    assert state["metrics"]["days_opened"] == ["2026-09-23"]
    # 06:30 落在 05:00-07:00，置位
    assert state["metrics"]["early_open"] == 1


def test_record_event_leaves_the_early_flag_alone_after_seven() -> None:
    state = achievements.empty_state()
    # 08:00 打开：不算"清晨第一眼"，但日期照记
    achievements.record_event(state, "daily_open", {}, now=datetime(2026, 9, 23, 8, 0))
    assert state["metrics"]["early_open"] == 0
    assert state["metrics"]["days_opened"] == ["2026-09-23"]


def test_record_event_rejects_an_unknown_name() -> None:
    # 事件名写错要立刻报出来，不能静默丢掉
    with pytest.raises(achievements.AchievementsError):
        achievements.record_event(achievements.empty_state(), "nope")


def test_record_event_folds_the_session_into_the_weekend_bucket() -> None:
    state = achievements.empty_state()
    achievements.record_event(
        state,
        "session_end",
        {
            "seconds": 1800,
            "started": "2026-09-26T10:00:00",
            "ended": "2026-09-26T10:30:00",
        },
    )
    # 周六的时长进当天的桶
    assert state["metrics"]["weekend_seconds"] == {"2026-09-26": 1800}
    assert state["counters"]["session_end"] == 1


def test_record_event_counts_imported_books() -> None:
    state = achievements.empty_state()
    # book_add 按本次导入的本数累加（不是每次加 1）
    achievements.record_event(state, "book_add", {"count": 3})
    achievements.record_event(state, "book_add", {})
    assert state["counters"]["book_add"] == 4


def test_record_event_counts_words_only_once_per_range() -> None:
    state = achievements.empty_state()
    payload = {"book_id": "b", "lines": ["你好世界"], "ranges": [(0, 1)]}
    # 同一段读两遍：字数只算一次（按行号区间去重）
    achievements.record_event(state, "progress_update", payload)
    achievements.record_event(state, "progress_update", payload)
    assert state["metrics"]["words_read"] == 4
    assert state["books"]["b"] == {"words": 4, "counted": [[0, 1]], "colors": []}


# ------------------------------------------------------------------ check_achievements
# 一份测试专用的定义表：三条覆盖两个分类，其中一条是隐藏成就
@pytest.fixture
def achievement_defs() -> "list[dict[str, Any]]":
    """A tiny definition list with categories, so tests never touch the shipped file."""
    return [
        {
            "id": "early",
            "name": "清晨第一眼",
            "desc": "在 05:00-07:00 期间首次打开",
            "condition": "early_open >= 1",
            "category": "阅读习惯",
            "secret": False,
        },
        {
            "id": "weekend",
            "name": "周末战士",
            "desc": "周六或周日累计阅读 3 小时",
            "condition": "weekend_time >= 10800",
            "category": "阅读习惯",
            "secret": False,
        },
        {
            "id": "shelf",
            "name": "书库初成",
            "desc": "书库里添加第 1 本书",
            "condition": "library_books >= 1",
            "category": "数据积累",
            "secret": True,
        },
    ]


# 一份最小的书库文档：一本书、没有会话、没有解锁记录
def make_document() -> "dict[str, Any]":
    """Return a minimal library document with a single book in it."""
    return {
        "books": {"b1": {"title": "B", "progress": {"sessions": []}}},
        "stats": {"daily_read_time": {}},
        "achievements": {"unlocked": [], "progress": {}},
    }


def test_check_achievements_unlocks_and_persists(isolated_home, achievement_defs) -> None:
    # 清晨打开一次：early（清晨）与 shelf（书库非空）都该解锁，顺序同定义顺序
    newly = achievements.check_achievements(
        "daily_open",
        {},
        definitions=achievement_defs,
        document=make_document(),
        now=datetime(2026, 9, 23, 6, 0),
    )
    assert [entry["id"] for entry in newly] == ["early", "shelf"]
    # 每条都带解锁时间戳
    assert all(entry["unlocked_at"] == "2026-09-23T06:00:00" for entry in newly)
    # 状态文件被创建，解锁记录写在里面
    assert achievements.state_path().is_file()
    saved = achievements.load_state()
    assert achievements.unlocked_ids(saved) == ["early", "shelf"]
    # 计数与日期也记下来了
    assert saved["counters"]["daily_open"] == 1
    assert saved["metrics"]["days_opened"] == ["2026-09-23"]
    # 顺带刷新了进度快照
    assert saved["progress"]["weekend"] == {"current": 0, "required": 10800}


def test_check_achievements_leaves_unreached_ones_locked(isolated_home, achievement_defs) -> None:
    # 深夜打开、书库为空：只看书库那条能不能达标
    document = make_document()
    document["books"] = {}
    newly = achievements.check_achievements(
        "daily_open", {}, definitions=achievement_defs, document=document,
        now=datetime(2026, 9, 23, 23, 0),
    )
    assert newly == []


def test_check_achievements_is_idempotent(isolated_home, achievement_defs) -> None:
    payload = {"seconds": 10800, "started": "2026-09-26T10:00:00", "ended": "2026-09-26T13:00:00"}
    # 第一次：周末战士（周六累计 3 小时）
    first = achievements.check_achievements(
        "session_end", payload, definitions=achievement_defs, document=make_document(),
        now=datetime(2026, 9, 26, 13, 0),
    )
    assert "weekend" in [entry["id"] for entry in first]
    # 第二次同样的会话：不再重复"解锁"
    second = achievements.check_achievements(
        "session_end", payload, definitions=achievement_defs, document=make_document(),
        now=datetime(2026, 9, 26, 13, 5),
    )
    assert second == []
    # 但事件本身照样累加（计数是计数，解锁是解锁）
    saved = achievements.load_state()
    assert saved["counters"]["session_end"] == 2
    assert saved["metrics"]["weekend_seconds"] == {"2026-09-26": 21600}


def test_check_achievements_rejects_an_unknown_event() -> None:
    # 事件名不在 EVENTS 里：立刻报错，不写任何状态
    with pytest.raises(achievements.AchievementsError):
        achievements.check_achievements("nope")


def test_check_achievements_counts_words_once_per_session(isolated_home) -> None:
    # 一条按字数解锁的定义
    definitions = [
        {
            "id": "words",
            "name": "万字户",
            "desc": "累计阅读 1 万字",
            "condition": "words_read >= 8",
            "category": "数据积累",
        }
    ]
    payload = {
        "book_id": "b1",
        "seconds": 60,
        "started": "2026-09-23T10:00:00",
        "ended": "2026-09-23T10:01:00",
        "lines": ["你好世界", "hello world"],
        "ranges": [(0, 2)],
    }
    # 第一次会话：6 个字 → 未达标
    assert (
        achievements.check_achievements(
            "session_end", payload, definitions=definitions, document=make_document()
        )
        == []
    )
    # 第二次会话读同一段：一个字都不加，仍未达标（去重生效）
    assert (
        achievements.check_achievements(
            "session_end", payload, definitions=definitions, document=make_document()
        )
        == []
    )
    # 第三次读新的一段：凑满 8 个字 → 解锁
    extended = dict(payload, ranges=[(0, 3)], lines=["你好世界", "hello world", "新的文字"])
    newly = achievements.check_achievements(
        "session_end", extended, definitions=definitions, document=make_document(),
        now=datetime(2026, 9, 23, 11, 0),
    )
    assert [entry["id"] for entry in newly] == ["words"]
    assert achievements.load_state()["metrics"]["words_read"] == 10


# ------------------------------------------------------------------ definitions
def test_packaged_conditions_only_use_metrics_that_exist() -> None:
    # 条件里写了 compute_metrics 不产出的指标，那条成就就永远解锁不了 —— 这里拦下来
    metrics = achievements.compute_metrics(make_document(), achievements.empty_state())
    for achievement in stats.load_achievements():
        metric, _, _ = stats.parse_condition(achievement["condition"])
        assert metric in metrics, "{} 用了未知指标 {}".format(
            achievement["id"], metric
        )


# ------------------------------------------------------------------ listing
def test_list_achievements_reports_category_progress_and_secret(
    isolated_home, achievement_defs
) -> None:
    rows = achievements.list_achievements(make_document(), definitions=achievement_defs)
    # 排序按 CATEGORY_ORDER：阅读习惯 在 数据积累 之前，同类保持定义顺序
    assert [row["id"] for row in rows] == ["early", "weekend", "shelf"]
    # 每条都带指标名、当前值与目标值（CLI 画进度条要用）
    assert rows[0]["metric"] == "early_open"
    assert rows[0]["current"] == 0
    assert rows[0]["required"] == 1
    assert rows[0]["unlocked"] is False
    # secret 原样透传（隐藏成就的文案由 CLI 决定怎么遮）
    assert rows[2]["secret"] is True
    # 书库非空：这条已经达标（虽然还没被"解锁"事件触发过）
    assert rows[2]["current"] == 1 and rows[2]["required"] == 1


def test_list_achievements_marks_unlocked_with_its_stamp(
    isolated_home, achievement_defs
) -> None:
    # 先触发一次解锁
    achievements.check_achievements(
        "daily_open",
        {},
        definitions=achievement_defs,
        document=make_document(),
        now=datetime(2026, 9, 23, 6, 0),
    )
    rows = achievements.list_achievements(make_document(), definitions=achievement_defs)
    early = next(row for row in rows if row["id"] == "early")
    assert early["unlocked"] is True
    assert early["unlocked_at"] == "2026-09-23T06:00:00"


def test_list_achievements_uses_a_fallback_category(isolated_home) -> None:
    # 定义里没有 category：退回 stats.DEFAULT_CATEGORY，而不是崩
    rows = achievements.list_achievements(
        make_document(),
        definitions=[
            {"id": "x", "name": "X", "desc": "", "condition": "library_books >= 1"}
        ],
    )
    assert rows[0]["category"] == stats.DEFAULT_CATEGORY


# ------------------------------------------------- Phase 2/3: the live events
def test_empty_state_has_every_new_metric() -> None:
    # 新指标也要在空状态里就位，否则调用方到处要写 setdefault
    metrics = achievements.empty_state()["metrics"]
    for name in achievements.COUNTER_METRICS + achievements.MAX_METRICS:
        assert metrics[name] == 0
    for name in ("holidays", "countries", "continents", "feuds", "envs", "eggs"):
        assert metrics[name] == []
    # 周末时长的桶仍然是独立的形状
    assert metrics["weekend_seconds"] == {}


def test_record_event_keeps_the_longest_not_reading_session() -> None:
    state = achievements.empty_state()
    # 界面每 5 分钟报一次当前单次峰值：内核只留最大的那一次
    achievements.record_event(state, "usage", {"seconds": 1200})
    assert state["metrics"]["not_reading_session"] == 1200
    # 另一次只用了 10 分钟：不该把已有的 20 分钟顶掉，也不该相加
    achievements.record_event(state, "usage", {"seconds": 600})
    assert state["metrics"]["not_reading_session"] == 1200
    # 后来真坐满两小时：峰值跟着变大
    achievements.record_event(state, "usage", {"seconds": 7200})
    assert state["metrics"]["not_reading_session"] == 7200
    # 坏值 / 负数不会把峰值拉回去
    achievements.record_event(state, "usage", {"seconds": -5})
    assert state["metrics"]["not_reading_session"] == 7200


def test_record_event_folds_key_deltas_and_keeps_the_largest_peak() -> None:
    state = achievements.empty_state()
    # 阅读器送来的增量与峰值：增量累加，峰值取大的
    achievements.record_event(
        state,
        "key",
        {
            "deltas": {"translate_hits": 3, "narrow_seconds": 61},
            "maxima": {"space_combo": 40, "page_streak": 5},
        },
    )
    assert state["metrics"]["translate_hits"] == 3
    assert state["metrics"]["narrow_seconds"] == 61
    assert state["metrics"]["space_combo"] == 40
    # 再送一次：增量变 5，峰值给个更小的也不该回退
    achievements.record_event(
        state, "key", {"deltas": {"translate_hits": 2}, "maxima": {"space_combo": 10}}
    )
    assert state["metrics"]["translate_hits"] == 5
    assert state["metrics"]["space_combo"] == 40


def test_record_event_ignores_junk_in_the_key_payload() -> None:
    state = achievements.empty_state()
    # 不在白名单里的指标名不该往状态文件里塞新键；负数增量也不该把进度拉回去
    achievements.record_event(
        state,
        "resize",
        {"deltas": {"bogus": 9, "help_opens": -5}, "maxima": {"nope": 3}},
    )
    assert "bogus" not in state["metrics"]
    assert "nope" not in state["metrics"]
    assert state["metrics"]["help_opens"] == 0


def test_session_end_also_settles_the_session_counters() -> None:
    state = achievements.empty_state()
    # 退出时会把本次攒下的增量一起交进来（没撞到门槛的那些也不能丢）
    achievements.record_event(
        state,
        "session_end",
        {
            "seconds": 60,
            "started": "2026-09-23T10:00:00",
            "ended": "2026-09-23T10:01:00",
            "deltas": {"arrow_chapters": 2, "narrow_chapters": 1},
            "maxima": {"page_streak": 300},
        },
    )
    assert state["metrics"]["arrow_chapters"] == 2
    assert state["metrics"]["narrow_chapters"] == 1
    assert state["metrics"]["page_streak"] == 300


def test_help_recover_view_egg_and_env_events() -> None:
    state = achievements.empty_state()
    # 帮助页按次计数
    achievements.record_event(state, "help")
    achievements.record_event(state, "help")
    assert state["metrics"]["help_opens"] == 2
    # 恢复：接着读算一次，放弃恢复算"我反悔"
    achievements.record_event(state, "recover", {"recovered": True})
    achievements.record_event(state, "recover", {})
    assert state["metrics"]["crash_recovers"] == 1
    assert state["metrics"]["recover_declined"] == 1
    # 成就页：成就猎人看的就是这个
    achievements.record_event(state, "achievements_view")
    assert state["metrics"]["achievement_views"] == 1
    # 彩蛋：只认白名单里的名字，重复也只算一次
    achievements.record_event(state, "name_egg", {"egg": "WERD"})
    achievements.record_event(state, "name_egg", {"egg": "werd"})
    achievements.record_event(state, "name_egg", {"egg": "nope"})
    assert state["metrics"]["eggs"] == ["werd"]
    # 环境信号：同样只认白名单
    achievements.record_event(state, "env", {"flags": ["tmux", "bogus", "editable"]})
    assert state["metrics"]["envs"] == ["editable", "tmux"]


def test_geo_change_records_countries_continents_and_the_feud() -> None:
    state = achievements.empty_state()
    achievements.record_event(
        state, "geo_change", {"country_code": "gb", "continent": "欧洲"}
    )
    # 只有一个国家：不算凑齐任何一对世仇
    assert state["metrics"]["countries"] == ["GB"]
    assert state["metrics"]["feuds"] == []
    # 第二个国家（法国）一到，英法两边就都有了
    achievements.record_event(
        state, "geo_change", {"country_code": "FR", "continent": "欧洲"}
    )
    assert state["metrics"]["countries"] == ["FR", "GB"]
    assert state["metrics"]["continents"] == ["欧洲"]
    assert state["metrics"]["feuds"] == ["GB×FR"]
    # 没有国家代码（接口挂了）：什么都不记
    achievements.record_event(state, "geo_change", {})
    assert state["metrics"]["countries"] == ["FR", "GB"]


def test_a_missing_continent_falls_back_to_the_country_code() -> None:
    state = achievements.empty_state()
    # 载荷没带大洲（比如用户手写的载荷）：从国家代码自己推
    achievements.record_event(state, "geo_change", {"country_code": "BR"})
    assert state["metrics"]["continents"] == ["南美洲"]


def test_holiday_of_knows_fixed_dates_lunar_festivals_and_ordinary_days() -> None:
    # 公历节日只看月日（哪一年都算）
    assert achievements.holiday_of(datetime(2026, 10, 1, 9, 0)) == "国庆节"
    assert achievements.holiday_of(datetime(2030, 1, 1, 9, 0)) == "元旦"
    # 农历节日查表：2026 春节是 2 月 17 日
    assert achievements.holiday_of(datetime(2026, 2, 17, 9, 0)) == "春节"
    assert achievements.holiday_of("2026-09-25T23:00:00") == "中秋节"
    # 元宵节 = 春节 + 14 天：2026 春节 2/17 → 元宵 3/3
    assert achievements.holiday_of(datetime(2026, 3, 3, 9, 0)) == "元宵节"
    # 前一天不是，出了 2030 的表也不认
    assert achievements.holiday_of(datetime(2026, 3, 2, 9, 0)) == ""
    assert achievements.holiday_of(datetime(2031, 3, 3, 9, 0)) == ""
    # 普通日子与坏输入都是空串
    assert achievements.holiday_of(datetime(2026, 9, 23, 9, 0)) == ""
    assert achievements.holiday_of("nope") == ""
    assert achievements.holiday_of(None) == ""


def test_lantern_festival_stays_fourteen_days_after_the_spring_festival() -> None:
    # 元宵节那七条不是另查历书抄来的，是从春节那七条加 14 天推出来的：
    # 钉住这层关系，以后谁改春节日期，元宵节会跟着露馅。
    springs = {s: n for s, n in achievements.LUNAR_HOLIDAYS.items() if n == "春节"}
    lanterns = {s: n for s, n in achievements.LUNAR_HOLIDAYS.items() if n == "元宵节"}
    assert len(springs) == len(lanterns) == 7
    for stamp in springs:
        after = datetime.strptime(stamp, "%Y-%m-%d") + timedelta(days=14)
        assert lanterns[after.strftime("%Y-%m-%d")] == "元宵节"


def test_daily_open_remembers_a_holiday() -> None:
    state = achievements.empty_state()
    # 元旦打开：记进节日列表（"节日读者"看的就是它）
    achievements.record_event(state, "daily_open", {}, now=datetime(2026, 1, 1, 12, 0))
    assert state["metrics"]["holidays"] == ["2026-01-01"]
    # 普通日子打开：列表不变
    achievements.record_event(state, "daily_open", {}, now=datetime(2026, 1, 15, 12, 0))
    assert state["metrics"]["holidays"] == ["2026-01-01"]


def test_compute_metrics_exposes_every_new_metric() -> None:
    state = achievements.empty_state()
    # 造一份"什么都有一点"的状态
    achievements.record_event(state, "help")
    achievements.record_event(state, "recover", {"recovered": True})
    achievements.record_event(state, "name_egg", {"egg": "werd"})
    achievements.record_event(state, "env", {"flags": ["cloud"]})
    achievements.record_event(state, "geo_change", {"country_code": "GB"})
    achievements.record_event(
        state, "key", {"maxima": {"space_combo": 7}, "deltas": {"narrow_seconds": 12}}
    )
    metrics = achievements.compute_metrics(make_document(), state)
    assert metrics["help_opens"] == 1
    assert metrics["crash_recovers"] == 1
    assert metrics["easter_eggs"] == 1
    assert metrics["space_combo"] == 7
    assert metrics["narrow_seconds"] == 12
    # 地理：国家数、大洲数、世仇标志
    assert metrics["geo_countries"] == 1
    assert metrics["geo_continents"] == 1
    assert metrics["geo_feud"] == 0
    # 环境：每个信号一个 0/1 指标，外加命中总数
    assert metrics["env_cloud"] == 1
    assert metrics["env_wsl"] == 0
    assert metrics["env_flags"] == 1


def test_normalise_state_keeps_and_clamps_the_new_metrics() -> None:
    # 手改过的状态文件：坏值要被吸收，好值要留住
    state = achievements._normalise_state(
        {
            "metrics": {
                "space_combo": "12",
                "translate_hits": -5,
                "early_open": 7,
                "countries": ["gb", "GB", 3, None],
                "eggs": "not-a-list",
                "weekend_seconds": {"2026-09-26": "600"},
            }
        }
    )
    assert state["metrics"]["space_combo"] == 12
    assert state["metrics"]["translate_hits"] == 0
    # 布尔型指标夹成 0/1
    assert state["metrics"]["early_open"] == 1
    # 列表去重排序，非字符串项丢掉
    assert state["metrics"]["countries"] == ["3", "GB", "gb"]
    assert state["metrics"]["eggs"] == []
    assert state["metrics"]["weekend_seconds"] == {"2026-09-26": 600}


def test_crossed_thresholds_reports_only_new_crossings() -> None:
    thresholds = {"translate_hits": (1, 100), "space_combo": (50,)}
    # 刚好踩到 1：只报这一条
    assert achievements.crossed_thresholds({"translate_hits": 1}, thresholds) == [
        ("translate_hits", 1)
    ]
    # 一步跨过 1 与 100：两条都报（顺序稳定）
    assert achievements.crossed_thresholds({"translate_hits": 150}, thresholds) == [
        ("translate_hits", 1),
        ("translate_hits", 100),
    ]
    # 报过的就不再报
    fired = [("translate_hits", 1), ("translate_hits", 100)]
    assert achievements.crossed_thresholds({"translate_hits": 150}, thresholds, fired) == []
    # 没到线的指标不出现
    assert achievements.crossed_thresholds({"translate_hits": 0}, thresholds) == []


def test_metric_thresholds_reads_every_condition() -> None:
    # 同一个指标出现两次：门槛去重并排序；写坏/缺字段的那两条跳过
    thresholds = achievements.metric_thresholds(
        [
            {"id": "a", "condition": "translate_hits >= 100"},
            {"id": "b", "condition": "translate_hits >= 10"},
            {"id": "c", "condition": "page_streak > 5"},
            {"id": "broken", "condition": "not a condition"},
            {"id": "empty"},
        ]
    )
    assert thresholds == {"translate_hits": (10, 100), "page_streak": (5,)}


def test_metric_thresholds_covers_the_packaged_definitions() -> None:
    # 随包发布的定义全都能解析，而且每个门槛都是正数
    thresholds = achievements.metric_thresholds()
    # 双语者（2026-10-16 改成看"读完的书有几种语言"）
    assert thresholds["finished_languages"] == (2,)
    assert "help_opens" in thresholds
    assert "geo_continents" in thresholds
    for numbers in thresholds.values():
        assert numbers, numbers
        assert all(number > 0 for number in numbers)


def test_session_metrics_matches_compute_metrics(isolated_home) -> None:
    # 阅读器的基线走的就是 compute_metrics，两者不许有两个口径
    achievements.check_achievements(
        "daily_open", {}, document=make_document(), now=datetime(2026, 1, 15, 12, 0)
    )
    baseline = achievements.session_metrics(document=make_document())
    assert baseline == achievements.compute_metrics(
        make_document(), achievements.load_state()
    )
    assert baseline["days_opened"] == 1


def test_session_metrics_degrades_to_an_empty_mapping(isolated_home, monkeypatch) -> None:
    # 状态文件读不出来：返回空表（阅读器于是不做实时判定，而不是崩）
    def boom(*args: Any, **kwargs: Any) -> Any:
        raise achievements.AchievementsError("broken state")

    monkeypatch.setattr(achievements, "load_state", boom)
    assert achievements.session_metrics(document=make_document()) == {}


# ------------------------------------------- 五颜六色：每本书挑过的自定义导读色
# 四种颜色，用来当"攒够了"那一档
_FOUR_COLORS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"]

# 「五颜六色」的定义（测试不碰随包那份，理由同 achievement_defs）
_COLORFUL_DEFS = [
    {
        "id": "colorful",
        "name": "🌈 五颜六色",
        "desc": "用四种自定义颜色的下划线 / 波浪线 / 光点读完一本书",
        "condition": "colorful_books >= 1",
        "category": "操作彩蛋",
    }
]


def test_record_event_keeps_the_guide_colours_per_book() -> None:
    state = achievements.empty_state()
    # 一场会话挑过：大写 / 三位简写其实是同一种颜色，认不出的项（空串 / 中文 / 数字）丢掉
    achievements.record_event(
        state,
        "session_end",
        {"book_id": "b1", "seconds": 60, "colors": ["#FF0000", "#f00", "", "换颜色", 12]},
    )
    assert state["books"]["b1"]["colors"] == ["#ff0000"]
    # 第二场又挑了一种：取并集（不是覆盖掉上一场那些）
    achievements.record_event(
        state, "session_end", {"book_id": "b1", "colors": ["#00ff00", "#ff0000"]}
    )
    assert state["books"]["b1"]["colors"] == ["#00ff00", "#ff0000"]
    # 另一本书各记各的：颜色是**按书**攒的
    achievements.record_event(state, "session_end", {"book_id": "b2", "colors": ["#0000ff"]})
    assert state["books"]["b2"]["colors"] == ["#0000ff"]
    # 没有书 id、没有颜色、颜色不是列表：一条都不记
    achievements.record_event(state, "session_end", {"colors": ["#123456"]})
    achievements.record_event(state, "session_end", {"book_id": "b1", "colors": []})
    achievements.record_event(state, "session_end", {"book_id": "b1", "colors": "red"})
    assert state["books"]["b1"]["colors"] == ["#00ff00", "#ff0000"]


def test_progress_update_records_the_colours_too() -> None:
    state = achievements.empty_state()
    # 即时上报的位置也带着颜色：没有区间（字数额度不结算）时颜色照样记下来
    achievements.record_event(state, "progress_update", {"book_id": "b1", "colors": ["#ff0000"]})
    assert state["books"]["b1"]["colors"] == ["#ff0000"]


def test_a_hand_edited_state_file_cannot_smuggle_bad_colours(isolated_home) -> None:
    # 手改的状态文件：颜色栏里塞了各种东西（大写 / 三位简写 / 名字 / 数字 / 重复）
    target = achievements.state_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "version": 1,
                "metrics": {},
                "books": {
                    "b1": {
                        "words": 0,
                        "counted": [],
                        "colors": ["#FF0000", "#f00", "red", 12, "#00FF00"],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    # 读回来只剩两种合法颜色（去重 + 收小写），坏项一个都不留
    assert achievements.load_state()["books"]["b1"]["colors"] == ["#00ff00", "#ff0000"]


def test_colorful_books_needs_both_halves(isolated_home) -> None:
    state = achievements.empty_state()
    # 三本书：b1 攒够四种、b2 攒够四种、b3 只有三种
    achievements.record_event(state, "session_end", {"book_id": "b1", "colors": _FOUR_COLORS})
    achievements.record_event(state, "session_end", {"book_id": "b2", "colors": _FOUR_COLORS})
    achievements.record_event(
        state, "session_end", {"book_id": "b3", "colors": _FOUR_COLORS[:3]}
    )
    document = make_document()
    document["books"] = {
        # b1：读完 + 四种 → 算
        "b1": {"progress": {"sessions": [], "finished": True}},
        # b2：颜色够了但没标读完 → 不算
        "b2": {"progress": {"sessions": []}},
        # b3：标了读完但颜色不够 → 不算
        "b3": {"progress": {"sessions": [], "finished": True}},
    }
    metrics = achievements.compute_metrics(document, state)
    assert metrics["colorful_books"] == 1
    # 指标在空状态里也得在（条件才不至于读到不存在的键）
    empty = achievements.compute_metrics(make_document(), achievements.empty_state())
    assert empty["colorful_books"] == 0


def test_colorful_counts_one_colour_per_field(isolated_home) -> None:
    # 三个取色器各挑一种（三种），还没够四种：这本读完也不算
    state = achievements.empty_state()
    achievements.record_event(
        state,
        "session_end",
        {"book_id": "b1", "colors": ["#ff0000", "#00ff00", "#0000ff"]},
    )
    document = make_document()
    document["books"]["b1"]["progress"]["finished"] = True
    assert achievements.compute_metrics(document, state)["colorful_books"] == 0
    # 再挑第四种（把其中一枚换掉也算）就凑齐了
    achievements.record_event(state, "session_end", {"book_id": "b1", "colors": ["#ffff00"]})
    assert achievements.compute_metrics(document, state)["colorful_books"] == 1


def test_colorful_unlocks_when_the_book_is_marked_read(isolated_home) -> None:
    # 一场会话挑了四种色，但书还没标读完：不解锁
    assert (
        achievements.check_achievements(
            "session_end",
            {
                "book_id": "b1",
                "seconds": 600,
                "started": "2026-03-01T20:00:00",
                "ended": "2026-03-01T20:10:00",
                "colors": _FOUR_COLORS,
            },
            definitions=_COLORFUL_DEFS,
            document=make_document(),
        )
        == []
    )
    # 书架标成已读（serve 的 finish 就发 book_finish）→ 当场解锁
    finished_document = make_document()
    finished_document["books"]["b1"]["progress"]["finished"] = True
    newly = achievements.check_achievements(
        "book_finish",
        {"book_id": "b1"},
        definitions=_COLORFUL_DEFS,
        document=finished_document,
        now=datetime(2026, 3, 1, 21, 0),
    )
    assert [entry["id"] for entry in newly] == ["colorful"]
    # 颜色也真的留在了状态里
    assert achievements.load_state()["books"]["b1"]["colors"] == sorted(_FOUR_COLORS)
    # 再标一次不会再给一枚（解锁幂等）
    assert (
        achievements.check_achievements(
            "book_finish",
            {"book_id": "b1"},
            definitions=_COLORFUL_DEFS,
            document=finished_document,
        )
        == []
    )


def test_merge_states_unites_the_colours_of_a_book() -> None:
    left = achievements.empty_state()
    left["books"]["b1"] = {"words": 0, "counted": [], "colors": ["#ff0000"]}
    right = achievements.empty_state()
    right["books"]["b1"] = {"words": 0, "counted": [], "colors": ["#00ff00", "#ff0000"]}
    # 两边（两台机器）各挑过的颜色合起来：这本就用过两种
    assert achievements.merge_states(left, right)["books"]["b1"]["colors"] == [
        "#00ff00",
        "#ff0000",
    ]


def test_colorful_definition_is_packaged() -> None:
    # 随包的定义里真有这一条，条件引用的指标是 compute_metrics 会产出的那种
    entry = next(item for item in stats.load_achievements() if item["id"] == "colorful")
    assert entry["condition"] == "colorful_books >= 1"
    assert entry["category"] == "操作彩蛋"
    assert entry["secret"] is False
    # 「四种」与内核那个常量对得上（改常量就得改文案，别悄悄漂走）
    assert achievements.COLORFUL_COLORS == 4
