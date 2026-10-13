/**
 * 光点导读：沿当前行从左向右、**在正文下方**走一位「领路的」—— 一颗琥珀光点（默认），
 * 或者**四五个字宽的一小段线**（一伸一缩地往前爬）：那一小段**自己就是领路的**，
 * 可以画成**下划线**、也可以画成**波浪线**（走法完全一样，只是笔迹不同，见 `GUIDE_MARKERS`）。
 *
 * 这里只放**纯逻辑**（20 档速度刻度、标记 / 档位归一化、光点与轨迹在一行里的落点、
 * 爬虫那一段线怎么爬）与**进度读写**（localStorage，按书分开）；移动、轨迹、长相、
 * 顶栏那枚速度按钮与键盘在 `views/Reader.tsx` 与 `App.css`。
 *
 * 从前还有「兔子」那一号（跳进书里那只，像素画见 `components/GuideRabbit.tsx`，轨迹铺一串脚印）
 * —— 2026-10-10 按用户要求去掉；老存档里存着 `rabbit` 的按坏值处理、回落成光点
 * （见 `normalizeGuideMarker`）。
 *
 * 为什么进度存本机 localStorage 而不是内核：内核不认识「光点读到第几行」这件事，
 * 它和字号 / 纸面配色一样属于界面自己的状态。键是 `paget.reading-guide.v1.<书 id>`；
 * 记录内部另有自己的 `rev`（见 `GUIDE_STORE_REV`）—— 档位刻度这类局部改动只动它，
 * 不换键名，免得把「读到第几行」也一起丢掉。等内核真需要这份进度时，再挪进 `gui_settings`。
 */

/**
 * 速度刻度：**20 档**，用「每行停留时间」表示 —— 不管行有多长，每行都被完整导读到。
 *
 * `1` 最慢（20s/行，慢到能逐字跟）、`20` 最快（0.5s/行，扫读），中间按**等比**排（见 `guideLineMs`）。
 * 为什么从六档加到二十档：六档里最慢那档是 8s/行，还是有人跟不上 —— 档位铺密、最慢端再往下拉，
 * 才试得出自己那格手感。主控是阅读顶栏里那枚速度按钮（点开是滑杆，见 `views/Reader.tsx`）。
 */
export const GUIDE_SPEED_MIN = 1;
export const GUIDE_SPEED_MAX = 20;
/** 最慢的一档（1 档）：每行停 20s。 */
export const GUIDE_SLOW_MS = 20_000;
/** 最快的一档（20 档）：每行停 0.5s —— 与原来那版六档的「极快」同一个速度。 */
export const GUIDE_FAST_MS = 500;
/** 默认档位：10 档（约 3.5s/行）—— 与原来那版六档的「中速 3s」差不多，开书就是能读的节奏。 */
export const DEFAULT_GUIDE_SPEED = 10;
/** 档位牌亮多久（毫秒）—— 要和 `App.css` 里 `.reader-speed-chip` 的动画时长对上。 */
export const GUIDE_CHIP_MS = 2000;

/**
 * 相邻两档的倍数（≈ 0.8235）：档位是给滑杆用的**等距刻度**，而人对快慢的感觉是对数的
 * —— 每往上推一格，每行停留时间就乘同一个数，从 20s 一路收到 0.5s。
 */
const GUIDE_SPEED_RATIO = (GUIDE_FAST_MS / GUIDE_SLOW_MS) ** (1 / (GUIDE_SPEED_MAX - GUIDE_SPEED_MIN));

/**
 * 走在前面的那一位：一颗琥珀光点（默认）、**一小段下划线**，或者**一小段波浪线**
 * （后两种的走法一样，只是笔迹不同）。
 */
export type GuideMarker = "dot" | "underline" | "wave";

/**
 * 三种标记（界面拿它排一枚胶囊，和主题面板同一套做法；`label` 也用在顶栏那枚开关上）。
 *
 * 「下划线」与「波浪线」都是**没有实体的那一位**：**四五个字宽的一小段线自己就是领路的** ——
 * 就是字底下那道线挪了个位置；走过的**迅速化掉**，所以看着像在往前（见 `guideCrawlAt`）。
 * 两者的**走法、宽度、步子、伸缩全都共用一套**（`guideCrawlAt` / `guideCrawlWidth`），
 * 区别只在长相与颜色：下划线是墨色方头的一条直线，波浪线是同一支笔画的波浪
 * （见 `App.css` 的 `.guide-crawl` / `.guide-wave`）。
 */
