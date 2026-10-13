import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  bookRecord,
  bookText,
  bookToc,
  getGuiSetting,
  indexBook,
  loadGuiPosition,
  recordDailyOpen,
  recordSession,
  saveCorePosition,
  saveGuiPosition,
  setGuiSetting,
} from "../lib/core";
import PdfReader from "../components/PdfReader";
import AutoCheckDialog from "../components/AutoCheckDialog";
import ReaderConfigPanel from "../components/ReaderConfigPanel";
import { useAutoTurn, type AutoTurn } from "../lib/useAutoTurn";
import {
  DEFAULT_PDF_VIEW,
  PDF_VIEW_KEY,
  pdfViewOf,
  readPdfViews,
  withPdfView,
  type PdfView,
} from "../lib/pdfView";
import { coreStamp, duration, percentageOf } from "../lib/format";
import {
  DEFAULT_READER_PREFS,
  FONT_MAX,
  FONT_MIN,
  LETTER_MAX,
  LETTER_MIN,
  LINE_MAX,
  LINE_MIN,
  LINE_STEP,
  MARGIN_MAX,
  MARGIN_MIN,
  PARA_MAX,
  PARA_MIN,
  PARA_STEP,
  READER_FONTS,
  READER_THEMES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  guideColorVars,
  guideSwatchColor,
  loadReaderPrefs,
  normalizeReaderPrefs,
  readerFontStack,
  readerPalette,
  saveReaderPrefs,
  type ReaderPrefs,
} from "../lib/readerPrefs";
import {
  GUIDE_CHIP_MS,
  GUIDE_CRAWLER_EM,
  GUIDE_MARKERS,
  GUIDE_SPEED_MAX,
  GUIDE_SPEED_MIN,
  guideCrawlAt,
  guideDotAt,
  guideFollowTop,
  guideLineMs,
  guideMarkerLabel,
  guideNeedsMore,
  guideSpeedLabel,
  guideTrailAt,
  guideTrailY,
  isBlankLine,
  loadGuideProgress,
  normalizeGuideMarker,
  normalizeGuideSpeed,
  saveGuideProgress,
  stepGuideWalk,
  type GuideMarker,
  type GuideProgress,
  type GuideRow,
} from "../lib/readingGuide";
import type {
  BookRow,
  Bookmark,
  GuiPosition,
  TextSlice,
  TocEntry,
  Unlocked,
} from "../lib/types";

/** 每批向内核取多少行（快见底时再取一批，于是能一路往下读） */
const SCROLL_CHUNK = 200;
/** 按「一屏」滚动时只滚这么高，留一点重叠，读起来不至于断在行缝里 */
const SCREEN_SCROLL_RATIO = 0.9;
/** 自动存位置的间隔（毫秒） */
const AUTOSAVE_MS = 60_000;

/**
 * 键盘 `1`–`6` 的快捷档：20 档里挑六个均匀落点（`1` 最慢 20s/行 → `6` 最快 0.5s/行）。
 *
 * 主控是顶栏那根滑杆（1–20 随便拖），这里只是「不开顶栏也能换个大概」——
 * 数字键的位置没变（`1` 还是最慢、`6` 还是最快），只是刻度变密之后落点不再是挨着的六格。
 */
const GUIDE_KEY_PRESETS = [1, 5, 9, 12, 16, 20];

/** 拖滑杆换档会连发：进度等手停下来再写一次（毫秒），与排版偏好同一个数。 */
const GUIDE_SAVE_MS = 400;

/** 顶栏里那四块浮层：Aa（字与页边距）、主题（纸面配色）、速度（光点导读的档位）、
 *  阅读设置（内核 `reader.*` 那一节的翻页与存档）。同一时刻只开一块。 */
type Panel = "type" | "theme" | "guide" | "config" | null;

/** 屏幕中间多大一块算「中间区域」——点它呼出 / 收起顶栏（比例，0~1）。 */
const MIDDLE_BAND = { xMin: 0.25, xMax: 0.75, yMin: 0.18, yMax: 0.82 };

/**
 * The reading view: the core's text, scrolled inside a **book**.
 *
 * There is deliberately no epub.js here: the core keeps converted ``.txt`` files,
 * not the original epubs, so the shared coordinate is the line number -- the same
 * one the core uses everywhere.  Every position the user reaches is written back through
 * the core, so the terminal reader resumes exactly where the GUI stopped.
 *
 * There is **one** browsing mode -- the paper scrolls, and the next batch is
 * pulled from the core as the reader nears the bottom, so a book can be read
 * straight through.  ↑ / ↓ move one line (line-precise, exactly like the
 * terminal); ← / → / 空格 / PgUp / PgDn scroll a screen.  The visible top line is
 * always the position that gets written back, so scrolling never loses context.
 *
 * Bookmarks come from the core too (`progress.bookmarks`): the little ribbon in
 * the top-right corner toggles one on the top line, writing the whole list back
 * through `position`, exactly like pressing `b` in the terminal.
 */
