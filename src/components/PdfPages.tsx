/**
 * The picture half of the PDF reader: every page drawn into its own canvas.
 *
 * PDFs are read as **pictures** by default -- a PDF *is* a page-description
 * format, and its text layer is a by-product (often missing on a scanned book,
 * always lossy).  The text view is one press away; see `PdfReader`.
 *
 * Pages are laid out at one uniform size (page one is measured -- pages of a book
 * really are all the same) and only a small window around the current page is
 * rendered: leaving the window hands the canvas back to the browser, so a 785 page
 * book never holds 785 bitmaps.  The painting itself happens in pdf.js's worker
 * (see `workerSrc` below), which is what keeps scrolling smooth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// legacy 构建：自带老引擎缺的那些 API 的垫片（Linux 的 WebKitGTK 常常落后一截），
// 代价只是包大一点点 —— 本地应用，这点体积换「所有平台都打得开」很值
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// 渲染放在 worker 里：Vite 把这个文件当资源发出去（不然滚动会一顿一顿）
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { firstVisiblePage, pageSlots } from "../lib/pdfView";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** How many pages on either side of the current one stay rendered. */
const WINDOW = 3;

/** 滚一屏的比例（留一点重叠，读起来不至于断在页缝里 —— 与文字阅读页同一个数）。 */
const SCREEN_SCROLL_RATIO = 0.9;

/** ↑ / ↓ 一次挪多少：视口高度的这个比例（图片模式没有「行」，按视口算最稳）。 */
const NUDGE_RATIO = 0.12;
/** 视口再矮也至少挪这么多像素，不然「按了没反应」。 */
const NUDGE_MIN_PX = 40;