export const GUIDE_MARKERS: { id: GuideMarker; label: string; hint: string }[] = [
  { id: "dot", label: "光点", hint: "一颗琥珀光点贴着字底走" },
  {
    id: "underline",
    label: "下划线",
    hint: "四五个字宽的一小段下划线自己往前挪，走过就化掉（不是匀速进度条）",
  },
  {
    id: "wave",
    label: "波浪线",
    hint: "同一小段波浪线自己往前挪，走过就化掉 —— 走法与下划线一样，只是笔迹是波浪的",
  },
];

export const DEFAULT_GUIDE_MARKER: GuideMarker = "dot";

/**
 * 只认名单里的三种；坏值 / 没存过都回落到光点。
 *
 * 从前还有 `rabbit`（2026-10-10 去掉）：老存档里那个值落到这里就是「不认识」，
 * 于是回落成光点 —— 不需要写迁移，位置 / 档位 / 开关都照旧。新增的 `wave` 也是纯新增
 * （老记录里没有它），同样不用动存档的 `rev`。
 */
export function normalizeGuideMarker(value: unknown): GuideMarker {
  return value === "underline" || value === "wave" ? value : DEFAULT_GUIDE_MARKER;
}

/** 标记的名字（顶栏那枚开关与档位牌上写它）。 */
export function guideMarkerLabel(marker: unknown): string {
  const id = normalizeGuideMarker(marker);
  return GUIDE_MARKERS.find((item) => item.id === id)?.label ?? GUIDE_MARKERS[0].label;
}

/**
 * 轨迹线（也是光点圆心）的分量：压在一折文字**内容框的下沿**，于是光点从正文下方划过，
 * 走过的轨迹正好贴着字底 —— 「划过的轨迹变成文字下划线」。
 *
 * `getClientRects()` 给的一折 rect 高度是**字体内容框**（ascent + descent），不是行高；
 * 所以「内容框下沿」≈「字母基线再往下 0.25em」，与 `App.css` 里 `.reading-line-text` 的
 * `text-underline-offset: 0.25em` 是同一个高度 —— 已读行那条 CSS 下划线因此与当前行量出来的
 * 轨迹条接得上（换行时看不出接缝）。**改这里就要改那边。**
 */
const TRAIL_RATIO = 1;

/** 光点在行内要走的每一「视觉行」（相对这一行的左上角，px）。 */
export type GuideRow = { left: number; top: number; width: number; height: number };

/** 一折文字的轨迹线 y（相对这一行的左上角，px）—— 光点圆心也压在这条线上。 */
export function guideTrailY(row: GuideRow): number {
  return row.top + row.height * TRAIL_RATIO;
}

/** 轨迹（字底下那条下划线）在 `pct` 处的样子。 */
export type GuideTrail = {
  /** 光点正走在这一折：它前面那几折（下标 0 … `row` - 1）已经整条走完 */
  row: number;
  /** 这一折里已经走过的宽度（从这一折的行首量起，px） */
  width: number;
  /** 这条轨迹的 y（相对这一行的左上角，px） */
  top: number;
};

/** 一本书的光点进度。 */
export type GuideProgress = {
  /** 光点现在读到第几行（**源行号**，与内核 / 终端同一套坐标） */
  line: number;
  /** 上次用的档位（1–20；滑杆上就是它） */
  speed: number;
  /** 走在前面的是光点还是那一小段下划线 */
  marker: GuideMarker;
  /** 光点导读是不是开着 */
  on: boolean;
};

/** 没存过任何进度时的样子：第一行、默认档、光点、开着（打开书就能看见光点）。 */
export const DEFAULT_GUIDE_PROGRESS: GuideProgress = {
  line: 0,
  speed: DEFAULT_GUIDE_SPEED,
  marker: DEFAULT_GUIDE_MARKER,
  on: true,
};

/** 档位收进 1–6 的整档；坏值（空 / 越界 / 小数）落回默认档。 */
export function normalizeGuideSpeed(value: unknown): number {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) return DEFAULT_GUIDE_SPEED;
  return Math.min(GUIDE_SPEED_MAX, Math.max(GUIDE_SPEED_MIN, level));
}

