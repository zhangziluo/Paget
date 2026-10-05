import { useCallback, useEffect, useRef, useState } from "react";

import {
  bookRecord,
  bookText,
  bookToc,
  indexBook,
  loadGuiPosition,
  recordDailyOpen,
  recordSession,
  saveCorePosition,
  saveGuiPosition,
} from "../lib/core";
import { coreStamp, duration, percentageOf } from "../lib/format";
import type {
  BookRow,
  Bookmark,
  GuiPosition,
  TextSlice,
  TocEntry,
  Unlocked,
} from "../lib/types";

/** 一屏显示多少行正文（大致等于终端里的一屏） */
const WINDOW_LINES = 40;
/** 自动存位置的间隔（毫秒） */
const AUTOSAVE_MS = 60_000;

/**
 * The reading view: the core's text, paged by **source line**.
 *
 * There is deliberately no epub.js here: the core keeps converted ``.txt`` files,
 * not the original epubs, so the shared coordinate is the line number -- the same
 * one `werd read` uses.  Every position the user reaches is written back through
 * the core, so the terminal reader resumes exactly where the GUI stopped.
 *
 * Bookmarks come from the core too (`progress.bookmarks`): toggling one writes the
 * whole list back through `position`, exactly like pressing `b` in the terminal.
 */
