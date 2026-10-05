import { useEffect, useMemo, useRef, useState } from "react";

import BookContextMenu, {
  BookPropsDialog,
  BookStatsDialog,
  ConfirmDeleteDialog,
  LimitDialog,
} from "../components/BookContextMenu";
import BookTransition, { type SpineRect } from "../components/BookTransition";
import { SEAL_TOAST_TEXT, SealDissolve, SealToast } from "../components/SealEffect";
import {
  bookCover,
  coreCapabilities,
  getGuiSetting,
  importBooks,
  pickImportPaths,
  removeBook,
  saveCoverSpec,
  sealBook,
  setFinished,
  setGuiSetting,
} from "../lib/core";
import { generatedCover, parseCoverSpec, type CoverSpec } from "../lib/coverGenerator";
import { expiredBooks, localDay, readDeadlines, writeDeadlines } from "../lib/deadlines";
import { coreStamp } from "../lib/format";
import type { BookRow, DeadlineMap } from "../lib/types";

/** 一屏放多少本书；超过一屏就用两侧的箭头翻屏，而不是滚动鼠标。 */
const PAGE_SIZE = 40;

/** 回车确认后，命中的书脊高亮多久（毫秒）。 */
const HIGHLIGHT_MS = 2000;

/** 置顶列表存在本机 gui_settings 里的键名（内核不认识"置顶"，这是界面自己的事）。 */
const PINNED_KEY = "shelf.pinned";

/** 书架上那只毛绒玩具的可选动物；选中的存在 localStorage（键名见 TOY_KEY）。
 *  emoji 不在这里 —— 造型是 CSS 画的（见 App.css 的 `.plush-<id>`），id 同时是 CSS 类名。 */
const TOYS: { id: string; label: string }[] = [
  { id: "rabbit", label: "兔子" },
  { id: "owl", label: "猫头鹰" },
  { id: "turtle", label: "乌龟" },
  { id: "dog", label: "小狗" },
  { id: "cat", label: "小猫" },
];

/** 选中的毛绒玩具存在浏览器自己的 localStorage 里（不碰内核数据）。 */
const TOY_KEY = "shelf_toy";

/** 读回上次选的玩具；没存过 / 存坏了 / 存了个不认识的 id 都回落到兔子。 */
function readToy(): string {
  // SSR 或非浏览器环境没有 localStorage：直接给默认值
  if (typeof window === "undefined" || !window.localStorage) {
    return TOYS[0].id;
  }
  try {
    const saved = window.localStorage.getItem(TOY_KEY);
    // 只认名单里的 id，免得被手改成不存在的动物
    return TOYS.some((toy) => toy.id === saved) ? String(saved) : TOYS[0].id;
  } catch {
    // 隐私模式等场景读 localStorage 会直接抛异常：一样回落
    return TOYS[0].id;
  }
}

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

/** 天亮 / 天黑的分界（按系统时间）：6 点天亮，18 点天黑。 */
const DAY_START = 6;
const NIGHT_START = 18;

/** 白天还是夜里。 */
type Sky = "day" | "night";

/** 看系统时间决定现在是白天还是夜里。 */
function skyOf(date: Date): Sky {
  const hour = date.getHours();
  return hour < DAY_START || hour >= NIGHT_START ? "night" : "day";
}

/**
 * 书房的天色：窗外的天空、整间屋子的明暗、台灯亮不亮，全都跟着它走。
 *
 * 半小时对一次表就够（天色是慢慢变的，不用每秒重算），返回的字符串直接当
 * `main` 上的类名用，CSS 里写 `.study.day` / `.study.night` 两套。
 */