/**
 * 这一档每行停多久（毫秒）—— 光点走完一行的时长。
 *
 * 从最慢那档按等比往上收（`GUIDE_SPEED_RATIO`），两端正好是 `GUIDE_SLOW_MS` / `GUIDE_FAST_MS`。
 * 取到 10ms 的整：滑杆拖出来的数、写进存档的数、档位牌上显示的数就是同一个（好对账）。
 */
export function guideLineMs(level: unknown): number {
  const step = normalizeGuideSpeed(level) - GUIDE_SPEED_MIN;
  return Math.round((GUIDE_SLOW_MS * GUIDE_SPEED_RATIO ** step) / 10) * 10;
}

/**
 * 档位牌 / 滑杆上的字，例如「10档 · 3.5s/行」。
 *
 * 20 档里光看档号说不清快慢（谁知道 13 档是多快），所以把「每行停留时间」一起写出来；
 * 恰好整秒时不带小数点（「1档 · 20s/行」）。
 */
export function guideSpeedLabel(level: unknown): string {
  const speed = normalizeGuideSpeed(level);
  const seconds = guideLineMs(speed) / 1000;
  return `${speed}档 · ${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s/行`;
}

/**
 * 把任意输入收成合法的进度：行号取非负整数，档位归一到 1–20，
 * 只有**明确**存了 `false` 才算关掉（坏数据按「开着」处理：打开书就有光点）。
 */
export function normalizeGuideProgress(
  input: Partial<GuideProgress> | null | undefined,
): GuideProgress {
  const raw = Number(input?.line);
  return {
    line: Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0,
    speed: normalizeGuideSpeed(input?.speed),
    marker: normalizeGuideMarker(input?.marker),
    on: input?.on !== false,
  };
}

/**
 * 这本书的进度键。带版本号，但**不是**每次改形状就换它 —— 键名管的是「整份形状」，
 * 比如将来再加几个字段、或者内核要接手这份进度。**档位刻度**这种局部改动不换键名：
 * 那是记录内部的 `rev` 管的事（见 `GUIDE_STORE_REV`），否则为了一个档位刻度
 * 会把「读到第几行」一起丢掉 —— 位置比档位金贵得多。
 */
export function guideStorageKey(bookId: string): string {
  return `paget.reading-guide.v1.${bookId}`;
}

/** 本机的储物柜；没有 window（非浏览器环境）或访问就抛（隐私模式）时退化成「不存」。 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 存档格式的版本：**2 = 档位是 20 档刻度**；1（没有这个字段）= 更早那版 6 档刻度。
 *
 * 档位刻度从 6 档加到 20 档之后，同一个数字不再是同一个速度（老的 3 档 3s/行，
 * 新的 3 档 13.6s/行）—— 老记录里的档位得换算过来，不然老用户的「中速」会突然慢四倍。
 *
 * `rev` 只管**档位刻度**这一件事。后来加的字段（比如 `marker`：光点还是下划线）是**纯新增**：
 * 老记录里没有它，`normalizeGuideMarker` 会给默认值，不需要换算，也就不用动这个版本号。
 * 同理，2026-10-10 去掉「兔子」这个标记时**也没换键名** —— 老记录里那个值没人认了，
 * `normalizeGuideMarker` 按坏值把它回落成光点，位置与档位照旧。
 */
const GUIDE_STORE_REV = 2;

/** 更早那版六档的每行停留时间（换算用：下标 = 档位 - 1）。 */
const LEGACY_LINE_MS = [8000, 5000, 3000, 1800, 1000, 500];

/** 与 `ms` 最接近的一档（1–20）；一样近时取慢的那一档。 */
function nearestGuideSpeed(ms: number): number {
  let best = GUIDE_SPEED_MIN;
  for (let level = GUIDE_SPEED_MIN + 1; level <= GUIDE_SPEED_MAX; level += 1) {
    if (Math.abs(guideLineMs(level) - ms) < Math.abs(guideLineMs(best) - ms)) best = level;
  }
  return best;
}

/** 老记录（6 档刻度）的档位 → 新 20 档刻度的档位；坏值落回默认档。 */
function upgradeLegacySpeed(value: unknown): number {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) return DEFAULT_GUIDE_SPEED;
  const index = Math.min(LEGACY_LINE_MS.length, Math.max(GUIDE_SPEED_MIN, level)) - 1;
  return nearestGuideSpeed(LEGACY_LINE_MS[index]);
}

