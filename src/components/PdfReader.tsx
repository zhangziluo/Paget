/**
 * The image-mode reading page for a PDF book.
 *
 * A PDF is imported as **pictures** (see `library.build_pdf_record`), so this page
 * paints the pages (`PdfPages`) and keeps the usual bookkeeping: position,
 * percentage, reading time and achievements all go through the core exactly like
 * the text reader's, because for a picture book one line *is* one page.
 *
 * 「转换成文字」 is the deliberate, slow step (a 785 page book takes about a minute:
 * that is why the import does not do it).  When it finishes the reader hands over
 * to the text view.
 *
 * Split of work: this file owns the chrome, the bookkeeping and the button;
 * painting lives in `PdfPages`; the pure maths (page → progress, scroll → page)
 * lives in `lib/pdfView.ts` so it can be tested without a browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// legacy 构建（理由见 PdfPages.tsx：老引擎也打得开）
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";

import PdfPages from "./PdfPages";
import AutoCheckDialog from "./AutoCheckDialog";
import ReaderConfigPanel from "./ReaderConfigPanel";
import { useAutoTurn, type AutoTurn } from "../lib/useAutoTurn";
import {
  bookRecord,
  convertPdfToText,
  readBookSource,
  recordDailyOpen,
  recordSession,
  saveCorePosition,
  saveGuiPosition,
} from "../lib/core";
import { coreStamp, duration, percentageOf } from "../lib/format";
import { pageLabel } from "../lib/pdfView";
import type { BookRow, Bookmark, GuiPosition, Unlocked } from "../lib/types";

/** 页与页之间的留白（布局与几何都读这一个数） */
const PAGE_GAP = 20;
/** 页面左右各留多少 */
const PAGE_MARGIN = 48;
/** 单页最宽多少（再宽就只是放大空白） */
const PAGE_MAX_WIDTH = 1100;
/** 自动保存间隔：与文字阅读页同一个用意（崩溃只丢几页） */
const AUTOSAVE_MS = 20_000;

/** Turn the visited pages into the `[[from, to], ...]` ranges the core counts. */
function mergePages(visited: Set<number>): [number, number][] {
  // 排好序再合并；相邻的两页算同一段（内核按区间去重字数）
  const sorted = [...visited].sort((left, right) => left - right);
  const ranges: [number, number][] = [];
  for (const index of sorted) {
    const last = ranges[ranges.length - 1];
    // 接得上就并进去
    if (last && index <= last[1] + 1) last[1] = index;
    else ranges.push([index, index]);
  }
  return ranges;
}

