import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import BookContextMenu, {
  BatchRenameDialog,
  BookPropsDialog,
  BookStatsDialog,
  ConfirmDeleteDialog,
  LimitDialog,
} from "../components/BookContextMenu";
import BookTransition, { type SpineRect } from "../components/BookTransition";
import BookshelfManager from "../components/BookshelfManager";
import ImportFlight from "../components/ImportFlight";
import ImportPickMenu, { type ImportPickAnchor } from "../components/ImportPickMenu";
import { Plush } from "../components/Plush";
import { SEAL_TOAST_TEXT, SealDissolve, SealToast } from "../components/SealEffect";
import StickyNoteNav from "../components/StickyNoteNav";
import {
  bookCover,
  coreCapabilities,
  getGuiSetting,
  importBooks,
  importPickerModes,
  pickImportPaths,
  removeBook,
  saveCoverSpec,
  sealBook,
  setBookMeta,
  setFinished,
  setGuiSetting,
  type ImportPickMode,
} from "../lib/core";
import { generatedCover, parseCoverSpec, type CoverSpec } from "../lib/coverGenerator";
import { loadAnnotations } from "../lib/annotations";
import { expiredBooks, localDay, readDeadlines, writeDeadlines } from "../lib/deadlines";
import { AMBIENT_TRACKS, type AmbientState, type AmbientTrackId } from "../lib/ambient";
import { coreStamp } from "../lib/format";
import { IMPORT_FLIGHT_KEY, normalizeImportFlight } from "../lib/importFlight";
import {
  packShelfRows,
  planShelfPages,
  normalizeSpineMode,
  spineDepth,
  spineTitleFontRem,
  spineWidthRem,
  stepPage,
  SPINE_MIN_REM,
  SPINE_MODE_KEY,
} from "../lib/shelfLayout";
import {
  DRAG_THRESHOLD_PX,
  SPRING_MS,
  gapInRow,
  mergeOrder,
  moveBook,
  normalizeLayout,
  nudgeStep,
  orderIndexAt,
  readLayout,
  renamedTitle,
  renameTouched,
  shiftBook,
  squeezeIds,
  writeLayout,
  type LayoutHome,
  type ManageDrag,
  type ManageHit,
  type ManageLayout,
  type ManageRename,
} from "../lib/shelfManage";
import { shortcutFrom, shortcutKey } from "../lib/shortcuts";
import { useSky } from "../lib/sky";
import {
  DEFAULT_TOY_SETTINGS,
  TOY_GAP_MAX,
  TOY_GAP_MIN,
  TOY_GAP_STEP,
  TOYS,
  loadToyGap,
  loadToySettings,
  normalizeToyGap,
  placedToys,
  saveToyGap,
  saveToySettings,
  toggleToy,
  type ToySettings,
} from "../lib/toyPrefs";
import type { BookRow, DeadlineMap } from "../lib/types";

/**
 * 排内间距（rem）—— **与 `App.css` 的 `.shelf` 的 `gap` 是一对**，改一个就得改另一个：
 * 那边排版时留这个缝，这边按厚度累加算「这一排放得下几本」时也要算上它。
 */
const SPINE_GAP_REM = 0.5;

/** 书超过这么多屏，右上角才出现「跳到第几屏」的输入框（三屏以内用箭头点两下就到了）。 */
const JUMP_MIN_PAGES = 4;

/**
 * 还没量到书排宽度时（SSR / 首帧）先按这个宽度排（rem）。
 *
 * 量宽度在 `useLayoutEffect` 里，**画之前**就会重排一次，所以这个值只是个起点；
 * 它有确定的值（而不是 0），是为了让服务端渲染那份 HTML 也是稳定可断言的。
 */
const ASSUMED_ROW_REM = 76;

/** 回车确认后，命中的书脊高亮多久（毫秒）。 */
const HIGHLIGHT_MS = 2000;

/** 置顶列表存在本机 gui_settings 里的键名（内核不认识"置顶"，这是界面自己的事）。 */
const PINNED_KEY = "shelf.pinned";

/** 指针靠近窗口哪一侧；"" = 在中间（两侧翻页箭头都不显示）。 */
type Edge = "" | "left" | "right";

/**
 * 这本书读过没有 —— 有进度就算「续读」。
 *
 * 点开的时候先看这个：**读过就直接进阅读页，不放过场**；没读过才抽书 / 翻封面。
 * 判据只用内核给的两个字段：`current_line > 0`（读到过某一行）或 `last_read`
 * 有值（内核记过上次阅读时间）。
 */
export function hasProgress(book: BookRow): boolean {
  return book.current_line > 0 || !!book.last_read;
}

/** 一次「抽书 → 翻封面」过场所需要的东西。 */
type Stage = {
  /** 正在翻的那本 */
  book: BookRow;
  /** 自动生成封面的方案（配色下标 + 中央那两个字） */
  spec: CoverSpec;
  /** 本地封面图的 data URL；没有就是 null（那就画生成的那张） */
  image: string | null;
  /** 书脊在屏幕上的位置：中途返回时封面飞回这里 */
  origin: SpineRect;
};

/** 数字时钟：书房墙上显示当前系统时间，每秒跳一次。 */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * 墙上那格数字时钟。
 *
 * **自成一个组件**：秒针在它自己身上跳，不牵动整面书架重渲染 —— 书一多，
 * 每秒把四十张书脊卡片重算一遍纯属白烧 CPU（书架那侧另有自己的每秒定时器，
 * 只管「有没有限时书到期」，见下面那个 effect）。
 */
function Clock() {
  const now = useClock();
  return (
    <div className="widget clock" title="当前系统时间">
      <span className="clock-time">{now.toLocaleTimeString("zh-CN", { hour12: false })}</span>
      <span className="clock-date">
        {now.toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        })}
      </span>
    </div>
  );
}

/* 天亮 / 天黑（`skyOf`）与 `useSky` 挪去了 `lib/sky.ts`：白噪音按时钟选声音
   用的是同一套判断，两处各写一份迟早会跑偏。 */

/* 毛绒玩具的骨架（`Plush`）2026-10-24 挪去了 `components/Plush.tsx`：
   阅读页右下角蹦出来的那只也要用同一套造型，两边一起 import。 */

/**
 * 换玩偶的小面板（挂在玩具那一格里、从它上方弹出，样式见 App.css 的 `.toy-picker`）：
 * **一行一只**（整行就是按钮：缩略图 + 名字，点一下放上 / 取下），架上摆着**两只以上**
 * 时再多一行**间距**（一只也没有「之间」可言）。
 *
 * 单拆出来是为了能在 node 里整块渲染点数：`Shelf` 太大、SSR 进不去，而这个面板又挂在
 * 组件内部 state 上（平时收着），不拆就只有出图能看。**面板自己不碰 `localStorage`** ——
 * 摆法 / 间距存哪儿是 `lib/toyPrefs` 的事，这里只管画与回调。
 */