/** 读回这本书的光点进度；没存过 / 存坏了都从第一行、默认档、开着开始。 */
export function loadGuideProgress(bookId: string): GuideProgress {
  try {
    const raw = storage()?.getItem(guideStorageKey(bookId));
    if (!raw) return { ...DEFAULT_GUIDE_PROGRESS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_GUIDE_PROGRESS };
    }
    const record = parsed as Partial<GuideProgress> & { rev?: unknown };
    // 老记录（6 档刻度）：只有档位要换算，行号 / 标记 / 开关照旧 —— 接着上次那一行读
    const speed =
      record.rev === GUIDE_STORE_REV ? record.speed : upgradeLegacySpeed(record.speed);
    return normalizeGuideProgress({
      line: record.line,
      speed,
      marker: record.marker,
      on: record.on,
    });
  } catch {
    // 存坏了不该影响读书：当没存过，从第一行开始
    return { ...DEFAULT_GUIDE_PROGRESS };
  }
}

/** 写回这本书的光点进度；写不进去（配额满 / 隐私模式）只影响下次从哪儿继续，不抛。 */
export function saveGuideProgress(bookId: string, progress: GuideProgress): void {
  try {
    const clean = normalizeGuideProgress(progress);
    // rev 只写在存档这一层：`GuideProgress` 是内存里的形状，不带存档自己的版本号
    storage()?.setItem(
      guideStorageKey(bookId),
      JSON.stringify({ ...clean, rev: GUIDE_STORE_REV }),
    );
  } catch {
    // 同上：存不上也比把阅读页搞崩强
  }
}

/**
 * 光点在一行里往前走的算术（纯函数，与 DOM 无关）：
 * 加 `dt` 毫秒，返回新的下标 / 这一行新的已走时间，以及「走到这一批的末行行尾了」。
 *
 * - `moved` 只会走一行 —— 于是不管 `dt` 多大，光点都不会瞬间掠过一整屏；
 * - 换行时把超出的那点时间**带走**（`elapsed - duration`），所以长跑下来不累积漂移；
 * - 停在末行行尾时 `elapsed` 正好等于 `duration`（进度牌上的「走到头了」）。
 */
export function stepGuideClock(
  state: { index: number; elapsed: number },
  dt: number,
  duration: number,
  last: number,
): { index: number; elapsed: number; moved: boolean; atEnd: boolean } {
  const elapsed = state.elapsed + dt;
  if (elapsed < duration) {
    return { index: state.index, elapsed, moved: false, atEnd: false };
  }
  if (state.index < last) {
    return {
      index: state.index + 1,
      elapsed: Math.min(elapsed - duration, duration),
      moved: true,
      atEnd: false,
    };
  }
  return { index: state.index, elapsed: duration, moved: false, atEnd: true };
}

/**
 * 一行是不是**空行**（全是空白、或者只有一个不断行空格）。
 *
 * 「这个位置没有字」就这**一个**判断：阅读页渲染 `.reading-line.blank`、算段首、导读跳空行，
 * 用的都是它 —— 各写一套迟早会分家（比如某一边认 `\u00a0` 另一边不认）。
 */
export function isBlankLine(line: string | null | undefined): boolean {
  return typeof line !== "string" || line.trim() === "";
}

/**
 * 从 `from`（含）往后找**第一条有字的行**。
 *
 * 为什么要有这一步：空行只是排版留下的缝，**导读不该在它身上花时间**。原来三种标记遇到空行
 * 都会照样「走」一整行的工夫 —— 光点 / 兔子沿空行的整宽慢慢挪过去（那条线上一个字都没有），
 * 下划线那一段更是这一整行都看不见（空行不画轨迹条），看着就是「停顿了好几秒钟」。
 * 现在换行时**一步跨过去**：跨过的空行一条也不花时间，`elapsed` 只留跨过来那点余量。
 *
 * 返回 `-1` = 这一行往后**这一批里再没有有字的行**了（调用方要么去接下一批，要么收住导读）；
 * 整批全是空行时同样返回 `-1`。坏 `from`（负 / 越界 / NaN）按 0 / 行数处理。
 */
export function guideNextLine(lines: string[], from: number): number {
  if (!Array.isArray(lines)) return -1;
  const start = Math.max(0, Math.floor(Number.isFinite(from) ? from : 0));
  for (let index = start; index < lines.length; index += 1) {
    if (!isBlankLine(lines[index])) return index;
  }
  return -1;
}

