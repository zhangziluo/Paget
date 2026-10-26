import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

import {
  ANNOTATION_COLORS,
  ANNOTATION_STYLES,
  DEFAULT_ANNOTATION_COLOR,
  annotationTint,
  lineSegments,
  loadAnnotations,
  marksByLine,
  newAnnotationId,
  normalizeAnnotationColor,
  patchAnnotation,
  removeAnnotation,
  saveAnnotations,
  upsertAnnotation,
  type Annotation,
  type AnnotationSpan,
  type AnnotationStyle,
  type LineMark,
} from "../lib/annotations";
import {
  bookRecord,
  bookText,
  bookToc,
  getGuiSetting,
  indexBook,
  loadGuiPosition,
  readerBackground,
  recordDailyOpen,
  recordSession,
  saveCorePosition,
  saveGuiPosition,
  searchBook,
  setGuiSetting,
  setReaderBackground,
} from "../lib/core";
import PdfReader from "../components/PdfReader";
import AutoCheckDialog from "../components/AutoCheckDialog";
import { Plush } from "../components/Plush";
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
  READER_BG_FILLS,
  READER_FONTS,
  READER_THEMES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  guideColorVars,
  guideSwatchColor,
  hexToRgba,
  loadReaderPrefs,
  normalizeReaderPrefs,
  readerFontStack,
  readerPalette,
  saveReaderPrefs,
  type ReaderPrefs,
} from "../lib/readerPrefs";
import {
  DEFAULT_READER_TAP_ZONES,
  READER_TAP_ACTIONS,
  READER_TAP_ZONES,
  isDefaultReaderTapZones,
  loadReaderTapZones,
  normalizeReaderTapZones,
  saveReaderTapZones,
  type ReaderTapAction,
  type ReaderTapZone,
  type ReaderTapZones,
} from "../lib/readerTapZones";
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
import { TOYS, loadToySettings, placedToys } from "../lib/toyPrefs";
import type {
  BookRow,
  Bookmark,
  BookSearchHit,
  GuiPosition,
  IndexReport,
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
 * 主控是下栏那颗「档位」里的滑杆（1–20 随便拖），这里只是「不开栏也能换个大概」——
 * 数字键的位置没变（`1` 还是最慢、`6` 还是最快），只是刻度变密之后落点不再是挨着的六格。
 */
const GUIDE_KEY_PRESETS = [1, 5, 9, 12, 16, 20];

/** 拖滑杆换档会连发：进度等手停下来再写一次（毫秒），与排版偏好同一个数。 */
const GUIDE_SAVE_MS = 400;

/** 栏里那五块浮层：Aa（字与页边距）、纸色（纸面配色）、档位（光点导读的速度）、
 *  翻页设置（内核 `reader.*` 那一节的翻页与存档）、手势（六个角落 / 边条点下去做什么）。
 *  同一时刻只开一块。 */
type Panel = "type" | "theme" | "guide" | "config" | "tap" | null;

/** 屏幕中间多大一块算「中间区域」——点它呼出 / 收起上下两栏（比例，0~1）。 */
const MIDDLE_BAND = { xMin: 0.25, xMax: 0.75, yMin: 0.18, yMax: 0.82 };

/**
 * 四角热区有多大（比例，0~1）。四角各做什么读「手势」那张表（`lib/readerTapZones.ts`）：
 * 出厂是左上「书架略缩图」、右上「书签」、左下「目录」、右下「玩偶」。
 *
 * 中间那块（`MIDDLE_BAND`）照旧呼出上下两栏；四角与它**不重叠**，所以两套交互各管各的。
 */
const CORNER_HIT = 0.22;

/**
 * 左右两条「上一页 / 下一页」热区的边线（比例，0~1）。
 *
 * 比四角（`CORNER_HIT`）窄一档：中间那一圈 0.18–0.22 / 0.78–0.82 是死区，
 * 贴着正文边缘点也不会误翻页。
 */
const EDGE_HIT = 0.18;

/**
 * 左上角「悬停浮出小书架」的触发范围与等待时间。
 *
 * 触发范围**比 `CORNER_HIT` 更窄**（0.14 而不是 0.22）：原来的 22% 太靠近第一行正文，
 * 鼠标只是去选字就会「啪」地弹出一块木头压在字上，划线与批注都被它挡了。
 * 现在还要求**停够 `PEEK_DELAY_MS`** 才浮出来 —— 快速划过、拖动选区都不会触发；
 * 一旦按了鼠标（`onMouseDown`）也立刻收起来。于是「略缩图压着正文」只可能发生在
 * 你确实把光标停在最角落的时候。
 */
const PEEK_HIT = 0.14;
const PEEK_DELAY_MS = 420;

/** 左上角小书架里那几根书脊：颜色与高矮都岔开一点，像一排放满的书 */
const PEEK_SPINES = [
  { color: "#a3452f", height: 82 },
  { color: "#3f6b8a", height: 94 },
  { color: "#c08a3e", height: 70 },
  { color: "#4f7a45", height: 88 },
  { color: "#8a5f8f", height: 76 },
  { color: "#7a5a2e", height: 92 },
  { color: "#b05a4a", height: 66 },
];

/**
 * 自定义背景图长边的上限（px）：纸面用不着更大，压住文件体积。
 *
 * 以前存进偏好 JSON 时是 2400px / q0.9 —— 一张照片动辄 4~5 MB，而每拖一下字号
 * 滑杆都要把它重写一遍。现在图单独落文件，并且压到 2000px / q0.82：
 * 铺在纸上还要淡化，肉眼看不出差别，文件通常只有几百 KB。
 */
const BG_MAX_EDGE = 2000;

/** 旧偏好里的背景图超过这个长度才值得重新压一遍（小图直接搬进文件，不降质）。 */
const BG_RECOMPRESS_ABOVE = 512 * 1024;

/** 把已经解码的图片画进 canvas，压成长边 ≤ `BG_MAX_EDGE` 的 webp data URL。 */
function encodeBackgroundImage(image: HTMLImageElement): string {
  const natural = Math.max(image.naturalWidth, image.naturalHeight);
  if (!natural) throw new Error("image has no pixels");
  const scale = Math.min(1, BG_MAX_EDGE / natural);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(image, 0, 0, width, height);
  // webp 保留透明（带透明的 png 不会变黑底）；不认 webp 的 webview 会自己退回 png
  return canvas.toDataURL("image/webp", 0.82);
}

/**
 * 把用户挑的图片读成一张压缩过的 data URL（长边 ≤ `BG_MAX_EDGE`，webp）。
 *
 * 为什么要先过一遍 canvas：直接 `readAsDataURL` 一张 4K 照片会得到好几 MB 的 base64，
 * 而这张图要写进磁盘、每次开书再读回来 —— 压过之后通常只剩几百 KB。
 */
function readBackgroundImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        resolve(encodeBackgroundImage(image));
      } catch (err) {
        reject(err);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    image.src = url;
  });
}

/**
 * 把一张已经存在的 data URL 重新压一遍（只给老数据用）。
 *
 * 老版本把图塞在 `gui_settings.reader.prefs` 里、压到 2400px；迁移到文件时顺手
 * 瘦一圈。解不开就原样返回 —— 迁移失败也不能把用户的背景图弄丢。
 */
function shrinkBackgroundImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        resolve(encodeBackgroundImage(image));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/* ------------------------------------------------------------------ */
/* 划线：把 DOM 选区换算成「行号 + 行内字符区间」                          */
/* ------------------------------------------------------------------ */

/** 浮条 / 批注卡片离屏幕边至少留这么多像素。 */
const ANNOT_EDGE_PX = 12;

/** 一个点（node, offset）在某一行里已经走过的字符数。 */
function offsetInLine(lineEl: HTMLElement, node: Node, offset: number): number {
  const box = lineEl.querySelector<HTMLElement>(".reading-line-text") ?? lineEl;
  if (node !== box && !box.contains(node)) return 0;
  const probe = document.createRange();
  probe.selectNodeContents(box);
  try {
    probe.setEnd(node, offset);
  } catch {
    return 0;
  }
  return probe.toString().length;
}

/** 这个节点属于哪一行（`.reading-line[data-line]`）。 */
function lineElementOf(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>(".reading-line[data-line]") ?? null;
}

/** 一行显示出来的文字（划线就是按它算字符偏移的）。 */
function lineTextOf(lineEl: HTMLElement): string {
  return lineEl.querySelector<HTMLElement>(".reading-line-text")?.textContent ?? "";
}

/**
 * 把当前选区换算成「落在哪几行的哪些字」。
 *
 * 跨段（跨多个 `<p class="reading-line">`）时中间那些整行都算上，所以一条划线可以
 * 有好几段 `spans`、共用一份样式 / 颜色 / 批注。返回的 `quote` 多段之间用换行拼
 * （导出时会压成一行）。首尾的空白与空行剔掉 —— 划到句尾那个看不见的空格很丑。
 */