export function ToyPicker(props: {
  /** 三只各自的摆法（`lib/toyPrefs` 那份存档） */
  toys: ToySettings;
  /** 相邻两只之间的间距（rem；正数分开、负数挨在一起） */
  gap: number;
  /** 架上摆着几只 —— 少于两只就不显示间距那一行 */
  placedCount: number;
  onToggle: (id: string) => void;
  onGap: (gap: number) => void;
}) {
  return (
    <div className="toy-picker" role="group" aria-label="毛绒玩具">
      {TOYS.map((item) => {
        const place = props.toys[item.id] ?? DEFAULT_TOY_SETTINGS[item.id];
        return (
          <div className="toy-line" key={item.id}>
            {/* **整行就是按钮**：点哪儿都算「放上 / 取下」。从前这行右边还排着四颗
                「前 / 左 / 右 / 后」的小方块（2026-10-10 按用户要求去掉三面、只留正面），
                那几颗占的位置现在归按钮 —— 行宽由下面「间距」那行定，多出来的部分全在
                按钮里（看着是一整条、点着也顺手） */}
            <button
              type="button"
              className={`toy-choice${place.on ? " active" : ""}`}
              title={place.on ? `把${item.label}收起来` : `把${item.label}摆上去`}
              aria-label={place.on ? `把${item.label}收起来` : `把${item.label}摆上去`}
              aria-pressed={place.on}
              onClick={() => props.onToggle(item.id)}
            >
              {/* 缩略图：与书架上那只同一套造型（只是缩小了）。外面这层定尺寸，
                  里面的 `.plush` 绝对定位居中（见 App.css 的 `.toy-thumb .plush`）*/}
              <span className="toy-thumb">
                <Plush id={item.id} />
              </span>
              <span className="toy-name">{item.label}</span>
            </button>
          </div>
        );
      })}
      {/* 间距：**摆上两只以上才有「之间」可言** —— 所以平时不出现，省得点进来看到
          一根用不上的滑杆。往左挤紧、往右分开（负数 = 挨在一起，就是从前那一档） */}
      {props.placedCount >= 2 ? (
        <div className="toy-line toy-gap-line">
          <span className="toy-name">间距</span>
          <input
            type="range"
            className="toy-gap-slider"
            min={TOY_GAP_MIN}
            max={TOY_GAP_MAX}
            step={TOY_GAP_STEP}
            value={props.gap}
            aria-label="玩偶之间的距离"
            title="玩偶之间的距离：往右分开、往左挤紧（负数 = 挨在一起）"
            onChange={(event) => props.onGap(Number(event.currentTarget.value))}
          />
          <span className="toy-gap-value">{props.gap.toFixed(1)}rem</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 留声机的曲目面板：点一下留声机，从机器**下方**弹出的小卡片。
 * 最上面一行是开 / 关，接着是九首（中间一条细隔线），最后一项「按昼夜自动」。
 * 当前选中的那一首亮着；正在响的那一首左边有一条暖色竖线（自动模式下也看得见）。
 *
 * 单拆出来和 `ToyPicker` 同一个道理：面板挂在组件内部 state 上（平时收着），
 * 不拆就只有出图能看。**面板自己不碰 localStorage** —— 开没开、选哪首是
 * `lib/ambient` 的事，这里只管画与回调。
 */
export function AmbientPicker(props: {
  on: boolean;
  mode: AmbientState["mode"];
  playing: boolean;
  current: AmbientTrackId | null;
  onToggle: () => void;
  onSelect: (id: AmbientTrackId) => void;
  onAuto: () => void;
}) {
  const auto = props.mode.kind === "auto";
  return (
    <div className="ambient-picker" role="group" aria-label="书房的声音">
      <button
        type="button"
        className={`ambient-choice ambient-power${props.on ? " active" : ""}`}
        aria-pressed={props.on}
        title={props.on ? "关掉书房的声音" : "打开书房的声音"}
        onClick={props.onToggle}
      >
        <span className="ambient-power-dot" aria-hidden="true" />
        <span className="ambient-name">{props.on ? "声音：开" : "声音：关"}</span>
      </button>
      <span className="ambient-rule" aria-hidden="true" />
      {AMBIENT_TRACKS.map((track) => {
        const picked = props.mode.kind === "track" && props.mode.track === track.id;
        const sounding = props.playing && props.current === track.id;
        return (
          <button
            key={track.id}
            type="button"
            className={`ambient-choice${picked ? " active" : ""}${sounding ? " sounding" : ""}`}
            aria-pressed={picked}
            title={`播放「${track.label}」（单曲循环）`}
            onClick={() => props.onSelect(track.id)}
          >
            <span className="ambient-name">{track.label}</span>
            {track.hint ? <span className="ambient-hint">{track.hint}</span> : null}
          </button>
        );
      })}
      <span className="ambient-rule" aria-hidden="true" />
      <button
        type="button"
        className={`ambient-choice${auto ? " active" : ""}`}
        aria-pressed={auto}
        title="跟着昼夜走：白天风铃流水，夜里两段虫鸣交替"
        onClick={props.onAuto}
      >
        <span className="ambient-name">按昼夜自动</span>
        <span className="ambient-hint">白天 / 夜里</span>
      </button>
    </div>
  );
}


/**
 * 一格书：现在只剩书脊（阅读数据搬进了右键菜单的「阅读统计 / 属性」）。
 *
 * 右键、或触屏按住 550ms，都会通过 `onMenu` 把菜单弹在指针位置。
 */
/**
 * 一根书脊（一整本书）。
 *
 * `memo` 包着：书架上的书一多（一屏最多四十本），任何一次重渲染都要重算四十份 JSX，
 * 而它们绝大多数时候什么都没变 —— 鼠标贴到左右边缘亮箭头、开个右键菜单、
 * 翻到别的屏，都不该牵动这些卡片。**所以传进来的 props 要保持「值」**（布尔 / 字符串 /
 * 稳定的回调），别传每帧新建的对象。
 */
const BookSpine = memo(function BookSpine(props: {
  book: BookRow;
  /** 书脊厚度（rem）—— 动态模式按总字数算（`spineWidthRem`），统一模式一律保底 */
  width: number;
  /** 厚度落在「最薄…最厚」之间的位置（0–1）：侧边那道厚度阴影按它加深 */
  depth: number;
  /** 书脊上那行书名的字号（rem）—— 长书名自动缩小，保证整条排得下（不截断） */
  titleFont: number;
  /** 字数没统计出来（解析失败 / 空文件）：宽度走保底那一档，并留个标记 */
  unknown: boolean;
  /** 点开这本书；顺带把书脊在屏幕上的位置交出去（过场要靠它飞回原位） */
  onOpen: (book: BookRow, origin: SpineRect) => void;
  onMenu: (book: BookRow, x: number, y: number) => void;
  highlight?: boolean;
  pinned?: boolean;
  /** 限时到期日（`YYYY-MM-DD`；null / 缺省 = 不是限时书）。只标一下，不显示倒计时 */
  limited?: string | null;
  /** 正在被"抽出来"（过场的第一阶段） */
  pulling?: boolean;
  /** 管理模式下：这一格在「格子序列」里的下标（拖拽判定与落位都要用它） */
  slot?: number;
  /** 管理模式下：按下不再开书，而是准备拖（移动超过阈值才算拖，见父组件的 `grabBook`） */
  managing?: boolean;
  /** 管理模式下：被落到旁边的书挤扁（`scaleX(0.8)`），松手后弹性恢复 */
  squeezed?: boolean;
  /** 管理模式下：这本书正在被拖走 —— 原位留空，只留一张半透明缩略图 */
  emptied?: boolean;
  /** 管理模式下按下：备一个「可能要拖」的手势 */
  onGrab?: (book: BookRow, event: React.PointerEvent<HTMLLIElement>) => void;
  /** 选择模式：这一根书脊按下 / 点击都只切换勾选（不再开书、也不再拖） */
  selecting?: boolean;
  /** 选择模式：这一本被勾上了（书脊抬起 + 暖色描边 + 右上角打勾） */
  selected?: boolean;
  /** 选择模式：点一下切换勾选状态 */
  onToggleSelect?: (book: BookRow) => void;
  /** 排序时点中的就是这一本（抬起来 + 暖色描边，随后可用方向键挪） */
  picked?: boolean;
  /** 点一下书脊（没在拖、也不是选择模式）：选中它，之后用方向键挪 */
  onPick?: (book: BookRow) => void;
}) {
  const { book } = props;
  // 长按计时器：按住不动 550ms 才算长按
  const pressTimer = useRef<number | null>(null);
  // 长按弹出菜单后，抬手那次 click 要丢掉（否则会顺手把书打开）
  const suppressClick = useRef(false);

  function clearPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function startPress(event: React.TouchEvent) {
    // 选择模式：长按不弹单本菜单（这里点一下就是勾选，弹菜单只会打架）
    if (props.selecting) return;
    const touch = event.touches[0];
    // 没有触点（异常事件）就不启动计时
    if (!touch) return;
    const { clientX, clientY } = touch;
    clearPress();
    // 新手势开始，先假定"这一次点击算数"
    suppressClick.current = false;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      // 菜单从这里弹：抬手时的 click 不要再打开书
      suppressClick.current = true;
      props.onMenu(book, clientX, clientY);
    }, 550);
  }

  // 卸载时别留下计时器
  useEffect(() => clearPress, []);

  return (
    <li
      // 封印动画要按 id 找回这根书脊的坐标（见 spineRect）
      data-book-id={book.id}
      // 字数没统计出来（解析失败 / 空文件）：宽度已按保底那一档算，这里再留个标记
      data-spine={props.unknown ? "unknown" : undefined}
      title={props.unknown ? "字数没统计出来（解析失败或空文件）—— 书脊按最薄一档摆" : undefined}
      className={`spine-card${props.highlight ? " highlight" : ""}${props.pinned ? " pinned" : ""}${
        props.pulling ? " pulling" : ""
      }${props.managing ? " manage" : ""}${props.squeezed ? " squeeze" : ""}${
        props.emptied ? " emptied" : ""
      }${props.selected ? " selected" : ""}${props.picked && props.managing ? " picked" : ""}`}
      // 管理模式下按它认格子（data-slot = 这一格在「格子序列」里的下标）
      data-slot={props.managing ? props.slot : undefined}
      // 三个数交给 CSS：厚度（动态模式按字数）、厚度比例（侧边阴影深浅）、书名字号（长书名自动缩）
      style={
        {
          "--spine-w": `${props.width}rem`,
          "--spine-depth": String(props.depth),
          "--spine-title-size": `${props.titleFont}rem`,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        // 选择模式：按下只准备勾选，不准备拖（拖动会让「点击勾选」抖一下就落空）
        if (props.selecting) return;
        props.onGrab?.(book, event);
      }}
      onClick={(event) => {
        // 选择模式：点一下就是勾 / 取消勾
        if (props.selecting) {
          props.onToggleSelect?.(book);
          return;
        }
        // 管理模式下抬手不算「打开书」：这一下是**选中**（拖动就是从这儿开始的；
        // 拖完也顺势选中，接着可以用方向键一位一位地调）
        if (props.managing) {
          props.onPick?.(book);
          return;
        }
        // 长按刚弹过菜单：这次 click 只是抬手，不当成"打开"
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        // 连书脊在屏幕上的位置一起交出去：过场结束时（或中途返回）要用
        props.onOpen(book, event.currentTarget.getBoundingClientRect());
      }}
      onContextMenu={(event) => {
        // 拦掉系统右键菜单，改弹我们自己的
        event.preventDefault();
        // 管理模式下不弹自己的菜单：拖着书的时候它只会碍事（右键仍然不会漏出系统菜单）
        if (props.managing) return;
        props.onMenu(book, event.clientX, event.clientY);
      }}
      onTouchStart={startPress}
      onTouchEnd={clearPress}
      onTouchMove={clearPress}
      onTouchCancel={clearPress}
    >
      {/* 选择模式：右上角一枚勾选圈（纯装饰 —— 点击由整根书脊接管，这里别再拦一道） */}
      {props.selecting ? (
        <span className={`spine-check${props.selected ? " on" : ""}`} aria-hidden="true">
          {props.selected ? "✓" : ""}
        </span>
      ) : null}
      <div className="spine">
        {/* 书脊：书名竖排（中文自上而下，英文按书脊惯例旋转 90°） */}
        <span className="spine-title" title={book.title || book.id}>
          {book.title || book.id}
        </span>
        {book.author ? <span className="spine-author">{book.author}</span> : null}
        {book.tags.length > 0 ? (
          <span className="spine-tags">#{book.tags.join(" #")}</span>
        ) : null}
        {/* 进度条画的仍是内核记的百分比，与终端里完全一致 */}
        <progress className="spine-progress" value={book.percentage} max={100} />
        <span className="spine-fill" style={{ height: `${book.percentage}%` }} />
        <span className="spine-read">
          {book.finished ? "已读完" : `${book.percentage.toFixed(1)}%`}
        </span>
        {/* 限时书：只标出"这本书有到期日"，不写倒计时（到期那天才告诉用户） */}
        {props.limited ? (
          <span className="spine-limit" title={`限时：${props.limited} 到期`}>
            ⏳
          </span>
        ) : null}
      </div>
    </li>
  );
});

/**
 * 书房：整间屋子就是书架页。
 *
 * 一屏之内不出现滚动条，书多了靠指针靠近左右两侧时浮现的翻页箭头翻屏。摆法是「一排一格」：
 * **主屏**是书房全景 —— 窗、墙上那一栏（日历 / 数字时钟 / 徽章盒 / 齿轮 / 同步那几个小圆钮）、
 * 摆件架，下面**只有一排书**（这一排的头一格是那只藤条篮子）；**第二屏起是整面书架** —— 窗与挂件
 * 都收起来（`main` 上打 `.study.shelves`，见 `App.css`），**三排书**顶到最上面，
 * 每排下面垫一块白色挡板，右上角浮着「回到主屏」（书超过 `JUMP_MIN_PAGES` 屏再多一个
 * 「跳到第几屏」的输入框）。一排摆几本由窗口宽度决定（`booksPerRow` 量出来的），
 * 所以「一屏固定多少本」这种数在这份代码里不存在。
 *
 * 搜索是**纯前端**的：点放大镜（或按 `/`、`⌘K`）会铺一层模糊遮罩并从顶部滑下输入框，
 * 输入即时按书名 / 作者过滤身后的书架；回车确认后收起遮罩、把命中的书脊高亮 2 秒，
 * Esc 或点遮罩空白处取消。这里不调用内核的 `search`。
 */
export default function Shelf(props: {
  books: BookRow[];
  busy: boolean;
  error: string;
  onOpen: (book: BookRow) => void;
  onSync: () => Promise<BookRow[]>;
  onReset: () => void;
  onOpenStats: () => void;
  onOpenAchievements: () => void;
  onOpenDesk: () => void;
  /** 书架上那本笔记本：所有书的划线 + 批注，按书分组摊开（见 `views/Notebook.tsx`） */
  onOpenNotebook?: () => void;
  /**
   * 沉浸模式：书、统计 / 成就 / 设置、导入与右上角那些小圆钮全部停用，
   * **只留管理模式**（锤子 / `M`）能整理书架。
   */
  immersive: boolean;
  /** 墙上那枚「沉浸」贴纸点一下：开 / 关沉浸模式（状态在 `App.tsx`） */
  onToggleImmersive: () => void;
  /** 进书房时是不是直接落在管理模式（`App.tsx` 记着上一次的状态，见 `onManageChange`） */
  initialManaging?: boolean;
  /** 管理模式开 / 关都报一声：`App.tsx` 记住它，去统计页看一眼再回来手里还拿着那把锤子 */
  onManageChange?: (managing: boolean) => void;
  /**
   * 白噪音（应用级，见 `lib/ambient.ts`）：开没开、该放哪段、真的在响没有、怎么切。
   * 书房只拿它画**架子上那台留声机** —— 点一下开 / 关，响着的时候喇叭口有一圈呼吸。
   */
  ambient: AmbientState;
}) {
  // 白天 / 夜里：窗外的天色、屋子的明暗、台灯都按它切换
  const sky = useSky();
  // 留声机那格的提示语：点一下弹出曲目面板（开关也在面板顶上）
  const gramophoneHint = props.immersive
    ? "沉浸模式：留声机先不响"
    : props.ambient.on
      ? `留声机：白噪音开着（现在放「${props.ambient.label}」）—— 点一下选曲 / 开关`
      : "留声机：白噪音关着 —— 点一下选曲或打开";
  // 点开一本书的过场：点的是哪本、封面怎么画、书脊在哪（null = 没在过场）
  const [stage, setStage] = useState<Stage | null>(null);
  // 搜索：遮罩是否打开、输入的关键词、回车后要高亮的书 id
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // 当前第几屏 + 指针贴在哪一侧（决定箭头是否现身）
  const [page, setPage] = useState(0);
  const [edge, setEdge] = useState<Edge>("");
  // 量出来的「一排可用宽度」与当前根字号（rem → px 要用）；量之前先按 ASSUMED_ROW_REM 排着
  const [rackSize, setRackSize] = useState({ width: 0, root: 16 });
  // 书脊厚度模式：动态（按字数）/ 统一等宽 —— 存在本机 gui_settings，开书读一次
  const [spineMode, setSpineMode] = useState<"dynamic" | "uniform">("dynamic");
  // 右上角「跳到第几屏」输入框里正在敲的字（空着就显示当前屏号）
  const [jumpText, setJumpText] = useState("");
  // 第一条书排的 <ul>：量它的宽度就知道一排放得下几本（厚薄不一，得一本本累加）
  const rackRef = useRef<HTMLUListElement | null>(null);
  // 藤条篮子的导入：是否正在进行 + 最近一次回执（出错原文另放）
  const [importing, setImporting] = useState(false);
  // 「＋」按一下之后弹什么：`["panel"]` = 面板一次挑完（macOS），`["files","folder"]` =
  // 先问一句挑文件还是挑文件夹（Windows / Linux）。问不到就按 macOS 那一档走，照旧能用。
  const [pickerModes, setPickerModes] = useState<string[]>(["panel"]);
  // 那个「文件还是文件夹」的小菜单挂在哪儿（null = 没开）：值就是篮子当时的位置
  const [pickAnchor, setPickAnchor] = useState<ImportPickAnchor | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");
  // 篮身那个盒子：导入飞行的起飞点由它量出来（篮口 ≈ 它高度的 55.4% 处，见 ImportFlight）
  const basketRef = useRef<HTMLSpanElement | null>(null);
  // 导入飞行动画：这一批新书 + 起飞点；null = 没在飞
  const [flight, setFlight] = useState<{ books: BookRow[]; origin: SpineRect } | null>(null);
  // 「导入后放不放飞行动画」：本机界面偏好（与「动态书脊厚度」同一套，进设置页改）
  const [importFlight, setImportFlight] = useState(true);
  // 笔记本里现有几条划线：架子上的册子要写这个数，也要据此给「多出来的那一格」留宽度。
  // 每次回书房都会重新挂载一次（阅读页 / 挂件页时书房是卸掉的），所以这里读一次就够新。
  const [notebookMarks, setNotebookMarks] = useState(0);
  useEffect(() => {
    let alive = true;
    loadAnnotations()
      .then((list) => {
        if (alive) setNotebookMarks(list.length);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 管理模式：开关 + 布局（书的先后，存本机 gui_settings）、正在拖的书、落点、翻屏动画
  // （初值从 props 来：从挂件页按 M 回到书房时，一进来就在管理模式里；只有挂载那一次读）
  const [managing, setManaging] = useState(props.initialManaging ?? false);
  const [layout, setLayout] = useState<ManageLayout>(() => normalizeLayout(null));
  // 这份布局存在哪儿：新内核的 shelf.json（跟着书库走）还是本机 gui_settings（老内核的退路）
  const [layoutHome, setLayoutHome] = useState<LayoutHome>("local");
  // 正在拖的那本书 + 它原来在第几格（`at` = 格子序列里的下标，原位留空时要用）
  const [dragging, setDragging] = useState<{ item: ManageDrag; at: number } | null>(null);
  // 指针当前的落点（null = 不在任何一排上）：让位 / 压扁、玩偶拦截都看它
  const [hover, setHover] = useState<ManageHit | null>(null);
  // 拖到边缘翻屏时播一下书排的滑动动画（`stamp` 一换动画就重放）
  const [flip, setFlip] = useState<{ dir: -1 | 1; stamp: number } | null>(null);
  // 选择模式（批量编辑）：每根书脊上出现勾选框，点一下勾 / 取消勾
  const [selecting, setSelecting] = useState(false);
  // 勾上的书 id（可以跨屏、跨排；用 Set 便于 O(1) 判断某根书脊该不该打勾）
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // 方向键排序**选中**的那一本书：点一下选中、再点同一本或 Esc 放开
  // （与批量编辑的勾选无关 —— 那个是「要一起动手的几本」，这个是「手上拿着的那一本」）
  const [picked, setPicked] = useState<string | null>(null);
  // 方向键挪完要不要把屏跟着翻过去：分屏要等挪完那一帧才算得出来，所以先记一笔（见下面的 effect）
  const followPick = useRef(false);

  // 置顶的书（本机界面状态，存 gui_settings，不碰内核）
  const [pinned, setPinned] = useState<string[]>([]);
  // 右键菜单：弹出位置 + 目标书；null = 没打开
  const [menu, setMenu] = useState<{ book: BookRow; x: number; y: number } | null>(null);
  // 弹窗：单本的阅读统计 / 属性 / 删除确认 / 限时模式，以及批量编辑里那两个
  // （批量改书名 / 批量删除 —— 它们没有「某一本」，作用对象是整份选择）
  const [dialog, setDialog] = useState<
    | { kind: "stats" | "props" | "delete" | "limit"; book: BookRow }
    | { kind: "batchRename" | "batchDelete" }
    | null
  >(null);
  // 删除 / 标记进行中 + 出错原文
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  // 批量操作的进度与结果（与导入回执同一套写法：先写「正在处理第 3/10 本」，最后写合计）
  const [batchNotice, setBatchNotice] = useState("");
  // 内核认不认 remove / finish / set_meta（老内核没有这几个方法，菜单项与编辑框要按这个禁用）
  const [canRemove, setCanRemove] = useState(true);
  const [canFinish, setCanFinish] = useState(true);
  const [canEditMeta, setCanEditMeta] = useState(true);
  // 限时书：书 id -> 到期日（本机界面状态，存 gui_settings；内核不认识"限时"）
  const [deadlines, setDeadlines] = useState<DeadlineMap>({});
  // 正在封印哪一本（同一时刻只封一本），以及已经交出去的 id（书还没从书架消失前挡住重复触发）
  const [sealing, setSealing] = useState("");
  const sealedIds = useRef(new Set<string>());
  // 封印的两下：书脊原位的光点飞散 + 一句轻提示
  const [sealEffect, setSealEffect] = useState<{ rect: SpineRect; title: string } | null>(null);
  const [toast, setToast] = useState("");

  // 启动时探一次内核能力：探不到就把「删除」「标记已读」禁掉，别等点了才报错
  useEffect(() => {
    let alive = true;
    coreCapabilities()
      .then((caps) => {
        if (!alive) return;
        setCanRemove(caps.remove);
        setCanFinish(caps.finish);
        setCanEditMeta(caps.setMeta);
      })
      .catch(() => {
        // 探测本身失败（内核还没起来等）就维持"支持"，不影响其它功能
      });
    return () => {
      alive = false;
    };
  }, []);

  // 沉浸模式一开，把书架上所有「另一页 / 选项」的浮层都收掉：搜索、右键菜单、玩偶面板、
  // 导入菜单（正常路径点不到它们 —— 贴纸在墙上，不在这些遮罩下面；这里只是兜底，
  // 免得以后哪个入口改成键盘打开时漏过去）。
  useEffect(() => {
    if (!props.immersive) return;
    setSearchOpen(false);
    setTerm("");
    setMenu(null);
    setToyPicker(false);
    setGramoOpen(false);
    setPickAnchor(null);
  }, [props.immersive]);

  // 摆件架上那几只玩偶：每只各自放不放（本机 localStorage，见 lib/toyPrefs）
  const [toys, setToys] = useState<ToySettings>(loadToySettings);
  // 相邻两只之间的间距（rem，本机；摆上两只以上才在面板里露出来）
  const [toyGap, setToyGap] = useState<number>(loadToyGap);
  const [toyPicker, setToyPicker] = useState(false);
  const toyRef = useRef<HTMLLIElement | null>(null);
  // 留声机的曲目面板（2026-10-22）：点一下机器弹出来，点外面 / Esc 收起
  const [gramoOpen, setGramoOpen] = useState(false);
  const gramoRef = useRef<HTMLLIElement | null>(null);
  // 架子上摆着哪几只（按名单顺序）—— 书架渲染就照这个摆
  const placed = placedToys(toys);

  /** 摆法一变就写回本机（存不进去只影响下次启动，见 lib/toyPrefs）。 */
  function applyToys(next: ToySettings) {
    setToys(next);
    saveToySettings(next);
  }

  /** 间距一变就写回本机（面板上那根滑杆每动一格走这里）。 */
  function applyToyGap(next: number) {
    const gap = normalizeToyGap(next);
    setToyGap(gap);
    saveToyGap(gap);
  }

  /** 放上 / 取下这一只。 */
  function flipToy(id: string) {
    applyToys(toggleToy(toys, id));
  }

  // 切换面板打开时：点面板外或按 Esc 关掉
  useEffect(() => {
    if (!toyPicker) return;
    function onPointerDown(event: MouseEvent) {
      // 点在玩具或面板里就不关（它们自己处理）
      if (
        toyRef.current &&
        event.target instanceof Node &&
        toyRef.current.contains(event.target)
      ) {
        return;
      }
      setToyPicker(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setToyPicker(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toyPicker]);
  // 留声机面板打开时：点机器 / 面板外或按 Esc 收起（与玩偶面板一个规矩）
  useEffect(() => {
    if (!gramoOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (
        gramoRef.current &&
        event.target instanceof Node &&
        gramoRef.current.contains(event.target)
      ) {
        return;
      }
      setGramoOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setGramoOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gramoOpen]);


  // 启动时把置顶列表读回来
  useEffect(() => {
    let alive = true;
    getGuiSetting(PINNED_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setPinned(parsed.filter((id): id is string => typeof id === "string"));
        }
      })
      .catch(() => {
        // 读不到或存坏了就当没置顶，不影响书架
      });
    return () => {
      alive = false;
    };
  }, []);

  // 启动时把限时表读回来（同样是界面自己的状态，存 gui_settings）
  useEffect(() => {
    let alive = true;
    readDeadlines()
      .then((map) => {
        if (alive) setDeadlines(map);
      })
      .catch(() => {
        // 读不到就当"没有限时书"：不该影响书架
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 到期检查：把到期的限时书就地封印。
   *
   * **自己每秒跳一下**（时钟已经拆成独立组件了，不能指望它带着整面书架重渲染）：
   * 跨过 0 点那一刻自然命中；进页面时先立刻查一次，免得要等到下一秒。
   * 同一时刻只封一本（`sealing`），处理过的 id 记在 `sealedIds` 里，等书架刷新。
   */
  useEffect(() => {
    // 内核不可用 / 正在封印：这一轮不查（下一个 tick 还会再来）
    if (props.error || sealing) return;
    const check = () => {
      const due = expiredBooks(props.books, deadlines, new Date()).find(
        (book) => !sealedIds.current.has(book.id),
      );
      if (!due) return;
      // 先记下来：书还没从 props.books 里消失，下一秒不该重复触发
      sealedIds.current.add(due.id);
      void sealExpired(due);
    };
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, [props.books, props.error, deadlines, sealing]);

  /** 置顶 / 取消置顶：排在书架最前，并写回 gui_settings（下次启动还在）。 */
  function togglePin(book: BookRow) {
    const next = pinned.includes(book.id)
      ? pinned.filter((id) => id !== book.id)
      : [...pinned, book.id];
    setPinned(next);
    void setGuiSetting(PINNED_KEY, JSON.stringify(next)).catch(() => {
      // 写不进去只是下次启动丢一次置顶，不值得打断用户
    });
  }

  /** 标记已读 / 未读（走内核的 finish，和终端看到的是同一份状态）。 */
  async function toggleFinished(book: BookRow) {
    setWorking(true);
    setActionError("");
    try {
      await setFinished(book.id, !book.finished);
      // 让外层重新同步，finished 会跟着更新
      props.onSync();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setWorking(false);
    }
  }

  /** 删除这本书（内核摘掉记录，并删掉转换后的正文）。 */
  async function deleteBook(book: BookRow) {
    setWorking(true);
    setActionError("");
    try {
      await removeBook(book.id);
      setDialog(null);
      props.onSync();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setWorking(false);
    }
  }

  /**
   * 改一本书的书名 / 作者 / 标签（走内核 `set_meta`，与书架上看到的书名是同一份）。
   *
   * 标签还参与内核的模糊搜索，所以成功后必须重同步书架 —— 只改内存里那一行会让
   * 搜索与卡片对不上。失败时把错误原样抛回弹窗（由它自己显示），这里不写页脚。
   */
  async function saveMeta(
    book: BookRow,
    meta: { title: string; author: string; tags: string[] },
  ) {
    await setBookMeta(book.id, meta);
    setDialog(null);
    props.onSync();
  }

  /** 设定 / 取消一本书的限时（写回 `gui_settings`；*day* 传空就是取消）。 */
  async function saveLimit(book: BookRow, day: string) {
    setWorking(true);
    setActionError("");
    try {
      const next: DeadlineMap = { ...deadlines };
      if (day) next[book.id] = day;
      else delete next[book.id];
      // 先改内存：书脊上的 ⏳ 与到期判定立刻跟上
      setDeadlines(next);
      await writeDeadlines(next);
      setDialog(null);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setWorking(false);
    }
  }

  /**
   * 这本书的书脊在屏幕上的位置。
   *
   * 封印动画要在**原位**播，而书一旦被内核摘掉，这个节点就没了 —— 所以必须在调用
   * 之前量下来。找不到（这本书正好翻在别的屏上，或书架刚被刷新掉）就回 null：
   * 动画跳过，封印照常。
   */
  function spineRect(bookId: string): SpineRect | null {
    const node = document.querySelector(`.spine-card[data-book-id="${bookId}"]`);
    if (!(node instanceof HTMLElement)) return null;
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  /**
   * 封印一本到期的限时书：打包 → 内核摘记录 → 原位消散 → 轻提示。
   *
   * 顺序与壳层一致（见 `src-tauri/src/lib.rs` 的 `archive_seal`）：先写 zip，再让
   * 内核摘掉记录。任何一步失败都只是"这本书没被封印"，不会丢数据。
   */
  async function sealExpired(book: BookRow) {
    // 动画的落点要在书架刷新之前量下来
    const rect = spineRect(book.id);
    setSealing(book.id);
    setActionError("");
    try {
      const dueAt = deadlines[book.id] ?? "";
      await sealBook(book.id, dueAt, coreStamp(new Date()));
      // 书脊原位散成光点（每本书的动画就在它自己那一格）
      if (rect) setSealEffect({ rect, title: book.title || book.id });
      setToast(SEAL_TOAST_TEXT);
      // 这本的限时到此结束（找回之后要重新设）
      const next: DeadlineMap = { ...deadlines };
      delete next[book.id];
      setDeadlines(next);
      await writeDeadlines(next);
      // 让外层重新同步：这本书从内核书单里消失，书架就少一格
      props.onSync();
    } catch (err) {
      // 没封成：把它从"已处理"里放出来，下一个 tick 还会再试
      sealedIds.current.delete(book.id);
      setActionError(`封印《${book.title || book.id}》失败：${String(err)}`);
    } finally {
      setSealing("");
    }
  }

  /**
   * 书架上的先后：**存过的顺序优先**，内核新加的书（这次才导入的）接在后面
   * （`mergeOrder` 顺便把已经不在了的书剔掉）。
   */
  const order = useMemo(
    () => mergeOrder(props.books.map((book) => book.id), layout.order),
    [props.books, layout.order],
  );

  /** 按 id 找书 —— 顺序表只认 id。 */
  const booksById = useMemo(
    () => new Map(props.books.map((book) => [book.id, book])),
    [props.books],
  );

  // 置顶的排最前；其余保持上面那份顺序（Array#sort 是稳定的）
  const ordered = useMemo(() => {
    const list = order
      .map((id) => booksById.get(id))
      .filter((book): book is BookRow => book !== undefined);
    if (pinned.length === 0) return list;
    const rank = new Map(pinned.map((id, index) => [id, index]));
    return [...list].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [order, booksById, pinned]);

  // 搜索只在本地书目上过滤（书名 / 作者），不调后端
  const keyword = term.trim().toLowerCase();
  // 管理模式下不按搜索过滤：拖拽落点算出来的「第几本」必须与整架的顺序对得上
  // （搜索遮罩本来就盖住书脊、拖不起来，这一条只是把该前提写死）
  const filtering = searchOpen && keyword.length > 0 && !managing;
  const visible = filtering
    ? ordered.filter(
        (book) =>
          (book.title || "").toLowerCase().includes(keyword) ||
          (book.author || "").toLowerCase().includes(keyword),
      )
    : ordered;

  /** 取消搜索（Esc / 点遮罩空白 / 再点放大镜）：收起遮罩，恢复完整书架。 */
  function cancelSearch() {
    setSearchOpen(false);
    setTerm("");
    setPage(0);
  }

  /* ── 批量编辑（管理模式的「选择」子状态） ──────────────────────────────── */

  /**
   * 勾上 / 取消勾一本书。
   *
   * `useCallback` 且不依赖任何 state：书脊卡片包了 `memo`，这个回调要一路稳定地传进
   * 一屏几十张卡片，否则每勾一本都会让整架重算（与 `openBook` / `openMenu` 同一条理由）。
   */
  const toggleSelect = useCallback((book: BookRow) => {
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }, []);

  /** 进 / 出「批量编辑」；出去（返回排序 / 完成）时把勾选与提示都清掉。 */
  function toggleSelecting() {
    const next = !selecting;
    setSelecting(next);
    // 进批量编辑时把「方向键选中的那一件」放开：这一层的方向键要留给翻屏，
    // 免得手上还挂着一件东西、方向键却被另一样东西占着（两个状态不该叠着用）
    if (next) setPicked(null);
    if (!next) {
      setSelected(new Set());
      setBatchNotice("");
    }
  }

  /** 全选：管理模式下不按搜索过滤，所以「全选」就是整架。 */
  function selectAll() {
    setSelected(new Set(ordered.map((book) => book.id)));
  }

  /** 清空选择。 */
  function clearSelection() {
    setSelected(new Set());
  }

  /** 这一份选择对应的书（按书架顺序；已经不在架上的自动忽略）。 */
  const selectedBooks = useMemo(
    () => ordered.filter((book) => selected.has(book.id)),
    [ordered, selected],
  );

  /**
   * 批量删除：一本一条地走内核 `remove`（内核一次只吃一本）。
   *
   * 与导入同一套写法：**每本开始前先把进度写出去**（删文件 + 改索引都要时间），
   * 中途某一本失败就继续做下去、把失败的记下来 —— 已删的不会回滚，也不该假装没发生。
   */
  async function batchDelete() {
    const books = selectedBooks;
    setWorking(true);
    setActionError("");
    setBatchNotice("");
    let done = 0;
    const failed: string[] = [];
    for (const [index, book] of books.entries()) {
      setBatchNotice(`正在删除第 ${index + 1}/${books.length} 本：${book.title || book.id}`);
      try {
        await removeBook(book.id);
        done += 1;
      } catch (err) {
        failed.push(`${book.title || book.id}（${String(err)}）`);
      }
    }
    setDialog(null);
    setWorking(false);
    setSelected(new Set());
    setBatchNotice(
      `已删除 ${done} 本` +
        (failed.length > 0 ? ` · 失败 ${failed.length} 本：${failed.join("、")}` : ""),
    );
    props.onSync();
  }

  /** 批量标记已读 / 未读（内核 `finish`；阅读进度与时长一概不动）。 */
  async function batchMarkFinished(finished: boolean) {
    const books = selectedBooks;
    setWorking(true);
    setActionError("");
    setBatchNotice("");
    let done = 0;
    const failed: string[] = [];
    for (const [index, book] of books.entries()) {
      setBatchNotice(
        `正在标记第 ${index + 1}/${books.length} 本：${book.title || book.id}`,
      );
      try {
        await setFinished(book.id, finished);
        done += 1;
      } catch (err) {
        failed.push(`${book.title || book.id}（${String(err)}）`);
      }
    }
    setWorking(false);
    setSelected(new Set());
    setBatchNotice(
      `已标记${finished ? "已读" : "未读"} ${done} 本` +
        (failed.length > 0 ? ` · 失败 ${failed.length} 本：${failed.join("、")}` : ""),
    );
    props.onSync();
  }

  /**
   * 批量改书名（内核 `set_meta`；作者与标签原样带回去）。
   *
   * 新书名由 `lib/shelfManage.ts` 的纯函数算（`renamedTitle`）—— 每本原名不同，只能一本一条地交；
   * 规则把书名改空的那几本跳过并记下来（内核也会拒绝空书名，不白跑一趟）。只有书名会变，
   * 正文、进度与阅读时长一概不碰（这也是 `set_meta` 的语义）。
   */
  async function batchRename(rule: ManageRename) {
    if (!renameTouched(rule)) return;
    const books = selectedBooks;
    setWorking(true);
    setActionError("");
    setBatchNotice("");
    let done = 0;
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const [index, book] of books.entries()) {
      setBatchNotice(`正在改名第 ${index + 1}/${books.length} 本：${book.title || book.id}`);
      const title = renamedTitle(book.title || book.id, rule).trim();
      if (!title) {
        skipped.push(book.title || book.id);
        continue;
      }
      try {
        await setBookMeta(book.id, { title, author: book.author, tags: book.tags ?? [] });
        done += 1;
      } catch (err) {
        failed.push(`${book.title || book.id}（${String(err)}）`);
      }
    }
    setDialog(null);
    setWorking(false);
    setSelected(new Set());
    setBatchNotice(
      `已改名 ${done} 本` +
        (skipped.length > 0 ? ` · 跳过（书名为空）${skipped.length} 本` : "") +
        (failed.length > 0 ? ` · 失败 ${failed.length} 本：${failed.join("、")}` : ""),
    );
    props.onSync();
  }

  /** 回车确认：收起搜索，命中的书脊高亮 HIGHLIGHT_MS 后自动落掉。 */
  function confirmSearch() {
    // 没输关键词就等于什么都没搜：直接收起（不然会把整架书都点亮）
    if (!keyword) {
      cancelSearch();
      return;
    }
    // 先把命中的 id 记下来，再收起搜索（收起后 visible 会变回全部书）
    const ids = visible.map((book) => book.id);
    setSearchOpen(false);
    setTerm("");
    setPage(0);
    setHighlightIds(ids);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightIds([]);
      highlightTimer.current = null;
    }, HIGHLIGHT_MS);
  }

  // 打开时自动聚焦输入框；卸载时清掉高亮计时器
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  /**
   * 量书排宽度 → 一排放得下几本（书脊厚薄不一，得按实际宽度一本本累加，见 `packShelfRows`）。
   *
   * 量的是第一条书排的 `<ul>`：它就是 `.shelf` 本身，宽度即这一排可用的宽度。
   * 用 `useLayoutEffect`（画之前量完并重排，不会闪一下），窗口变化交给 `ResizeObserver`。
   */
  useLayoutEffect(() => {
    const el = rackRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      // rem → px 要按当前根字号换算（用户可能把界面字号调过）
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setRackSize({ width: el.clientWidth, root });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * 书脊厚度模式（动态 / 统一等宽）读一次。
   *
   * 它存在本机 `gui_settings`（内核不认识它，与「置顶」同一个做法）。在设置页改完回到书架时，
   * 书架是**重新挂载**的（设置页是另一个整页），所以开书读一次就够，不用订阅变化。
   */
  useEffect(() => {
    let alive = true;
    getGuiSetting(SPINE_MODE_KEY)
      .then((raw) => {
        if (alive) setSpineMode(normalizeSpineMode(raw));
      })
      .catch(() => {
        // 读不到就按默认的「动态」，不影响书架
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 「导入后放不放飞行动画」也读一次（同一个做法：只存本机 `gui_settings`）。
   *
   * 设置页改完回到书架时书架是**重新挂载**的，所以开书读一次就够，不用订阅变化。
   */
  useEffect(() => {
    let alive = true;
    getGuiSetting(IMPORT_FLIGHT_KEY)
      .then((raw) => {
        if (alive) setImportFlight(normalizeImportFlight(raw));
      })
      .catch(() => {
        // 读不到就按默认的「放」，不影响导入
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 「＋」按一下该弹什么，问壳层一次（`import_picker_modes`）。
   *
   * macOS 的系统面板文件与文件夹同框 → `["panel"]`，一按就开面板；Windows / Linux 的系统
   * 对话框只能二选一 → `["files","folder"]`，先弹一个小菜单问一句（见 ImportPickMenu）。
   * **不在浏览器里跑时这个命令不存在**（比如 SSR 冒烟）：那就保持初值 `["panel"]`，
   * 也就是「按了直接开面板」这条最老的路。
   */
  useEffect(() => {
    let alive = true;
    importPickerModes()
      .then((modes) => {
        // 只认「一组非空字符串」；别的（undefined / 空数组 / 不是数组）都当没问过
        if (alive && Array.isArray(modes) && modes.length > 0) setPickerModes(modes);
      })
      .catch(() => {
        // 问不到就用默认那一档，不影响导入
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 管理模式的布局读一次：**优先问内核**（`shelf_layout`，存在书库里，
   * 跟着书库走），老内核 / 内核没起来就回落到本机 `gui_settings` 的老键 —— 两边都是
   * 归一化过的同一份形状，所以只多记一个 `home`（见 `lib/shelfManage.ts` 的 `readLayout`）。
   *
   * 读回来之后还要过一次 `mergeOrder`：存过的顺序里可能有已经不在了的书（删掉 /
   * 封印掉的），而内核新加的书得接在后面 —— 这些都在渲染时按 id 并，不在这里改。
   */
  useEffect(() => {
    let alive = true;
    readLayout()
      .then(({ layout: savedLayout, home }) => {
        if (!alive) return;
        setLayout(savedLayout);
        // 记下它存在哪儿：后面每一次写回都要写回原处（内核对内核、本机对本机）
        setLayoutHome(home);
      })
      .catch(() => {
        // readLayout 自己兜过底了：真到这儿也只是布局空着，不影响书架
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 每本书的书脊厚度（rem）—— 与「可见书目」同序：动态按字数算，统一模式一律保底。 */
  const spineWidths = useMemo(
    () => visible.map((book) => (spineMode === "dynamic" ? spineWidthRem(book.total_words) : SPINE_MIN_REM)),
    [visible, spineMode],
  );

  /** 书架上这几本的 id（与「可见书目」同序）：拖拽落点、让位、跨屏翻页都按它算。 */
  const bookIds = useMemo(() => visible.map((book) => book.id), [visible]);

  /**
   * 分屏：**先按宽度把书排成排**（这一排摆不下就换排），再按「主屏一排 / 其余每屏三排」切屏。
   *
   * 所以「一屏多少本」不是常量 —— 书越厚，一屏摆得越少、页数跟着变（需求点名要按总宽度重算）。
   * 主屏第一排要先把藤条篮子那一格让出来，所以 `firstRowExtra` 给了一个保底厚度。
   */
  const pages = useMemo(() => {
    const root = rackSize.root > 0 ? rackSize.root : 16;
    const width = rackSize.width > 0 ? rackSize.width : ASSUMED_ROW_REM * root;
    // 主屏第一排头里坐着两只「不是书」的格子：藤条篮子（导入）与本子（笔记本）。
    // 它们不在 `spineWidths` 里，打包时得按同样的厚度 + 缝让出来，不然书会挤出木板。
    const extras = (SPINE_MIN_REM * 2 + SPINE_GAP_REM * 2) * root;
    return planShelfPages(
      packShelfRows(
        spineWidths.map((rem) => rem * root),
        width,
        SPINE_GAP_REM * root,
        extras,
      ),
    );
  }, [spineWidths, rackSize]);

  const totalPages = pages.length;
  const current = Math.min(page, totalPages - 1);
  /** 这一屏的几排：主屏一排、其余三排（末尾不足已补空排，排高与挡板数都不跳） */
  const rows = pages[current];

  /**
   * 每本书落在第几屏 —— 跨屏飞行动画要用（翻到第一本新书那一屏，其余朝对应方向飞出画外）。
   *
   * 算的是**分屏结果本身**（`pages` + `bookIds`），不碰 DOM：所以刚导入还没画上去的书也
   * 算得出来（`spineRect` 那种量法对它们是空的）。
   */
  const pageOfBook = useMemo(() => {
    const map = new Map<string, number>();
    pages.forEach((pageRows, index) => {
      for (const row of pageRows) {
        for (const at of row) {
          const id = bookIds[at];
          if (id) map.set(id, index);
        }
      }
    });
    return map;
  }, [pages, bookIds]);

  // 查表要走 ref：`pageOf` 会被 ImportFlight 放进 effect 依赖里，必须是稳定引用
  const pageOfBookRef = useRef(pageOfBook);
  pageOfBookRef.current = pageOfBook;
  const pageOf = useCallback((bookId: string) => pageOfBookRef.current.get(bookId) ?? 0, []);

  // ── 管理模式的拖拽 ────────────────────────────────────────────────────────
  // 指针落点的判定全靠下面这份量出来的坐标；它只在「拖起来 / 翻屏 / 布局变了」时重量
  const slotRows = useRef<
    { row: number; y: number; height: number; cells: { slot: number; x: number; width: number }[] }[]
  >([]);
  // 毛绒玩具那一格的位置：拖书经过它时兔子要跳起来拦
  const toyBox = useRef<SpineRect | null>(null);
  // 翻屏动画的计时器（拖拽中每翻一屏重设一次）
  const flipTimer = useRef<number | null>(null);

  /**
   * 量下这一屏每一格的位置。
   *
   * 量的是 DOM（`.shelf-rack.books[data-row]` 里的 `[data-slot]`）：书脊厚薄不一、
   * 排几本还是打包器算出来的，只有 DOM 知道真实位置。**不在指针每动一下时量** ——
   * 那是每帧一次强制重排，几十张卡片会把拖动拖卡（与阅读页光点「不每帧渲染」同理）。
   */
  function measureSlots() {
    const boxes: typeof slotRows.current = [];
    for (const rack of Array.from(
      document.querySelectorAll<HTMLElement>(".shelf-rack.books[data-row]"),
    )) {
      const box = rack.getBoundingClientRect();
      const cells = Array.from(rack.querySelectorAll<HTMLElement>("[data-slot]"))
        .map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { slot: Number(cell.dataset.slot ?? -1), x: rect.x, width: rect.width };
        })
        .sort((a, b) => a.x - b.x);
      boxes.push({ row: Number(rack.dataset.row ?? 0), y: box.y, height: box.height, cells });
    }
    boxes.sort((a, b) => a.row - b.row);
    slotRows.current = boxes;

    const toy = document.querySelector(".decor-item.toy-item");
    if (toy instanceof HTMLElement) {
      const rect = toy.getBoundingClientRect();
      toyBox.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } else {
      toyBox.current = null;
    }
  }

  // 拖拽中：屏号 / 布局 / 格子一变就重量一次（翻屏之后每一格都换了位置）
  useLayoutEffect(() => {
    if (!managing || !dragging) return;
    measureSlots();
    window.addEventListener("resize", measureSlots);
    return () => window.removeEventListener("resize", measureSlots);
  }, [managing, dragging, current, bookIds, flip]);

  /** 落点 → 「格子序列」里的缝下标（拖书用）。 */
  function gapIndexOf(hit: ManageHit): number {
    const row = rows[hit.row] ?? [];
    if (row.length === 0) return 0;
    // 排尾那个缝 = 这一排最后一格之后
    return hit.gap < row.length ? row[hit.gap] : row[row.length - 1] + 1;
  }

  /**
   * 指针落在哪一格的缝上（拖拽时每动一下问一次）。
   *
   * 竖直方向留 24px 余量（拖到书排上下沿之外一点也算落在这一排），水平方向由
   * `gapInRow` 按每格的中点分左右半边。**落空回 null** —— 松手落在那儿就等于取消。
   */
  function hitAt(x: number, y: number): ManageHit | null {
    const near = slotRows.current;
    if (near.length === 0) return null;
    const slack = 24;
    const row = near.find((box) => y >= box.y - slack && y <= box.y + box.height + slack);
    if (!row) return null;
    const gap = gapInRow(row.cells, x);
    const last = row.cells[row.cells.length - 1];
    // 缝画在「第 gap 格的左边缘」上；排尾那个缝画在最后一格的右边缘
    const edge = gap < row.cells.length ? row.cells[gap].x : (last?.x ?? 0) + (last?.width ?? 0);
    const toy = toyBox.current;
    const overToy =
      !!toy && x >= toy.x && x <= toy.x + toy.width && y >= toy.y && y <= toy.y + toy.height;
    return { page: current, row: row.row, gap, x: edge, y: row.y, height: row.height, overToy };
  }

  // `grabBook` 要当 props 交进 `memo` 的书脊卡片（必须是稳定引用，否则每次重渲染
  // 都会让几十张卡片白重算），所以它读的最新状态走这个 ref
  const manageRef = useRef({ managing, selecting, ids: bookIds });
  manageRef.current = { managing, selecting, ids: bookIds };

  /**
   * 按住一根书脊：备一个「可能要拖」的手势。
   *
   * 移动**超过 `DRAG_THRESHOLD_PX`** 才算真的拖起来 —— 手指抖一下、或只是想点一下，
   * 都不该把书挪走。真的拖起来之前先 `measureSlots()`：格子的坐标只有这时候量才准。
   */
  const armDrag = useCallback((item: ManageDrag, event: React.PointerEvent<HTMLElement>) => {
    // 选择模式：按下只准备勾选（拖动会让「点击勾选」抖一下就落空）
    if (!manageRef.current.managing || manageRef.current.selecting || event.button !== 0) return;
    const at = manageRef.current.ids.indexOf(item.id);
    if (at < 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    function arm(move: PointerEvent) {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD_PX) return;
      window.removeEventListener("pointermove", arm);
      measureSlots();
      setDragging({ item, at });
    }
    function forget() {
      window.removeEventListener("pointermove", arm);
    }
    window.addEventListener("pointermove", arm);
    // 抬手 / 指针事件被系统收走：这次拖作废
    window.addEventListener("pointerup", forget, { once: true });
    window.addEventListener("pointercancel", forget, { once: true });
  }, []);

  /** 按住一根书脊（书脊卡片是 `memo` 的，这个回调要稳定）。 */
  const grabBook = useCallback(
    (book: BookRow, event: React.PointerEvent<HTMLLIElement>) =>
      armDrag({ id: book.id, title: book.title || book.id }, event),
    [armDrag],
  );

  /* ── 方向键排序：点一下选中一本书，再用 ← ↑ → ↓ 一位一位地挪 ────────────── */

  /**
   * 点一下选中一本书：再点同一本 = 放开（`Esc` 也是放开）。
   *
   * 与拖拽并行不悖：拖是「直接搬过去」，选是「先拿在手上、再用方向键微调」——
   * 拖完也顺手选中（`BookSpine` 的 click 走这一条），接着按方向键就能挪。
   */
  function pickItem(bookId: string) {
    setPicked((now) => (now === bookId ? null : bookId));
  }

  // 书脊卡片是 `memo` 的：这个回调必须是**稳定引用**，读最新的函数走 ref
  const pickOps = useRef({ pick: pickItem });
  pickOps.current = { pick: pickItem };

  /** 点一下书脊：选中这一本（随后用方向键挪）。 */
  const pickBook = useCallback((book: BookRow) => pickOps.current.pick(book.id), []);

  /** 方向键挪一下选中的那一本：`← ↑` 往前一位、`→ ↓` 往后一位。 */
  function nudgePicked(step: -1 | 1) {
    if (!picked) return;
    const nextOrder = shiftBook(order, picked, step);
    // 挪不动（书已经在最前 / 最后）：`shiftBook` 原样还回来，这一下就当没发生（也不必写盘）
    if (nextOrder === order) return;
    const next: ManageLayout = { ...layout, order: nextOrder };
    // 挪完把屏跟着翻过去（见下面那个 effect）：盯着它挪，别挪到画外
    followPick.current = true;
    setLayout(next);
    void writeLayout(next, layoutHome).catch(() => {
      // 写不进去只是下次启动回到旧布局，不值得打断用户
    });
  }

  // 键盘那一层只订阅一次键盘：挪的动作走 ref 拿最新的闭包（与 `manageRef` 同一个理由）
  const nudgeRef = useRef(nudgePicked);
  nudgeRef.current = nudgePicked;

  /**
   * 松手：把拖着的那本书落到那个缝上。
   *
   * 落点 → 「格子序列」里的缝下标（`gapIndexOf`）→ `orderIndexAt`（抽掉这本之后算第几位）
   * → `moveBook` 重排。
   *
   * **落空**（拖到墙上 / 按了 Esc / 指针不在任何一排上）什么都不做：书回原位。
   */
  function dropDrag(hit: ManageHit | null) {
    const drag = dragging;
    setDragging(null);
    setHover(null);
    if (!drag || !hit) return;
    const gap = gapIndexOf(hit);
    const next: ManageLayout = {
      ...layout,
      order: moveBook(order, drag.item.id, orderIndexAt(bookIds, gap, drag.item.id)),
    };
    setLayout(next);
    void writeLayout(next, layoutHome).catch(() => {
      // 写不进去只是下次启动回到旧布局，不值得打断用户
    });
  }

  /** 右上角那把锤子：进 / 出管理模式（进出都把拖拽痕迹清干净）。 */
  function toggleManage() {
    const next = !managing;
    setManaging(next);
    // 退出管理模式时把「批量编辑」与「方向键选中的那一件」两个子状态一起收掉：
    // 下次进来是干净的排序态
    if (!next) {
      setSelecting(false);
      setSelected(new Set());
      setBatchNotice("");
    }
    setPicked(null);
    setDragging(null);
    setHover(null);
    setFlip(null);
  }

  /**
   * 管理模式的开 / 关往外报一声（`App.tsx` 记着它）：去统计页看一眼再回来还是整理模式 ——
   * 否则那一趟会把手里那把锤子弄丢（书房是从挂件页回来时重新挂载的）。
   */
  useEffect(() => {
    props.onManageChange?.(managing);
  }, [managing, props.onManageChange]);

  /**
   * 翻到指定那一屏并让书排播一下滑入动画 —— 拖拽翻屏与**导入飞行跨屏**都走它。
   *
   * 已经在那一屏 / 越界就什么都不做。`stamp` 只用来让同一方向的连续翻屏也重放动画。
   */
  function flipToPage(next: number) {
    if (next === current || next < 0 || next >= totalPages) return;
    setPage(next);
    setFlip({ dir: next > current ? 1 : -1, stamp: Date.now() });
    if (flipTimer.current !== null) window.clearTimeout(flipTimer.current);
    flipTimer.current = window.setTimeout(() => setFlip(null), SPRING_MS);
  }

  /**
   * 拖拽中翻屏：指针在边缘停留满 `EDGE_HOLD_MS`（或按 ← / →）**并重新计时**。
   * 已经在头 / 尾就什么都不做（`stepPage` 会回同一个屏号）。
   */
  function turnPageFromDrag(step: -1 | 1) {
    flipToPage(stepPage(current, totalPages, step));
  }

  // 卸下时别留下翻屏动画的计时器
  useEffect(
    () => () => {
      if (flipTimer.current !== null) window.clearTimeout(flipTimer.current);
    },
    [],
  );

  /** 落点旁边要被挤扁的那两本（`scaleX(0.8)`）；松手后由 CSS 的弹性曲线恢复。 */
  const squeezedIds = useMemo(() => {
    if (!managing || !dragging || !hover) return new Set<string>();
    return new Set(squeezeIds(bookIds, gapIndexOf(hover), dragging.item.id));
  }, [managing, dragging, hover, bookIds, rows]);

  /** 方向键选中的那一本叫什么（管理条上写出来）：书名。 */
  const pickedLabel = useMemo(
    () => (picked ? booksById.get(picked)?.title || picked : null),
    [picked, booksById],
  );

  /**
   * 方向键挪完「跟着挪过去」：那一本要是被挪出了这一屏，就翻到它那一屏。
   *
   * 分屏是 `pages` 算出来的，**挪完那一帧才有的算** —— 所以不是在按键那一下硬猜，而是
   * 记一个一次性的记号（`followPick`），渲染后接着做。
   */
  useLayoutEffect(() => {
    if (!followPick.current) return;
    followPick.current = false;
    if (!picked) return;
    const target = pageOfBook.get(picked);
    if (target !== undefined && target !== current) flipToPage(target);
    // `pages` 必须列在依赖里：分屏是它算出来的，挪完这一帧它变了这个 effect 才会跑
  }, [picked, pages, current, pageOfBook]);

  /**
   * 选中的那一本要是没了（书被删 / 被封印），把选中一并放开 ——
   * 否则方向键会一直指着一本已经不在架上的书。
   */
  useEffect(() => {
    if (picked && !booksById.has(picked)) setPicked(null);
  }, [picked, booksById]);

  /**
   * 界面里是不是正开着东西（搜索遮罩 / 开书过场 / 右键菜单 / 弹窗 / 换玩具的面板 / 拖着一本书）。
   *
   * 开着的时候方向键不翻屏：搜索框里要留左右键移动光标（`typing` 也挡一道），
   * 右键菜单是按指针位置浮着的 —— 翻屏会让它指着一本已经不在那儿的书；
   * 拖拽中 ← / → 归管理模式那一层管（`BookshelfManager` 自己也订阅键盘），
   * 两边都翻会一次跳两屏。
   */
  const overlayOpen = searchOpen || !!stage || !!menu || !!dialog || toyPicker || !!dragging;

  /**
   * 键盘快捷键：`Esc` 取消搜索，`⌘K` / `/` 唤起搜索，**`←` / `→` 翻屏**，
   * 单键 **`M` 管理模式 / `S` 统计 / `A` 成就 / `G` 设置**（键位表在 `lib/shortcuts.ts`；
   * 正在输入框里打字、或界面正开着东西时不抢）。
   *
   * 管理模式下点中了一件东西（`picked`）时，方向键先归它：`←` `↑` 往前一位、`→` `↓`
   * 往后一位（书架是横着排的，上下与左右同义）、`Esc` 放开 —— **没点中东西时 `←` / `→`
   * 仍然是翻屏**（老手感不变，`↑` / `↓` 本来就不翻屏）。
   *
   * 翻屏与两侧那对 `‹ ›` 走的是同一条路（`stepPage`）—— 键盘和鼠标在同一屏上不会打架。
   * 已经在第一屏 / 最后一屏时**什么都不做、也不 `preventDefault`**，按键留给系统。
   *
   * 这个 effect 必须排在分屏算完之后：它要用到 `totalPages` 与 `current`。
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // 过场动画播放中：键盘只归过场用（Esc 在那里是"返回书架"），这里一概不响应
      if (stage) {
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        cancelSearch();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        // 沉浸模式里搜索也收起来：只留整理书架这一件事
        if (props.immersive) return;
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      // 单键快捷键：M 管理模式 / S 统计 / A 成就 / G 设置（输入框里打字时、界面开着东西时不抢）
      const shortcut = shortcutFrom(event);
      if (shortcut && !typing && !overlayOpen) {
        // 沉浸模式里只有 `M`（管理模式）还算数；S / A / G 一概不响应
        if (shortcut !== "manage" && props.immersive) return;
        event.preventDefault();
        if (shortcut === "manage") toggleManage();
        else if (shortcut === "stats") props.onOpenStats();
        else if (shortcut === "achievements") props.onOpenAchievements();
        else props.onOpenDesk();
        return;
      }
      // 排序中点了中一件东西：方向键先归它 —— ← ↑ 往前一位、→ ↓ 往后一位，Esc 放开
      // （书架是横着排的，上下与左右同义；输入框里打字的 ↑ ↓ 还留给输入框）
      if (managing && picked && !typing && !overlayOpen) {
        const nudge = nudgeStep(event.key);
        if (nudge) {
          event.preventDefault();
          nudgeRef.current(nudge);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setPicked(null);
          return;
        }
      }
      // ← / →：翻屏（与两侧那对 ‹ › 同一条路）；已经在头 / 尾就什么都不做，也别吞掉按键
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !typing && !overlayOpen) {
        const next = stepPage(current, totalPages, event.key === "ArrowRight" ? 1 : -1);
        if (next !== current) {
          event.preventDefault();
          setPage(next);
        }
        return;
      }
      if (event.key === "/" && !typing && !searchOpen) {
        // 沉浸模式里 `/` 也不再唤出搜索
        if (props.immersive) return;
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // 一变就重新订阅，闭包才是新的：searchOpen / stage / overlayOpen 管「界面开着什么」，
    // totalPages / current 管翻屏该往哪儿翻，managing 管 M 那把锤子是开还是关，
    // picked 管方向键是「挪东西」还是「翻屏」，immersive 管 S / A / G 与搜索还认不认
    // （cancelSearch 只用三个 setState，不会过期，不必列；nudgePicked 走 nudgeRef）
  }, [overlayOpen, searchOpen, stage, totalPages, current, managing, picked, props.immersive]);

  /** 指针进入窗口左右两侧的窄带就亮出翻页箭头，回到中间就收起来。 */
  function trackPointer(event: React.MouseEvent) {
    const width = window.innerWidth;
    const zone = Math.min(150, width * 0.16);
    if (event.clientX <= zone) setEdge("left");
    else if (event.clientX >= width - zone) setEdge("right");
    else setEdge("");
  }

  /**
   * 藤条篮子：让系统文件浏览器挑电子书 —— 可以点一个文件、多选几个，或者直接选文件夹，
   * 然后把每个路径交给内核 `import`（内核一次吃一个文件或目录）。
   *
   * `mode` 只在 Windows / Linux 上有意义：那边先弹一个小菜单问「文件还是文件夹」，挑完才
   * 走到这里（macOS 一按就开面板，壳层会把 `mode` 忽略掉）。它顺手把那个小菜单收掉 ——
   * 点完某一项它就该没了。
   */
  async function doImport(mode: ImportPickMode = "files") {
    // 沉浸模式：导入也停用（它不属于「整理书架」）
    if (props.immersive) return;
    setPickAnchor(null);
    setImporting(true);
    setImportNotice("");
    setImportError("");
    try {
      const paths = await pickImportPaths(mode);
      // 用户点了取消：什么都不做
      if (paths.length === 0) {
        return;
      }
      // 起飞点要在导入**之前**量下来：导完书架会重排（新书插在篮子右边、篮子自己的位置也可能挪），
      // 那时再量就不是用户刚才点的那只篮子了
      const box = basketRef.current?.getBoundingClientRect() ?? null;
      const origin: SpineRect | null = box
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : null;
      // 这一批之前有哪些书：导完拿它比出「刚进来的那几本」（书 id 是正文哈希，稳定）
      const before = new Set(props.books.map((book) => book.id));
      // 多选/多目录时逐个导入，再把回执合并成一行。
      // 一个文件夹里可能几十本（内核一次吃一个路径），转换 + 建索引都要时间，
      // 所以**每个路径开始前先把进度写出去**：用户看得见它在动，而不是以为卡死了。
      let scanned = 0;
      let added = 0;
      let duplicates = 0;
      let failed = 0;
      const unlocked: string[] = [];
      for (const [index, path] of paths.entries()) {
        const name = path.split(/[/\\]/).pop() ?? path;
        setImportNotice(
          paths.length > 1
            ? `正在导入第 ${index + 1}/${paths.length} 个：${name}`
            : `正在导入：${name}`,
        );
        const result = await importBooks(path);
        scanned += result.scanned;
        added += result.imported.length;
        duplicates += result.duplicates.length;
        failed += result.failed.length;
        unlocked.push(...result.unlocked.map((item) => item.name));
      }
      setImportNotice(
        `扫描 ${scanned} 个 · 新增 ${added} 本` +
          (duplicates > 0 ? ` · 重复跳过 ${duplicates}` : "") +
          (failed > 0 ? ` · 失败 ${failed}` : "") +
          (unlocked.length > 0 ? ` · 🏆 ${unlocked.join("、")}` : ""),
      );
      // 书架上多书了，让外层重新同步 —— 顺便把刷新后的书单拿回来：
      // 飞行动画要知道这几本新书各自落在哪一格（见 components/ImportFlight.tsx）
      const fresh = await props.onSync();
      const arrived = fresh.filter((book) => !before.has(book.id));
      // 新书按内核给的顺序接在最后（`mergeOrder` 会在渲染时把它们并进 `order`）
      // 量到了篮子、开关也开着、并且这回真的多了书 —— 才放这一场
      if (importFlight && origin && arrived.length > 0) {
        setFlight({ books: arrived, origin });
      }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  }

  /**
   * 后台问壳层要这本书的封面：有本地封面图就用图，有缓存过的方案就用缓存，
   * 都没有就把这次算出来的方案写进 `app_data_dir/covers/<id>.json` 备下次用。
   * 整个过程出错都不影响过场继续放 —— 封面只是锦上添花。
   *
   * `useCallback` 是因为 `openBook` 要用它，而 `openBook` 又是书脊卡片的 props
   * （卡片包了 `memo`，回调得是稳定引用才不白重算）。
   */
  const resolveCover = useCallback(async (book: BookRow, fallback: CoverSpec) => {
    try {
      const info = await bookCover(book.id, book.file_path);
      const cached = parseCoverSpec(info.spec);
      if (!cached) {
        void saveCoverSpec(book.id, JSON.stringify(fallback)).catch(() => undefined);
      }
      const spec = cached ?? fallback;
      // 只更新"还在翻同一本"的那一次，别把之后的状态覆盖掉
      setStage((now) => (now && now.book.id === book.id ? { ...now, spec, image: info.image } : now));
    } catch {
      // 问不到就用本地生成的那套，不影响看书
    }
  }, []);

  /**
   * 点开一本书：**读过的直接续读，没读过的先放一遍「抽书 → 翻封面」的过场**。
   *
   * 续读的判据就是"内核里有没有进度"：`current_line > 0` 或 `last_read` 有值 ——
   * 一行 if 判完，不去猜"这是不是第一次打开"。
   */
  const openBook = useCallback(
    (book: BookRow, origin: SpineRect) => {
      // 沉浸模式：书打不开（要退出就点墙上那枚「沉浸」贴纸）
      if (props.immersive) return;
      // 续读（有进度）就直接进阅读页，不看过场 —— 一行判完
      if (hasProgress(book)) {
        props.onOpen(book);
        return;
      }
      // 首次打开：方案（配色 + 中央那两个字）是本地算出来的、零延迟，先把过场放起来
      const spec = generatedCover(book.title);
      setStage({ book, spec, image: null, origin });
      // 同时去壳层问一句有没有真封面图 / 上次缓存的方案（不挡动画）
      void resolveCover(book, spec);
    },
    [props.onOpen, props.immersive, resolveCover],
  );

  /** 右键 / 长按弹出的菜单：回调要稳定（见 `BookSpine` 的 `memo`）。 */
  const openMenu = useCallback(
    (book: BookRow, x: number, y: number) => {
      // 沉浸模式：右键菜单里全是「另一页 / 选项」，一概不弹
      if (props.immersive) return;
      setMenu({ book, x, y });
    },
    [props.immersive],
  );

  /**
   * 跳到第 N 屏（输入框里是 1-based；越界夹回范围，清空或非数字就不动）。
   *
   * 只在书超过 `JUMP_MIN_PAGES` 屏时才出现 —— 三屏以内用两侧箭头点两下就到了。
   */
  function jumpToPage(event: React.FormEvent) {
    event.preventDefault();
    const n = Number.parseInt(jumpText, 10);
    if (!Number.isFinite(n)) return;
    setPage(Math.max(0, Math.min(totalPages - 1, n - 1)));
    setJumpText("");
  }

  /**
   * 「跳到第几屏」那个小表单：**书超过 `JUMP_MIN_PAGES` 屏才用得上**。
   *
   * 同一个表单挂在两处（主屏挂在墙上那一栏的右端、其余屏挂在右上角浮层里），所以做成变量 ——
   * 别做成组件：写在 render 里的组件每次渲染都是新类型，输入框会被重挂、打字打到一半就丢焦点。
   */
  const jumpForm =
    totalPages >= JUMP_MIN_PAGES ? (
      <form className="page-jump" onSubmit={jumpToPage}>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpText}
          // 空着就把当前屏号当占位
          placeholder={String(current + 1)}
          aria-label="跳到第几屏"
          title={`跳到第几屏：1–${totalPages}，回车（或点「跳转」）`}
          onChange={(event) => setJumpText(event.currentTarget.value)}
        />
        <span className="jump-total">/ {totalPages} 屏</span>
        <button type="submit" className="jump-go" title="跳到这一屏">
          跳转
        </button>
      </form>
    ) : null;

  return (
    <main
      // main = 主屏（书房全景：窗 + 挂件栏 + 摆件栏 + 一排书）；shelves = 第二屏起（整面书架，只有书）
      className={`container study ${sky}${current === 0 ? " main" : " shelves"}${
        managing ? " manage" : ""
      }${selecting ? " select-mode" : ""}${props.immersive ? " immersive" : ""}`}
      onMouseMove={trackPointer}
      onMouseLeave={() => setEdge("")}
    >
      {/* 墙上那扇窗：天色跟着系统时间走 —— 白天浅蓝 + 淡云，夜里深紫 + 月牙。
          两层天空叠着交叉淡入，所以换天色是渐变的；纯 CSS，没有图片。 */}
      <div className="study-window" aria-hidden="true">
        <span className="sky sky-day" />
        <span className="sky sky-night" />
        <span className="cloud c1" />
        <span className="cloud c2" />
        <span className="moon" />
        <span className="star s1" />
        <span className="star s2" />
        <span className="star s3" />
        {/* 窗格：一竖一横把玻璃分成四格 */}
        <span className="window-bar v" />
        <span className="window-bar h" />
      </div>

      {/* 墙上那一栏：四枚便利贴（统计 / 成就 / 设置 / 沉浸）、数字时钟、右上角那排小圆钮。
          便利贴的文案是生活化的（「日记」「勋章」「调一调」「沉浸」），真名与快捷键写在悬停提示里；
          沉浸模式下前三枚灰掉，只有「沉浸」自己与整理书架还能用。
          长什么样、怎么拖、怎么撕下 / 贴回全在 `components/StickyNoteNav.tsx` */}
      <div className="study-wall">
        <StickyNoteNav
          notes={[
            {
              id: "stats",
              text: "日记",
              realName: "统计",
              shortcut: "stats",
              onClick: props.onOpenStats,
              disabled: props.immersive,
            },
            {
              id: "achievements",
              text: "勋章",
              realName: "成就",
              shortcut: "achievements",
              onClick: props.onOpenAchievements,
              disabled: props.immersive,
            },
            {
              id: "settings",
              text: "调一调",
              realName: "设置与数据",
              shortcut: "settings",
              onClick: props.onOpenDesk,
              disabled: props.immersive,
            },
            {
              id: "immersive",
              text: "沉浸",
              realName: props.immersive
                ? "沉浸模式已开启：只能整理书架，点一下退出"
                : "沉浸模式：只留下书架，书和设置都点不开（还能整理书架）",
              // 它不打开另一页：点一下立刻切换，贴纸留在墙上（见 `StickyNoteNav` 的 `toggle`）
              toggle: true,
              active: props.immersive,
              onClick: props.onToggleImmersive,
            },
          ]}
        />
        {/* 数字时钟：和三枚便利贴并排的一格，纯展示、不可点（秒针只在它自己身上跳） */}
        <Clock />
        {/* 书超过三屏时，墙上右上角再挂一个「跳到第几屏」（贴在同步那些小圆钮左边）；
            只在主屏挂 —— 别的屏整栏都收着，那一份由右上角的浮层给 */}
        {current === 0 ? jumpForm : null}
        {/* 右上角工具栏：管理模式（锤子）/ 重新同步 / 清空缓存 / 放大镜（搜索打开时变成关闭的 ✕） */}
        <div className="study-tools">
          <button
            type="button"
            className={`icon-button manage-toggle${managing ? " active" : ""}`}
            title={
              managing
                ? `完成（退出管理模式，布局已经存好了 · 快捷键 ${shortcutKey("manage")}）`
                : `管理模式：拖着书排序、点一下选中再用方向键挪（快捷键 ${shortcutKey("manage")}）`
            }
            aria-pressed={managing}
            onClick={toggleManage}
          >
            🔨
          </button>
          <button
            type="button"
            className="icon-button"
            title={
              props.immersive
                ? "沉浸模式：重新同步先不做"
                : props.busy
                  ? "同步中…"
                  : "重新同步"
            }
            onClick={props.onSync}
            disabled={props.busy || props.immersive}
          >
            ⟳
          </button>
          <button
            type="button"
            className="icon-button"
            title={
              props.immersive
                ? "沉浸模式：清缓存先不做"
                : "清空本地缓存（下次启动会从内核重建）"
            }
            onClick={props.onReset}
            disabled={props.busy || props.immersive}
          >
            ♻
          </button>
          <button
            type="button"
            className={`icon-button search-toggle${searchOpen ? " active" : ""}`}
            title={
              props.immersive
                ? "沉浸模式：搜索先收起来"
                : searchOpen
                  ? "关闭搜索（Esc）"
                  : "搜索（/ 或 ⌘K）"
            }
            onClick={() => (searchOpen ? cancelSearch() : setSearchOpen(true))}
            disabled={props.immersive}
          >
            {searchOpen ? "✕" : "🔍"}
          </button>
        </div>
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}

      {/* 藤条篮子导入的回执：新增 / 重复 / 失败 / 新解锁的成就 */}
      {importNotice ? <p className="notice">{importNotice}</p> : null}
      {importError ? <p className="error">{importError}</p> : null}
      {/* 批量编辑的进度与回执（改书名 / 标记 / 删除都写这一行） */}
      {batchNotice ? <p className="notice">{batchNotice}</p> : null}
      {/* 右键菜单里的操作（删除 / 标记已读）出错时也走这里 */}
      {actionError ? <p className="error">{actionError}</p> : null}

      {/* 上层架子：放装饰（一叠黑胶 / 留声机 / 收音机 / 毛绒玩具 / 台灯）；只有玩具能点 */}
      <section className="shelf-rack decor">
        <ul className="decor-shelf">
          {/* 黑胶唱片：五张侧着摞成一叠，斜靠在**右边**那台留声机木箱的左脸上。
              它排在留声机**前面**（DOM 顺序 = 画的顺序），所以留声机的木箱正好压住
              最里面那张的顶端 —— 「倚」而不是「挨」（样式见 App.css 的 .vinyl） */}
          <li className="decor-item vinyl" title="黑胶唱片 ×5（以后会加入音频播放）">
            <span className="v-disc" />
            <span className="v-disc" />
            <span className="v-disc" />
            <span className="v-disc" />
            <span className="v-disc" />
          </li>
          {/* 留声机：台阶式木箱（顶板上平躺着一张黑胶 + 一根弯脖子唱臂，右侧面一支摇柄）+
              从箱体左上角升起来、拐个弯再张开成花瓣口的一支大铜喇叭。
              零件顺序就是遮挡顺序，坐标全在 App.css 的 .g-* 一节里逐件量过。
              点一下机器 = 弹出曲目面板（开 / 关就在面板顶上，见上面的 `AmbientPicker`）；
              面板节点也挂在这一格里，打开时 `.gramo-open` 把整格抬高到书排之上 */}
          <li
            className={`decor-item gramophone${props.ambient.playing ? " playing" : ""}${
              gramoOpen ? " gramo-open" : ""
            }`}
            ref={gramoRef}
          >
            {/* 整台机器包在按钮里，按钮铺满格子 —— `.g-*` 那些 `left/bottom` 的坐标原点是
                最近的定位祖先，按钮用 `position: absolute; inset: 0`，原点与格子重合，
                所有零件一个坐标都不用动。 */}
            <button
              type="button"
              className="gramo-button"
              aria-label={gramophoneHint}
              aria-haspopup="true"
              aria-expanded={gramoOpen}
              title={gramophoneHint}
              onClick={() => setGramoOpen((open) => !open)}
              disabled={props.immersive}
            >
              <span className="g-foot" />
              <span className="g-foot" />
              <span className="g-plinth" />
              <span className="g-step" />
              <span className="g-base" />
              <span className="g-plaque" />
              <span className="g-top" />
              <span className="g-disc" />
              <span className="g-stud" />
              <span className="g-crank-shaft" />
              <span className="g-crank-arm" />
              <span className="g-crank-grip" />
              <span className="g-arm-stem" />
              <span className="g-arm-head" />
              <span className="g-arm-pivot" />
              <span className="g-collar" />
              <span className="g-collar-tab" />
              <span className="g-pipe" />
              <span className="g-collar-ring" />
              <span className="g-flare" />
              <span className="g-elbow" />
              <span className="g-ferrule" />
              <span className="g-mouth" />
            </button>
            {gramoOpen ? (
              <AmbientPicker
                on={props.ambient.on}
                mode={props.ambient.mode}
                playing={props.ambient.playing}
                current={props.ambient.current}
                onToggle={props.ambient.toggle}
                onSelect={(id) => {
                  props.ambient.selectTrack(id);
                  setGramoOpen(false);
                }}
                onAuto={() => {
                  props.ambient.selectAuto();
                  setGramoOpen(false);
                }}
              />
            ) : null}
          </li>
          {/* 收音机：圆角木壳 +（左）横百叶的喇叭格栅 +（右）表盘、四个铜旋钮 + 四只木脚。
             里面那几个小件（旋钮、小铭牌）的位置在 App.css 里按「第几个孩子」排 */}
          <li className="decor-item radio" title="收音机（以后会加入音频播放）">
            <span className="r-foot" />
            <span className="r-foot" />
            <span className="r-case" />
            <span className="r-face" />
            <span className="r-grille" />
            <span className="r-mark" />
            <span className="r-mark" />
            <span className="r-mark" />
            <span className="r-dial">
              <span className="r-hand" />
              <span className="r-hand" />
            </span>
            <span className="r-knob r-knob-big" />
            <span className="r-knob" />
            <span className="r-knob" />
            <span className="r-knob" />
            <span className="r-side-knob" />
          </li>
          {/* 毛绒玩具：**架子上可以同时摆几只**（兔子 / 猫头鹰 / 乌龟，每只各自由用户决定放不放）。
              点这一排玩具（一只也没摆时点那个「＋」空位）弹出面板调。
              摆法记在本机 localStorage（见 lib/toyPrefs），所以下次打开还是你摆的样子 */}
          <li
            // 管理模式：玩偶进入「看着你摆书」的状态（兔子抬头张望 / 乌龟缩头 / 猫头鹰左右张望，见 CSS）；
            // 拖着的书经过它头顶时，兔子会跳起来拦一下（需求：拖拽经过玩偶时兔子尝试跳跃拦截）
            className={`decor-item toy-item${managing ? " manage-look" : ""}${
              hover?.overToy ? " intercept" : ""
            }`}
            ref={toyRef}
          >
            {/* 摆着的几只并排站（CSS 里让相邻两只轻轻搭上一点，省地方也像挤在一起的玩具）；
                一只也没有时留一个虚线空位，不然这个入口就没了 */}
            <button
              type="button"
              className="toy-button"
              title={
                props.immersive
                  ? "沉浸模式：玩偶摆法先不调"
                  : placed.length
                    ? `毛绒玩具：${placed.map((item) => item.label).join("、")}（点一下收放）`
                    : "摆上毛绒玩具"
              }
              aria-expanded={toyPicker}
              onClick={() => setToyPicker((open) => !open)}
              disabled={props.immersive}
            >
              <span
                className="toy-row"
                // 相邻两只之间的间距（rem）—— 面板里那根滑杆一拉，这里跟着变（CSS 见 .toy-row .plush + .plush）
                style={{ "--toy-gap": `${toyGap}rem` } as CSSProperties}
              >
                {placed.map((item) => (
                  <Plush key={item.id} id={item.id} label={item.label} />
                ))}
                {placed.length === 0 ? (
                  <span className="toy-empty" aria-hidden="true">
                    ＋
                  </span>
                ) : null}
              </span>
            </button>
            {toyPicker ? (
              <ToyPicker
                toys={toys}
                gap={toyGap}
                placedCount={placed.length}
                onToggle={flipToy}
                onGap={applyToyGap}
              />
            ) : null}
          </li>
          {/* 台灯**摆在最右边**：白天是件摆设，天一黑自己亮起来，往架子下洒一小块暖光
              （CSS 里给了 `margin-left: auto`，剩下的空间全留在它左边 —— 所以它贴着这一排的右端） */}
          <li className="decor-item lamp" title="台灯（天黑自动点亮）">
            <span className="lamp-shade" />
            <span className="lamp-bulb" />
            <span className="lamp-stem" />
            <span className="lamp-base" />
          </li>
        </ul>
      </section>

      {/* 书排：主屏只有一排（头一格是藤条篮子），第二屏起三排；每排下面都垫一块白色挡板（CSS 的 ::after） */}
      {rows.map((row, index) => (
        <section
          className={`shelf-rack books${flip ? (flip.dir > 0 ? " turn-next" : " turn-prev") : ""}`}
          // 拖拽判定按它认「第几排」（见 measureSlots）
          data-row={managing ? index : undefined}
          key={index}
        >
          <ul
            // dynamic / uniform 决定每格是「按算出来的厚度」还是「等宽平分」（见 App.css）
            className={`shelf ${spineMode}${stage ? " transitioning" : ""}`}
            // 第一排量一次宽度就够（几排一样宽）：它决定一排放得下几本
            ref={index === 0 ? rackRef : undefined}
          >
            {/* 藤条篮子只摆在主屏第一排的头一格：篮子里插着一本书、几张残页探出来 ——
                它就是书房的入口（点它选文件导入），后面的屏是纯书架。
                它也占一格，宽度给保底那一档（--spine-w），与书脊共用同一套格子样式 */}
            {index === 0 && current === 0 ? (
              <li
                className="spine-card add-slot"
                style={{ "--spine-w": `${SPINE_MIN_REM}rem` } as CSSProperties}
              >
                <button
                  type="button"
                  className="add-book"
                  title={props.immersive ? "沉浸模式：导入先收起来（只留整理书架）" : "导入电子书"}
                  aria-label={
                    props.immersive
                      ? "沉浸模式不能导入电子书"
                      : importing
                        ? "正在导入电子书"
                        : "导入电子书"
                  }
                  onClick={() => {
                    // 沉浸模式：导入也停用（它不属于「整理书架」）
                    if (props.immersive) return;
                    // Windows / Linux：先问一句「文件还是文件夹」（那两个平台的原生对话框
                    // 不能同框多选，见 ImportPickMenu）；macOS 一按就开面板，与从前一样。
                    const box = basketRef.current?.getBoundingClientRect();
                    if (pickerModes.length > 1 && box) {
                      setPickAnchor({
                        left: box.left,
                        top: box.top,
                        right: box.right,
                        height: box.height,
                      });
                      return;
                    }
                    void doImport();
                  }}
                  disabled={importing || props.immersive}
                >
                  {/* 藤条篮子（纯装饰）：先在后沿挂上提手，再插进那本书与几张残页，
                      最后盖上篮身与收边 —— 后画的挡住先画的，看着才是「从篮口探出来」 */}
                  <span className="basket" aria-hidden="true" ref={basketRef}>
                    <span className="bk-handle" />
                    <span className="bk-book" />
                    <span className="bk-slip bk-slip-a" />
                    <span className="bk-slip bk-slip-b" />
                    <span className="bk-slip bk-slip-c" />
                    <span className="bk-body" />
                    <span className="bk-rim" />
                  </span>
                  {/* 这行小字平时藏着，鼠标移上去（或正在导入）才浮出来 —— 它其实是个按钮 */}
                  <span className="add-hint" aria-hidden="true">
                    {props.immersive ? "沉浸中不可导入" : importing ? "导入中…" : "导入电子书"}
                  </span>
                </button>
              </li>
            ) : null}
            {/* 笔记本：只摆主屏第一排（篮子旁边）。它不是书，不进内核的 list ——
                点开是 `views/Notebook.tsx`，所有书的划线 + 批注按书摊开。
                封面上的数字是「几条划线」，每次回书房重新读一次（见上面的 `notebookMarks`） */}
            {index === 0 && current === 0 ? (
              <li
                className="spine-card notebook-slot"
                style={{ "--spine-w": `${SPINE_MIN_REM}rem` } as CSSProperties}
              >
                <button
                  type="button"
                  className="notebook-book"
                  title={
                    props.immersive
                      ? "沉浸模式：笔记本先收起来（只留整理书架）"
                      : `笔记本：${notebookMarks} 条划线 / 批注`
                  }
                  aria-label={
                    props.immersive
                      ? "沉浸模式不能打开笔记本"
                      : `打开笔记本（${notebookMarks} 条划线）`
                  }
                  onClick={() => {
                    if (props.immersive) return;
                    props.onOpenNotebook?.();
                  }}
                  disabled={props.immersive}
                >
                  {/* 一本摊在架子上的册子：牛皮纸封面 + 左侧线圈 + 一张斜贴的标签。
                      全是 CSS 画的（见 notebook.css），不用图片 */}
                  <span className="nb-art" aria-hidden="true">
                    <span className="nb-rings" />
                    <span className="nb-cover">
                      <span className="nb-strap" />
                      <span className="nb-label">
                        <span className="nb-label-text">笔记本</span>
                        <span className="nb-label-count">
                          {notebookMarks > 0 ? `${notebookMarks} 条` : "空白"}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="notebook-hint" aria-hidden="true">
                    {props.immersive ? "沉浸中不可翻" : "翻开笔记本"}
                  </span>
                </button>
              </li>
            ) : null}
            {row.map((at) => {
              const book = visible[at];
              if (!book) return null;
              const width = spineWidths[at] ?? SPINE_MIN_REM;
              return (
                <BookSpine
                  key={book.id}
                  book={book}
                  width={width}
                  depth={spineDepth(width)}
                  // 书名用「标题（没有就退回 id，与书脊上写的那串一致）」算字号
                  titleFont={spineTitleFontRem(book.title || book.id)}
                  unknown={!(book.total_words > 0)}
                  onOpen={openBook}
                  onMenu={openMenu}
                  highlight={highlightIds.includes(book.id)}
                  pinned={pinned.includes(book.id)}
                  limited={deadlines[book.id] ?? null}
                  pulling={stage?.book.id === book.id}
                  // 管理模式：这一格的下标、压扁 / 留空的状态，以及「按下准备拖」
                  slot={at}
                  managing={managing}
                  squeezed={squeezedIds.has(book.id)}
                  emptied={dragging?.item.id === book.id}
                  onGrab={grabBook}
                  // 方向键排序选中的就是这一本
                  picked={picked === book.id}
                  onPick={pickBook}
                  // 批量编辑：书脊右上角出现勾选圈，点一下切换（这时不拖、不开书）
                  selecting={selecting}
                  selected={selected.has(book.id)}
                  onToggleSelect={toggleSelect}
                />
              );
            })}
          </ul>
        </section>
      ))}
      {props.books.length === 0 ? (
        <p className="dim empty-hint">
          {props.immersive
            ? "沉浸模式：导入先收起来了 —— 点墙上那枚「沉浸」贴纸退出后再导入。"
            : "书架是空的 —— 点书架左边那只藤条篮子导入电子书，或者点右上角的 ⟳ 重新同步。"}
        </p>
      ) : null}
      {props.books.length > 0 && visible.length === 0 ? (
        <p className="dim empty-hint">没有匹配「{term.trim()}」的书。</p>
      ) : null}

      {totalPages > 1 ? (
        <p className="dim page-info">
          第 {current + 1} / {totalPages} 屏 · 共 {visible.length} 本
        </p>
      ) : null}

      {/* 第二屏起右上角浮一枚「回到主屏」；跳屏输入框在有四屏以上时跟着它一起出现 */}
      {current > 0 ? (
        <div className="shelf-nav">
          <button
            type="button"
            className="home-button"
            title="回到主屏（窗 + 挂件 + 摆件 + 最上面那一排书）"
            onClick={() => setPage(0)}
          >
            ⌂ 回到主屏
          </button>
          {jumpForm}
        </div>
      ) : null}

      {/* 齿轮已挪到右上角、挂在成就旁边（见 .study-wall），这里不再有右下角胶囊 */}

      {/* 翻页箭头：书多于一屏时，指针贴到哪一侧就显示哪一侧（搜索时让位） */}
      {current > 0 && edge === "left" && !searchOpen ? (
        <button
          type="button"
          className="page-arrow left"
          title="上一屏（←）"
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
      ) : null}
      {current < totalPages - 1 && edge === "right" && !searchOpen ? (
        <button
          type="button"
          className="page-arrow right"
          title="下一屏（→）"
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>
      ) : null}

      {/* 管理模式那一层：管理条（完成 / 批量编辑 / 选中的那一本）+ 拖书的浮起卡片 + 落点指示线 +
          边缘停留 0.3s 的翻屏环。它只做交互，书的先后由 lib/shelfManage.ts 的纯函数算 */}
      {managing ? (
        <BookshelfManager
          drag={dragging ? dragging.item : null}
          hitAt={hitAt}
          onHover={setHover}
          onDrop={dropDrag}
          onTurn={turnPageFromDrag}
          page={{ current, total: totalPages }}
          // 布局存在哪儿（内核 / 本机）：管理条上会写出来，老内核时用户能看出区别
          home={layoutHome}
          onDone={toggleManage}
          // 方向键排序：点中了一本时管理条上写出来，并给一枚「取消选中」
          pickedLabel={pickedLabel}
          onClearPick={() => setPicked(null)}
          // 批量编辑（选择子状态）：勾几本 → 批量改书名 / 改阅读状态 / 删除
          selecting={selecting}
          selectedCount={selectedBooks.length}
          totalBooks={ordered.length}
          canEditMeta={canEditMeta}
          canFinish={canFinish}
          canRemove={canRemove}
          onToggleSelecting={toggleSelecting}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          // 两个有二次确认/表单的动作先开弹窗，真正的数据操作在下面的弹窗确认后才跑
          onBatchRename={() => setDialog({ kind: "batchRename" })}
          onMarkFinished={(finished) => void batchMarkFinished(finished)}
          onBatchDelete={() => setDialog({ kind: "batchDelete" })}
        />
      ) : null}

      {/* 搜索遮罩：铺满整个书架区域并把它模糊掉；输入框从顶部滑下 */}
      {searchOpen ? (
        <div className="search-overlay" onClick={cancelSearch}>
          {/* 点面板本身不算"点空白"，只有点遮罩才取消 */}
          <div className="search-panel" onClick={(event) => event.stopPropagation()}>
            <input
              ref={searchInput}
              className="search-input"
              value={term}
              onChange={(event) => {
                // 实时过滤：改关键词就回到第一屏
                setTerm(event.currentTarget.value);
                setPage(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmSearch();
                }
              }}
              placeholder="搜索书名 / 作者（回车确认，Esc 取消）"
              aria-label="搜索书名或作者"
            />
            <p className="search-count">
              {keyword ? `匹配 ${visible.length} 本` : "输入书名或作者，实时过滤书架"}
            </p>
          </div>
        </div>
      ) : null}

      {/* 右键菜单：位置由指针决定，超出窗口时自己夹回来 */}
      {menu ? (
        <BookContextMenu
          book={menu.book}
          x={menu.x}
          y={menu.y}
          pinned={pinned.includes(menu.book.id)}
          limit={deadlines[menu.book.id] ?? null}
          canFinish={canFinish}
          canRemove={canRemove}
          onClose={() => setMenu(null)}
          onContinue={() => {
            if (props.immersive) return;
            props.onOpen(menu.book);
          }}
          onStats={() => setDialog({ kind: "stats", book: menu.book })}
          onProps={() => setDialog({ kind: "props", book: menu.book })}
          onTogglePin={() => togglePin(menu.book)}
          onToggleFinished={() => void toggleFinished(menu.book)}
          onDelete={() => setDialog({ kind: "delete", book: menu.book })}
          onLimit={() => setDialog({ kind: "limit", book: menu.book })}
        />
      ) : null}

      {/* 阅读统计 / 属性 / 删除确认 / 限时模式 */}
      {dialog?.kind === "stats" ? (
        <BookStatsDialog book={dialog.book} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "props" ? (
        <BookPropsDialog
          book={dialog.book}
          canEdit={canEditMeta}
          onSave={(meta) => saveMeta(dialog.book, meta)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDeleteDialog
          message={`确定要把《${dialog.book.title || dialog.book.id}》移走吗？`}
          busy={working}
          onConfirm={() => void deleteBook(dialog.book)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "limit" ? (
        <LimitDialog
          book={dialog.book}
          current={deadlines[dialog.book.id] ?? null}
          today={localDay(new Date())}
          busy={working}
          onSave={(day) => void saveLimit(dialog.book, day)}
          onClear={() => void saveLimit(dialog.book, "")}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {/* 批量编辑的两个弹窗：预览用的样板取选中的第一本（改书名是「多条对多条」，没法逐本预览） */}
      {dialog?.kind === "batchRename" ? (
        <BatchRenameDialog
          count={selectedBooks.length}
          sample={
            selectedBooks.length > 0
              ? selectedBooks[0].title || selectedBooks[0].id
              : null
          }
          busy={working}
          onApply={(rule) => void batchRename(rule)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "batchDelete" ? (
        <ConfirmDeleteDialog
          title={`删除选中的 ${selectedBooks.length} 本`}
          message={`确定要把选中的 ${selectedBooks.length} 本书移走吗？`}
          note="删掉的只是书目与转换后的正文；阅读时长与成就会保留，但书架布局里的位置会一起消失。"
          busy={working}
          onConfirm={() => void batchDelete()}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {/* 点开一本书的过场：抽书 → 横转封面 → 停留 3 秒 → 翻页进阅读页。
          Esc 或「← 返回书架」会让封面飞回原位（阶段 5），翻完则交给阅读页。 */}
      {stage ? (
        <BookTransition
          book={stage.book}
          spec={stage.spec}
          image={stage.image}
          origin={stage.origin}
          // 跳进书页里的是**架子上摆着的第一只**（一只也没摆就用兔子 —— 它在封印提示里
          // 本来就是这本书的「藏家」，过场里露个脸不算冒犯）
          toy={<Plush id={placed[0]?.id ?? TOYS[0].id} />}
          onDone={() => {
            // 先把书记下来再清过场：清完 stage 就没了
            const opened = stage.book;
            setStage(null);
            // 沉浸模式里过场也不该把人送进阅读页（正常路径进不到这里，兜个底）
            if (!props.immersive) props.onOpen(opened);
          }}
          onCancel={() => setStage(null)}
        />
      ) : null}

      {/* 封印：书脊原位的光点飞散 + 一句轻提示（限时书到期时走这条路） */}
      {sealEffect ? (
        <SealDissolve
          rect={sealEffect.rect}
          title={sealEffect.title}
          onDone={() => setSealEffect(null)}
        />
      ) : null}
      {toast ? <SealToast text={toast} onDone={() => setToast("")} /> : null}

      {/* 「＋」在 Windows / Linux 上先弹的两项（那两地的原生对话框不能文件与文件夹同框）；
          macOS 一按就开面板，这一层永远不出现 */}
      {pickAnchor ? (
        <ImportPickMenu
          anchor={pickAnchor}
          onPick={(mode) => void doImport(mode)}
          onClose={() => setPickAnchor(null)}
        />
      ) : null}

      {/* 导入飞行动画：刚进来的书从藤条篮子一本本飞上架（节奏见 lib/importFlight.ts）。
          这一层只是给眼睛看的 —— 书在飞之前就已经在架上了，飞完就把自己摘掉 */}
      {flight ? (
        <ImportFlight
          books={flight.books}
          origin={flight.origin}
          resolveTarget={spineRect}
          // 跨屏飞行：这批书落在哪一屏、书架这会儿在第几屏、以及「请翻到那一屏」
          pageOf={pageOf}
          page={current}
          onTurn={flipToPage}
          onDone={() => setFlight(null)}
        />
      ) : null}
    </main>
  );
}