/**
 * 导读**一帧的推进**：把 `stepGuideClock`（一行一行地走的算术）与「空行不花时间」串成一步 ——
 * 阅读页每帧只调它一个。
 *
 * 三件事：
 * - **空行一步跨过去**：换行时不会在空行上白等一个「每行停留时间」；落在空行上（开书恢复位置 /
 *   手滚同步 / 新铺一批之后）也会当帧纠正到后面第一条有字的行。
 * - 跨过空行时 **`elapsed` 的余量照样带走**（与 `stepGuideClock` 同一个道理），长跑不漂。
 * - `stopped` = 这一行往后**这批里再没有有字的行**了（含「走到末行行尾」）：调用方要么去接
 *   下一批，要么收住导读并说一声「已到最后一页」。
 */
export function stepGuideWalk(
  lines: string[],
  state: { index: number; elapsed: number },
  dt: number,
  duration: number,
): { index: number; elapsed: number; moved: boolean; stopped: boolean } {
  const here = guideNextLine(lines, state.index);
  if (here < 0) {
    // 这一批后面全是空行：一条也不花时间，直接当「这批到头了」
    return { index: state.index, elapsed: state.elapsed, moved: false, stopped: true };
  }
  if (here !== state.index) {
    // 本身落在空行上：当帧跨过去，这一行从头开始计时
    return { index: here, elapsed: 0, moved: true, stopped: false };
  }
  const step = stepGuideClock(state, dt, duration, lines.length - 1);
  if (step.moved) {
    const next = guideNextLine(lines, step.index);
    if (next < 0) {
      // 尾巴上只剩空行：别在空行上落脚，直接当「这批到头了」（`stopped` 优先于 `moved`）
      return { index: step.index, elapsed: step.elapsed, moved: true, stopped: true };
    }
    return { index: next, elapsed: step.elapsed, moved: true, stopped: false };
  }
  return { index: step.index, elapsed: step.elapsed, moved: false, stopped: step.atEnd };
}

/**
 * 一行折成几折时把时间**均摊**到每一折上：`pct`（0–1，这一行走了多少）落在第几折、
 * 这一折走了多少（0–1）。越界 / 小数 / `NaN` 都先收进 0–0.999。
 */
function walkRows(rows: GuideRow[], pct: number): { row: number; frac: number } {
  const ratio = Number.isFinite(pct) ? Math.min(0.999, Math.max(0, pct)) : 0;
  const walked = ratio * rows.length;
  const row = Math.min(rows.length - 1, Math.floor(walked));
  return { row, frac: walked - row };
}

/**
 * 光点在 `pct`（0–1，这一行走了多少）处的位置（相对这一行的左上角，px）。
 *
 * 一行文字常常折成几「视觉行」（`getClientRects` 一条 rect 就是一折）：把时间**均摊**到
 * 每一折上，光点就会沿折行继续往右走，而不是在第一折的右边停住。
 * y 落在轨迹线上（`guideTrailY`）—— 光点从正文下方划过。
 */
export function guideDotAt(rows: GuideRow[], pct: number): { left: number; top: number } {
  if (!rows.length) return { left: 0, top: 0 };
  const { row, frac } = walkRows(rows, pct);
  return { left: rows[row].left + frac * rows[row].width, top: guideTrailY(rows[row]) };
}

/**
 * 轨迹（字底下那条下划线）在 `pct` 处的样子：光点走到哪儿，轨迹就长到哪儿。
 *
 * 调用方拿它摆这一行的每一条轨迹条：下标 < `row` 的那几折整条点亮，`row` 这一折是 `width`
 * 那么长；再往后的几折还没走到，先不画。空行没有字，也就不该有下划线（光点照走）。
 */
export function guideTrailAt(rows: GuideRow[], pct: number): GuideTrail {
  if (!rows.length) return { row: 0, width: 0, top: 0 };
  const { row, frac } = walkRows(rows, pct);
  return { row, width: rows[row].width * frac, top: guideTrailY(rows[row]) };
}

/* ------------------------------------------------------------------ */
/* 第三号领路的：四五个字宽的一小段下划线（墨色、笔直，走过就化掉）        */
/* ------------------------------------------------------------------ */