export default function PdfReader(props: {
  book: BookRow;
  /** 退出（true = 书架要重新同步） */
  onClose: (reload: boolean) => void;
  /** 切到文字视图（用户按了「读文字」） */
  onShowText: () => void;
  /**
   * 转换成文字成功之后：外层把这一行重新同步回来（字数/行数/章节都变了），
   * 再切到文字视图 —— 顺序不能反，否则文字视图的分母还是页数。
   */
  onConverted: () => void | Promise<void>;
}) {
  // pdf.js 的文档对象；null = 还在打开
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  // 页数与一页的宽高比（按第 1 页量，其余同尺寸）
  const [pages, setPages] = useState(0);
  const [ratio, setRatio] = useState(1.414);
  // 缩放（1 = 按窗口宽度铺满）
  const [zoom, setZoom] = useState(1);
  // 窗口尺寸变了要重算页面宽度
  const [tick, setTick] = useState(0);
  // 当前页（0 起始 —— 内核那边它就是行号，所以进度天然对得上）
  const [page, setPage] = useState(Math.max(0, props.book.current_line));
  // 顶栏 / 提示 / 错误 / 正在转换
  const [barOpen, setBarOpen] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [unlocked, setUnlocked] = useState<Unlocked[]>([]);
  const [converting, setConverting] = useState(false);
  // 记账：开始时刻、读过的页（区间去重）、书签（原样带回去，别覆盖掉）
  const startedAt = useRef(new Date());
  const visited = useRef<Set<number>>(new Set());
  const bookmarks = useRef<Bookmark[]>([]);
  const pageRef = useRef(page);
  const pagesRef = useRef(0);
  // 打开时落在哪一页：只在第一次决定，之后换缩放不该再跳回去
  const startPage = useRef(Math.max(0, props.book.current_line));
  // 外部要求翻页（自动翻页）：`token` 每次请求都变，`PdfPages` 认它才滚
  const [jump, setJump] = useState({ page: 0, token: 0 });
  // 顶栏那块「阅读设置」浮层（内容与文字阅读页共用同一个组件）
  const [panel, setPanel] = useState<"config" | null>(null);

  // 一页的尺寸：窗口宽度（或缩放）乘上第 1 页的宽高比
  const sheet = useMemo(() => {
    const usable = Math.max(320, Math.min(window.innerWidth, PAGE_MAX_WIDTH + PAGE_MARGIN * 2));
    const width = Math.max(320, Math.round((usable - PAGE_MARGIN * 2) * zoom));
    return { width, height: Math.round(width * ratio) };
  }, [ratio, zoom, tick]);

  // 打开这本书：拿字节 → 交给 pdf.js → 量第 1 页
  useEffect(() => {
    let alive = true;
    // 加载任务：销毁它才是真正把 worker 与内存还回去（v6 的文档对象上没有 destroy）
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    void (async () => {
      try {
        // 字节由壳层从内核记的路径读出来（前端永远不猜路径）
        const bytes = await readBookSource(props.book.id);
        task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        const loaded = await task.promise;
        // 组件已经卸载：把这一份销毁掉，别留着 worker 与内存
        if (!alive) {
          void task.destroy();
          return;
        }
        const first = await loaded.getPage(1);
        const view = first.getViewport({ scale: 1 });
        setRatio(view.height / view.width);
        setPages(loaded.numPages);
        pagesRef.current = loaded.numPages;
        setPdf(loaded);
      } catch (err) {
        if (alive) setError(String(err));
      }
    })();
    // 书签以内核为准：这里只是原样带回去（图片模式不落书签，但不能把它们抹掉）
    bookRecord(props.book.id)
      .then((record) => {
        if (alive) bookmarks.current = record?.progress?.bookmarks ?? [];
      })
      .catch(() => undefined);
    // 与文字阅读页同一条：「今天打开了阅读器」
    recordDailyOpen().catch(() => undefined);
    return () => {
      alive = false;
      if (task) void task.destroy();
    };
  }, [props.book.id]);

  // 窗口变宽变窄：重算一页的宽度
  useEffect(() => {
    const onResize = () => setTick((value) => value + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Write the position through the core (the authoritative one). */
  const persist = useCallback(async () => {
    const total = pagesRef.current;
    // 还没打开：没什么可记的
    if (total <= 0) return;
    await saveCorePosition(
      props.book.id,
      pageRef.current,
      percentageOf(pageRef.current, total),
      total,
    );
  }, [props.book.id]);

  // 自动保存：与文字阅读页同一个节奏（崩溃只丢几页）
  useEffect(() => {
    const timer = window.setInterval(() => {
      persist().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [persist]);

  /** 翻页：记下读过的页 + 把 GUI 自己的位置写进本地缓存。 */
  const handleVisiblePage = useCallback(
    (next: number) => {
      pageRef.current = next;
      setPage(next);
      visited.current.add(next);
      const total = Math.max(1, pagesRef.current);
      const position: GuiPosition = {
        book_id: props.book.id,
        // 图片模式没有 CFI：用一个 `page:` 前缀记页码（文字模式那边留空）
        cfi: `page:${next}`,
        percentage: percentageOf(next, total),
        line: next,
        updated_at: coreStamp(new Date()),
      };
      saveGuiPosition(position).catch(() => undefined);
    },
    [props.book.id],
  );

  // 第一次拿到页数时把「读过这一页」也记上（否则停在第一页不动就没有进度）
  useEffect(() => {
    if (pages > 0) handleVisiblePage(startPage.current);
    // 只跟页数走：handleVisiblePage 会随 book.id 变，那是另一回事
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  /** 退出：位置 + 书签 + 时长 + 成就，然后回书架（与文字阅读页同一套）。 */
  const finish = useCallback(async () => {
    const ended = new Date();
    const seconds = Math.max(0, Math.round((ended.getTime() - startedAt.current.getTime()) / 1000));
    const total = Math.max(1, pagesRef.current);
    const index = pageRef.current;
    const ranges = mergePages(visited.current);
    // 读过的页数（区间长度之和）
    const linesRead = ranges.reduce((sum, [from, to]) => sum + Math.max(0, to - from + 1), 0);
    try {
      const result = await recordSession({
        bookId: props.book.id,
        line: index,
        percentage: percentageOf(index, total),
        seconds,
        linesRead,
        ranges,
        // 图片模式不落书签：把读到的整份原样带回去（内核整份覆盖写）
        bookmarks: bookmarks.current,
        // ⚠️ 本地时间 + 秒级，别用 toISOString（见 coreStamp 的说明）
        started: coreStamp(startedAt.current),
        ended: coreStamp(ended),
      });
      // 解锁的成就先留在这里看一眼，再回书架
      setUnlocked(result.unlocked);
      setNotice(`本次 ${duration(seconds)}，新解锁 ${result.unlocked.length} 个成就`);
    } catch (err) {
      // 记不上也不该把人困在阅读页：报一句就走
      setError(String(err));
    }
    props.onClose(true);
  }, [props.book.id, props.onClose]);

  /** 「转换成文字」：让内核抽文字层，成功之后直接切到文字视图。 */
  const convert = useCallback(async () => {
    setConverting(true);
    setNotice("");
    setError("");
    try {
      const record = await convertPdfToText(props.book.id);
      setNotice(`已转换成文字：${record.total_lines ?? 0} 行`);
      // 位置先落一次：切过去之后文字视图从同一条进度接着读
      await persist().catch(() => undefined);
      // 交给外层：先同步书架那一行（分母要从页数变成行数），再切文字视图
      await props.onConverted();
    } catch (err) {
      // 扫描版会走到这里：内核明确说「没有文字层」
      setError(String(err));
    } finally {
      setConverting(false);
    }
  }, [props.book.id, persist, props.onConverted]);

  // 点面板外面 / 按 Esc 收起那块浮层（与文字阅读页同一套做法：判内外用 `.reader-prefs-wrap`）
  useEffect(() => {
    if (!panel) return;
    function onDown(event: MouseEvent) {
      const node = event.target;
      const inside = node instanceof Element && node.closest(".reader-prefs-wrap") !== null;
      if (!inside) setPanel(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  /** 翻到某一页：交给 `PdfPages` 滚过去，位置由滚动回调照常记。 */
  const gotoPage = useCallback((index: number) => {
    // token 每次加一：连着翻到同一页也会重新滚
    setJump((current) => ({ page: index, token: current.token + 1 }));
  }, []);

  // 自动翻页（免手翻）：与文字阅读页同一套（lib/useAutoTurn.ts），只是单位是**页**
  const autoTurnRef = useRef<AutoTurn | null>(null);
  const autoTurn = useAutoTurn({
    advance: (step) => {
      // 一次翻 step 页（step 默认 1；在「阅读设置」里调大就是"一口气翻几页"）
      const next = pageRef.current + step;
      // 全书翻完了：停下来并说清原因 —— 终端也是这么做的
      if (next >= pagesRef.current) {
        autoTurnRef.current?.stop();
        setNotice("已经读到全书末尾，自动翻页已停");
        return;
      }
      gotoPage(next);
    },
    unit: "页",
    onStop: (reason) => setNotice(reason),
  });
  autoTurnRef.current = autoTurn;

  return (
    <div className="pdf-view">
      {/* 顶栏：默认展开（让「转换成文字」第一眼就看得见），按右上那颗按钮收起。
          位置类名 `.reader-bar-top` 与文字阅读页的上栏共用一套「呼出来的浮层」样式 */}
      <header className="bar reader-bar reader-bar-top" inert={!barOpen}>
        {/* 唯一的退出口：记账（位置 + 时长 + 成就）之后再回书架 */}
        <button className="ghost" onClick={() => void finish()}>
          ← 书架
        </button>
        <strong>{props.book.title || props.book.id}</strong>
        <span className="dim">
          {pageLabel(page, pages)} · {percentageOf(page, Math.max(1, pages)).toFixed(1)}%
          {zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : ""}
        </span>
        <button
          className="ghost"
          title="缩小"
          onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
        >
          −
        </button>
        <button
          className="ghost"
          title="放大"
          onClick={() => setZoom((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10))}
        >
          ＋
        </button>
        {/* 图片模式的正题：抽出文字层（慢活）→ 转完切到文字视图 */}
        <button className="ghost" disabled={converting} onClick={() => void convert()}>
          {converting ? "正在转换成文字…" : "转换成文字"}
        </button>
        {props.book.text_path ? (
          <button className="ghost" title="这本已经转换成文字了" onClick={props.onShowText}>
            读文字
          </button>
        ) : null}
        {/* 免手翻：图片模式一次翻一页（节奏在「阅读设置」里调，与终端同一份设置） */}
        <button
          className="ghost"
          title={autoTurn.pace ? `自动翻页：${autoTurn.pace}` : "自动翻页"}
          onClick={autoTurn.toggle}
        >
          {autoTurn.on ? "停止自动" : "自动翻页"}
        </button>
        {/* 翻页设置：内核 `reader.*` 里与阅读有关的那几项（与文字阅读页同一份）。
            图片模式正读着的时候也能调节奏，不用先切到文字那一档 */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${panel === "config" ? " on" : ""}`}
            title="自动翻页多久走一次、一次走多少、多久抽查一次（改完立刻生效）"
            aria-label="翻页设置"
            aria-expanded={panel === "config"}
            onClick={() => setPanel((open) => (open === "config" ? null : "config"))}
          >
            翻页设置
          </button>
          {panel === "config" ? (
            <ReaderConfigPanel
              onSaved={(path) => {
                if (path.startsWith("reader.auto_scroll")) autoTurn.reload();
              }}
            />
          ) : null}
        </div>
      </header>

      {/* 收起顶栏之后留一颗小按钮：不然「转换成文字」就没入口了 */}
      <button
        className="pdf-bar-toggle ghost"
        title={barOpen ? "收起工具栏" : "展开工具栏"}
        onClick={() => setBarOpen((open) => !open)}
      >
        {barOpen ? "×" : "☰"}
      </button>

      {/* 提示区：成就、转换成文字的回执、以及错误 */}
      {unlocked.length > 0 ? (
        <p className="notice pdf-note">新解锁：{unlocked.map((item) => item.name).join("、")}</p>
      ) : null}
      {notice ? <p className="notice pdf-note">{notice}</p> : null}
      {error ? <p className="error pdf-note">{error}</p> : null}

      {/* 自动翻页开着时挂一枚小牌子：节奏一眼可见；点它就把「阅读设置」打开（跟文字阅读页一样） */}
      {autoTurn.on ? (
        <button
          type="button"
          className="notice pdf-note pdf-chip"
          title="点一下展开顶栏并打开「阅读设置」，在那里改节奏"
          onClick={() => {
            setBarOpen(true);
            setPanel("config");
          }}
        >
          自动翻页中 · {autoTurn.pace}
        </button>
      ) : null}

      {/* 连着翻久了要回答一道题：点任一选项都算（与终端同一条规矩） */}
      {autoTurn.check ? (
        <AutoCheckDialog
          question={autoTurn.check}
          remaining={autoTurn.remaining}
          onAnswer={autoTurn.answer}
          onStop={() => {
            autoTurn.stop();
            setNotice("自动翻页已停");
          }}
        />
      ) : null}

      {/* 页面本体 */}
      {pdf ? (
        <PdfPages
          document={pdf}
          pages={pages}
          width={sheet.width}
          height={sheet.height}
          gap={PAGE_GAP}
          startPage={startPage.current}
          jump={jump}
          onVisiblePage={handleVisiblePage}
          onError={setError}
        />
      ) : (
        <p className="dim pdf-loading">正在打开 PDF…</p>
      )}

      {/* 进度条：贴在最下沿，与文字阅读页那条同一个意思 */}
      <div className="pdf-progress" aria-hidden>
        <span style={{ width: `${percentageOf(page, Math.max(1, pages))}%` }} />
      </div>
    </div>
  );
}