export default function PdfPages(props: {
  document: PDFDocumentProxy;
  pages: number;
  /** One page's size in CSS pixels, already scaled. */
  width: number;
  height: number;
  /** Blank space between two pages. */
  gap: number;
  /** Which page to land on when the view opens (0 based). */
  startPage: number;
  /**
   * 外部要求跳到某一页（自动翻页 / 以后可能的"跳到第 N 页"）。
   * `token` 每次请求都变，所以连着跳同一页也会重新滚一次。
   */
  jump?: { page: number; token: number };
  /** The first page that is visible changed. */
  onVisiblePage: (page: number) => void;
  onError: (message: string) => void;
}) {
  // 滚动容器（页面几何只有它需要知道）
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 每一页的画布
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  // 正在画的那几页：避免同一页叠两次
  const rendering = useRef<Set<number>>(new Set());
  // 当前页（渲染窗口跟着它走）
  const pageRef = useRef(Math.max(0, props.startPage));
  const [page, setPage] = useState(pageRef.current);
  // 滚动事件很密：rAF 合并，一帧最多算一次
  const frame = useRef(0);

  // 所有页的纵向位置：一页一页等间距排下来
  const slots = useMemo(
    () => pageSlots(props.pages, props.height, props.gap),
    [props.pages, props.height, props.gap],
  );

  /** Paint one page into its canvas (device pixel ratio aware). */
  const paint = useCallback(
    async (index: number) => {
      const canvas = canvasRefs.current[index];
      // 没画布 / 正在画 / 已经画好：都不重复
      if (!canvas || rendering.current.has(index) || canvas.width > 0) return;
      rendering.current.add(index);
      try {
        const page = await props.document.getPage(index + 1);
        // 缩放由外面的「一页多宽」定；画布再按屏幕像素比放大，字才不发虚
        const base = page.getViewport({ scale: 1 });
        const scaled = page.getViewport({ scale: props.width / base.width });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(scaled.width * ratio));
        canvas.height = Math.max(1, Math.floor(scaled.height * ratio));
        canvas.style.width = `${Math.floor(scaled.width)}px`;
        canvas.style.height = `${Math.floor(scaled.height)}px`;
        const context = canvas.getContext("2d");
        // 取不到 2d 上下文（极罕见）：这一页空着，别把整本卡住
        if (!context) return;
        await page.render({
          canvas,
          canvasContext: context,
          viewport: scaled,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        }).promise;
      } catch (err) {
        props.onError(String(err));
      } finally {
        rendering.current.delete(index);
      }
    },
    [props.document, props.width, props.onError],
  );

  /** Give one page's bitmap back to the browser (it gets painted again later). */
  const release = useCallback((index: number) => {
    const canvas = canvasRefs.current[index];
    // 已经空的就别动
    if (!canvas || canvas.width === 0) return;
    canvas.width = 0;
    canvas.height = 0;
  }, []);

  // 渲染窗口：当前页附近画上，远处的还回去
  useEffect(() => {
    for (let index = 0; index < props.pages; index += 1) {
      if (Math.abs(index - page) > WINDOW) release(index);
    }
    for (let index = page - WINDOW; index <= page + WINDOW; index += 1) {
      if (index >= 0 && index < props.pages) void paint(index);
    }
  }, [page, props.pages, paint, release]);

  // 打开时落到上次读到的那一页（内核的 current_line 就是页码）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || slots.length === 0) return;
    const index = Math.min(Math.max(0, props.startPage), slots.length - 1);
    container.scrollTop = Math.max(0, slots[index].top - props.gap);
  }, [slots, props.startPage]);

  // 外面要求翻到某一页（自动翻页走这条）：token 变了才动，免得跟上面那条抢
  useEffect(() => {
    const container = scrollRef.current;
    const request = props.jump;
    // 没有请求 / 还没铺开：什么都不做
    if (!request || !request.token || !container || slots.length === 0) return;
    const index = Math.min(Math.max(0, request.page), slots.length - 1);
    container.scrollTo({ top: Math.max(0, slots[index].top - props.gap), behavior: "smooth" });
    // 只跟 token 走：同一页连着跳两次也要重新滚
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jump?.token, slots, props.gap]);

  // 滚动：算出「看得见的第一页」，变了才通知外面（位置与进度都靠它）
  const handleScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const container = scrollRef.current;
      if (!container) return;
      const next = firstVisiblePage(slots, container.scrollTop);
      // 没换页：什么都不做
      if (next === pageRef.current) return;
      pageRef.current = next;
      setPage(next);
      props.onVisiblePage(next);
    });
  }, [slots, props.onVisiblePage]);

  // 卸载：撤掉还没跑完的那一帧
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // 键盘也能滚：↑ / ↓ 挪一小步、← / → / 空格 / PageDown 滚一屏、Shift+空格 / PageUp 往回滚。
  //
  // **键位与文字阅读页完全一致**（那边是 `.reader-keys` 写着的那三样），所以两种视图的手感一样。
  // 从前这页只吃鼠标滚轮 —— 2026-10-14 用户反馈「PDF 模式下空格与上下方向键都不能滚」。
  // 焦点在输入框 / 下拉框上时不抢（那是用户在打字 / 选项）；空格落在按钮上时也留给按钮自己按下。
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const container = scrollRef.current;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      // 容器还没挂上 / 焦点在控件里：不抢
      if (!container || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // 一屏 ≈ 视口高度的 90%；↑ ↓ 挪一小步（视口再矮也至少挪 40px）
      const screen = Math.round(container.clientHeight * SCREEN_SCROLL_RATIO);
      const nudge = Math.max(NUDGE_MIN_PX, Math.round(container.clientHeight * NUDGE_RATIO));
      let delta = 0;
      switch (event.key) {
        case "ArrowDown":
          delta = nudge;
          break;
        case "ArrowUp":
          delta = -nudge;
          break;
        case "PageDown":
        case "ArrowRight":
          delta = screen;
          break;
        case "PageUp":
        case "ArrowLeft":
          delta = -screen;
          break;
        case " ":
          // 焦点在按钮上时，空格是「按下那枚按钮」，不是滚屏
          if (tag === "BUTTON") return;
          delta = event.shiftKey ? -screen : screen;
          break;
        default:
          return;
      }
      // 自己滚（别让浏览器再把外层也滚一下）
      event.preventDefault();
      container.scrollBy({ top: delta });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pdf-scroll" ref={scrollRef} onScroll={handleScroll}>
      <div className="pdf-column" style={{ width: props.width }}>
        {Array.from({ length: props.pages }, (_, index) => (
          <div
            key={index}
            className="pdf-sheet"
            style={{ width: props.width, height: props.height, marginBottom: props.gap }}
          >
            {/* 画布自己不带尺寸：paint 时按屏幕像素比写 width/height */}
            <canvas
              className="pdf-canvas"
              ref={(node) => {
                canvasRefs.current[index] = node;
              }}
            />
            {/* 页码贴在这一页的右下角：翻到哪一页一眼看得见 */}
            <span className="pdf-folio dim">{index + 1}</span>
          </div>
        ))}
        <p className="pdf-tail dim">共 {props.pages} 页 · 到底了</p>
      </div>
    </div>
  );
}