/**
 * 这一段下划线占多宽（**em**）：`4.6em` ≈ **四五个中文字**（一个汉字 ≈ 1em），
 * 英文书下约**两个单词**（一个单词 ≈ 0.5em 上下）。这是它**伸到最长那一拍**的宽度，
 * 「缩回来」那一拍按 `GUIDE_CRAWLER_BREATH` 收窄一点（见 `guideCrawlWidth`）。
 *
 * 又是「跟着字号走」的一个：调用方按 `fontSize × GUIDE_CRAWLER_EM` 算好 px 再传进来
 * —— 用户是按「几个字」想的，而字宽 ≈ 字号。
 */
export const GUIDE_CRAWLER_EM = 4.6;

/**
 * 伸缩的幅度（比例）：最长那一拍与最短那一拍差这么多（0.18 = 在四五个字之间来回）。
 * **只有长度在动** —— 粗细与落点都不动，所以它看上去始终是「字底下一条笔直的下划线」。
 */
export const GUIDE_CRAWLER_BREATH = 0.18;

/**
 * 一伸一缩多久（毫秒）—— 与档位无关：这是它**自己的节奏**，不是「走到下一行的节奏」。
 * 所以慢档慢走时它在伸缩，快档快跑时它也在伸缩，两个节奏对不上，看着就不机械。
 *
 * 2.2s 是**挑出来的**：二十档的每行停留时间（500ms…20s）没有一个与它成整数倍（最接近的
 * 那一档也差 7%），所以「每到行尾正好伸到同一拍」这种事不会发生 —— 不然每翻一行都会
 * 踩在同一个相位上，反而看出机械感。
 */
export const GUIDE_CRAWLER_BREATH_MS = 2200;

/**
 * 伸到哪一拍：给一个**只增不减的毫秒时钟**，得到一个 -1 … 1 的来回 ——
 * `+1` 是**伸到最长**，`-1` 是**缩到最短**。
 *
 * 为什么时钟要跟 `pct`（这一行走了多少）分开：**换行不能打断它**。拿 `pct` 当相位的话，
 * 每换一行它就从 0 重来，看着就是「一换行就抽一下」的机械感。
 * 非有限值（NaN / 没给）当 0：不伸缩，也不乱跳。
 */
export function guideBreath(clock: number): number {
  if (!Number.isFinite(clock)) return 0;
  return Math.sin((clock / GUIDE_CRAWLER_BREATH_MS) * Math.PI * 2);
}

/**
 * 这一刻这一段下划线有多宽（px）；`em` = **一个字的宽度**（px，调用方按字号给）。
 *
 * 宽度是**唯一**在动的东西：粗细 / 颜色 / 落点全在 CSS 里，而且与已读行那条下划线
 * （`text-decoration`）**一模一样**（0.1em 粗、同一个下沿，见 `guideTrailY` 那段注释）。
 * 所以看上去不是一只虫、也不是进度条，就是**字底下一条笔直的下划线**自己在往前挪；
 * 它走过的地方由 `.reader-lines.guide-crawl` 那条 CSS 动画**迅速化掉**（见 App.css），
 * 于是任何一刻正文里能看到的都只有这一小段 —— 视觉上就是「在前进」。
 */
export function guideCrawlWidth(em: number, clock: number): number {
  if (!Number.isFinite(em) || em <= 0) return 0;
  // 0 = 缩到最短，1 = 伸到最长
  const stretch = (guideBreath(clock) + 1) / 2;
  return em * GUIDE_CRAWLER_EM * (1 - GUIDE_CRAWLER_BREATH * (1 - stretch));
}

/**
 * 这一段下划线在一折上的一条（相对这一行的左上角，px）。`width <= 0` = 这一段没搭上这一折。
 *
 * 只有 `left / top / width`：**粗细交给 CSS**（就是 `.reading-guide-trail` 的 0.1em，
 * 与已读行那条同高同粗）—— 它不再随呼吸变粗变细，那会一眼看出是「另一个东西」。
 */
export type GuideCrawlBand = { left: number; top: number; width: number };

/**
 * 一折之内**先慢、再快、再慢**（smoothstep）：一步一顿地爬。
 *
 * `pct` 是按时间均摊出来的比例，直接拿它定位置就是**匀速**推过去 —— 那正是要避开的机械感。
 * 这条曲线 0 → 0 的斜率是 0、1 → 1 的斜率也是 0，所以一折的**两头会顿一下**、中间那段才快，
 * 走出「一步一步」的步子；而一折走完的时间还是那么长（平均值不变），换行的节奏不受影响。
 */