export default function Reader(props: {
  book: BookRow;
  onClose: (reload: boolean) => void;
  /**
   * 这本在阅读页里被改写了（目前只有 PDF 的「转换成文字」）：外层重新同步书架那一行
   * 再把它交回来 —— 文字视图的分母（`total_lines`）必须跟着变，不然百分比就错了。
   */
  onBookChanged?: (bookId: string) => void | Promise<void>;
}) {
  // 当前交给页面的那一段正文（含起始行）
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
  // 屏顶行号（显示用；权威值在 cursor 里）
  const [topLine, setTopLine] = useState(props.book.current_line);
  // 每次点书签 +1：让丝带重挂载一次，把「插进去」的动画重放一遍
  const [ribbonStamp, setRibbonStamp] = useState(0);
  // 正在取下一批
  const [appending, setAppending] = useState(false);
  // 排版偏好（字 / 边距 / 纸面主题）与顶栏那两块小面板（Aa、主题）
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_READER_PREFS);
  const [panel, setPanel] = useState<Panel>(null);
  // 光点导读：开着时沿当前行慢慢走过一位「领路的」—— 一颗光点、跳进书里那只兔子，
  // 或者四五个字宽的一小段下划线（自己一伸一缩地往前爬）；划过的轨迹是字底下一条下划线
  // （兔子模式换成一串脚印，下划线模式那段短下划线自己就是领路的）。
  // 进来先读一次这本书的进度（本机 localStorage，按书分开）；读不到就从第一行、默认档、光点、开着开始
  const guideStart = useRef<GuideProgress | null>(null);
  if (guideStart.current === null) guideStart.current = loadGuideProgress(props.book.id);
  const guideSaved = guideStart.current;
  const [guideOn, setGuideOn] = useState(guideSaved.on);
  const [guideSpeed, setGuideSpeed] = useState(guideSaved.speed);
  // 走在前面的是光点还是下划线（在顶栏那枚速度按钮的浮层里切）
  const [guideMarker, setGuideMarker] = useState<GuideMarker>(guideSaved.marker);
  // 光点在这批正文里的下标：只有换行时才变（≤ 2 次/秒），字底下那条轨迹跟着它走
  const [guideIndex, setGuideIndex] = useState(0);
  // 当前行要几条轨迹条（一行折成几折就几条；空行没有字，0 条；下划线模式里这几条就是那条虫）
  // 条数要等量完 rect 才知道，所以放 state —— 只在换行 / 改字号 / 开关时变，不是每帧
  const [guideTrailRows, setGuideTrailRows] = useState(0);
  // 档位牌上的字（换档 / 开关时亮两秒，见 flashChip）
  const [guideChip, setGuideChip] = useState<string | null>(null);
  // 领路的模式类：那两号「一段线自己往前爬」的（下划线 / 波浪线）各挂一个类 ——
  // 走法共用一套，只有长相与颜色不同；光点模式不用挂类（见 App.css 的 .guide-crawl / .guide-wave）
  const guideModeClass =
    guideMarker === "underline" ? " guide-crawl" : guideMarker === "wave" ? " guide-wave" : "";
  // 三块面板互斥：同一时刻最多开一块
  const prefsOpen = panel === "type";
  const themeOpen = panel === "theme";
  const speedOpen = panel === "guide";
  // 第四块：内核 reader.* 那一节（2026-10-11 从「调一调」搬过来，见 lib/readerConfig.ts）
  const configOpen = panel === "config";
  // 顶栏默认收着，点屏幕中间才呼出；进来先亮一句提示，几秒后自己消失
  const [barOpen, setBarOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  // pdf 的两种看法：默认**按图片浏览**（见 lib/pdfView.ts），偏好按书存在本机设置里
  const isPdf = (props.book.format ?? "") === "pdf";
  const [pdfViews, setPdfViews] = useState<Record<string, PdfView>>({});
  const [pdfView, setPdfView] = useState<PdfView>(DEFAULT_PDF_VIEW);

  // 读一次本机偏好：读不到 / 坏 JSON 都当默认的图片模式（绝不能因此打不开书）
  useEffect(() => {
    let alive = true;
    getGuiSetting(PDF_VIEW_KEY)
      .then((raw) => {
        if (!alive) return;
        const views = readPdfViews(raw);
        setPdfViews(views);
        setPdfView(pdfViewOf(views, props.book.id));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [props.book.id]);

  /** 换一种看法：立刻生效，并写回本机设置（下次开这本还按它）。 */
  const switchPdfView = useCallback(
    (view: PdfView) => {
      setPdfView(view);
      const next = withPdfView(pdfViews, props.book.id, view);
      setPdfViews(next);
      // 设置只是「本机怎么显示这本书」：写失败也不影响这次阅读
      setGuiSetting(PDF_VIEW_KEY, JSON.stringify(next)).catch(() => undefined);
    },
    [pdfViews, props.book.id],
  );

  /** 「转换成文字」成功之后：先让外层换掉这一行（分母变成行数），再切到文字视图。 */
  const handleConverted = useCallback(async () => {
    await props.onBookChanged?.(props.book.id);
    switchPdfView("text");
  }, [props.book.id, props.onBookChanged, switchPdfView]);
  // 跳转 / 翻行后短暂亮一下「第几行」（位置感就是上下文）
  const [posChip, setPosChip] = useState<string | null>(null);
  // 本次会话的开始时刻
  const startedAt = useRef(new Date());
  // 读过的行区间（内核按区间去重，重读不加字数）
  const ranges = useRef<[number, number][]>([]);
  // 屏顶行号：定时器里要读到最新值，所以放 ref 而不是 state
  const cursor = useRef(props.book.current_line);
  // 最新书签：定时器与收尾都要写它，同样放 ref
  const marks = useRef<Bookmark[]>([]);
  // 正文容器：整页锁在一屏内，只有它自己滚
  const textRef = useRef<HTMLDivElement>(null);
  // 异步回调（键盘、滚动、追加）里要读到最新的正文
  const sliceRef = useRef<TextSlice | null>(null);
  const appendingRef = useRef(false);
  // 内核在这一行之后就没有正文了（书单报的行数比正文实际有的多）：记下这个行号，
  // 从此不再往后要（**只挡这一行之后的**，跳回前面的章节照样能接着取）
  const exhaustedAt = useRef<number | null>(null);
  // 重新铺了一批正文（而不是往下追加）之后要把滚动位置拉回顶部
  const resetScroll = useRef(false);
  // 滚动回调按帧节流
  const scrollFrame = useRef(0);
  // 排版偏好还没读回来之前，别把默认值写进 gui_settings 盖掉用户的设置
  const prefsReady = useRef(false);
  // 点面板外面要能收起它（三块面板都挂在 `.reader-prefs-wrap` 里，用 closest 判断）
  // 刚点在外面关掉了排版面板：这次 click 只算「关面板」，不再顺手收起顶栏
  const swallowClick = useRef(false);
  // 挪位置排队：一次只发一份取文请求，其余的记账（见 runTurns）
  const turning = useRef(false);
  const pendingStep = useRef(0);
  const pendingLine = useRef<number | null>(null);
  // 位置小牌子自己会消失
  const chipTimer = useRef(0);
  // 自动翻页（免手翻）：与终端同一套语义，纯逻辑在 lib/autoTurn.ts、壳在 lib/useAutoTurn.ts。
  // 文字这一档前进的单位是**屏幕行** —— 一屏行的高度 ≈ 字号 × 行距，所以直接按像素滚
  const autoTurnRef = useRef<AutoTurn | null>(null);
  // 上一拍**开始时**的滚动位置：两拍之间一点没动 = 屏幕已经贴底（正在追加新批次时，
  // 下一拍的位置又会变，所以不会误判成"读到末尾"）
  const autoTop = useRef(-1);
  const autoTurn = useAutoTurn({
    advance: (step) => {
      const el = textRef.current;
      if (!el) return;
      // 与上一拍位置一模一样：屏幕已经停在书末，再翻也不动了 —— 停下来并说清原因
      if (autoTop.current >= 0 && Math.abs(el.scrollTop - autoTop.current) < 1) {
        autoTurnRef.current?.stop();
        setNotice("已经读到全书末尾，自动翻页已停");
        return;
      }
      autoTop.current = el.scrollTop;
      el.scrollBy({
        top: step * prefs.fontSize * prefs.lineHeight,
        behavior: "smooth",
      });
    },
    unit: "行",
    onStop: (reason) => setNotice(reason),
  });
  autoTurnRef.current = autoTurn;
  // 光点导读的记账：每帧都要读的东西全放 ref —— 动画循环因此不必重启（重启会丢一帧，
  // 也会把当前行的计时打乱），换行 / 换档只动它，再用 setGuideIndex / setGuideSpeed 让界面跟上
  const guide = useRef({
    on: guideSaved.on,
    speed: guideSaved.speed,
    /** 走在前面的是光点还是下划线（每帧的落点要按它算，所以放 ref） */
    marker: guideSaved.marker,
    /** 光点在**这一批正文**里的下标（源行号 = slice.start + index） */
    index: 0,
    /** 光点读到的**源行号**（离开阅读页时要写回本机，所以单独记一份） */
    line: guideSaved.line,
    /** 当前这一行已经走了多久（毫秒） */
    elapsed: 0,
    /** 当前这一行每一「视觉行」的位置（折行时一条 rect 一折）；换行 / 换字号后重量 */
    rows: [] as GuideRow[],
    /**
     * 下划线模式：这一段最长有多宽（px）= 字号 × `GUIDE_CRAWLER_EM`；跟着字号走，所以放 ref
     */
    crawl: 0,
    /**
     * 它**自己的时钟**（毫秒，只增不减）：一伸一缩的相位靠它 —— 每换一行不重来，
     * 所以伸缩的节奏与「走到下一行的节奏」错开（见 `guideBreath`）
     */
    clock: 0,
  });
  // 领路的那位（光点 / 兔子；下划线模式里它只是个「量这一行折到哪儿」的锚点）的容器：
  // 位置每帧直接写 style（走 state 的话一秒要渲染几十次）
  const markerRef = useRef<HTMLSpanElement>(null);
  // 轨迹条（当前行每一折一条）：同理，left / top / width 每帧直接写 style
  const trailRefs = useRef<(HTMLSpanElement | null)[]>([]);
  // 档位牌自己会淡出
  const guideChipTimer = useRef(0);
  // 拖滑杆换档会连发：进度等手停下来再写一次（见 setGuideLevel）
  const guideSaveTimer = useRef(0);
  // 用户自己滚走之后等手停下来再把光点带到屏顶那一行（滚动中每一帧都重排没必要）
  const guideSyncTimer = useRef(0);

  /** 记下当前位置：ref 给定时器，state 给顶栏与书签。 */
  const setCursor = useCallback((line: number) => {
    cursor.current = line;
    setTopLine(line);
  }, []);

  /** 换上新的正文段（同时更新异步用得到的 ref）。 */
  const applySlice = useCallback((next: TextSlice) => {
    sliceRef.current = next;
    setSlice(next);
  }, []);

  /** 取消「手停下来之后再同步」的那次排队（一旦显式同步 / 重铺了正文，它就已经过时了）。 */
  const clearPendingGuideSync = useCallback(() => {
    if (guideSyncTimer.current) {
      window.clearTimeout(guideSyncTimer.current);
      guideSyncTimer.current = 0;
    }
  }, []);

  /**
   * 手动挪位置（翻行 / 跳章 / 跳书签 / 自己滚动）之后，把光点带到新的一行重新计时。
   *
   * 光点导读是「跟着读」的：用户自己把画面挪走之后，光点不该还在屏幕外面走，
   * 而是落到屏顶那一行、这一行从头开始导。
   */
  const syncGuide = useCallback(
    (line: number) => {
      clearPendingGuideSync();
      const current = sliceRef.current;
      if (!current || current.lines.length === 0) return;
      const index = Math.max(0, Math.min(line - current.start, current.lines.length - 1));
      if (guide.current.index === index && current.start + index === guide.current.line) {
        // 还是这一行：只把计时归零（位置没变，量好的 rect 也还有效），不必重渲染
        guide.current.elapsed = 0;
        return;
      }
      guide.current.index = index;
      guide.current.line = current.start + index;
      guide.current.elapsed = 0;
      guide.current.rows = [];
      setGuideIndex(index);
    },
    [clearPendingGuideSync],
  );

  /** 把光点读到哪儿写回本机（按书分开；这是界面自己的状态，不碰内核）。 */
  const saveGuide = useCallback(() => {
    saveGuideProgress(props.book.id, {
      line: guide.current.line,
      speed: guide.current.speed,
      marker: guide.current.marker,
      on: guide.current.on,
    });
  }, [props.book.id]);

  /**
   * 走到头了：书末，或者内核那边再也取不到下一批（书单报的行数比正文实际有的多）。
   *
   * 两种到头都得**收住导读并说一声** —— 不然光点停在那一批的末行，既不前进也不报错，
   * 用户看到的就只是「不翻页了」，不知道已经读到结尾。
   */
  const arriveAtEnd = useCallback(() => {
    if (!guide.current.on) return;
    guide.current.on = false;
    setGuideOn(false);
    saveGuide();
    setNotice("光点导读：已到最后一页");
  }, [saveGuide]);

  /**
   * 把「领路的」和这一行的轨迹摆到 `pct`（0–1，这一行走了多少）处 —— 一行折成几折由
   * `guideDotAt` / `guideTrailAt` / `guideCrawlAt` 分摊。
   *
   * 落点那个坐标压在轨迹线上（正文下方）：光点是一颗圆点（坐标 = 圆心），这里只给横向位置
   * 与这一行的进度。轨迹是字底下那条线：已经走完的那几折整条亮起来，正在走的那一折从行首长到光点。
   *
   * **下划线 / 波浪线那两号**（「没有实体的那一位」，那一段线自己就是领路的）复用同一批轨迹条：
   * `guideCrawlAt` 把这一段按折拆开，每一折给一条 —— 所以那几条只管「在哪儿、多长」，长相
   * （直线还是波浪、什么颜色、多粗）全在 `.reader-lines.guide-crawl` / `.guide-wave` 里。
   * 每帧直接写 style，不走 React 渲染。它走过的地方不留痕：由那两套模式里的一条 CSS 动画
   * 迅速化掉（见 App.css）。
   */
  const placeGuide = useCallback((pct: number) => {
    const state = guide.current;
    const rows = state.rows;
    const marker = markerRef.current;
    if (marker) {
      const { left, top } = guideDotAt(rows, pct);
      marker.style.left = `${left}px`;
      marker.style.top = `${top}px`;
    }
    // 下划线 / 波浪线：这一段线就是它（每帧重算，跟着伸缩与步子走）；光点模式下这几条是轨迹
    const crawl =
      state.marker === "dot" ? null : guideCrawlAt(rows, pct, state.crawl, state.clock);
    const trail = guideTrailAt(rows, pct);
    trailRefs.current.forEach((bar, row) => {
      const box = rows[row];
      if (!bar || !box) return;
      if (crawl) {
        const band = crawl[row];
        // 这一折没搭上（还在前面 / 已经过去了）：收起来，别留一截上一条的长度
        if (!band || band.width <= 0) {
          bar.style.width = "0px";
          return;
        }
        // 只有「在哪儿、多长」在这儿写；粗细 / 颜色 / 长相（直条还是波浪）都是 CSS 的事
        //（.guide-crawl / .guide-wave）
        bar.style.left = `${band.left}px`;
        bar.style.top = `${band.top}px`;
        bar.style.width = `${band.width}px`;
        return;
      }
      bar.style.left = `${box.left}px`;
      bar.style.top = `${guideTrailY(box)}px`;
      bar.style.width = `${row < trail.row ? box.width : row === trail.row ? trail.width : 0}px`;
    });
  }, []);

  /** 左上方亮一下档位牌（换档 / 开关时），两秒后自己淡出。 */
  const flashChip = useCallback((text: string) => {
    setGuideChip(text);
    if (guideChipTimer.current) window.clearTimeout(guideChipTimer.current);
    guideChipTimer.current = window.setTimeout(() => setGuideChip(null), GUIDE_CHIP_MS);
  }, []);

  /**
   * 换档：当前行**重新计时**、不跳行 —— 新档要能从这一行的开头看起。
   *
   * 拖顶栏那根滑杆时这个函数一秒会被叫几十次（每个 `input` 事件一次），所以进度**等手停下来
   * 再写**（`GUIDE_SAVE_MS` 防抖，与排版偏好同一个做法）；离开阅读页时那次收尾写盘照旧，
   * 最后停在那一档不会丢。
   */
  const setGuideLevel = useCallback(
    (level: number) => {
      guide.current.speed = normalizeGuideSpeed(level);
      guide.current.elapsed = 0;
      setGuideSpeed(guide.current.speed);
      flashChip(`${guideMarkerLabel(guide.current.marker)} · ${guideSpeedLabel(guide.current.speed)}`);
      if (guideSaveTimer.current) window.clearTimeout(guideSaveTimer.current);
      guideSaveTimer.current = window.setTimeout(() => {
        guideSaveTimer.current = 0;
        saveGuide();
      }, GUIDE_SAVE_MS);
    },
    [flashChip, saveGuide],
  );

  /**
   * 换标记（光点 / 下划线 / 波浪线）：位置不动、不跳行，只是换一位领路的；轨迹也跟着换
   * （光点模式是字底下那条下划线，下划线 / 波浪线那两号是那一小段线自己就是它 ——
   * 走法一模一样，只有长相不同，见 `App.css` 的 `.guide-crawl` / `.guide-wave`）。
   *
   * 与换档不同 —— 这是点一下、不会连发，所以进度**当场写回**（拖滑杆那边才要防抖）。
   */
  const chooseGuideMarker = useCallback(
    (marker: unknown) => {
      const next = normalizeGuideMarker(marker);
      if (next === guide.current.marker) return;
      guide.current.marker = next;
      setGuideMarker(next);
      flashChip(`导读标记 · ${guideMarkerLabel(next)}`);
      saveGuide();
    },
    [flashChip, saveGuide],
  );

  /** 开 / 关光点导读；关掉也把进度存下来，下次打开接着走。 */
  const toggleGuide = useCallback(() => {
    const next = !guide.current.on;
    guide.current.on = next;
    guide.current.elapsed = 0;
    setGuideOn(next);
    flashChip(
      next
        ? `光点导读 · ${guideMarkerLabel(guide.current.marker)} · ${guideSpeedLabel(guide.current.speed)}`
        : "光点导读 · 已关",
    );
    saveGuide();
  }, [flashChip, saveGuide]);

  /**
   * 跳转 / 翻行之后，把「第几行」亮一下。
   *
   * 顶栏默认是收着的，跳章或跳到书签之后如果什么提示都没有，读者就不知道自己到哪儿了
   * （位置感一丢，等于没了上下文）。所以这里在顶栏那个位置短暂亮一枚小牌子。
   */
  const flashPosition = useCallback(
    (line: number) => {
      setPosChip(
        `第 ${line + 1}/${props.book.total_lines} 行 · ` +
          `${percentageOf(line, props.book.total_lines).toFixed(1)}%`,
      );
      // 提示与位置牌共用一个位置，别叠在一起
      setHintVisible(false);
      if (chipTimer.current) window.clearTimeout(chipTimer.current);
      chipTimer.current = window.setTimeout(() => setPosChip(null), 1400);
    },
    [props.book.total_lines],
  );

  /**
   * Load a batch of text starting at *start* and remember where we are.
   *
   * 一次要一整批（`SCROLL_CHUNK` 行），滚到快见底再要下一批；跳转落在已经装好的
   * 那一批之外时，也是从这里重新铺一批。
   */
  const loadAt = useCallback(
    async (start: number) => {
      // 夹进 [0, 总行数 - 1]，越界会被内核当空切片
      const limit = Math.max(0, props.book.total_lines - 1);
      const clamped = Math.max(0, Math.min(start, limit));
      const next = await bookText(props.book.id, clamped, SCROLL_CHUNK);
      // 这是重新铺了一批（不是往下追加）：稍后把滚动位置拉回顶部
      resetScroll.current = true;
      applySlice(next);
      // 位置以「内核真正给的那一段」为准，界面与正文才不会错位
      setCursor(next.start);
      // 光点导读也回到这一批的第一行：这一批的第一行就是「读到哪儿」
      clearPendingGuideSync();
      guide.current.index = 0;
      guide.current.line = next.start;
      guide.current.elapsed = 0;
      guide.current.rows = [];
      setGuideIndex(0);
      // 报一段"读过的区间"，内核会与已有记录合并去重
      ranges.current.push([next.start, next.start + Math.max(0, next.lines.length - 1)]);
      setNotice("");
    },
    [applySlice, clearPendingGuideSync, props.book.id, props.book.total_lines, setCursor],
  );

  /**
   * 往下接一批：读过的书能一直往下读，不会被一批截住。
   */
  const appendScroll = useCallback(async () => {
    const current = sliceRef.current;
    if (!current || appendingRef.current) return;
    const nextStart = current.start + current.lines.length;
    // 书末，或者已经确认过「内核在这之后没有正文了」
    const known = exhaustedAt.current;
    if (nextStart >= props.book.total_lines || (known !== null && nextStart >= known)) return;
    appendingRef.current = true;
    setAppending(true);
    try {
      const more = await bookText(props.book.id, nextStart, SCROLL_CHUNK);
      if (!more.lines.length) {
        // 内核在这儿**一行都没有了** —— 书单报的行数比正文实际有的多（转换后的 txt 短了）。
        // 记下这个行号：别每帧再来要一次（那是每帧一次 RPC，机器跟着发烫），并让导读像
        // 走到书末一样收住 —— 不然它停在那一批的末行、既不前进也不报错，看着就是「不翻页了」。
        exhaustedAt.current = nextStart;
        arriveAtEnd();
        return;
      }
      applySlice({
        ...current,
        count: current.count + more.count,
        lines: [...current.lines, ...more.lines],
      });
      ranges.current.push([nextStart, nextStart + more.lines.length - 1]);
    } catch (err) {
      setError(String(err));
    } finally {
      appendingRef.current = false;
      setAppending(false);
    }
  }, [applySlice, arriveAtEnd, props.book.id, props.book.total_lines]);

  /**
   * 光点换到新的一行之后，把这一行留在视野里，并把「下一页」准备好。
   *
   * 做的是「带子」而不是「整屏跳」：让这一行待在视野上方约 1/3 处，出了带子就滚回来
   * —— 每次也就挪一行上下，画面匀速往上爬，眼睛不用重新找行。
   *
   * **顺手把「下一页」也接上**（`appendScroll`）：下面剩的正文不到一屏多就先要一批。
   * 这件事**不能只交给 `onScroll`** —— 那道预取只认 `scroll` 事件，而**滚到底时 `scrollTop`
   * 会被浏览器夹住，夹住就不再触发 `scroll` 事件**，预取于是永远等不到、正文不再往下接，
   * 表现就是「光点走到屏幕最下面那条字之后就不见了、页面再也不翻」。放在这里（每次换行都过
   * 一遍，光点往前走的节奏 = 每次都要看一眼）就与滚动事件无关了：只要光点还在前进，
   * 缓冲区就不会见底。`appendScroll` 自带 `appendingRef` 锁，同一时刻只有一批在飞。
   */
  const followGuide = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    // 1) 下面快见底了：自己接一批，别等滚动事件
    if (guideNeedsMore(el.scrollHeight, el.scrollTop, el.clientHeight)) {
      void appendScroll();
    }
    // 2) 再把当前行摆回「带子」上（它自己看不见时更得摆）
    const node = el.querySelectorAll<HTMLElement>("p")[guide.current.index];
    if (!node) return;
    const top = guideFollowTop(node.offsetTop, node.offsetHeight, el.scrollTop, el.clientHeight);
    if (top === null) return; // 还在带子里：一行一行地爬，不是一行一跳
    el.scrollTop = top;
  }, [appendScroll]);

  /**
   * 光点往前一步（每帧一次）。
   *
   * 计时单位是**每行停留时间**：一行走完就换下一行，与这一行有多长无关。
   * 一帧最多跨一行（切后台回来时 `dt` 已经被夹过），所以不会一瞬间掠过一整屏。
   * **空行不花时间**：换行时、以及恢复 / 同步 / 新铺一批之后落在空行上时，都一步跨到后面
   * 第一条有字的行（见 `guideNextLine`）—— 空行只是排版留下的缝，在那儿停几秒没有意义。
   */
  const stepGuide = useCallback(
    (dt: number) => {
      const state = guide.current;
      const current = sliceRef.current;
      if (!state.on || !current || current.lines.length === 0) return;
      // 这条下划线的时钟：只增不减，换行 / 换档都不重来（伸缩的相位靠它，见 guideBreath）
      state.clock += dt;
      const duration = guideLineMs(state.speed);

      /** 换到这一批的第 `index` 行（换了行：清掉量好的 rect，等这一帧渲染出来再量）。 */
      const land = (index: number, elapsed: number) => {
        state.index = index;
        state.line = current.start + index;
        state.elapsed = elapsed;
        state.rows = [];
        setGuideIndex(index);
        saveGuide(); // 进度实时落本机（离开阅读页时还会再写一次）
        followGuide();
      };

      /** 这一批再往下没有有字的行了：书末就收住，还有下文就取一批接着走（与走到末行行尾同一套）。 */
      const atBatchEnd = () => {
        const known = exhaustedAt.current;
        const batchEnd = current.start + current.lines.length;
        if (batchEnd >= props.book.total_lines || (known !== null && batchEnd >= known)) {
          // 书末（或内核已经取不到下一批）：光点就停在这儿，并说一声
          // （再按一次 0 键或用顶栏那枚开关可以让它从头再走）
          arriveAtEnd();
          return;
        }
        void appendScroll();
      };

      // 一帧的推进全在 stepGuideWalk 里：正常走一格，或者**把空行一步跨过去**（不花时间）
      const walk = stepGuideWalk(current.lines, state, dt, duration);
      state.elapsed = walk.elapsed;
      if (walk.stopped) {
        atBatchEnd();
        return;
      }
      if (walk.moved) {
        land(walk.index, walk.elapsed);
        return;
      }
      // 还在这一行上：把「领路的」（和它划过的轨迹）往前挪一点点
      placeGuide(walk.elapsed / duration);
    },
    [appendScroll, arriveAtEnd, followGuide, placeGuide, props.book.total_lines, saveGuide],
  );

  /** 把阅读位置移到 *line*：目标还在这一批里就滚过去，否则从目标重新铺一批。 */
  const moveTo = useCallback(
    async (line: number) => {
      const limit = Math.max(0, props.book.total_lines - 1);
      const target = Math.max(0, Math.min(line, limit));
      const current = sliceRef.current;
      if (!current) {
        await loadAt(target);
        return;
      }
      const loadedEnd = current.start + current.lines.length - 1;
      if (target >= current.start && target <= loadedEnd) {
        const el = textRef.current;
        const child = el?.querySelectorAll<HTMLElement>("p")[target - current.start];
        if (el && child) el.scrollTop = child.offsetTop;
        setCursor(target);
        // 跳章 / 跳书签 / 翻行：光点跟到新位置，这一行重新开始计时
        syncGuide(target);
        return;
      }
      await loadAt(target);
    },
    [loadAt, props.book.total_lines, setCursor, syncGuide],
  );

  /**
   * 一次只跑一个「挪位置」的请求。
   *
   * 连按 ↑ ↓ 或连点跳转会一瞬间来好几发：如果每发都直接去内核取文，几份请求会互相盖
   * —— 都以还没更新的位置为起点，回来又乱序落地，界面就会跳到更靠后的地方，
   * 中间那段「上下文」直接没了。所以这里把「还要挪多少」记下来，等上一发落地再接着走，
   * 每一发都以最新的位置为起点。屏幕位置牌也在这里刷新。
   */
  const runTurns = useCallback(async () => {
    if (turning.current) return;
    turning.current = true;
    try {
      for (;;) {
        const jump = pendingLine.current;
        const step = pendingStep.current;
        if (jump === null && step === 0) break;
        pendingLine.current = null;
        pendingStep.current = 0;
        await moveTo(jump ?? cursor.current + step);
        flashPosition(cursor.current);
      }
    } finally {
      turning.current = false;
    }
  }, [flashPosition, moveTo]);

  /** 相对挪（↑ ↓ 一行）：排队，不并发。 */
  const stepBy = useCallback(
    (step: number) => {
      pendingStep.current += step;
      void runTurns();
    },
    [runTurns],
  );

  /** 绝对跳（目录 / 书签）：清掉排队的相对步进，直接去那一行。 */
  const jumpTo = useCallback(
    (line: number) => {
      pendingLine.current = line;
      pendingStep.current = 0;
      void runTurns();
    },
    [runTurns],
  );

  /**
   * ← / → / 空格 / PgUp / PgDn：按「一屏」滚。
   *
   * 滚动视图里这才是自然的手感 —— 按像素滚一屏（少滚 10%，两屏之间留一点重叠），
   * 滚动回调会把屏顶行号重新算出来，所以位置照样是准的、也照样会被存回内核。
   */
  const scrollScreen = useCallback((dir: number) => {
    const el = textRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * el.clientHeight * SCREEN_SCROLL_RATIO, behavior: "smooth" });
  }, []);

  /** ↑ / ↓：翻一行（与终端里的相同）。 */
  const moveLine = useCallback(
    (dir: number) => {
      stepBy(dir);
    },
    [stepBy],
  );

  /**
   * 跟着滚动走：位置始终等于「看得见的第一行」，并且在到底之前把下一批接上。
   */
  const onScroll = useCallback(() => {
    const el = textRef.current;
    const current = sliceRef.current;
    if (!el || !current) return;
    const items = el.querySelectorAll<HTMLElement>("p");
    if (!items.length) return;
    const top = el.scrollTop;
    // offsetTop 单调递增 → 二分找出「看得见的第一行」，书滚到几千行也不卡
    let low = 0;
    let high = items.length - 1;
    let first = items.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = items[mid];
      if (item.offsetTop + item.offsetHeight > top + 1) {
        first = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    setCursor(current.start + first);
    // 光点导读：用户自己把画面挪走之后，如果光点那一行已经看不见了，就把它带到屏顶那一行。
    // 光点自己往前爬时会先把这一行滚进视野，所以它自己滚出来的那些不会误判成「挪走」。
    // 拖滚动条时每帧都同步一次没必要（那会每帧重排一整批正文），等手停下来再同步
    const active = items[guide.current.index];
    const hidden =
      !!active &&
      (active.offsetTop + active.offsetHeight <= top + 1 ||
        active.offsetTop >= top + el.clientHeight - 1);
    if (hidden) {
      const line = current.start + first;
      if (guideSyncTimer.current) window.clearTimeout(guideSyncTimer.current);
      guideSyncTimer.current = window.setTimeout(() => {
        guideSyncTimer.current = 0;
        syncGuide(line);
      }, 120);
    } else if (guideSyncTimer.current) {
      // 光点那一行又回到视野里了：刚才排的那次同步作废，别把它拽回旧的位置
      window.clearTimeout(guideSyncTimer.current);
      guideSyncTimer.current = 0;
    }
    // 快见底了就再取一批
    if (guideNeedsMore(el.scrollHeight, el.scrollTop, el.clientHeight)) {
      void appendScroll();
    }
  }, [appendScroll, setCursor, syncGuide]);

  /** 滚动手感要顺，回调按帧节流。 */
  const handleScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0;
      onScroll();
    });
  }, [onScroll]);

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
    // 位置：光点导读自己的进度优先 —— 它才是「读到哪儿」的最新事实（光点总走在屏顶那一行前面），
    // 其次 GUI 上次的位置，最后内核记的行号；导读关着时就不看它，按老规矩来
    loadGuiPosition(props.book.id)
      .then((saved) => {
        if (!alive) return;
        const resume = guideSaved.on ? guideSaved.line : 0;
        void loadAt(resume > 0 ? resume : saved ? saved.line : props.book.current_line);
      })
      .catch((err) => {
        if (alive) setError(String(err));
      });
    // 记一条"今天打开了阅读器"（连续天数 / 清晨第一眼）
    recordDailyOpen().catch(() => undefined);
    // 退出时别再往已经卸载的组件里写
    return () => {
      alive = false;
    };
  }, [props.book.id, props.book.current_line, loadAt]);

  // 自动保存：与终端的 auto_save_interval 同一个用意（崩溃只丢一屏）
  useEffect(() => {
    const timer = window.setInterval(() => {
      persist().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [persist]);

  // 光点导读的动画循环：循环本身不依赖任何 state（每帧要读的都放 ref），所以换行 / 换档
  // 都不会重启它 —— 重启会丢一帧，也会把当前行的计时打乱
  useEffect(() => {
    if (!guideOn) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // 切后台再回来时 now 会跳一大段：夹一刀，别让光点一瞬间掠过一整屏
      stepGuide(Math.min(120, Math.max(0, now - last)));
      last = now;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [guideOn, stepGuide]);

  // 离开阅读页：把光点读到哪儿写回本机（每换一行也写，所以崩了最多丢一行）
  useEffect(() => () => saveGuide(), [saveGuide]);

  // 卸载时别再等这一帧 / 别再等位置牌 / 别再等档位牌
  useEffect(
    () => () => {
      if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current);
      if (chipTimer.current) window.clearTimeout(chipTimer.current);
      if (guideChipTimer.current) window.clearTimeout(guideChipTimer.current);
      if (guideSyncTimer.current) window.clearTimeout(guideSyncTimer.current);
      if (guideSaveTimer.current) window.clearTimeout(guideSaveTimer.current);
    },
    [],
  );

  // 开书时读回排版偏好（界面自己的状态，存在本机 gui_settings）
  useEffect(() => {
    let alive = true;
    loadReaderPrefs()
      .then((saved) => {
        if (alive) setPrefs(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        // 读失败也要放行，否则用户改了字号永远存不进去
        prefsReady.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  // 改了就存；拖滑块会连发，所以等手停下来再写一次
  useEffect(() => {
    if (!prefsReady.current) return;
    const timer = window.setTimeout(() => {
      saveReaderPrefs(prefs).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [prefs]);

  // 点面板外面收起它（面板里的输入框在 wrap 内，不会误关）
  useEffect(() => {
    if (!panel) return;
    function onDown(event: MouseEvent) {
      const node = event.target;
      // 三块面板（Aa / 主题 / 速度）都在 `.reader-prefs-wrap` 里，点它们自己不算「外面」
      const inside =
        node instanceof Element && node.closest(".reader-prefs-wrap") !== null;
      if (!inside) {
        // 这次 click 已经被「关面板」用掉了，别让它再顺手收起顶栏
        swallowClick.current = true;
        setPanel(null);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panel]);

  // 顶栏默认收着，先亮一句怎么呼出来，几秒后自己消失
  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), 3500);
    return () => window.clearTimeout(timer);
  }, []);

  // 重新铺了一批（不是往下追加）就把滚动位置拉回顶部
  useLayoutEffect(() => {
    if (!resetScroll.current) return;
    resetScroll.current = false;
    if (textRef.current) textRef.current.scrollTop = 0;
  });

  // 领路的换到新的一行（或改了字号 / 行距 / 纸面配色）之后，重新量这一行的每一折，决定这一行
  // 要几条轨迹条，并立刻把它与轨迹摆好。放在 useLayoutEffect 里：绘制之前就位，
  // 看不到「先跳到行首、再走过去」的那一下
  useLayoutEffect(() => {
    // 那条虫的一段下划线跟着字号走（4.6em ≈ 四五个字，英文书下约两个单词）
    guide.current.crawl = prefs.fontSize * GUIDE_CRAWLER_EM;
    const marker = markerRef.current;
    const box = marker?.parentElement;
    if (!marker || !box) {
      guide.current.rows = [];
      setGuideTrailRows(0);
      return;
    }
    const span = box.querySelector<HTMLElement>(".reading-line-text") ?? box;
    const base = box.getBoundingClientRect();
    const rows = Array.from(span.getClientRects())
      .filter((rect) => rect.width > 0 || rect.height > 0)
      .map((rect) => ({
        left: rect.left - base.left,
        top: rect.top - base.top,
        width: rect.width,
        height: rect.height,
      }));
    // 空行只有一个不断行空格（量出来是一条几乎没宽度的 rect）：那就退用整行的框，
    // 光点照样从这一行的左边走到右边
    guide.current.rows = rows.length
      ? rows
      : [{ left: 0, top: 0, width: base.width, height: base.height }];
    // 轨迹条一折一条；空行没有字，也就没有下划线（光点照走）。
    // 条数变了得再渲染一次才挂得上这些条，所以这个 effect 也盯着 guideTrailRows：
    // 那一次重跑里 placeGuide 才拿得到刚挂上的那几条（否则要等下一帧才摆位）
    const blank = isBlankLine(slice?.lines[guideIndex]);
    setGuideTrailRows(blank ? 0 : guide.current.rows.length);
    placeGuide(guide.current.elapsed / guideLineMs(guide.current.speed));
    // 换标记（光点 ⇄ 兔子）也盯着：那一位是新挂的元素，没写 left/top 之前会闪在行首
  }, [guideIndex, guideMarker, guideOn, guideTrailRows, prefs, slice, placeGuide]);

  // 键盘：↑ ↓ 翻一行、← → / 空格 / PgUp / PgDn 滚一屏、1–6 换光点快捷档、0 开关光点导读
  // （底部那四个按钮就是被它们替掉的；光点档位也能在顶栏那根滑杆上拖）
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // 在下拉框 / 输入框里按方向键是在操作控件，别抢
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          moveLine(-1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveLine(1);
          break;
        // 滚动视图里「一屏」就是滚一屏；按住不放连滚是正常动作，不做连发限制
        // （像素滚动没有异步取文，不存在乱序落地的问题，只有 ↑ ↓ 翻行走队列）
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          scrollScreen(-1);
          break;
        case "ArrowRight":
        case "PageDown":
          event.preventDefault();
          scrollScreen(1);
          break;
        case " ":
          // 空格 = 往下滚一屏（焦点落在按钮上时留给按钮自己按下）
          if (target?.tagName !== "BUTTON") {
            event.preventDefault();
            scrollScreen(event.shiftKey ? -1 : 1);
          }
          break;
        case "Escape":
          // 先收面板（Aa / 主题 / 速度），再收顶栏
          if (panel) {
            setPanel(null);
          } else if (barOpen) {
            setBarOpen(false);
          }
          break;
        case "0":
          // 0 = 开关光点导读（与顶栏那枚开关同一件事）
          toggleGuide();
          break;
        default:
          // 1–6 = 光点导读的六个快捷档（1 最慢 … 6 最快；细调拖顶栏那根滑杆）；
          // 带修饰键的组合留给系统（⌘1 之类）
          if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[1-6]$/.test(event.key)) {
            setGuideLevel(GUIDE_KEY_PRESETS[Number(event.key) - 1]);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveLine, scrollScreen, panel, barOpen, setGuideLevel, toggleGuide]);

  /** 改一项排版偏好：范围都夹好，「上下边距相等」时下边距跟着上边距。 */
  function updatePrefs(patch: Partial<ReaderPrefs>) {
    setPrefs((prev) => normalizeReaderPrefs({ ...prev, ...patch }));
  }

  /** 恢复默认排版。 */
  function resetPrefs() {
    setPrefs({ ...DEFAULT_READER_PREFS });
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
    // 重放一次丝带动画：不管插进去还是拔出来都看得见
    setRibbonStamp((n) => n + 1);
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

  // 屏顶这一行有没有书签（丝带的「插着 / 没插」状态）
  const markedHere = bookmarks.some((mark) => mark.line === topLine);

  // 纸面配色：先取「预设主题 + 亮暗」，被自定义背景 / 字色盖过之后就是最终的一套
  const palette = readerPalette(prefs);
  // 导读那几枚取色器**显示什么颜色**：自定义色优先，没填就给这一档的出厂色
  // （下划线 / 波浪线那两号出厂跟正文墨色 —— 于是色块总与屏幕上那一条线同色）
  const guideColors = guideSwatchColor(prefs, palette.ink, guideMarker);
  // 贴成 CSS 变量：整张纸（底色、书页堆叠、书口、纸面的光、书脊的暗、正文墨色）全跟着走
  const paperVars = {
    "--paper": palette.paper,
    "--paper-edge-fill": palette.edgeFill,
    "--paper-edge-line": palette.edgeLine,
    "--reader-ink": palette.ink,
    "--reader-sheen": palette.sheen,
    "--reader-spine": palette.spine,
  } as CSSProperties;

  // pdf 默认按图片浏览：整页交给 PdfReader（位置、时长、成就与「转换成文字」都在它里面），
  // 下面这套文字阅读的逻辑一个字节都不用改 —— 想看文字时按一下「转换成文字」即可
  if (isPdf && pdfView === "image") {
    return (
      <PdfReader
        book={props.book}
        onClose={props.onClose}
        onShowText={() => switchPdfView("text")}
        onConverted={handleConverted}
      />
    );
  }

  return (
    <main
      className="container reader"
      style={paperVars}
      onClick={(event) => {
        // 顶栏 / 两块面板都是浮层，点它们不算「点屏幕中间」
        const node = event.target as HTMLElement | null;
        if (node?.closest(".reader-bar")) return;
        // 拖选文字松手也会来一次 click，别把顶栏抖出来
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        // 刚点在外面关掉了面板，这次 click 只当「关面板」
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        // 只有屏幕中间那一块才算（比例判断，与窗口大小无关）
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        if (
          x < MIDDLE_BAND.xMin ||
          x > MIDDLE_BAND.xMax ||
          y < MIDDLE_BAND.yMin ||
          y > MIDDLE_BAND.yMax
        ) {
          return;
        }
        // 呼出 / 收起顶栏（收起时顺手把面板也带走）
        if (barOpen) {
          setPanel(null);
          setBarOpen(false);
        } else {
          setBarOpen(true);
          setHintVisible(false);
        }
      }}
    >
      {/* 顶栏默认收着，点屏幕中间才滑下来；它是浮层，不占布局，书页不会跳 */}
      <header className={`bar reader-bar${barOpen ? " open" : ""}`} inert={!barOpen}>
        {/* 唯一的退出口：记账（位置 + 书签 + 时长 + 成就）之后再回书架 */}
        <button className="ghost" onClick={() => void finish()}>
          ← 书架
        </button>
        {/* pdf 的另一半：回到图片模式（偏好记在本机，下次开这本还按它） */}
        {isPdf ? (
          <button className="ghost" title="回到图片模式" onClick={() => switchPdfView("image")}>
            看图片
          </button>
        ) : null}
        {/* 免手翻：与终端按「a」同一个东西；节奏是「阅读设置」里那四个 reader.auto_scroll_* */}
        <button
          className="ghost"
          title={autoTurn.pace ? `自动翻页：${autoTurn.pace}（顶栏「阅读设置」里改）` : "自动翻页"}
          onClick={autoTurn.toggle}
        >
          {autoTurn.on ? "停止自动" : "自动翻页"}
        </button>
        <strong>{props.book.title || props.book.id}</strong>
        <span className="dim">
          {percentageOf(topLine, props.book.total_lines).toFixed(1)}% · 第{" "}
          {topLine + 1}/{props.book.total_lines} 行
        </span>

        <select
          value=""
          onChange={(event) => {
            // 选了章节才跳（空选项只是占位）
            if (event.currentTarget.value) {
              jumpTo(Number(event.currentTarget.value));
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
              jumpTo(Number(event.currentTarget.value));
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
        <button onClick={() => void persist()}>保存位置</button>
        <button className="ghost" onClick={() => void buildIndex()}>
          建立索引
        </button>
        {/* 光点导读：沿当前行跟着光读（领路的是光点或兔子；0 开关、1–6 是滑杆上的快捷落点；
            标记 / 档位 / 进度都存本机） */}
        <button
          type="button"
          className={`ghost reader-guide-btn${guideOn ? " on" : ""}`}
          title={`光点导读：${guideMarkerLabel(guideMarker)} · ${guideSpeedLabel(guideSpeed)}，按 1–6 是六个快捷档、0 开关`}
          aria-pressed={guideOn}
          onClick={toggleGuide}
        >
          {guideMarkerLabel(guideMarker)}
          {guideOn ? "开" : "关"}
        </button>
        {/* 光点导读的标记与档位：一枚写着当前档位的小按钮，点开才出「标记 + 那根 1–20 滑杆」
            （与 Aa / 主题同一套浮层做法、同一个 panel 状态，所以三块面板天然互斥）。
            换标记不跳行（光点 ⇄ 下划线）；滑杆往左更慢（1 档 20s/行）→ 往右更快（20 档 0.5s/行），
            换档时当前行重新计时（见 chooseGuideMarker / setGuideLevel） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-guide-speed-btn${speedOpen ? " on" : ""}`}
            title={`光点导读：${guideMarkerLabel(guideMarker)} · ${guideSpeedLabel(guideSpeed)}（点开换标记与速度）`}
            aria-label="光点导读的标记与速度"
            aria-expanded={speedOpen}
            onClick={() => setPanel((open) => (open === "guide" ? null : "guide"))}
          >
            {guideSpeedLabel(guideSpeed)}
          </button>
          {speedOpen ? (
            <div className="reader-prefs reader-guide-panel" role="group" aria-label="光点导读">
              <div className="pref-row">
                <span className="pref-label">标记</span>
                <div className="pref-pill" role="group" aria-label="导读的标记">
                  {GUIDE_MARKERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={guideMarker === item.id ? "on" : ""}
                      aria-pressed={guideMarker === item.id}
                      title={item.hint}
                      onClick={() => chooseGuideMarker(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* 颜色：三样各一枚取色器 —— 光点是那颗小球（高光 / 光晕跟着它算），
                  下划线 / 波浪线是它们各自那一段线（两号的走法一样，只是笔迹不同）。
                  都空着 = 出厂色，所以这里不写「默认值」这个概念，只给三枚色块 */}
              <div className="pref-row">
                <span className="pref-label">光点</span>
                <input
                  className="pref-color"
                  type="color"
                  value={guideColors.dot}
                  aria-label="光点的颜色"
                  title={`光点的颜色（当前 ${guideColors.dot}）`}
                  onChange={(event) => updatePrefs({ guideDotColor: event.currentTarget.value })}
                />
                <span className="pref-label">下划线</span>
                <input
                  className="pref-color"
                  type="color"
                  value={guideColors.line}
                  aria-label="下划线的颜色"
                  title={`下划线的颜色（当前 ${guideColors.line}）`}
                  onChange={(event) => updatePrefs({ guideLineColor: event.currentTarget.value })}
                />
              </div>
              <div className="pref-row">
                <span className="pref-label">波浪线</span>
                <input
                  className="pref-color"
                  type="color"
                  value={guideColors.wave}
                  aria-label="波浪线的颜色"
                  title={`波浪线的颜色（当前 ${guideColors.wave}）`}
                  onChange={(event) => updatePrefs({ guideWaveColor: event.currentTarget.value })}
                />
              </div>
              {prefs.guideDotColor || prefs.guideLineColor || prefs.guideWaveColor ? (
                <p className="pref-note">
                  三样都空着就是出厂色：光点那颗琥珀；下划线与波浪线跟正文同色。
                </p>
              ) : null}
              <div className="pref-row">
                <span className="pref-label">速度</span>
                <input
                  type="range"
                  min={GUIDE_SPEED_MIN}
                  max={GUIDE_SPEED_MAX}
                  step={1}
                  value={guideSpeed}
                  aria-label="光点导读速度"
                  onChange={(event) => setGuideLevel(Number(event.currentTarget.value))}
                />
              </div>
              {/* 滑杆没有刻度，所以把两端写出来，中间是当前那一档 */}
              <div className="guide-speed-scale">
                <span>{GUIDE_SPEED_MIN} 最慢</span>
                <strong>{guideSpeedLabel(guideSpeed)}</strong>
                <span>{GUIDE_SPEED_MAX} 最快</span>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={
                  !prefs.guideDotColor && !prefs.guideLineColor && !prefs.guideWaveColor
                }
                title="光点回到那颗琥珀、下划线与波浪线回到跟随正文"
                onClick={() =>
                  updatePrefs({ guideDotColor: "", guideLineColor: "", guideWaveColor: "" })
                }
              >
                恢复出厂色
              </button>
            </div>
          ) : null}
        </div>
        {/* 底部那四个按钮删掉了，快捷键得写出来才有人知道 */}
        <span className="dim reader-keys">↑ ↓ 翻行 · ← → / 空格 滚一屏 · 1–6 光点换速</span>

        {/* 排版：字（字号 / 字重 / 字距）、行距 / 段间距与页边距（界面自己的状态，存本机 gui_settings） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${prefsOpen ? " on" : ""}`}
            title="字号 / 字重 / 字距 / 行距 / 段间距与页边距"
            aria-label="阅读排版设置"
            aria-expanded={prefsOpen}
            onClick={() => setPanel((open) => (open === "type" ? null : "type"))}
          >
            Aa
          </button>
          {prefsOpen ? (
            <div className="reader-prefs" role="group" aria-label="阅读排版">
              {/* 字体：都用本机自带的字体（不联网），每枚按钮**自己就用那款字体**写自己的名字，
                  所以挑的时候一眼能看出差别；窗口窄的时候这一排会自己换行 */}
              <div className="pref-row">
                <span className="pref-label">字体</span>
                <div className="pref-pill pref-fonts" role="group" aria-label="正文字体">
                  {READER_FONTS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={prefs.font === item.id ? "on" : ""}
                      aria-pressed={prefs.font === item.id}
                      title={item.hint}
                      style={{ fontFamily: item.stack }}
                      onClick={() => updatePrefs({ font: item.id })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pref-row">
                <span className="pref-label">字号</span>
                <input
                  type="range"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  step={1}
                  value={prefs.fontSize}
                  aria-label="字号"
                  onChange={(event) =>
                    updatePrefs({ fontSize: Number(event.currentTarget.value) })
                  }
                />
                <input
                  className="pref-num"
                  type="number"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  step={1}
                  value={prefs.fontSize}
                  aria-label="字号（像素）"
                  onChange={(event) =>
                    updatePrefs({ fontSize: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">字重</span>
                <input
                  type="range"
                  min={WEIGHT_MIN}
                  max={WEIGHT_MAX}
                  step={WEIGHT_STEP}
                  value={prefs.fontWeight}
                  aria-label="字重"
                  onChange={(event) =>
                    updatePrefs({ fontWeight: Number(event.currentTarget.value) })
                  }
                />
                <input
                  className="pref-num"
                  type="number"
                  min={WEIGHT_MIN}
                  max={WEIGHT_MAX}
                  step={WEIGHT_STEP}
                  value={prefs.fontWeight}
                  aria-label="字重（100~900）"
                  onChange={(event) =>
                    updatePrefs({ fontWeight: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">g</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">字距</span>
                <input
                  type="range"
                  min={LETTER_MIN}
                  max={LETTER_MAX}
                  step={0.1}
                  value={prefs.letterSpacing}
                  aria-label="字距"
                  onChange={(event) =>
                    updatePrefs({ letterSpacing: Number(event.currentTarget.value) })
                  }
                />
                <input
                  className="pref-num"
                  type="number"
                  min={LETTER_MIN}
                  max={LETTER_MAX}
                  step={0.1}
                  value={prefs.letterSpacing}
                  aria-label="字距（像素）"
                  onChange={(event) =>
                    updatePrefs({ letterSpacing: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">行距</span>
                <input
                  type="range"
                  min={LINE_MIN}
                  max={LINE_MAX}
                  step={LINE_STEP}
                  value={prefs.lineHeight}
                  aria-label="行距"
                  onChange={(event) =>
                    updatePrefs({ lineHeight: Number(event.currentTarget.value) })
                  }
                />
                <input
                  className="pref-num"
                  type="number"
                  min={LINE_MIN}
                  max={LINE_MAX}
                  step={LINE_STEP}
                  value={prefs.lineHeight}
                  aria-label="行距（倍数）"
                  onChange={(event) =>
                    updatePrefs({ lineHeight: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">×</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">段间距</span>
                <input
                  type="range"
                  min={PARA_MIN}
                  max={PARA_MAX}
                  step={PARA_STEP}
                  value={prefs.paraSpacing}
                  aria-label="段间距"
                  onChange={(event) =>
                    updatePrefs({ paraSpacing: Number(event.currentTarget.value) })
                  }
                />
                <input
                  className="pref-num"
                  type="number"
                  min={PARA_MIN}
                  max={PARA_MAX}
                  step={PARA_STEP}
                  value={prefs.paraSpacing}
                  aria-label="段间距（em）"
                  onChange={(event) =>
                    updatePrefs({ paraSpacing: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">em</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">左右边距</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginX}
                  aria-label="左右边距（像素）"
                  onChange={(event) =>
                    updatePrefs({ marginX: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">上边距</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginTop}
                  aria-label="上边距（像素）"
                  onChange={(event) =>
                    updatePrefs({ marginTop: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">下边距</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginBottom}
                  disabled={prefs.linkY}
                  aria-label="下边距（像素）"
                  onChange={(event) =>
                    updatePrefs({ marginBottom: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row pref-check">
                <input
                  id="reader-margin-y-link"
                  type="checkbox"
                  checked={prefs.linkY}
                  onChange={(event) => updatePrefs({ linkY: event.currentTarget.checked })}
                />
                <label htmlFor="reader-margin-y-link">上下边距相等</label>
              </div>
              <button type="button" className="ghost" onClick={resetPrefs}>
                恢复默认
              </button>
            </div>
          ) : null}
        </div>

        {/* 主题：四套预设纸面 + 白天/黑夜 + 自定义背景 / 字色（同样是界面自己的状态） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${themeOpen ? " on" : ""}`}
            title="纸面主题与配色"
            aria-label="阅读主题设置"
            aria-expanded={themeOpen}
            onClick={() => setPanel((open) => (open === "theme" ? null : "theme"))}
          >
            主题
          </button>
          {themeOpen ? (
            <div className="reader-prefs reader-theme" role="group" aria-label="纸面主题">
              <div className="pref-row">
                <span className="pref-label">主题</span>
                <div className="pref-pill pref-themes" role="group" aria-label="预设主题">
                  {READER_THEMES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={prefs.theme === item.id ? "on" : ""}
                      aria-pressed={prefs.theme === item.id}
                      title={item.hint}
                      onClick={() => updatePrefs({ theme: item.id })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pref-row">
                <span className="pref-label">亮暗</span>
                <div className="pref-pill pref-scheme" role="group" aria-label="白天或黑夜">
                  <button
                    type="button"
                    className={prefs.dark ? "" : "on"}
                    aria-pressed={!prefs.dark}
                    onClick={() => updatePrefs({ dark: false })}
                  >
                    白天
                  </button>
                  <button
                    type="button"
                    className={prefs.dark ? "on" : ""}
                    aria-pressed={prefs.dark}
                    onClick={() => updatePrefs({ dark: true })}
                  >
                    黑夜
                  </button>
                </div>
                <span className="pref-unit">每套两版</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">背景</span>
                <input
                  className="pref-color"
                  type="color"
                  value={palette.paper}
                  aria-label="自定义阅读背景色"
                  title={`自定义阅读背景色（当前 ${palette.paper}）`}
                  onChange={(event) => updatePrefs({ customBg: event.currentTarget.value })}
                />
                <span className="pref-label">字体</span>
                <input
                  className="pref-color"
                  type="color"
                  value={palette.ink}
                  aria-label="自定义正文字色"
                  title={`自定义正文字色（当前 ${palette.ink}）`}
                  onChange={(event) => updatePrefs({ customFg: event.currentTarget.value })}
                />
              </div>
              {prefs.customBg || prefs.customFg ? (
                <p className="pref-note">
                  自定义色盖在主题之上，换预设时它们不会被改动。
                </p>
              ) : null}
              <button
                type="button"
                className="ghost"
                disabled={!prefs.customBg && !prefs.customFg}
                onClick={() => updatePrefs({ customBg: "", customFg: "" })}
              >
                清除自定义色（跟随主题）
              </button>
            </div>
          ) : null}
        </div>

        {/* 阅读设置：内核 `reader.*` 那一整节（2026-10-11 从「调一调」搬来的 ——
            正读着书的时候就能调翻页手感、自动翻页的节奏与抽查、终端的一屏与存档口径）。
            存好一笔就叫一声，自动翻页当场按新节奏走（见 useAutoTurn 的 reload） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${configOpen ? " on" : ""}`}
            title="翻页手感 / 自动翻页的节奏与抽查 / 存档口径（存进书库设置）"
            aria-label="阅读设置"
            aria-expanded={configOpen}
            onClick={() => setPanel((open) => (open === "config" ? null : "config"))}
          >
            阅读设置
          </button>
          {configOpen ? (
            <ReaderConfigPanel
              // 只有自动翻页那四项需要当场生效，别的项（终端手感）存下就够了
              onSaved={(path) => {
                if (path.startsWith("reader.auto_scroll")) autoTurn.reload();
              }}
            />
          ) : null}
        </div>
      </header>

      {/* 顶栏收着时给一句提示，几秒后自己消失 */}
      {hintVisible ? (
        <div className="reader-hint" role="status">
          点屏幕中间呼出工具栏
        </div>
      ) : null}

      {/* 跳转 / 翻行后亮一下位置：顶栏收着时，这是唯一的「我在哪」 */}
      {posChip && !barOpen ? (
        <div className="reader-pos" role="status">
          {posChip}
        </div>
      ) : null}

      {/* 自动翻页开着时挂一枚小牌子：节奏一眼可见；点它就把「阅读设置」打开（改节奏去那儿） */}
      {autoTurn.on && !barOpen ? (
        <button
          type="button"
          className="auto-chip"
          title="点一下打开「阅读设置」，在那里改自动翻页的节奏"
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

      {/* 换档 / 开关光点导读时左上方亮一下档位名，两秒后自己淡出 */}
      {guideChip ? (
        <div className="reader-speed-chip" role="status">
          {guideChip}
        </div>
      ) : null}

      {/* 一次性消息做成底部浮字：顶栏收着也看得见，而且不挤动书页 */}
      <div className="reader-toasts" aria-live="polite">
        {error ? <p className="toast error">{error}</p> : null}
        {notice ? <p className="toast notice">{notice}</p> : null}
        {unlocked.length > 0 ? (
          <p className="toast notice">🏆 {unlocked.map((item) => item.name).join("、")}</p>
        ) : null}
        {appending ? <p className="toast dim">正在往下接…</p> : null}
      </div>

      {/* 一本书的骨架：封面在左边，右侧的纸页堆叠 / 书口是「底下还有多少页」。
          正文就铺在这张纸上，整张纸自己滚 —— 没有分页，也就没有「翻页」动效 */}
      <div className="reader-book">
        <div className="book-cover" aria-hidden="true" />
        <div className="book-stack" aria-hidden="true" />
        <div className="reader-page">
          {/* 右上角那枚拟物书签：点一下插进这一页，再点一下拔出来 */}
          <button
            type="button"
            key={ribbonStamp}
            className={`reader-bookmark${markedHere ? " active" : ""}`}
            title={markedHere ? "拔掉这一页的书签" : "给这一页插一枚书签"}
            aria-label={markedHere ? "取消本页书签" : "给本页加书签"}
            aria-pressed={markedHere}
            onClick={() => void toggleBookmark()}
          />
          <div className="reader-text" ref={textRef} onScroll={handleScroll}>
            {/* 字、行距与页边距直接贴成行内样式：改一下马上就看得到。
                段间距是给每一行用的，所以走 CSS 变量（段首那一行取它做额外上边距）。
                `guide-crawl` / `guide-wave` 是「一段线自己往前爬」的那两号：那几条轨迹条就是
                那一段领路的线本身（下划线是墨色方头的一条、波浪线是同一支笔画的波浪），
                走过的地方由各自的 CSS 动画迅速化掉（见 App.css） */}
            <div
              className={`reader-lines${guideModeClass}`}
              style={
                {
                  fontSize: `${prefs.fontSize}px`,
                  fontFamily: readerFontStack(prefs.font),
                  fontWeight: prefs.fontWeight,
                  letterSpacing: `${prefs.letterSpacing}px`,
                  lineHeight: prefs.lineHeight,
                  "--reader-para-gap": `${prefs.paraSpacing}em`,
                  // 光点 / 下划线那两样颜色（没自定义过时这里是空的，颜色全交给 CSS 的兜底）
                  ...guideColorVars(prefs),
                  paddingTop: `${prefs.marginTop}px`,
                  paddingBottom: `${prefs.marginBottom}px`,
                  paddingLeft: `${prefs.marginX}px`,
                  paddingRight: `${prefs.marginX}px`,
                } as CSSProperties
              }
            >
              {slice ? (
                slice.lines.map((line, index) => {
                  // 空行也要占位，不然段间距会塌掉（「没有字」就这一个判断，导读跳空行用的是同一个）
                  const blank = isBlankLine(line);
                  // 段首 = 这一行有字、而上一行是空的（这本书用空行分段）。
                  // 这批的第一行不算：跨批时看不到上一批的末行，宁可少一次留白也别误加。
                  const paraStart = !blank && index > 0 && isBlankLine(slice.lines[index - 1]);
                  // 光点导读：走过的行字底下留一条下划线（CSS 那层），当前行那条由轨迹条负责
                  const guided = guideOn && index <= guideIndex;
                  const active = guided && index === guideIndex;
                  const lit = guided ? (active ? " active" : " passed") : "";
                  return (
                    <p
                      key={slice.start + index}
                      className={`reading-line${blank ? " blank" : paraStart ? " para-start" : ""}${lit}`}
                    >
                      {/* 轨迹：当前行每一折一条（走过的整条、正在走的那折按进度长）。
                          条数是量完 rect 才知道的（空行没有字，不画），宽高每帧直接写 style */}
                      {active
                        ? Array.from({ length: guideTrailRows }, (_, row) => (
                            <span
                              key={row}
                              className="reading-guide-trail"
                              ref={(node) => {
                                trailRefs.current[row] = node;
                              }}
                              aria-hidden="true"
                            />
                          ))
                        : null}
                      {/* 内层这一层是给「量这一行文字铺到哪儿」用的（折行时 getClientRects 一折一条） */}
                      <span className="reading-line-text">{line || "\u00a0"}</span>
                      {/* 领路的那位挂在这一行里：位置每帧由 Reader 直接写 style，不走 React 渲染。
                          光点是一颗小球；下划线 / 波浪线那两号没有实体的那一位（那一段线就是它），
                          这个 span 只当「量这一行折到哪儿」的锚点 —— 所以它里面是空的，但**不能省** */}
                      {active ? (
                        <span className="reading-guide-marker" ref={markerRef} aria-hidden="true">
                          {guideMarker === "dot" ? <span className="reading-guide-dot" /> : null}
                        </span>
                      ) : null}
                    </p>
                  );
                })
              ) : (
                <p className="dim">载入中…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