function useSky(): Sky {
  const [sky, setSky] = useState<Sky>(() => skyOf(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setSky(skyOf(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return sky;
}

/** 墙上的挂件（日历 / 徽章盒 / 齿轮）：鼠标移上去会发出白色散光。 */
function Widget(props: {
  kind: string;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`widget ${props.kind}`}
      title={props.label}
      onClick={props.onClick}
    >
      <span className="widget-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="widget-label">{props.label}</span>
    </button>
  );
}

/**
 * 一只毛绒玩具的骨架：尾巴 → 身子（含浅色肚皮）→ 四肢 → 耳朵 → 头（缝线 + 点眼 + 鼻子）。
 *
 * 这里只摆结构，具体长什么样完全交给 CSS 的 `.plush-<id>`（见 App.css）——
 * 和留声机、收音机一样是纯 CSS 塑形，不用任何图片。
 * 传了 *label* 就是一张有名字的图（书架上的那只）；不传就当纯装饰（面板里的小图标）。
 */
function Plush(props: { id: string; label?: string }) {
  return (
    <span
      className={`plush plush-${props.id}`}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {/* 尾巴：从身子后面探出来 */}
      <span className="plush-tail" />
      {/* 身子 + 浅色肚皮（一眼看出"有身体"） */}
      <span className="plush-body">
        <span className="plush-belly" />
      </span>
      {/* 前爪（猫头鹰是翅膀、乌龟是前鳍） */}
      <span className="plush-arm l" />
      <span className="plush-arm r" />
      {/* 后脚（乌龟是后鳍） */}
      <span className="plush-leg l" />
      <span className="plush-leg r" />
      {/* 耳朵（乌龟没有耳朵，CSS 里藏掉） */}
      <span className="plush-ear l" />
      <span className="plush-ear r" />
      {/* 头：缝线、点眼、鼻子都在脸上 */}
      <span className="plush-head">
        <span className="plush-stitch" />
        <span className="plush-eye l" />
        <span className="plush-eye r" />
        <span className="plush-snout" />
      </span>
    </span>
  );
}

/**
 * 一格书：现在只剩书脊（阅读数据搬进了右键菜单的「阅读统计 / 属性」）。
 *
 * 右键、或触屏按住 550ms，都会通过 `onMenu` 把菜单弹在指针位置。
 */
function BookSpine(props: {
  book: BookRow;
  /** 点开这本书；顺带把书脊在屏幕上的位置交出去（过场要靠它飞回原位） */
  onOpen: (book: BookRow, origin: SpineRect) => void;
  onMenu: (book: BookRow, x: number, y: number) => void;
  highlight?: boolean;
  pinned?: boolean;
  /** 限时到期日（`YYYY-MM-DD`；null / 缺省 = 不是限时书）。只标一下，不显示倒计时 */
  limited?: string | null;
  /** 正在被"抽出来"（过场的第一阶段） */
  pulling?: boolean;
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
      className={`spine-card${props.highlight ? " highlight" : ""}${props.pinned ? " pinned" : ""}${
        props.pulling ? " pulling" : ""
      }`}
      onClick={(event) => {
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
        props.onMenu(book, event.clientX, event.clientY);
      }}
      onTouchStart={startPress}
      onTouchEnd={clearPress}
      onTouchMove={clearPress}
      onTouchCancel={clearPress}
    >
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
}

/**
 * 书房：整间屋子就是书架页。
 *
 * 书多了（超过一屏 PAGE_SIZE 本）不出现滚动条，而是靠指针靠近左右两侧时出现的翻页箭头
 * 切换下一屏；最上面一栏并排着日历（统计）、数字时钟、透明玻璃徽章盒（成就），
 * 右上角是同步 / 清缓存 / 放大镜，右下角是齿轮（设置与数据）。
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
  onSync: () => void;
  onReset: () => void;
  onOpenStats: () => void;
  onOpenAchievements: () => void;
  onOpenDesk: () => void;
}) {
  const now = useClock();
  // 白天 / 夜里：窗外的天色、屋子的明暗、台灯都按它切换
  const sky = useSky();
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
  // 「＋」导入：是否正在进行 + 最近一次回执（出错原文另放）
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");

  // 置顶的书（本机界面状态，存 gui_settings，不碰内核）
  const [pinned, setPinned] = useState<string[]>([]);
  // 右键菜单：弹出位置 + 目标书；null = 没打开
  const [menu, setMenu] = useState<{ book: BookRow; x: number; y: number } | null>(null);
  // 弹窗：阅读统计 / 属性 / 删除确认 / 限时模式
  const [dialog, setDialog] = useState<
    { kind: "stats" | "props" | "delete" | "limit"; book: BookRow } | null
  >(null);
  // 删除 / 标记进行中 + 出错原文
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  // 内核认不认 remove / finish（老内核没有这两个方法，右键菜单要按这个禁用）
  const [canRemove, setCanRemove] = useState(true);
  const [canFinish, setCanFinish] = useState(true);
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
      })
      .catch(() => {
        // 探测本身失败（内核还没起来等）就维持"支持"，不影响其它功能
      });
    return () => {
      alive = false;
    };
  }, []);

  // 毛绒玩具：当前选中的动物 + 切换面板是否打开（选择存在本机 localStorage）
  const [toy, setToy] = useState<string>(readToy);
  const [toyPicker, setToyPicker] = useState(false);
  const toyRef = useRef<HTMLLIElement | null>(null);

  /** 换一只玩具：立刻换上去并写回 localStorage。 */
  function chooseToy(id: string) {
    setToy(id);
    try {
      window.localStorage.setItem(TOY_KEY, id);
    } catch {
      // 存不进去只是下次启动回到默认，不值得打断用户
    }
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

  // 当前那一只（即使存的 id 已经不认识了也不会是 undefined）
  const activeToy = TOYS.find((item) => item.id === toy) ?? TOYS[0];

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
   * 书架上的时钟每秒都在跳（`useClock`），所以这里**不需要另设 0 点的定时器** ——
   * 每次重渲染都会重算一次"有没有书到期"，跨过 0 点那一刻自然就命中了。
   * 同一时刻只封一本（`sealing`），处理过的 id 记在 `sealedIds` 里，等书架刷新。
   */
  useEffect(() => {
    // 内核不可用 / 正在封印：等下一轮（时钟每秒都在跳，不怕错过）
    if (props.error || sealing) return;
    const due = expiredBooks(props.books, deadlines, now).find(
      (book) => !sealedIds.current.has(book.id),
    );
    if (!due) return;
    // 先记下来：书还没从 props.books 里消失，下一秒不该重复触发
    sealedIds.current.add(due.id);
    void sealExpired(due);
  }, [props.books, props.error, deadlines, now, sealing]);

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

  // 置顶的排最前；其余保持内核给的顺序（Array#sort 是稳定的）
  const ordered = useMemo(() => {
    if (pinned.length === 0) return props.books;
    const rank = new Map(pinned.map((id, index) => [id, index]));
    return [...props.books].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [props.books, pinned]);

  // 搜索只在本地书目上过滤（书名 / 作者），不调后端
  const keyword = term.trim().toLowerCase();
  const filtering = searchOpen && keyword.length > 0;
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

  // 键盘快捷键：Esc 取消，Cmd/Ctrl+K 或 "/" 唤起（正在输入框里打字时不抢）
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
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "/" && !typing && !searchOpen) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // searchOpen 一变就重新订阅，闭包里的 cancelSearch 才不会过期；stage 同理
  }, [searchOpen, stage]);

  // 分屏：一屏 PAGE_SIZE 本；总屏数至少是 1
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, totalPages - 1);
  const shown = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  /** 指针进入窗口左右两侧的窄带就亮出翻页箭头，回到中间就收起来。 */
  function trackPointer(event: React.MouseEvent) {
    const width = window.innerWidth;
    const zone = Math.min(150, width * 0.16);
    if (event.clientX <= zone) setEdge("left");
    else if (event.clientX >= width - zone) setEdge("right");
    else setEdge("");
  }

  /**
   * 「＋」：让系统文件浏览器挑电子书 —— 可以点一个文件、多选几个，或者直接选文件夹，
   * 然后把每个路径交给内核 `import`（内核一次吃一个文件或目录）。
   */
  async function doImport() {
    setImporting(true);
    setImportNotice("");
    setImportError("");
    try {
      const paths = await pickImportPaths();
      // 用户点了取消：什么都不做
      if (paths.length === 0) {
        return;
      }
      // 多选/多目录时逐个导入，再把回执合并成一行
      let scanned = 0;
      let added = 0;
      let duplicates = 0;
      let failed = 0;
      const unlocked: string[] = [];
      for (const path of paths) {
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
      // 书架上多书了，让外层重新同步
      props.onSync();
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
    }
  }

  /**
   * 点开一本书：**读过的直接续读，没读过的先放一遍「抽书 → 翻封面」的过场**。
   *
   * 续读的判据就是"内核里有没有进度"：`current_line > 0` 或 `last_read` 有值 ——
   * 一行 if 判完，不去猜"这是不是第一次打开"。
   */
  function openBook(book: BookRow, origin: SpineRect) {
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
  }

  /**
   * 后台问壳层要这本书的封面：有本地封面图就用图，有缓存过的方案就用缓存，
   * 都没有就把这次算出来的方案写进 `app_data_dir/covers/<id>.json` 备下次用。
   * 整个过程出错都不影响过场继续放 —— 封面只是锦上添花。
   */
  async function resolveCover(book: BookRow, fallback: CoverSpec) {
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
  }

  const clock = now.toLocaleTimeString("zh-CN", { hour12: false });
  const date = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <main
      className={`container study ${sky}`}
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

      {/* 墙上那一栏：日历（统计）、数字时钟、透明玻璃徽章盒（成就） */}
      <div className="study-wall">
        <Widget kind="calendar" icon="📅" label="统计" onClick={props.onOpenStats} />
        {/* 数字时钟：和左右两个挂件并排的一格，纯展示、不可点 */}
        <div className="widget clock" title="当前系统时间">
          <span className="clock-time">{clock}</span>
          <span className="clock-date">{date}</span>
        </div>
        <Widget
          kind="badge-box"
          icon="🏅"
          label="成就"
          onClick={props.onOpenAchievements}
        />
        {/* 齿轮：挂在成就旁边的小物件（无底色 / 边框 / 阴影），点它开设置面板 */}
        <button
          type="button"
          className="gear-token"
          title="设置与数据"
          onClick={props.onOpenDesk}
        >
          <svg className="gear-token-icon" viewBox="0 0 40 40" aria-hidden="true">
            <defs>
              {/* 黄铜渐变：上亮下暗，做出金属质感 */}
              <linearGradient id="brass-gear" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f2d18b" />
                <stop offset="0.55" stopColor="#c99a45" />
                <stop offset="1" stopColor="#8a5a24" />
              </linearGradient>
            </defs>
            {/* 8 个齿：把一个小方块绕圆心转一圈 */}
            {Array.from({ length: 8 }, (_, index) => (
              <rect
                key={index}
                x="17"
                y="0.5"
                width="6"
                height="8.5"
                rx="1.6"
                fill="url(#brass-gear)"
                transform={`rotate(${index * 45} 20 20)`}
              />
            ))}
            {/* 齿轮本体 */}
            <circle cx="20" cy="20" r="13" fill="url(#brass-gear)" />
            <circle
              cx="20"
              cy="20"
              r="13"
              fill="none"
              stroke="rgba(255, 240, 200, 0.4)"
              strokeWidth="1"
            />
            {/* 中心孔 */}
            <circle cx="20" cy="20" r="4.6" fill="#2a1c10" />
            <circle
              cx="20"
              cy="20"
              r="4.6"
              fill="none"
              stroke="rgba(255, 230, 180, 0.35)"
              strokeWidth="1"
            />
          </svg>
          <span className="gear-token-label">设置</span>
        </button>
        {/* 右上角工具栏：重新同步 / 清空缓存 / 放大镜（搜索打开时变成关闭的 ✕） */}
        <div className="study-tools">
          <button
            type="button"
            className="icon-button"
            title={props.busy ? "同步中…" : "重新同步"}
            onClick={props.onSync}
            disabled={props.busy}
          >
            ⟳
          </button>
          <button
            type="button"
            className="icon-button"
            title="清空本地缓存（下次启动会从内核重建）"
            onClick={props.onReset}
            disabled={props.busy}
          >
            ♻
          </button>
          <button
            type="button"
            className={`icon-button search-toggle${searchOpen ? " active" : ""}`}
            title={searchOpen ? "关闭搜索（Esc）" : "搜索（/ 或 ⌘K）"}
            onClick={() => (searchOpen ? cancelSearch() : setSearchOpen(true))}
          >
            {searchOpen ? "✕" : "🔍"}
          </button>
        </div>
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}

      {/* 「＋」导入的回执：新增 / 重复 / 失败 / 新解锁的成就 */}
      {importNotice ? <p className="notice">{importNotice}</p> : null}
      {importError ? <p className="error">{importError}</p> : null}
      {/* 右键菜单里的操作（删除 / 标记已读）出错时也走这里 */}
      {actionError ? <p className="error">{actionError}</p> : null}

      {/* 上层架子：放装饰（留声机 / 竖着的黑胶唱片 / 收音机 / 毛绒玩具）；只有玩具能点 */}
      <section className="shelf-rack decor">
        <ul className="decor-shelf">
          {/* 台灯：白天是件摆设，天一黑自己亮起来，往架子下洒一小块暖光 */}
          <li className="decor-item lamp" title="台灯（天黑自动点亮）">
            <span className="lamp-shade" />
            <span className="lamp-bulb" />
            <span className="lamp-stem" />
            <span className="lamp-base" />
          </li>
          <li className="decor-item gramophone" title="留声机（以后会加入音频播放）">
            <span className="g-horn" />
            <span className="g-arm" />
            <span className="g-base" />
          </li>
          <li className="decor-item vinyl" title="黑胶唱片（以后会加入音频播放）">
            <span className="v-label" />
            <span className="v-hole" />
          </li>
          <li className="decor-item radio" title="收音机（以后会加入音频播放）">
            <span className="r-grille" />
            <span className="r-knobs">
              <span className="r-knob" />
              <span className="r-knob" />
            </span>
          </li>
          {/* 毛绒玩具：点它弹出切换面板（5 种动物），选中的那个记在本机 localStorage */}
          <li className="decor-item toy-item" ref={toyRef}>
            <button
              type="button"
              className="toy-button"
              title={`毛绒玩具：${activeToy.label}（点一下换一只）`}
              aria-haspopup="menu"
              aria-expanded={toyPicker}
              onClick={() => setToyPicker((open) => !open)}
            >
              <Plush id={activeToy.id} label={activeToy.label} />
            </button>
            {toyPicker ? (
              <div className="toy-picker" role="menu" aria-label="换一只毛绒玩具">
                {TOYS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={`toy-choice${item.id === toy ? " active" : ""}`}
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => {
                      chooseToy(item.id);
                      setToyPicker(false);
                    }}
                  >
                    <Plush id={item.id} />
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        </ul>
      </section>

      {/* 下层架子：书都放在这一层，头一格是「＋」空书位 */}
      <section className="shelf-rack books">
        <ul className={`shelf${stage ? " transitioning" : ""}`}>
          <li className="spine-card add-slot">
            <button
              type="button"
              className="add-book"
              title="导入电子书"
              onClick={() => void doImport()}
              disabled={importing}
            >
              <span className="add-plus" aria-hidden="true">
                ＋
              </span>
              <span className="add-label">{importing ? "导入中…" : "导入"}</span>
            </button>
          </li>
          {shown.map((book) => (
            <BookSpine
              key={book.id}
              book={book}
              onOpen={openBook}
              onMenu={(target, x, y) => setMenu({ book: target, x, y })}
              highlight={highlightIds.includes(book.id)}
              pinned={pinned.includes(book.id)}
              limited={deadlines[book.id] ?? null}
              pulling={stage?.book.id === book.id}
            />
          ))}
        </ul>
      </section>

      {props.books.length === 0 ? (
        <p className="dim empty-hint">
          书架是空的 —— 点书架上的「＋」导入电子书，或者点右上角的 ⟳ 重新同步。
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

      {/* 齿轮已挪到右上角、挂在成就旁边（见 .study-wall），这里不再有右下角胶囊 */}

      {/* 翻页箭头：书多于一屏时，指针贴到哪一侧就显示哪一侧（搜索时让位） */}
      {current > 0 && edge === "left" && !searchOpen ? (
        <button
          type="button"
          className="page-arrow left"
          title="上一屏"
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
      ) : null}
      {current < totalPages - 1 && edge === "right" && !searchOpen ? (
        <button
          type="button"
          className="page-arrow right"
          title="下一屏"
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>
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
          onContinue={() => props.onOpen(menu.book)}
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
        <BookPropsDialog book={dialog.book} onClose={() => setDialog(null)} />
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
          today={localDay(now)}
          busy={working}
          onSave={(day) => void saveLimit(dialog.book, day)}
          onClear={() => void saveLimit(dialog.book, "")}
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
          toy={<Plush id={activeToy.id} />}
          onDone={() => {
            // 先把书记下来再清过场：清完 stage 就没了
            const opened = stage.book;
            setStage(null);
            props.onOpen(opened);
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
    </main>
  );
}