function selectionToSpans(range: Range): { spans: AnnotationSpan[]; quote: string } | null {
  const startLine = lineElementOf(range.startContainer);
  const endLine = lineElementOf(range.endContainer);
  if (!startLine || !endLine) return null;
  const root = startLine.closest(".reader-lines");
  if (!root || !root.contains(endLine)) return null;
  const lines = [...root.querySelectorAll<HTMLElement>(".reading-line[data-line]")];
  const from = lines.indexOf(startLine);
  const to = lines.indexOf(endLine);
  if (from < 0 || to < 0 || to < from) return null;
  const spans: AnnotationSpan[] = [];
  for (let i = from; i <= to; i += 1) {
    const el = lines[i];
    const line = Number(el.dataset.line);
    if (!Number.isInteger(line)) continue;
    const text = lineTextOf(el);
    if (!text.trim()) continue;
    const rawStart = i === from ? offsetInLine(el, range.startContainer, range.startOffset) : 0;
    const rawEnd = i === to ? offsetInLine(el, range.endContainer, range.endOffset) : text.length;
    const start = Math.max(0, Math.min(rawStart, text.length));
    const end = Math.max(0, Math.min(rawEnd, text.length));
    if (end > start) spans.push({ line, start, end });
  }
  if (!spans.length) return null;
  const textOf = (line: number) => {
    const el = lines.find((node) => Number(node.dataset.line) === line);
    return el ? lineTextOf(el) : "";
  };
  // 首尾空白剔掉
  while (spans.length) {
    const span = spans[0];
    const text = textOf(span.line);
    while (span.start < span.end && /\s/.test(text[span.start] ?? "")) span.start += 1;
    if (span.end > span.start) break;
    spans.shift();
  }
  while (spans.length) {
    const span = spans[spans.length - 1];
    const text = textOf(span.line);
    while (span.end > span.start && /\s/.test(text[span.end - 1] ?? "")) span.end -= 1;
    if (span.end > span.start) break;
    spans.pop();
  }
  if (!spans.length) return null;
  const quote = spans.map((span) => textOf(span.line).slice(span.start, span.end)).join("\n");
  return quote.trim() ? { spans, quote } : null;
}

/**
 * 两段选中是不是同一处（同一段原文、同样的几个字符区间）。
 *
 * 用途：点浮条上的色点时，浏览器会再冒一次 `mouseup`，有些 WebView 此时
 * 选区还在——要靠它认出「这不是新划的一段」，别把刚挑的笔色冲掉。
 */