export default function Reader(props: {
  book: BookRow;
  onClose: (reload: boolean) => void;
}) {
  // 当前这一屏正文（含它的起始行与总行数）
  const [slice, setSlice] = useState<TextSlice | null>(null);
  // 章节目录（内核会给缓存）
  const [toc, setToc] = useState<TocEntry[]>([]);
  // 一次性提示与错误
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // 这一场新解锁的成就
  const [unlocked, setUnlocked] = useState<Unlocked[]>([]);
  // 书签：内核 `progress.bookmarks` 的镜像
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  // 本次会话的开始时刻
  const startedAt = useRef(new Date());
  // 读过的行区间（内核按区间去重，重读不加字数）
  const ranges = useRef<[number, number][]>([]);
  // 屏顶行号：定时器里要读到最新值，所以放 ref 而不是 state
  const cursor = useRef(props.book.current_line);
  // 最新书签：定时器与收尾都要写它，同样放 ref
  const marks = useRef<Bookmark[]>([]);

  /** Load one screen of text and remember where we are. */
  const loadFrom = useCallback(
    async (start: number) => {
      // 夹进 [0, 总行数 - 1]，越界会被内核当空切片
      const limit = Math.max(0, props.book.total_lines - 1);
      const clamped = Math.max(0, Math.min(start, limit));
      const next = await bookText(props.book.id, clamped, WINDOW_LINES);
      setSlice(next);
      cursor.current = clamped;
      // 报一段"读过的区间"，内核会与已有记录合并去重
      ranges.current.push([clamped, clamped + Math.max(0, next.lines.length - 1)]);
      setNotice("");
    },
    [props.book.id, props.book.total_lines],
  );

  /** Write the current position **and the bookmarks** to the core and to our cache. */
  const persist = useCallback(async () => {
    // 百分比用内核的算法，两边显示的进度才不会差一截
    const percentage = percentageOf(cursor.current, props.book.total_lines);
    // 权威位置与书签：写进内核的 library.json
    await saveCorePosition(
      props.book.id,
      cursor.current,
      percentage,
      props.book.total_lines,
      marks.current,
    );
    // GUI 自己的坐标：写进本地缓存（这里是纯文本书，没有 CFI，留空）
    const position: GuiPosition = {
      book_id: props.book.id,
      cfi: "",
      percentage,
      line: cursor.current,
      updated_at: coreStamp(new Date()),
    };
    await saveGuiPosition(position);
  }, [props.book.id, props.book.total_lines]);

  // 开书：目录、书签（内核才是权威）、位置，各拉一次
  useEffect(() => {
    let alive = true;
    // 目录尽力而为：没有目录也能读
    bookToc(props.book.id)
      .then((entries) => {
        if (alive) setToc(entries);
      })
      .catch(() => undefined);
    // 书签以内核为准（本地缓存里不存书签）
    bookRecord(props.book.id)
      .then((record) => {
        const saved = record?.progress?.bookmarks ?? [];
        if (alive) {
          marks.current = saved;
          setBookmarks(saved);
        }
      })
      .catch(() => undefined);
    // 位置：先用 GUI 上次的位置，其次用内核记的行号
    loadGuiPosition(props.book.id)
      .then((saved) => loadFrom(saved ? saved.line : props.book.current_line))
      .catch((err) => {
        if (alive) setError(String(err));
      });
    // 记一条"今天打开了阅读器"（连续天数 / 清晨第一眼）
    recordDailyOpen().catch(() => undefined);
    // 退出时别再往已经卸载的组件里写
    return () => {
      alive = false;
    };
  }, [props.book.id, props.book.current_line, loadFrom]);

  // 自动保存：与终端的 auto_save_interval 同一个用意（崩溃只丢一屏）
  useEffect(() => {
    const timer = window.setInterval(() => {
      persist().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [persist]);

  /** Move the window by *delta* source lines. */
  async function move(delta: number) {
    await loadFrom(cursor.current + delta);
  }

  /** Jump to a chapter (or a bookmark) picked from a dropdown. */
  async function jump(line: number) {
    await loadFrom(line);
  }

  /** Toggle the bookmark on the top line, then write the whole list back. */
  async function toggleBookmark() {
    const line = cursor.current;
    const existing = marks.current.some((mark) => mark.line === line);
    // 整份覆盖着写：删掉这一行，或在没有时补上它
    const next = marks.current.filter((mark) => mark.line !== line);
    if (!existing) {
      next.push({ line, label: "", created: coreStamp(new Date()) });
    }
    // 内核也是这么排的（按行号升序）
    next.sort((left, right) => left.line - right.line);
    marks.current = next;
    setBookmarks(next);
    try {
      // 立刻落库，不等自动保存
      await saveCorePosition(
        props.book.id,
        line,
        percentageOf(line, props.book.total_lines),
        props.book.total_lines,
        next,
      );
      setNotice(existing ? `已移除第 ${line + 1} 行书签` : `已加书签：第 ${line + 1} 行`);
    } catch (err) {
      setError(String(err));
    }
  }

  /** End the session: position + bookmarks + duration + achievements, then back. */
  async function finish() {
    // 本次读了多久
    const ended = new Date();
    const seconds = Math.max(0, Math.round((ended.getTime() - startedAt.current.getTime()) / 1000));
    // 读过的行数（区间长度之和）
    const linesRead = ranges.current.reduce(
      (sum, [from, to]) => sum + Math.max(0, to - from + 1),
      0,
    );
    try {
      const result = await recordSession({
        bookId: props.book.id,
        line: cursor.current,
        percentage: percentageOf(cursor.current, props.book.total_lines),
        seconds,
        linesRead,
        ranges: ranges.current,
        bookmarks: marks.current,
        // ⚠️ 本地时间 + 秒级，别用 toISOString（见 coreStamp 的说明）
        started: coreStamp(startedAt.current),
        ended: coreStamp(ended),
      });
      // 解锁的成就先留在这里给用户看一眼，再回书架
      setUnlocked(result.unlocked);
      setNotice(`本次 ${duration(seconds)}，新解锁 ${result.unlocked.length} 个成就`);
    } catch (err) {
      // 记不上也不该把用户困在阅读页：报一句就走
      setError(String(err));
    }
    // 书架上的进度与时长都变了，回去要刷新
    props.onClose(true);
  }

  /** Build the local search index for this book (needed by the shelf's search). */
  async function buildIndex() {
    try {
      const report = await indexBook(props.book.id);
      // 大书会被截断，这一句必须说出来（缓存是便利，不是数据）
      setNotice(
        `已索引 ${report.chunks} 块 / ${report.lines} 行` +
          (report.truncated ? "（这本书太大，只索引了前半部分）" : ""),
      );
    } catch (err) {
      setError(String(err));
    }
  }

  // 当前这一行有没有书签（用来决定按钮文字）
  const markedHere = bookmarks.some((mark) => mark.line === cursor.current);

  return (
    <main className="container reader">
      <header className="bar">
        {/* 唯一的退出口：记账（位置 + 书签 + 时长 + 成就）之后再回书架 */}
        <button className="ghost" onClick={() => void finish()}>
          ← 书架
        </button>
        <strong>{props.book.title || props.book.id}</strong>
        <span className="dim">
          {percentageOf(cursor.current, props.book.total_lines).toFixed(1)}% · 第{" "}
          {cursor.current + 1}/{props.book.total_lines} 行
        </span>
        <select
          value=""
          onChange={(event) => {
            // 选了章节才跳（空选项只是占位）
            if (event.currentTarget.value) {
              void jump(Number(event.currentTarget.value));
            }
          }}
        >
          <option value="">跳到章节…</option>
          {toc.map((entry) => (
            <option key={entry.line} value={entry.line}>
              {entry.title}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(event) => {
            // 选了书签才跳
            if (event.currentTarget.value) {
              void jump(Number(event.currentTarget.value));
            }
          }}
        >
          <option value="">跳到书签…（{bookmarks.length}）</option>
          {bookmarks.map((mark) => (
            <option key={mark.line} value={mark.line}>
              {mark.label || `第 ${mark.line + 1} 行`}
            </option>
          ))}
        </select>
        <button onClick={() => void toggleBookmark()}>
          {markedHere ? "取消书签" : "加书签"}
        </button>
        <button onClick={() => void persist()}>保存位置</button>
        <button className="ghost" onClick={() => void buildIndex()}>
          建立索引
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {unlocked.length > 0 ? (
        <p className="notice">
          🏆 {unlocked.map((item) => item.name).join("、")}
        </p>
      ) : null}

      <div className="text">
        {slice ? (
          slice.lines.map((line, index) => (
            // 空行也要占位，不然段间距会塌掉
            <p key={slice.start + index} className={line.trim() ? "" : "blank"}>
              {line || "\u00a0"}
            </p>
          ))
        ) : (
          <p className="dim">载入中…</p>
        )}
      </div>

      <footer className="bar">
        <button onClick={() => void move(-WINDOW_LINES)}>↑ 上一屏</button>
        <button onClick={() => void move(WINDOW_LINES)}>↓ 下一屏</button>
        <button onClick={() => void move(-1)}>↑ 一行</button>
        <button onClick={() => void move(1)}>↓ 一行</button>
        <span className="dim">位置每分钟自动保存一次，退出时记入时长与成就</span>
      </footer>
    </main>
  );
}