function crawlStep(frac: number): number {
  const t = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  return t * t * (3 - 2 * t);
}

/**
 * 这一段下划线这一刻铺在哪儿：**一行折成几折就返回几条**（与 `rows` 一一对应；没搭上的那条
 * `width` 为 0，调用方把它藏起来 —— 复用轨迹条那几条就是这个原因）。
 *
 * 它铺在**头的后面**（右端 = 正在走的那一头，左端 = 刚走过的四五个字）：左端是**顺着阅读顺序
 * 往回退**的 —— 一折的左边退到头，就从**上一折的末尾**接着算（折行时几折都是从行首那个 x
 * 起头的，所以不能拿区间硬套，得按读的顺序走）。于是折行也是天然的：一行折成两折时它被拆成
 * 两条（上一折末尾一条、下一折开头一条），行首那一小段是从左边**长出来**的（身子还没爬够
 * 就出了行首），行尾那一条右端正好压在行尾。
 *
 * 两件事让它不像匀速推进的进度条：**一步步挪**（`crawlStep` 的 smoothstep —— 一折之内先慢、
 * 再快、再慢，两头几乎停住）与**它自己的伸缩**（`guideCrawlWidth`，2.2s 一伸一缩）。
 */
export function guideCrawlAt(
  rows: GuideRow[],
  pct: number,
  em: number,
  clock: number,
): GuideCrawlBand[] {
  if (!rows.length) return [];
  const hidden: GuideCrawlBand = { left: 0, top: 0, width: 0 };
  const bands: GuideCrawlBand[] = rows.map(() => hidden);
  const width = guideCrawlWidth(em, clock);
  if (width <= 0) return bands;
  const { row, frac } = walkRows(rows, pct);
  let index = row;
  // 头在这一折里的位置
  let head = rows[index].left + crawlStep(frac) * rows[index].width;
  // 身子还有多长没铺下：一折铺满就退到上一折的末尾接着铺
  let remaining = width;
  while (index >= 0 && remaining > 0) {
    const box = rows[index];
    const part = Math.min(remaining, Math.max(0, head - box.left));
    if (part > 0) {
      bands[index] = { left: head - part, top: guideTrailY(box), width: part };
      remaining -= part;
    }
    index -= 1;
    if (index >= 0) head = rows[index].left + rows[index].width;
  }
  return bands;
}

/** 跟读时让当前行停在视野上方这个比例处（「带子」）；出了带子才把画面往前挪。 */
export const GUIDE_BAND_RATIO = 0.34;
/** 带子上下这个像素之内不动（一行一行地爬，不是一行一跳）；再宽也不过半个行高。 */
export const GUIDE_BAND_SLACK_PX = 10;
/** 载入的正文距底部不足这么多像素，就该再要一批。 */
export const GUIDE_PREFETCH_PX = 900;

/**
 * 「跟着导读滚」要滚到哪：让这一行落在视野上方约 1/3 处（带子）。
 *
 * 已经在带子附近（半个行高以内、至少 `GUIDE_BAND_SLACK_PX`）就返回 `null` —— 一行一行地
 * 爬，不是一行一跳。返回值夹到 0：顶上那一行摆不到带子上，只能贴着顶。
 */
export function guideFollowTop(
  lineTop: number,
  lineHeight: number,
  scrollTop: number,
  clientHeight: number,
): number | null {
  const band = clientHeight * GUIDE_BAND_RATIO;
  if (Math.abs(lineTop - scrollTop - band) <= Math.max(GUIDE_BAND_SLACK_PX, lineHeight * 0.5)) {
    return null;
  }
  return Math.max(0, lineTop - band);
}

/**
 * 载入的正文快见底了没（下面还剩不到 `GUIDE_PREFETCH_PX`）—— 是就该再要一批。
 *
 * 导读必须**自己问这一句**，不能只等 `onScroll` 的预取：滚到底时 `scrollTop` 会被浏览器
 * 夹住，夹住就不再触发 `scroll` 事件，预取于是永远等不到、正文不再往下接 —— 表现就是
 * 「光点走到屏幕最下面那条字之后就不见了、页面再也不翻」。
 */
export function guideNeedsMore(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < GUIDE_PREFETCH_PX;
}