function isSameSelection(
  a: { spans: AnnotationSpan[]; quote: string },
  b: { spans: AnnotationSpan[]; quote: string },
): boolean {
  return (
    a.quote === b.quote &&
    a.spans.length === b.spans.length &&
    a.spans.every((span, index) => {
      const next = b.spans[index];
      return span.line === next.line && span.start === next.start && span.end === next.end;
    })
  );
}

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
  // 划线 + 批注：整份表（跨书，存本机 `gui_settings`）—— 阅读页只画这本书的那几条
  const [allAnnotations, setAllAnnotations] = useState<Annotation[]>([]);
  // 选中文字后浮出的工具条：落在哪几行哪些字、划中的原文、浮条位置、当前选的笔色
  const [picked, setPicked] = useState<{
    spans: AnnotationSpan[];
    quote: string;
    left: number;
    top: number;
    color: string;
  } | null>(null);
  // 点开的一条划线（批注卡片跟着它走）
  const [opened, setOpened] = useState<{ id: string; left: number; top: number } | null>(null);
  // 卡片里正在敲的批注 / 是「看」还是「改」
  const [draftNote, setDraftNote] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  // 屏顶行号（显示用；权威值在 cursor 里）
  const [topLine, setTopLine] = useState(props.book.current_line);
  // 每次点书签 +1：让丝带重挂载一次，把「插进去」的动画重放一遍
  const [ribbonStamp, setRibbonStamp] = useState(0);
  // 正在取下一批
  const [appending, setAppending] = useState(false);
  // 排版偏好（字 / 边距 / 纸面主题）与顶栏那两块小面板（Aa、主题）
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_READER_PREFS);
  const [panel, setPanel] = useState<Panel>(null);
  // 背景图：藏起来的那枚 `<input type="file">`（点面板上的按钮去点它）+ 一句临时提示
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [bgNotice, setBgNotice] = useState<string | null>(null);
  // 光点导读：开着时沿当前行慢慢走过一位「领路的」—— 一颗光点、跳进书里那只兔子，
  // 或者四五个字宽的一小段下划线（自己一伸一缩地往前爬）；划过的轨迹是字底下一条下划线
  // （兔子模式换成一串脚印，下划线模式那段短下划线自己就是领路的）。
  // 进来先读一次这本书的进度（本机 localStorage，按书分开）；读不到就从第一行、默认档、光点、开着开始
  const guideStart = useRef<GuideProgress | null>(null);
  if (guideStart.current === null) guideStart.current = loadGuideProgress(props.book.id);
  const guideSaved = guideStart.current;
  const [guideOn, setGuideOn] = useState(guideSaved.on);
  const [guideSpeed, setGuideSpeed] = useState(guideSaved.speed);
  // 走在前面的是光点还是下划线（在下栏那颗「档位」的浮层里切）
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
  // 六个角落 / 边条点下去各做什么（本机设置，见 lib/readerTapZones.ts）。
  // 默认就是原来写死的那六样，所以没动过设置的人手感不变。
  const [zoneActions, setZoneActions] = useState<ReaderTapZones>(DEFAULT_READER_TAP_ZONES);
  // 还没读回设置之前别把默认值写回去（与上面的 prefsReady 同一个理由）
  const zonesReady = useRef(false);
  // 左上角悬停浮出小书架的延迟计时器（0 = 没在等）
  const peekTimer = useRef(0);

  // 五块面板互斥：同一时刻最多开一块
  const prefsOpen = panel === "type";
  const themeOpen = panel === "theme";
  const speedOpen = panel === "guide";
  // 第四块：内核 reader.* 那一节（2026-10-11 从「调一调」搬过来，见 lib/readerConfig.ts）
  const configOpen = panel === "config";
  // 第五块：手势（六个角落 / 边条点下去做什么，本机设置）
  const tapOpen = panel === "tap";
  // 左上角还指着「回书架」时，悬停才浮出小书架（换成别的动作就不浮了）
  const topLeftIsShelf = zoneActions["top-left"] === "shelf";
  // 上下两栏默认都收着，点屏幕中间才呼出；进来先亮一句提示，几秒后自己消失
  const [barOpen, setBarOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  // 左上角悬停：浮出「首页书架」的小略缩图（点它直接回书架）
  const [shelfPeek, setShelfPeek] = useState(false);
  // 左下角弹出的目录页（点标题跳到对应行）
  const [tocOpen, setTocOpen] = useState(false);
  // 右下角蹦出来的那只玩偶（null = 收着；书同时往左让一让，右侧桌面加宽）
  const [toy, setToy] = useState<{ id: string; label: string } | null>(null);
  // 右下角能蹦出来的玩偶：书架摆着的那几只；一只也没摆就三只里随便挑
  const toyPool = useMemo(() => {
    const placed = placedToys(loadToySettings());
    return placed.length ? placed : TOYS;
  }, []);
  // 在本书里搜：输入框 + 结果列表（浮层，Esc 关闭；点结果跳到那一行）
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<BookSearchHit[]>([]);
  // 这批结果对应哪个词：回车时拿来对一下，别把上一轮的结果当成这一轮的
  const [searchHitsFor, setSearchHitsFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  // 跳到某一行之后短暂高亮它（2.6 秒后自己淡掉）
  const [searchHitLine, setSearchHitLine] = useState<number | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  // 每次输入 / 关闭都 +1：慢一步回来的旧结果直接丢掉
  const searchSeq = useRef(0);
  // 正在跑的建索引任务（连打几个字时不重复建）
  const indexRun = useRef<Promise<IndexReport> | null>(null);
  // 这本已经确认没有可索引的正文：别再反复建空索引
  const noSearchText = useRef(false);
  const searchHitTimer = useRef(0);
  // pdf 的两种看法：默认**按图片浏览**（见 lib/pdfView.ts），偏好按书存在本机设置里
  const isPdf = (props.book.format ?? "") === "pdf";
  const [pdfViews, setPdfViews] = useState<Record<string, PdfView>>({});
  const [pdfView, setPdfView] = useState<PdfView>(DEFAULT_PDF_VIEW);
  // 只有文字视图能搜（图片模式没有可跳的行号；PDF 可先「转换成文字」）
  const textMode = !isPdf || pdfView === "text";

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

  /* ---------------- 划线 + 批注 ---------------- */

  // 读一次本机那份划线表（跨书；这本书的那几条从里面筛）
  useEffect(() => {
    let alive = true;
    loadAnnotations()
      .then((list) => {
        if (alive) setAllAnnotations(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 这本书的划线摊到每一行上（渲染 `.reading-line` 时按行号查）
  const lineMarks = useMemo(
    () => marksByLine(allAnnotations, props.book.id),
    [allAnnotations, props.book.id],
  );
  // 卡片里正开着的那一条
  const openedAnnotation = useMemo(
    () => (opened ? (allAnnotations.find((ann) => ann.id === opened.id) ?? null) : null),
    [allAnnotations, opened],
  );

  /** 写回整份划线表：先改界面（立刻看得到线），再写本机设置。 */
  const commitAnnotations = useCallback((next: Annotation[]) => {
    setAllAnnotations(next);
    saveAnnotations(next).catch(() => setNotice("划线没存下来：本机设置写入失败"));
  }, []);

  /** 用户松开鼠标 / 手指：有选中文字就浮出工具条。 */
  const captureSelection = useCallback((target?: EventTarget | null) => {
    // 落在浮条 / 批注卡片上（挑笔色、保存批注、取色器）不是「重新选了一段」：
    // 这一下直接不理，否则会把刚挑好的笔色冲回墨红
    if (target instanceof Element && target.closest(".annot-menu, .annot-card")) return;
    // 等一拍：有些 WebView 在 mouseup 里读到的还是旧选区
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const mapped = selectionToSpans(range);
      if (!mapped) return;
      const rect = range.getBoundingClientRect();
      const width = 344;
      const left = Math.max(
        ANNOT_EDGE_PX,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - ANNOT_EDGE_PX,
        ),
      );
      const top = Math.min(rect.bottom + 10, window.innerHeight - 108);
      setOpened(null);
      setPicked((prev) => ({
        ...mapped,
        left,
        top,
        // 同一段字又「松手」一次（比如重拖了一遍）：留着已经挑好的笔色；
        // 换了一段才回到默认的墨红
        color: prev && isSameSelection(prev, mapped) ? prev.color : DEFAULT_ANNOTATION_COLOR,
      }));
    }, 0);
  }, []);

  // 松手就去看看有没有选中文字（挂在 document 上：拖出正文再松手也算）
  useEffect(() => {
    const onUp = (event: MouseEvent | TouchEvent) => captureSelection(event.target);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, [captureSelection]);

  /** 挑好线型：把这次选区落成一条划线（批注留空，点它再写）。 */
  const addAnnotation = useCallback(
    (style: AnnotationStyle) => {
      if (!picked) return;
      const annotation: Annotation = {
        id: newAnnotationId(),
        bookId: props.book.id,
        bookTitle: props.book.title,
        spans: picked.spans,
        style,
        color: normalizeAnnotationColor(picked.color) || DEFAULT_ANNOTATION_COLOR,
        quote: picked.quote,
        note: "",
        createdAt: new Date().toISOString(),
      };
      commitAnnotations(upsertAnnotation(allAnnotations, annotation));
      window.getSelection()?.removeAllRanges();
      setPicked(null);
    },
    [picked, allAnnotations, commitAnnotations, props.book.id, props.book.title],
  );

  /** 点一条划线：在它下方弹出批注卡片（有批注先看，没有就直接是输入框）。 */
  const openAnnotation = useCallback(
    (event: React.MouseEvent<HTMLElement>, id: string) => {
      event.stopPropagation();
      setPicked(null);
      const annotation = allAnnotations.find((ann) => ann.id === id);
      if (!annotation) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const width = 336;
      const left = Math.max(
        ANNOT_EDGE_PX,
        Math.min(rect.left, window.innerWidth - width - ANNOT_EDGE_PX),
      );
      const top = Math.min(rect.bottom + 8, window.innerHeight - 196);
      setOpened({ id, left, top });
      setDraftNote(annotation.note);
      setNoteEditing(!annotation.note.trim());
    },
    [allAnnotations],
  );

  /** 保存批注（清空再存 = 只留划线、不要批注）。 */
  const saveNote = useCallback(() => {
    if (!opened) return;
    commitAnnotations(patchAnnotation(allAnnotations, opened.id, { note: draftNote.trim() }));
    setNoteEditing(false);
  }, [opened, draftNote, allAnnotations, commitAnnotations]);

  /** 删掉这条划线（连同批注）。 */
  const deleteOpened = useCallback(() => {
    if (!opened) return;
    commitAnnotations(removeAnnotation(allAnnotations, opened.id));
    setOpened(null);
    setDraftNote("");
  }, [opened, allAnnotations, commitAnnotations]);

  /** 一行文字：划过的片段包一层（点它弹批注卡片），没划过的原样输出。 */
  const renderAnnotatedLine = (line: string, marks: LineMark[]) => {
    if (!marks.length) return line;
    return lineSegments(line, marks).map((segment, index) =>
      segment.mark ? (
        <span
          key={index}
          className={`annot annot-${segment.mark.style}${segment.mark.hasNote ? " annot-noted" : ""}`}
          style={
            {
              "--annot-color": segment.mark.color,
              "--annot-tint": annotationTint(segment.mark.color),
            } as CSSProperties
          }
          title={segment.mark.hasNote ? "点开看这条批注" : "点一下写批注"}
          onClick={(event) => openAnnotation(event, segment.mark!.id)}
        >
          {segment.text}
        </span>
      ) : (
        <span key={index}>{segment.text}</span>
      ),
    );
  };
  // 跳转 / 翻行后短暂亮一下「第几行」（位置感就是上下文）
  const [posChip, setPosChip] = useState<string | null>(null);
  // 本次会话的开始时刻
  const startedAt = useRef(new Date());
  // 这一场里**挑过**的自定义导读色（光点 / 下划线 / 波浪线）：改了又改回去也算用过，
  // 所以只往里加、不删；收尾时随会话一起交给内核（「五颜六色」按书攒够四种就解锁）
  const guideColorsUsed = useRef<Set<string>>(new Set());
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
  // 刚点在外面关掉了排版面板：这次 click 只算「关面板」，不再顺手收起两栏
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

  /** 记下当前位置：ref 给定时器，state 给上栏与书签。 */
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
   * 拖下栏那颗「档位」里的滑杆时这个函数一秒会被叫几十次（每个 `input` 事件一次），所以进度**等手停下来
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
   * 两栏默认是收着的，跳章或跳到书签之后如果什么提示都没有，读者就不知道自己到哪儿了
   * （位置感一丢，等于没了上下文）。所以这里在上栏那个位置短暂亮一枚小牌子。
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
          // （再按一次 0 键或用下栏那枚开关可以让它从头再走）
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

  /**
   * 右下角：随机放一只玩偶出来。
   *
   * 已经从架上蹦出来一只时，再点就换一只**不同的**（只有一只可选时不换），
   * 这样连点几下能挨个看一遍，不会老是同一只。放出来的同时书的右边收窄、
   * 右侧那条桌面加宽，看着就是书往左让了让（见 App.css 的
   * `.reader-book.shifted` 与 `.container.reader.toy-open`）。
   */
  const popToy = useCallback(() => {
    setToy((current) => {
      const pool =
        toyPool.length > 1 && current
          ? toyPool.filter((item) => item.id !== current.id)
          : toyPool;
      return pool[Math.floor(Math.random() * pool.length)] ?? null;
    });
    // 蹦出来就先把别的浮层收掉，免得挤在一起
    setShelfPeek(false);
    setTocOpen(false);
    setBarOpen(false);
    setHintVisible(false);
  }, [toyPool]);

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
      if (searchHitTimer.current) window.clearTimeout(searchHitTimer.current);
      if (peekTimer.current) window.clearTimeout(peekTimer.current);
    },
    [],
  );

  // 开书时读回排版偏好（界面自己的状态，存在本机 gui_settings）。
  // 背景图不在那段 JSON 里：先读单独的文件；老版本把图塞在 prefs 里的，就地迁出来。
  useEffect(() => {
    let alive = true;
    loadReaderPrefs()
      .then(async (saved) => {
        let image: string | null = null;
        try {
          image = await readerBackground();
        } catch {
          image = null;
        }
        if (!alive) return;
        if (!image && saved.bgImage) {
          // 老数据：图还在 JSON 里。大图先压小一圈（老版本是 2400px / q0.9）再写文件，
          // 随后那次保存会把 JSON 里的几 MB 去掉；小图原样搬，不白降一次质。
          const legacy = saved.bgImage;
          const stored =
            legacy.length > BG_RECOMPRESS_ABOVE ? await shrinkBackgroundImage(legacy) : legacy;
          if (!alive) return;
          try {
            await setReaderBackground(stored);
            image = stored;
          } catch {
            // 文件写不进去（磁盘满 / 权限）：这次先用旧图，至少别当用户没设背景
            image = legacy;
          }
        }
        if (alive) setPrefs({ ...saved, bgImage: image ?? "" });
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

  // 开书时读回六个角落 / 边条的手势表（同样是本机 gui_settings，但按一下就该立刻生效，
  // 所以不做防抖 —— 改一块就写一次）
  useEffect(() => {
    let alive = true;
    loadReaderTapZones()
      .then((saved) => {
        if (alive) setZoneActions(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        // 读失败也要放行，否则用户改了手势永远存不进去
        zonesReady.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!zonesReady.current) return;
    saveReaderTapZones(zoneActions).catch(() => undefined);
  }, [zoneActions]);

  // 「这一场挑过哪几种颜色」只在这三样真的变了时才动（改字号、改纸色都不算）。
  // 空串 = 出厂色，不算自定义，所以不进集合；换过的颜色留在集合里 —— 换来换去
  // 最后又换回原色，那一次也算用过（成就问的是「用过几种」，不是「最后是什么色」）。
  useEffect(() => {
    for (const color of [
      prefs.guideDotColor,
      prefs.guideLineColor,
      prefs.guideWaveColor,
    ]) {
      if (color) guideColorsUsed.current.add(color);
    }
  }, [prefs.guideDotColor, prefs.guideLineColor, prefs.guideWaveColor]);

  // 点面板外面收起它（面板里的输入框在 wrap 内，不会误关）
  useEffect(() => {
    if (!panel) return;
    function onDown(event: MouseEvent) {
      const node = event.target;
      // 三块面板（Aa / 主题 / 速度）都在 `.reader-prefs-wrap` 里，点它们自己不算「外面」
      const inside =
        node instanceof Element && node.closest(".reader-prefs-wrap") !== null;
      if (!inside) {
        // 这次 click 已经被「关面板」用掉了，别让它再顺手收起两栏
        swallowClick.current = true;
        setPanel(null);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [panel]);

  // 两栏默认都收着，先亮一句怎么呼出来，几秒后自己消失
  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), 3500);
    return () => window.clearTimeout(timer);
  }, []);

  /** 打开「在本书里搜」：收起两栏，把键盘焦点交给输入框。 */
  const openSearch = useCallback(() => {
    // 图片模式没有可跳的行号；PDF 得先「转换成文字」。那里连这条浮层都不渲染，
    // 所以只是不打开（键盘那边也不抢 ⌘F，交给系统自己的页内查找）。
    if (!textMode) return;
    setPanel(null);
    setBarOpen(false);
    setHintVisible(false);
    setSearchOpen(true);
  }, [textMode]);

  /** 关掉搜索浮层；还在路上的旧结果一律作废。 */
  const closeSearch = useCallback(() => {
    searchSeq.current += 1;
    setSearchOpen(false);
    setSearching(false);
  }, []);

  // 切到图片模式（PDF 没有行号）时，把还开着的搜索收掉
  useEffect(() => {
    if (!textMode) closeSearch();
  }, [textMode, closeSearch]);

  /**
   * 搜一次（输入防抖 / 自动建索引 / 丢弃过期结果都在这里）。
   * 返回值就是这一轮的结果（里面已经 setState 了）：回车靠它拿到「刚搜出来的第一处」，
   * 好直接跳过去；作废的一轮返回 null。
   *
   * 第一次搜一本没索引的书：先 `indexBook` 建好，再搜一次；建索引期间连打几个字
   * 共用同一个任务，不会把同一本书反复索引。`seq` 是发起时的编号，回来时对不上就丢掉。
   */
  const runSearch = useCallback(
    async (keyword: string, seq: number): Promise<BookSearchHit[] | null> => {
      setSearching(true);
      setSearchStatus("正在找…");
      try {
        let report = await searchBook(props.book.id, keyword, 80);
        if (seq !== searchSeq.current) return null;
        if (!report.indexed && !noSearchText.current) {
          setSearchStatus("正在给这本书建立搜索索引…");
          let task: Promise<IndexReport> | null = indexRun.current;
          if (!task) {
            // 成功 / 失败都把这一格放掉：失败的建索引任务不能一辈子占着，
            // 否则后面每敲一个字都会拿到同一个已经 reject 的 promise
            const shared = indexBook(props.book.id).finally(() => {
              if (indexRun.current === shared) indexRun.current = null;
            });
            task = shared;
            indexRun.current = shared;
          }
          const built = await task;
          if (indexRun.current === task) indexRun.current = null;
          if (seq !== searchSeq.current) return null;
          // 正文为空（或索引切出 0 块）：记住，别每次输入都再建一遍
          if (built.chunks === 0) noSearchText.current = true;
          setSearchStatus(built.truncated ? "索引只覆盖了前半部分，正在找…" : "正在找…");
          report = await searchBook(props.book.id, keyword, 80);
          if (seq !== searchSeq.current) return null;
        }
        if (!report.indexed) {
          setSearchHits([]);
          setSearchHitsFor("");
          setSearchStatus(noSearchText.current ? "这本书没有可搜索的正文" : "还没建立索引");
          return [];
        }
        setSearchHits(report.hits);
        setSearchHitsFor(keyword);
        setSearchStatus(
          report.hits.length === 0
            ? `没有找到「${keyword}」`
            : `找到 ${report.hits.length} 处` +
                (report.truncated ? "（索引只覆盖前半部分）" : ""),
        );
        return report.hits;
      } catch (err) {
        if (seq !== searchSeq.current) return null;
        setSearchHits([]);
        setSearchHitsFor("");
        setSearchStatus(String(err));
        return [];
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [props.book.id],
  );

  // 换书：搜索状态清空（同一时刻只搜当前这一本）
  useEffect(() => {
    searchSeq.current += 1;
    noSearchText.current = false;
    indexRun.current = null;
    setSearchOpen(false);
    setSearchQuery("");
    setSearchHits([]);
    setSearchHitsFor("");
    setSearching(false);
    setSearchStatus("");
    setSearchHitLine(null);
  }, [props.book.id]);

  // 输入防抖：停手 280ms 再搜；每敲一个字先把上一轮结果作废
  useEffect(() => {
    if (!searchOpen) return;
    const keyword = searchQuery.trim();
    const seq = ++searchSeq.current;
    if (!keyword) {
      setSearchHits([]);
      setSearchHitsFor("");
      setSearching(false);
      setSearchStatus("");
      return;
    }
    setSearching(true);
    setSearchStatus("正在找…");
    const timer = window.setTimeout(() => void runSearch(keyword, seq), 280);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery, runSearch]);

  // 打开时聚焦输入框并全选：接着敲就是新词，回车就是第一处
  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  /** 点一条结果：收起浮层，跳到那一行，并短暂高亮它。 */
  const jumpToSearchHit = useCallback(
    (hit: BookSearchHit) => {
      setSearchOpen(false);
      setSearching(false);
      searchSeq.current += 1;
      setHintVisible(false);
      setSearchHitLine(hit.line);
      if (searchHitTimer.current) window.clearTimeout(searchHitTimer.current);
      searchHitTimer.current = window.setTimeout(() => {
        setSearchHitLine(null);
        searchHitTimer.current = 0;
      }, 2600);
      jumpTo(hit.line);
    },
    [jumpTo],
  );

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

  // Esc 的最后一步是「退出到书架」：`finish` 每次渲染都会新建，放进 ref 免得监听器拿到旧闭包
  // （与下面那些指针回调同一个做法）
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // 键盘：↑ ↓ 翻一行、← → / 空格 / PgUp / PgDn 滚一屏、1–6 换光点快捷档、0 开关光点导读
  // （底部那四个按钮就是被它们替掉的；光点档位也能在下栏那颗「档位」里拖）
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // ⌘F / Ctrl+F：阅读页自己的搜索（拦下浏览器的「页内查找」）；
      // 已经开着就回到输入框（浏览器里再按一次也是这个意思），不关它。
      // 图片模式没有可跳的行号，不拦，交还给系统
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (!textMode) return;
        event.preventDefault();
        if (searchOpen) {
          searchInput.current?.focus();
          searchInput.current?.select();
        } else {
          openSearch();
        }
        return;
      }
      // Esc 关搜索：**焦点在输入框里也认**（搜索框是全页浮层，Esc 就是走）
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      // 在下拉框 / 输入框里按方向键是在操作控件，别抢
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      // `/`：与书架同一套手感，随手开搜索（焦点在按钮上时不抢空格，但 `/` 可以）
      if (textMode && event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        openSearch();
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
          // Esc 一路往回退：先收面板（Aa / 纸色 / 档位 / 翻页设置），再收目录 / 玩偶，
          // 再收两栏，**都没有就记好账回书架**
          // （2026-10-14 用户要求：阅读模式下 Esc 默认应当退出到书架；与「← 书架」同一条路 ——
          //  经 finish() 落位置 / 时长 / 成就，不是直接关掉）
          if (panel) {
            setPanel(null);
          } else if (tocOpen) {
            setTocOpen(false);
          } else if (toy) {
            setToy(null);
          } else if (barOpen) {
            setBarOpen(false);
          } else {
            void finishRef.current();
          }
          break;
        case "0":
          // 0 = 开关光点导读（与下栏那枚开关同一件事）
          toggleGuide();
          break;
        default:
          // 1–6 = 光点导读的六个快捷档（1 最慢 … 6 最快；细调拖下栏那颗「档位」里的滑杆）；
          // 带修饰键的组合留给系统（⌘1 之类）
          if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[1-6]$/.test(event.key)) {
            setGuideLevel(GUIDE_KEY_PRESETS[Number(event.key) - 1]);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    moveLine,
    scrollScreen,
    panel,
    barOpen,
    tocOpen,
    toy,
    setGuideLevel,
    toggleGuide,
    searchOpen,
    openSearch,
    closeSearch,
    textMode,
  ]);

  /** 改一项排版偏好：范围都夹好，「上下边距相等」时下边距跟着上边距。 */
  function updatePrefs(patch: Partial<ReaderPrefs>) {
    setPrefs((prev) => normalizeReaderPrefs({ ...prev, ...patch }));
  }

  /** 恢复默认排版（背景图也撤掉 —— 默认值里就是空）。 */
  function resetPrefs() {
    setPrefs({ ...DEFAULT_READER_PREFS });
    setBgNotice(null);
    void setReaderBackground(null).catch(() => undefined);
  }

  /**
   * 挑一张图当阅读背景。
   *
   * 走浏览器自己的文件选择器（`accept` 只列图片，各平台都是原生的那一套）：
   * 读进来先压到长边 2000px，写成 `reader/background.*` 这张独立文件 —— 见
   * `readBackgroundImage`。同一个文件再选一次也要能触发，所以读完把 input 的值清空。
   */
  async function handleBgPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    // `accept` 已经把目录里的非图片挡掉大半，但「所有文件」还能绕过来，这里再认一次
    const isImage =
      file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    if (!isImage) {
      setBgNotice("这不是图片，换一张 png / jpg / webp / gif。");
      return;
    }
    // 原图可以有几十 MB（读进来先压，但太夸张的还是先挡一下，免得卡住）
    if (file.size > 32 * 1024 * 1024) {
      setBgNotice("图片太大了（上限 32MB），换一张小一点的。");
      return;
    }
    try {
      const dataUrl = await readBackgroundImage(file);
      // 先让纸面立刻换过来，再把图落到磁盘（写失败时这次至少还能看）
      updatePrefs({ bgImage: dataUrl });
      setBgNotice(null);
      try {
        await setReaderBackground(dataUrl);
      } catch {
        setBgNotice("这张图没能存到磁盘，下次打开这本书时背景会没有。");
      }
    } catch {
      setBgNotice("这张图读不出来，换一张试试。");
    }
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
        // 这一场挑过的自定义导读色（「五颜六色」：一本读完的书里攒够四种）
        guideColors: [...guideColorsUsed.current],
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

  /* ---------------- 六个角落 / 边条的手势 ---------------- */

  /** 收起左上角那块「悬停浮出的小书架」，并把还在等的计时器撤掉。 */
  const cancelShelfPeek = useCallback(() => {
    if (peekTimer.current) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = 0;
    }
    setShelfPeek(false);
  }, []);

  /** 呼出 / 收起上下两栏（点屏幕中间与「上下两栏」这个手势走同一条路）。 */
  function toggleBars() {
    setTocOpen(false);
    if (barOpen) {
      setPanel(null);
      setBarOpen(false);
    } else {
      setBarOpen(true);
      setHintVisible(false);
    }
  }

  /**
   * 把某个区域被指派的事做一遍。
   *
   * 每一项都沿用原来写死时的那几行：目录 / 玩偶会把别的浮层收掉、上一页 / 下一页先收目录、
   * 「回书架」与上栏那颗走同一条 `finish()`（记账之后再走）。所以换位置不换行为。
   */
  function runTapAction(action: ReaderTapAction) {
    switch (action) {
      case "shelf":
        void finish();
        break;
      case "bookmark":
        setTocOpen(false);
        void toggleBookmark();
        break;
      case "toc":
        // 与左下角原来那一下完全一样：开目录时把两栏与面板收掉
        setTocOpen((open) => !open);
        setBarOpen(false);
        setPanel(null);
        setHintVisible(false);
        break;
      case "toy":
        popToy();
        break;
      case "prev":
        setTocOpen(false);
        scrollScreen(-1);
        break;
      case "next":
        setTocOpen(false);
        scrollScreen(1);
        break;
      case "bars":
        toggleBars();
        break;
      case "guide":
        toggleGuide();
        break;
      case "autoturn":
        autoTurn.toggle();
        break;
      case "save":
        void persist();
        break;
      case "search":
        openSearch();
        break;
      case "index":
        void buildIndex();
        break;
      case "image":
        // 只有 PDF 有第二种看法；别的格式点了什么也不发生
        if (isPdf) switchPdfView("image");
        break;
      case "none":
      default:
        // 特意留白：把这块热区还给选字与批注
        break;
    }
  }

  /**
   * 按落点比例（0~1）算这是哪一块热区。
   *
   * 四角先判（`CORNER_HIT`），两条边后判（更窄的 `EDGE_HIT`，且只在纵向中段）——
   * 于是四个角与两条边之间那一圈窄窄的死区不属于任何一块，贴着正文边缘点不会误触。
   * 中间那块不在这里（它呼出两栏，由 `MIDDLE_BAND` 单独判断）。
   */
  function zoneForPoint(x: number, y: number): ReaderTapZone | null {
    const left = x < CORNER_HIT;
    const right = x > 1 - CORNER_HIT;
    const top = y < CORNER_HIT;
    const bottom = y > 1 - CORNER_HIT;
    if (top && left) return "top-left";
    if (top && right) return "top-right";
    if (bottom && left) return "bottom-left";
    if (bottom && right) return "bottom-right";
    if (x < EDGE_HIT && y >= CORNER_HIT && y <= 1 - CORNER_HIT) return "left-edge";
    if (x > 1 - EDGE_HIT && y >= CORNER_HIT && y <= 1 - CORNER_HIT) return "right-edge";
    return null;
  }

  // 屏顶这一行有没有书签（丝带的「插着 / 没插」状态）
  const markedHere = bookmarks.some((mark) => mark.line === topLine);

  // 目录里「现在读到的那一章」：行号不超过屏顶的最后一条（`toc` 按行号升序）
  const tocCurrent = useMemo(() => {
    let line = -1;
    for (const entry of toc) {
      if (entry.line > topLine) break;
      line = entry.line;
    }
    return line;
  }, [toc, topLine]);

  // 纸面配色：先取「预设主题 + 亮暗」，被自定义背景 / 字色盖过之后就是最终的一套
  const palette = readerPalette(prefs);
  // 导读那几枚取色器**显示什么颜色**：自定义色优先，没填就给这一档的出厂色
  // （下划线 / 波浪线那两号出厂跟正文墨色 —— 于是色块总与屏幕上那一条线同色）
  const guideColors = guideSwatchColor(prefs, palette.ink, guideMarker);
  // 背景图那几层：图片垫最底下，上面盖一层「淡化」（纸色半透明），最上面仍是原来那道纸面光。
  // 只在这张纸上生效 —— 右侧书口 / 桌面不跟着变。淡化 0% 时那层是全透明的。
  const bgVars: Record<string, string> = prefs.bgImage
    ? {
        "--reader-bg-image": `url("${prefs.bgImage}")`,
        "--reader-bg-size": prefs.bgFill === "repeat" ? "auto" : prefs.bgFill,
        "--reader-bg-repeat": prefs.bgFill === "repeat" ? "repeat" : "no-repeat",
        "--reader-bg-position": prefs.bgFill === "repeat" ? "0 0" : "center",
        "--reader-bg-veil": hexToRgba(
          palette.paper,
          Math.min(100, Math.max(0, prefs.bgFade)) / 100,
        ),
      }
    : {};
  // 贴成 CSS 变量：整张纸（底色、书页堆叠、书口、纸面的光、书脊的暗、正文墨色、背景图）全跟着走
  const paperVars = {
    "--paper": palette.paper,
    "--paper-edge-fill": palette.edgeFill,
    "--paper-edge-line": palette.edgeLine,
    "--reader-ink": palette.ink,
    "--reader-sheen": palette.sheen,
    "--reader-spine": palette.spine,
    ...bgVars,
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
      className={`container reader${barOpen ? " bars-open" : ""}${toy ? " toy-open" : ""}`}
      style={paperVars}
      // 左上角悬停：停够 `PEEK_DELAY_MS` 才浮出「首页书架」的略缩图（且只有左上角
      // 还指着「回书架」时才浮）。用 mousemove 判断而不是铺一块透明热区，是为了不挡住
      // 最上面几行正文的拖选；正在拖选 / 在别处按下鼠标就立刻收起 —— 划线、批注不会被它挡。
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        // 已经浮着时放宽到整块四角（0.22），免得手一抖就收掉；还没浮时只有 0.14
        const hit = shelfPeek ? CORNER_HIT : PEEK_HIT;
        const inZone =
          topLeftIsShelf &&
          !barOpen &&
          rect.width > 0 &&
          rect.height > 0 &&
          (event.clientX - rect.left) / rect.width < hit &&
          (event.clientY - rect.top) / rect.height < hit;
        if (!inZone) {
          cancelShelfPeek();
          return;
        }
        // 正在拖选文字：绝不弹出来（那正是它从前最碍事的时候）。
        // 这一句放在范围判断之后：鼠标在正文中间时不必每帧都去问一次选区
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          cancelShelfPeek();
          return;
        }
        // 已经浮着 / 已经在等：别再排一次（mousemove 一秒几十次）
        if (shelfPeek || peekTimer.current) return;
        peekTimer.current = window.setTimeout(() => {
          peekTimer.current = 0;
          setShelfPeek(true);
        }, PEEK_DELAY_MS);
      }}
      onMouseLeave={cancelShelfPeek}
      // 一滚轮就收起：略缩图正压在正文上时，滚轮落在它身上不会转给下面的书页 ——
      // 先收掉，下一格滚轮就照常滚（只丢一格，比一直卡住好）
      onWheel={() => {
        if (shelfPeek || peekTimer.current) cancelShelfPeek();
      }}
      // 一按下鼠标就收起略缩图：它若正压在正文上，拖动选字 / 划线也不会被它吃掉。
      // 点在略缩图自己身上不算（否则它会在 click 之前先消失，反而点不到）。
      onMouseDown={(event) => {
        const node = event.target as HTMLElement | null;
        if (node?.closest(".reader-shelf-thumb")) return;
        cancelShelfPeek();
      }}
      onClick={(event) => {
        // 上下两栏 / 搜索 / 目录 / 书签丝带 / 书架略缩图 / 玩偶都是浮层，
        // 点它们不算「点书页」（它们自己的 onClick 负责）
        const node = event.target as HTMLElement | null;
        if (
          node?.closest(
            ".reader-bar, .reader-search-scrim, .reader-toc, .reader-bookmark, .reader-shelf-thumb, .reader-toy, .annot-menu, .annot-card",
          )
        ) {
          return;
        }
        // 点别处先收起划线的浮条 / 批注卡片；这一下只当「关浮层」，不再翻页 / 呼出两栏
        if (picked || opened) {
          setPicked(null);
          setOpened(null);
          return;
        }
        // 拖选文字松手也会来一次 click，别把两栏抖出来
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        // 刚点在外面关掉了面板，这次 click 只当「关面板」
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        // 按比例算落点，与窗口大小无关
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        // 先看这是哪一块热区（四角 / 两条边），再照「手势」表里给它派的活做
        const zone = zoneForPoint(x, y);
        if (zone) {
          const action = zoneActions[zone];
          // 左上角的「回书架」保着老手感：角落本身不做事，悬停浮出的小书架才是出口。
          // （那一块 22% 见方、离第一行正文最近，误点一下就离开整本书，代价太大）
          if (zone === "top-left" && action === "shelf") return;
          runTapAction(action);
          return;
        }
        // 屏幕中间那一块：呼出 / 收起两栏（比例判断，与窗口大小无关）
        if (
          x < MIDDLE_BAND.xMin ||
          x > MIDDLE_BAND.xMax ||
          y < MIDDLE_BAND.yMin ||
          y > MIDDLE_BAND.yMax
        ) {
          return;
        }
        // 呼出 / 收起两栏（收起时顺手把面板与目录也带走）
        toggleBars();
      }}
    >
      {/* 点屏幕中间同时呼出上下两栏（都是浮层，不占布局，书页不会跳）。
          上栏 = 「这本书现在在哪、要离开还是要换个看法」；读书时要用的家伙全在下栏。 */}
      <header
        className={`bar reader-bar reader-bar-top${barOpen ? " open" : ""}`}
        inert={!barOpen}
      >
        {/* 唯一的退出口：记账（位置 + 书签 + 时长 + 成就）之后再回书架 */}
        <button className="ghost" title="先记好读到哪，再回书架" onClick={() => void finish()}>
          ← 书架
        </button>
        {/* pdf 的另一半：回到图片模式（偏好记在本机，下次开这本还按它） */}
        {isPdf ? (
          <button
            className="ghost"
            title="这一页按图片看（PDF 的图片模式：不抽文字，翻页按整页走）"
            onClick={() => switchPdfView("image")}
          >
            看图片
          </button>
        ) : null}
        <strong>{props.book.title || props.book.id}</strong>
        <span className="dim" title="读到这本书的百分之几、正数第几行">
          {percentageOf(topLine, props.book.total_lines).toFixed(1)}% · 第{" "}
          {topLine + 1}/{props.book.total_lines} 行
        </span>

        <button
          className="ghost"
          title="把当前这一行存进书库（翻篇 / 离开时会自动存，这枚是手动保险）"
          onClick={() => void persist()}
        >
          保存位置
        </button>
        {textMode ? (
          <button
            className="ghost"
            title="在本书正文里找关键词（⌘F / Ctrl+F，或按 /）；点结果跳到那一行"
            onClick={openSearch}
          >
            搜索
          </button>
        ) : null}
        <button
          className="ghost"
          title="给这本书建搜索索引：书架里搜正文要用；很长的书只建前半部分"
          onClick={() => void buildIndex()}
        >
          建立索引
        </button>
        {/* 底部那四个按钮删掉了，快捷键得写在明面上 */}
        <span className="dim reader-keys">↑ ↓ 翻行 · ← → / 空格 滚一屏 · 1–6 光点换速</span>
      </header>

      {/* 下栏：读书时要用的家伙 —— 免手翻、目录与书签（2026-10-13 从上面搬下来的）、
          光点导读、排版、纸色与翻页设置。上栏管「这本书 / 我在哪」，下栏管「怎么读」 */}
      <footer
        className={`bar reader-bar reader-bar-bottom${barOpen ? " open" : ""}`}
        inert={!barOpen}
      >
        {/* 免手翻：与终端按「a」同一个东西；节奏是下栏那颗「翻页设置」里那四个
            reader.auto_scroll_* */}
        <button
          className={`ghost${autoTurn.on ? " on" : ""}`}
          aria-pressed={autoTurn.on}
          title={
            autoTurn.on
              ? `正在自己往前走（${autoTurn.pace}）—— 点一下停下`
              : "打开后按「翻页设置」里的节奏自己往前走：文字一次走一屏行、PDF 图片模式一次走一页"
          }
          onClick={autoTurn.toggle}
        >
          {autoTurn.on ? "停止自动" : "自动翻页"}
        </button>
        {/* 目录：这本书认出来的章节表（内核按标题的样子认的），选一章就跳过去 */}
        <select
          title="目录：这本书认出来的章节，选一章跳过去"
          value=""
          onChange={(event) => {
            // 选了章节才跳（空选项只是占位）
            if (event.currentTarget.value) {
              jumpTo(Number(event.currentTarget.value));
            }
          }}
        >
          <option value="">跳到某一章…</option>
          {toc.map((entry) => (
            <option key={entry.line} value={entry.line}>
              {entry.title}
            </option>
          ))}
        </select>
        {/* 书签：自己插过的那些位置（右上角那枚丝带插的就是它们），选一个跳回去 */}
        <select
          title="书签：你插过的位置，选一个跳回去"
          value=""
          onChange={(event) => {
            // 选了书签才跳
            if (event.currentTarget.value) {
              jumpTo(Number(event.currentTarget.value));
            }
          }}
        >
          <option value="">跳到我的书签…（{bookmarks.length}）</option>
          {bookmarks.map((mark) => (
            <option key={mark.line} value={mark.line}>
              {mark.label || `第 ${mark.line + 1} 行`}
            </option>
          ))}
        </select>
        {/* 光点导读：沿当前行跟着光读（领路的是光点或兔子；0 开关、1–6 是滑杆上的快捷落点；
            标记 / 档位 / 进度都存本机） */}
        <button
          type="button"
          className={`ghost reader-guide-btn${guideOn ? " on" : ""}`}
          title={
            guideOn
              ? `光点导读开着：领路的是「${guideMarkerLabel(guideMarker)}」，${guideSpeedLabel(guideSpeed)}（按 0 关掉、1–6 换挡）`
              : "光点导读：打开后有一枚小标记沿着你正读的这一行慢慢领读；按 0 开关、1–6 换挡"
          }
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
            title={`光点导读：领路的是「${guideMarkerLabel(guideMarker)}」，现在是${guideSpeedLabel(guideSpeed)}（点开换样式、速度与颜色）`}
            aria-label="光点导读的标记与速度"
            aria-expanded={speedOpen}
            onClick={() => setPanel((open) => (open === "guide" ? null : "guide"))}
          >
            {guideSpeedLabel(guideSpeed)}
          </button>
          {speedOpen ? (
            <div className="reader-prefs reader-guide-panel" role="group" aria-label="光点导读">
              {/* 一句话交代：这几项改的是「领路的样子」，只存本机 */}
              <p className="reader-prefs-lead">
                领路的是哪一号、走多快、什么颜色 —— 只改这台电脑上的样子，存在本机。
              </p>
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
              {/* 颜色：三样各一枚「换颜色」文字按钮，**一样占一行**（挤在一行时两个按钮会被压成
                  一字符宽、文字竖着折行）—— 光点是那颗小球（高光 / 光晕跟着它算），
                  下划线 / 波浪线是它们各自那一段线（两号的走法一样，只是笔迹不同）。
                  都空着 = 出厂色，所以这里不写「默认值」这个概念；点文字按钮弹系统取色盘，
                  挑的颜色即时生效。按钮上只写「换颜色」，当前色值放在悬停提示里 */}
              <div className="pref-row">
                <span className="pref-label">光点</span>
                <label className="pref-color-btn" title={`光点的颜色（当前 ${guideColors.dot}）`}>
                  换颜色
                  <input
                    type="color"
                    value={guideColors.dot}
                    aria-label="光点的颜色"
                    onChange={(event) => updatePrefs({ guideDotColor: event.currentTarget.value })}
                  />
                </label>
              </div>
              <div className="pref-row">
                <span className="pref-label">下划线</span>
                <label className="pref-color-btn" title={`下划线的颜色（当前 ${guideColors.line}）`}>
                  换颜色
                  <input
                    type="color"
                    value={guideColors.line}
                    aria-label="下划线的颜色"
                    onChange={(event) => updatePrefs({ guideLineColor: event.currentTarget.value })}
                  />
                </label>
              </div>
              <div className="pref-row">
                <span className="pref-label">波浪线</span>
                <label className="pref-color-btn" title={`波浪线的颜色（当前 ${guideColors.wave}）`}>
                  换颜色
                  <input
                    type="color"
                    value={guideColors.wave}
                    aria-label="波浪线的颜色"
                    onChange={(event) => updatePrefs({ guideWaveColor: event.currentTarget.value })}
                  />
                </label>
              </div>
              {prefs.guideDotColor || prefs.guideLineColor || prefs.guideWaveColor ? (
                <p className="pref-note">
                  三样都空着就是出厂色：光点那颗琥珀；下划线与波浪线跟正文同色。
                </p>
              ) : null}
              <div className="pref-row">
                <span className="pref-label">走多快</span>
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
        {/* 排版：字（字多大 / 笔画多粗 / 字与字之间）、行与行、段与段、纸边留白
            （界面自己的状态，存本机 gui_settings） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${prefsOpen ? " on" : ""}`}
            title="字多大 / 笔画多粗 / 字与字的间隔 / 一行多高 / 两段之间 / 纸边留白（点开有滑杆）"
            aria-label="阅读排版设置"
            aria-expanded={prefsOpen}
            onClick={() => setPanel((open) => (open === "type" ? null : "type"))}
          >
            Aa
          </button>
          {prefsOpen ? (
            <div className="reader-prefs reader-type" role="group" aria-label="阅读排版">
              {/* 一句话交代：这几项改的是「读起来的样子」，不动书库里的文件 */}
              <p className="reader-prefs-lead">
                这几项只改这台电脑上「读起来的样子」—— 书库里的文件一个字都不动。
              </p>
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
                <span className="pref-label">字多大</span>
                <input
                  type="range"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  step={1}
                  value={prefs.fontSize}
                  aria-label="字多大"
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
                  aria-label="字多大（像素）"
                  onChange={(event) =>
                    updatePrefs({ fontSize: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">笔画多粗</span>
                <input
                  type="range"
                  min={WEIGHT_MIN}
                  max={WEIGHT_MAX}
                  step={WEIGHT_STEP}
                  value={prefs.fontWeight}
                  aria-label="笔画多粗"
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
                  aria-label="笔画多粗（100~900）"
                  onChange={(event) =>
                    updatePrefs({ fontWeight: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">g</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">字与字之间</span>
                <input
                  type="range"
                  min={LETTER_MIN}
                  max={LETTER_MAX}
                  step={0.1}
                  value={prefs.letterSpacing}
                  aria-label="字与字之间"
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
                  aria-label="字与字之间（像素）"
                  onChange={(event) =>
                    updatePrefs({ letterSpacing: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">一行多高</span>
                <input
                  type="range"
                  min={LINE_MIN}
                  max={LINE_MAX}
                  step={LINE_STEP}
                  value={prefs.lineHeight}
                  aria-label="一行多高"
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
                  aria-label="一行多高（倍数）"
                  onChange={(event) =>
                    updatePrefs({ lineHeight: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">×</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">两段之间</span>
                <input
                  type="range"
                  min={PARA_MIN}
                  max={PARA_MAX}
                  step={PARA_STEP}
                  value={prefs.paraSpacing}
                  aria-label="两段之间"
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
                  aria-label="两段之间（em）"
                  onChange={(event) =>
                    updatePrefs({ paraSpacing: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">em</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">左右留白</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginX}
                  aria-label="左右留白（像素）"
                  onChange={(event) =>
                    updatePrefs({ marginX: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">上边留白</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginTop}
                  aria-label="上边留白（像素）"
                  onChange={(event) =>
                    updatePrefs({ marginTop: Number(event.currentTarget.value) })
                  }
                />
                <span className="pref-unit">px</span>
              </div>
              <div className="pref-row">
                <span className="pref-label">下边留白</span>
                <input
                  className="pref-num"
                  type="number"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={prefs.marginBottom}
                  disabled={prefs.linkY}
                  aria-label="下边留白（像素）"
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
                <label htmlFor="reader-margin-y-link">上下留白一样多</label>
              </div>
              <button
                type="button"
                className="ghost"
                title="字号 / 行距 / 字距 / 留白全回到出厂那一套（纸色与字体不动）"
                onClick={resetPrefs}
              >
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
            title="纸的样子：四套预设 + 白天 / 夜里 + 自己调底色与字色"
            aria-label="阅读主题设置"
            aria-expanded={themeOpen}
            onClick={() => setPanel((open) => (open === "theme" ? null : "theme"))}
          >
            纸色
          </button>
          {themeOpen ? (
            <div className="reader-prefs reader-theme" role="group" aria-label="纸面主题">
              {/* 一句话交代：换的是纸的样子，字与版式一个字不动 */}
              <p className="reader-prefs-lead">
                换纸的样子 —— 预设只动颜色，字与版式一个字都不动；自定义色盖在预设之上。
              </p>
              <div className="pref-row">
                <span className="pref-label">纸的样子</span>
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
                <span className="pref-label">白天或夜里</span>
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
                <span className="pref-label">底色</span>
                <input
                  className="pref-color"
                  type="color"
                  value={palette.paper}
                  aria-label="自定义阅读背景色"
                  title={`自定义阅读背景色（当前 ${palette.paper}）`}
                  onChange={(event) => updatePrefs({ customBg: event.currentTarget.value })}
                />
                <span className="pref-label">字色</span>
                <input
                  className="pref-color"
                  type="color"
                  value={palette.ink}
                  aria-label="自定义正文字色"
                  title={`自定义正文字色（当前 ${palette.ink}）`}
                  onChange={(event) => updatePrefs({ customFg: event.currentTarget.value })}
                />
              </div>
              <div className="pref-row">
                <span className="pref-label">背景图</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => bgInputRef.current?.click()}
                >
                  {prefs.bgImage ? "换一张" : "选择图片"}
                </button>
                {prefs.bgImage ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      updatePrefs({ bgImage: "" });
                      setBgNotice(null);
                      // 图在磁盘上：不删的话下次开书又会回来
                      void setReaderBackground(null).catch(() => undefined);
                    }}
                  >
                    移除
                  </button>
                ) : null}
                {/* 藏起来的原生文件选择器：`accept` 只列图片，点上面那枚按钮去点它 */}
                <input
                  ref={bgInputRef}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label="选择背景图片"
                  onChange={(event) => void handleBgPick(event)}
                />
              </div>
              {prefs.bgImage ? (
                <>
                  <div className="pref-row">
                    <span className="pref-label">摆放方式</span>
                    <div className="pref-pill pref-bg-fill" role="group" aria-label="背景图摆放方式">
                      {READER_BG_FILLS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={prefs.bgFill === item.id ? "on" : ""}
                          aria-pressed={prefs.bgFill === item.id}
                          title={item.hint}
                          onClick={() => updatePrefs({ bgFill: item.id })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pref-row">
                    <span className="pref-label">淡化</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={prefs.bgFade}
                      aria-label="背景图淡化程度"
                      onChange={(event) =>
                        updatePrefs({ bgFade: Number(event.currentTarget.value) })
                      }
                    />
                    <span className="pref-unit">{prefs.bgFade}%</span>
                  </div>
                  <p className="pref-note">
                    图片垫在文字下面；字看不清时把「淡化」往右推（盖一层纸色）。
                  </p>
                </>
              ) : null}
              {bgNotice ? <p className="pref-note">{bgNotice}</p> : null}
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

        {/* 翻页设置（内核 `reader.*` 那一整节；2026-10-11 从「调一调」搬来，2026-10-13
            随下栏一起挪到屏幕下方）—— 正读着书的时候就能调自动翻页的节奏与抽查。
            存好一笔就叫一声，自动翻页当场按新节奏走（见 useAutoTurn 的 reload） */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${configOpen ? " on" : ""}`}
            title="自动翻页多久走一次、一次走多少、多久抽查一次（改完立刻生效）"
            aria-label="翻页设置"
            aria-expanded={configOpen}
            onClick={() => setPanel((open) => (open === "config" ? null : "config"))}
          >
            翻页设置
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

        {/* 手势：六个角落 / 边条点下去各做什么（本机设置，存 gui_settings 的 reader.tapZones）。
            出厂就是原来写死的那六样；每一块都能换成栏里那些常用动作，或者干脆「不做事」
            把那块热区还给选字与批注。改一块当场生效、当场存。 */}
        <div className="reader-prefs-wrap">
          <button
            type="button"
            className={`ghost reader-prefs-btn${tapOpen ? " on" : ""}`}
            title="六个角落与左右两条边：点下去各做什么（改完立刻生效，只存本机）"
            aria-label="边角手势"
            aria-expanded={tapOpen}
            onClick={() => setPanel((open) => (open === "tap" ? null : "tap"))}
          >
            手势
          </button>
          {tapOpen ? (
            <div className="reader-prefs reader-tap" role="group" aria-label="边角手势">
              <p className="reader-prefs-lead">
                屏幕上六个角落 / 边条点下去做什么 —— 只改这台电脑上的手感，存在本机；
                点屏幕中间仍然是呼出上下两栏。
              </p>
              {READER_TAP_ZONES.map((zone) => (
                <label className="pref-row reader-tap-row" key={zone.id} title={zone.hint}>
                  <span className="pref-label">{zone.label}</span>
                  <select
                    value={zoneActions[zone.id]}
                    aria-label={`${zone.label}点下去做什么`}
                    onChange={(event) =>
                      // 值先过一遍归一化：将来删掉某个动作时，坏值会自己回落到出厂值
                      setZoneActions((current) =>
                        normalizeReaderTapZones({
                          ...current,
                          [zone.id]: event.currentTarget.value,
                        }),
                      )
                    }
                  >
                    {READER_TAP_ACTIONS.map((action) => (
                      <option key={action.id} value={action.id} title={action.hint}>
                        {action.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p className="pref-note">
                左上角的「回书架」靠悬停浮出小书架（点略缩图才走，点角落本身不做事）；把它换成别的，
                悬停就不再浮出。想彻底不被那块木头打扰，就把它设成「不做事」。
              </p>
              <button
                type="button"
                className="ghost"
                disabled={isDefaultReaderTapZones(zoneActions)}
                title="六个角 / 边条回到出厂：左上回书架、右上书签、左下目录、右下玩偶、左右两条边翻页"
                onClick={() => setZoneActions({ ...DEFAULT_READER_TAP_ZONES })}
              >
                恢复默认
              </button>
            </div>
          ) : null}
        </div>
      </footer>

      {/* 在本书里搜：一块浮在书页上的木牌。输入即搜（停手 280ms），结果是
          「章节 · 第几行 + 那一行上下文」；点一条直接跳到那一行并亮一下。
          Esc / 点旁边空白关掉；回车跳到第一处。 */}
      {searchOpen ? (
        <div
          className="reader-search-scrim"
          role="presentation"
          onClick={(event) => {
            // 浮层里的点击不要漏到 main 的「点中间呼出两栏」上
            event.stopPropagation();
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <form
            className="reader-search"
            role="search"
            aria-label="在本书里搜索"
            onSubmit={(event) => {
              event.preventDefault();
              const keyword = searchQuery.trim();
              if (searchHitsFor === keyword && searchHits[0]) {
                jumpToSearchHit(searchHits[0]);
              } else if (keyword) {
                // 结果还没回来 / 上一轮是空的：立刻按当前词重搜一次，拿到第一处就跳
                const seq = ++searchSeq.current;
                setSearching(true);
                setSearchStatus("正在找…");
                void runSearch(keyword, seq).then((hits) => {
                  if (hits && hits[0] && seq === searchSeq.current) jumpToSearchHit(hits[0]);
                });
              }
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="reader-search-head">
              <span className="reader-search-eyebrow">
                在《{props.book.title || props.book.id}》里找
              </span>
              <button
                type="button"
                className="ghost reader-search-close"
                title="关掉搜索（Esc）"
                aria-label="关闭搜索"
                onClick={closeSearch}
              >
                ×
              </button>
            </div>
            <div className="reader-search-field">
              <span className="reader-search-icon" aria-hidden="true">
                🔍
              </span>
              <input
                ref={searchInput}
                type="search"
                value={searchQuery}
                placeholder="输入关键词，点结果跳到那一行"
                aria-label="搜索本书正文"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
              {searching ? <span className="reader-search-busy">找…</span> : null}
            </div>
            <p className="reader-search-status" role="status">
              {searching ? "正在找…" : searchStatus || "输入一个词，整本书里一次搜完"}
            </p>
            {searchHits.length > 0 ? (
              <ul className="reader-search-list">
                {searchHits.map((hit, index) => (
                  <li key={`${hit.line}-${index}`}>
                    <button
                      type="button"
                      className="reader-search-hit"
                      onClick={() => jumpToSearchHit(hit)}
                    >
                      <span className="reader-search-hit-meta">
                        <span className="reader-search-hit-title">{hit.title || "正文"}</span>
                        <span className="reader-search-hit-line">第 {hit.line + 1} 行</span>
                      </span>
                      <span className="reader-search-hit-text">
                        {hit.snippet.split(/(\[[^\]]*\])/g).map((part, partIndex) =>
                          part.startsWith("[") && part.endsWith("]") ? (
                            <mark key={partIndex}>{part.slice(1, -1)}</mark>
                          ) : (
                            <span key={partIndex}>{part}</span>
                          ),
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="reader-search-foot">
              <span>Esc 关闭</span>
              <span>回车跳到第一处</span>
              <span>⌘F / Ctrl+F 随时打开</span>
            </div>
          </form>
        </div>
      ) : null}

      {/* 两栏都收着时给一句提示，几秒后自己消失 */}
      {hintVisible ? (
        <div className="reader-hint" role="status">
          点中间呼出工具栏 · 四角各有小机关
        </div>
      ) : null}

      {/* 跳转 / 翻行后亮一下位置：两栏都收着时，这是唯一的「我在哪」 */}
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
          title="点一下打开下栏那颗「翻页设置」，在那里改自动翻页的节奏"
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

      {/* 一次性消息做成底部浮字：两栏收着也看得见，而且不挤动书页 */}
      <div className="reader-toasts" aria-live="polite">
        {error ? <p className="toast error">{error}</p> : null}
        {notice ? <p className="toast notice">{notice}</p> : null}
        {unlocked.length > 0 ? (
          <p className="toast notice">🏆 {unlocked.map((item) => item.name).join("、")}</p>
        ) : null}
        {appending ? <p className="toast dim">正在往下接…</p> : null}
      </div>

      {/* 左上角悬停浮出的小书架：点了就带着账回书架（与「← 书架」同一条路）。
          只有左上角还指派着「回书架」时才渲染 —— 换成别的动作，这块悬停就不再浮出来。 */}
      {topLeftIsShelf ? (
        <button
          type="button"
          className={`reader-shelf-thumb${shelfPeek ? " open" : ""}`}
          title="回书架（先把读到哪记好）"
          aria-label="回书架"
          tabIndex={shelfPeek ? 0 : -1}
          onClick={() => void finish()}
          onMouseMove={(event) => event.stopPropagation()}
        >
          <span className="peek-shelf" aria-hidden="true">
            <span className="peek-shelf-row">
              {PEEK_SPINES.map((spine) => (
                <span
                  key={spine.color}
                  className="peek-spine"
                  style={{ backgroundColor: spine.color, height: `${spine.height}%` }}
                />
              ))}
            </span>
            <span className="peek-shelf-board" />
          </span>
          <span className="peek-label">回书架</span>
        </button>
      ) : null}

      {/* 左下角点开的目录：按章节标题跳到那一行（内核认出来的那些） */}
      {tocOpen ? (
        <div className="reader-toc" role="dialog" aria-label="目录">
          <div className="reader-toc-head">
            <span>目录</span>
            <button
              type="button"
              className="reader-toc-close"
              title="收起目录"
              aria-label="收起目录"
              onClick={() => setTocOpen(false)}
            >
              ×
            </button>
          </div>
          {toc.length > 0 ? (
            <ol className="reader-toc-list">
              {toc.map((entry) => (
                <li key={entry.line}>
                  <button
                    type="button"
                    className={tocCurrent === entry.line ? "on" : undefined}
                    title={`跳到第 ${entry.line + 1} 行`}
                    onClick={() => {
                      jumpTo(entry.line);
                      setTocOpen(false);
                    }}
                  >
                    <span className="reader-toc-title">{entry.title}</span>
                    <span className="reader-toc-line">{entry.line + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="reader-toc-empty">这本书还没认出章节。</p>
          )}
        </div>
      ) : null}

      {/* 右下角蹦出来的玩偶：坐在露出来的木桌上，眼睛朝书页那边看。
          点它一下就放回去，书也跟着回到原位 */}
      {toy ? (
        <button
          type="button"
          key={toy.id}
          className="reader-toy"
          title="点一下把它放回去"
          aria-label={`把${toy.label}放回去`}
          onClick={() => setToy(null)}
        >
          <Plush id={toy.id} label={toy.label} looking />
        </button>
      ) : null}

      {/* 一本书的骨架：纸面铺到上 / 左 / 下三条屏幕边，只留右侧的书口。
          玩偶蹦出来时书的右边收窄、右侧桌面加宽，看着就是书往左让了一让 */}
      <div className={`reader-book${toy ? " shifted" : ""}`}>
        <div className="book-stack" aria-hidden="true" />
        <div className={`reader-page${prefs.bgImage ? " has-bg" : ""}`}>
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
                  // 搜索跳过来的那一行：短暂亮一块底色，方便一眼看见
                  const matched = searchHitLine === slice.start + index;
                  return (
                    <p
                      key={slice.start + index}
                      // 划线按「源行号 + 行内偏移」定位，选区换算（selectionToSpans）就靠它
                      data-line={slice.start + index}
                      className={`reading-line${blank ? " blank" : paraStart ? " para-start" : ""}${lit}${matched ? " search-hit" : ""}`}
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
                      {/* 内层这一层是给「量这一行文字铺到哪儿」用的（折行时 getClientRects 一折一条）；
                          划过的片段在这里拆成一截一截（点某一截就弹那条划线的批注卡片） */}
                      <span className="reading-line-text">
                        {blank
                          ? "\u00a0"
                          : renderAnnotatedLine(line, lineMarks.get(slice.start + index) ?? [])}
                      </span>
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

      {/* 选中文字后浮出的小工具条：三种线型 + 笔色 + 取消。
          位置是屏幕上算好的固定坐标（贴着选区下方），点它自己不算「点书页」 */}
      {picked ? (
        <div
          className="annot-menu"
          style={{ left: `${picked.left}px`, top: `${picked.top}px` }}
          onClick={(event) => event.stopPropagation()}
          role="toolbar"
          aria-label="划线"
        >
          {ANNOTATION_STYLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="annot-style"
              title={`${item.label}：${item.hint}`}
              // 按在浮条上时别让浏览器把选中的字取消掉（这样挑笔色期间原文还亮着）
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addAnnotation(item.id)}
            >
              <span className={`annot-sample annot-sample-${item.id}`} aria-hidden="true" />
              {item.label}
            </button>
          ))}
          <span className="annot-swatches" role="group" aria-label="笔色">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`annot-swatch${picked.color === color ? " on" : ""}`}
                style={{ "--swatch": color } as CSSProperties}
                title={color}
                aria-label={`笔色 ${color}`}
                aria-pressed={picked.color === color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setPicked({ ...picked, color })}
              />
            ))}
            {/* 取色器：常用色不够用时自己调一个 */}
            <label
              className="annot-swatch annot-swatch-custom"
              title="自定义颜色"
              style={{ "--swatch": picked.color } as CSSProperties}
            >
              <input
                type="color"
                value={picked.color}
                aria-label="自定义颜色"
                onChange={(event) => {
                  const color = normalizeAnnotationColor(event.target.value);
                  if (color) setPicked({ ...picked, color });
                }}
              />
            </label>
          </span>
          <button
            type="button"
            className="annot-cancel"
            title="取消（Esc）"
            aria-label="取消划线"
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              setPicked(null);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* 点一条划线：下方一张小卡片 —— 没批注就是输入框；有批注先看，点「编辑」再改 */}
      {opened && openedAnnotation ? (
        <div
          className="annot-card"
          style={
            {
              left: `${opened.left}px`,
              top: `${opened.top}px`,
              "--annot-color": openedAnnotation.color,
              "--annot-tint": annotationTint(openedAnnotation.color),
            } as CSSProperties
          }
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-label="批注"
        >
          <div className="annot-card-quote">
            {openedAnnotation.quote.replace(/\s*\n\s*/g, " ")}
          </div>
          {noteEditing ? (
            <>
              <textarea
                className="annot-card-input"
                value={draftNote}
                placeholder="写一句批注…（⌘/Ctrl + Enter 保存）"
                autoFocus
                onChange={(event) => setDraftNote(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    saveNote();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpened(null);
                  }
                }}
              />
              <div className="annot-card-actions">
                <button type="button" className="annot-card-save" onClick={saveNote}>
                  保存
                </button>
                <button type="button" className="ghost" onClick={() => setOpened(null)}>
                  取消
                </button>
                <button type="button" className="ghost annot-card-delete" onClick={deleteOpened}>
                  删掉划线
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="annot-card-note">{openedAnnotation.note}</p>
              <div className="annot-card-actions">
                <button
                  type="button"
                  className="annot-card-save"
                  onClick={() => {
                    setDraftNote(openedAnnotation.note);
                    setNoteEditing(true);
                  }}
                >
                  编辑
                </button>
                <button type="button" className="ghost" onClick={() => setOpened(null)}>
                  关闭
                </button>
                <button type="button" className="ghost annot-card-delete" onClick={deleteOpened}>
                  删掉划线
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </main>
  );
}
