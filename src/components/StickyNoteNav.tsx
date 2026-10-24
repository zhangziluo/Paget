import { useEffect, useRef, useState, type CSSProperties } from "react";

import { hashText } from "../lib/coverGenerator";
import { shortcutKey, type ShortcutId } from "../lib/shortcuts";

/**
 * 便利贴式功能入口：墙上那一栏里的四枚贴纸（统计 / 成就 / 设置 / 沉浸）。
 *
 * 一枚便利贴就是一格「能点的陈设」——它替掉了原来的日历挂件 / 徽章盒挂件 / 黄铜齿轮，
 * 位置仍在**主屏墙面上那一栏**（`.study-wall`，第二屏起整栏收起来，见 `App.css`）。
 *
 * 五件事都在这一个文件里说清楚：
 *
 * 1. **长什么样**：和纸纹理是**纯 CSS** 叠出来的（细纤维 + 一道水痕 + 斜向纸色），
 *    不用图片、也不引 web font —— 与书房里那些纯 CSS 塑形的物件（藤条篮子 / 留声机）
 *    同一条理由：离线应用，一个纹理资产也不想多。
 * 2. **颜色与倾斜「随机」**：四色（米黄 / 淡粉 / 淡绿 / 淡蓝）**顺着 id 列表循环发下去**，
 *    起点取自整张列表的哈希，-3°~+3° 的倾斜按各自 id 的哈希 —— 看着随机，但每次打开都一样
 *    （与封面配色、封印光点同一个做法：`hashText` 已经在 `lib/coverGenerator.ts` 里了，直接复用）。
 *    真随机会让每次重渲染都换一个模样，那是 bug 不是风味。
 * 3. **能拖**：拖动写的是 `transform` 偏移（不改版面），松手吸附（回到原位附近就吸回原位、
 *    否则吸到 8px 的格上），位置记在本机 `localStorage`（与「置顶」「玩具」同一套做法）。
 *    偏移量的上下限夹在窗口里，拖不出屏幕。
 * 4. **点一下**：撕下（向上飞出 + 转 15° + 淡出）之后才开面板 —— 面板一开 `Shelf` 就被
 *    `App.tsx` 卸下了，所以「贴回」要在挂载时补：上一次撕下的是哪一枚记在模块变量里
 *    （见 `lastTornId`），下次挂载时那一枚从上方飞回来。
 *    **`toggle` 那一枚（「沉浸」）例外**：它不打开另一页，只切换当前模式，所以点一下立刻
 *    切换、贴纸留在原地（否则「撕下」之后没有重新挂载，纸片会一直飞着不回来）。
 * 5. **沉浸模式下**：另外三枚带 `disabled`，灰掉、既不能点也不能拖；「沉浸」自己仍然能点
 *    （它是退出这个模式的唯一入口）。
 *
 * **连点 5 下**是彩蛋：翻到背面看一句随机的话。为了既能连点、又不让「点一下」变得迟钝，
 * 点一下先只是「被捏起来」（`.is-lifting`），`STREAK_MS` 之内没有后续点击才真的撕下去开面板；
 * 攒够 5 下就改成翻面，不开面板（`toggle` 那一枚不参与这个彩蛋）。
 */

/** 位置记在本机哪个键（按便利贴 id 分开存 `{ dx, dy }`）。 */
export const STICKY_POS_KEY = "paget.sticky-note.v1";

/** 22:00 之后边缘微微发黄（到次日 6:00 为止 —— 与窗外天色的判定同一口径）。 */
const LATE_START = 22;
const LATE_END = 6;

/** 四种纸色：米黄 / 淡粉 / 淡绿 / 淡蓝（具体色值在 `styles/sticky-note.css`）。 */
const COLORS = ["butter", "blush", "mint", "sky"] as const;
type NoteColor = (typeof COLORS)[number];

/** 拖动超过这么多像素才算「在拖」，否则当成点击（与书架排序同一把尺）。 */
const DRAG_PX = 4;

/** 松手时离原位不到这么多像素就吸回原位，否则吸到 `SNAP_GRID_PX` 的格上。 */
const SNAP_HOME_PX = 28;
const SNAP_GRID_PX = 8;

/** 两次点击挨得比这还近才算「连续点击」；正常点一下等这么久就撕下去开面板。 */
const STREAK_MS = 300;

/** 撕下那一下多久（毫秒）—— 与 CSS 的 `sticky-note-tear` 是一对；飞出去之后才开面板。 */
const TEAR_MS = 220;

/** 把贴纸拖出窗口之前留的边（px）。 */
const EDGE_KEEP_PX = 6;

/** 连点 5 下才翻面。 */
const FLIP_STREAK = 5;

/** 背面的随机句子（可配置；中文、一句一个意思，与书房那点玩笑话同一个调子）。 */
export const STICKY_FORTUNES: readonly string[] = [
  "今天也读到哪儿算哪儿",
  "书脊歪一点才像人摆的",
  "先喝口茶，再翻下一页",
  "这本我看过，忘了",
  "别催，兔子还在找路",
  "书架满了就换间屋子",
  "读到困了就是读到了",
  "慢慢来，字又不会跑",
];

/** 一枚便利贴。 */
export type StickyNote = {
  /** 稳定 id：也当 localStorage 的键后缀与「颜色 / 倾斜」的种子 */
  id: string;
  /** 生活化文案（可配置） */
  text: string;
  /** 它其实是哪一页（悬停提示里写出来，别让人猜） */
  realName: string;
  /** 快捷键 id（提示里带上「按 S」这类；「沉浸」没有快捷键，省略即可） */
  shortcut?: ShortcutId;
  /** 点它要做的事（撕下动画之后才调；`toggle` 那枚立刻调） */
  onClick: () => void;
  /**
   * 点一下是**切换一个模式**（「沉浸」），不是打开另一页。
   * 这种贴纸不撕下、不参与连点彩蛋 —— 书架不会因为它被卸下，纸片得留在原地。
   */
  toggle?: boolean;
  /** 这个模式正开着（贴纸点亮，`aria-pressed` 也报这一项） */
  active?: boolean;
  /** 沉浸模式下灰掉：点不动、也拖不动（「沉浸」自己不带这一项） */
  disabled?: boolean;
};

/** 一枚贴纸的偏移（相对它在墙上的原位）。 */
type NoteOffset = { dx: number; dy: number };
type OffsetMap = Record<string, NoteOffset>;

/** 面板一开 `Shelf` 会被卸下，所以「上一次撕下的是哪一枚」只能记在模块里。 */
let lastTornId: string | null = null;

/** 读回存过的偏移；SSR / 隐私模式 / 存坏了都回空表（= 都在原位）。 */
function readOffsets(): OffsetMap {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STICKY_POS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: OffsetMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const dx = typeof row.dx === "number" && Number.isFinite(row.dx) ? row.dx : 0;
      const dy = typeof row.dy === "number" && Number.isFinite(row.dy) ? row.dy : 0;
      out[id] = { dx, dy };
    }
    return out;
  } catch {
    // 读不动就当没存过：贴纸回到原位而已，不值得打断
    return {};
  }
}

/** 写回偏移（写不进去只是下次回到原位）。 */
function writeOffsets(map: OffsetMap) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STICKY_POS_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式等场景会直接抛异常：一样放过
  }
}

/**
 * 四色怎么分：**先按这一组 id 定一个起点，再顺着循环发下去** —— 四枚贴纸正好四色各一枚。
 * （每枚各自哈希会撞色：`stats` 与 `achievements` 都落在淡绿上，米黄一枚都没出现，试过。）
 * 起点来自 id 列表的哈希，所以同一组贴纸每次打开都分得一样。
 */
function colorsFor(ids: string[]): NoteColor[] {
  const start = hashText(ids.join("|")) % COLORS.length;
  return ids.map((_, index) => COLORS[(start + index) % COLORS.length]);
}

/** 这枚贴纸是哪一色、歪多少度 —— 分到的色照用，倾斜按 id 哈希（同一枚永远同一副样子）。 */
function lookOf(id: string, color: NoteColor): { color: NoteColor; tilt: number } {
  const seed = hashText(id);
  // -3° ~ +3°，按 0.5° 取整（13 档）
  const tilt = ((seed >>> 8) % 13) * 0.5 - 3;
  return { color, tilt };
}

/** 现在是不是「22:00 之后」（到次日 6:00 为止）。 */
function isLate(date: Date): boolean {
  const hour = date.getHours();
  return hour >= LATE_START || hour < LATE_END;
}

/** 22:00 到了就让边缘发黄：半分钟对一次表就够（与墙上天色同一个做法）。 */
function useLate(): boolean {
  const [late, setLate] = useState(() => isLate(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setLate(isLate(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return late;
}

/** 松手吸附：离原位够近就回原位，否则吸到格上。 */
function snapOffset(offset: NoteOffset): NoteOffset {
  if (Math.hypot(offset.dx, offset.dy) < SNAP_HOME_PX) return { dx: 0, dy: 0 };
  return {
    dx: Math.round(offset.dx / SNAP_GRID_PX) * SNAP_GRID_PX,
    dy: Math.round(offset.dy / SNAP_GRID_PX) * SNAP_GRID_PX,
  };
}

/** 夹在 [lo, hi]（lo > hi 时取 lo —— 窗口比贴纸还小的极端情况别翻负）。 */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), value));
}

export default function StickyNoteNav(props: { notes: StickyNote[] }) {
  const late = useLate();
  // 存过的位置读一次：首帧就摆在存过的地方，不留「先原位再跳过去」的闪
  const [offsets, setOffsets] = useState<OffsetMap>(readOffsets);
  // 正在拖的那一枚（每动一下写 style，不走版面）
  const [drag, setDrag] = useState<{ id: string; offset: NoteOffset } | null>(null);
  // 「被捏起来」的那一枚（等连点窗口过去才真的撕下去）
  const [liftingId, setLiftingId] = useState<string | null>(null);
  // 正在撕下（飞出）的那一枚
  const [tearingId, setTearingId] = useState<string | null>(null);
  // 翻到背面的那一枚 + 背面那句话
  const [flipped, setFlipped] = useState<{ id: string; text: string } | null>(null);

  // 上一枚被撕下的贴纸要「从上方飞回来」：面板一开这块书架就被卸下，回来时是重新挂载的，
  // 所以这一眼只能在挂载时补（render 里读一次，effect 里清掉；StrictMode 下读两遍也无妨）
  const backId = useRef(lastTornId).current;
  // pointerup 要用最新的落点：state 在那个监听器的闭包里会过期
  const dragRef = useRef<{ id: string; offset: NoteOffset } | null>(null);
  // 刚拖完紧跟的那次 click 要丢掉（不然一松手就把面板开了）
  const suppressClick = useRef(false);
  // 拖动期间挂在 window 上的那几个监听器：卸下时要摘掉
  // （一只手拖着、另一只手按了 `S` 去统计页 —— 这种事真会发生）
  const detachDrag = useRef<(() => void) | null>(null);
  // 连点计数：同一枚、两次间隔 ≤ `STREAK_MS`（计时器也放这儿，卸下时好清）
  const streak = useRef<{ id: string; count: number; at: number; timer: number | null }>({
    id: "",
    count: 0,
    at: 0,
    timer: null,
  });

  // 这一眼「贴回」补过了，记号清掉（**别**在卸下时清 —— 撕下那一下正是先记记号、再开面板）
  useEffect(() => {
    lastTornId = null;
  }, []);

  // 卸下时别留下连点 / 撕下的计时器与拖动期间的监听器
  useEffect(
    () => () => {
      if (streak.current.timer !== null) {
        window.clearTimeout(streak.current.timer);
        streak.current.timer = null;
      }
      detachDrag.current?.();
    },
    [],
  );

  /** 撕下：向上飞出 + 转 15° + 淡出，落地之后再开面板（面板滑入正好接上）。 */
  function tearOff(note: StickyNote) {
    setTearingId(note.id);
    // 先把「贴回」的记号留下：onClick 一开面板，这块书架就被卸下了
    lastTornId = note.id;
    streak.current.timer = window.setTimeout(() => {
      streak.current.timer = null;
      note.onClick();
    }, TEAR_MS);
  }

  /** 点一下：先「捏起来」，连点窗口过去才真撕下；攒够 5 下改成翻面。 */
  function clickNote(note: StickyNote) {
    // 沉浸模式里被灰掉的那几枚：按钮本身已经 disabled，这里再挡一道
    if (note.disabled) return;
    // 刚拖完的那一下不算点击
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // 背面朝上时点一下 = 翻回来（不再开面板）
    if (flipped?.id === note.id) {
      setFlipped(null);
      return;
    }
    // 「沉浸」这种开关：立刻切换，不撕下（书架不会重新挂载，纸片得留在原地）
    if (note.toggle) {
      // 刚点过另一枚、它还在「捏起来」等着撕下：这一下先把它取消 ——
      // 否则 300ms 后它照样飞走、去开那一页，可那时沉浸模式已经开了
      if (streak.current.timer !== null) {
        window.clearTimeout(streak.current.timer);
        streak.current.timer = null;
      }
      streak.current.count = 0;
      streak.current.id = "";
      setLiftingId(null);
      setTearingId(null);
      setFlipped(null);
      // 撕下那一下若已经起步（记号也留了），这趟没开成面板：把记号一并撤掉，
      // 免得下次回到书架时它莫名其妙从上面飞回来
      lastTornId = null;
      note.onClick();
      return;
    }
    const now = Date.now();
    const s = streak.current;
    if (s.id !== note.id || now - s.at > STREAK_MS) {
      s.id = note.id;
      s.count = 0;
    }
    s.count += 1;
    s.at = now;
    if (s.timer !== null) {
      window.clearTimeout(s.timer);
      s.timer = null;
    }

    if (s.count >= FLIP_STREAK) {
      // 彩蛋：翻到背面随口一句。这一下不算「点它进去」，面板不开
      s.count = 0;
      s.id = "";
      setLiftingId(null);
      setFlipped({
        id: note.id,
        text: STICKY_FORTUNES[Math.floor(Math.random() * STICKY_FORTUNES.length)],
      });
      return;
    }

    setLiftingId(note.id);
    s.timer = window.setTimeout(() => {
      s.timer = null;
      s.count = 0;
      s.id = "";
      setLiftingId(null);
      tearOff(note);
    }, STREAK_MS);
  }

  /** 按下：备一个「可能要拖」的手势（拖动写 transform，不动版面）。 */
  function startDrag(note: StickyNote, event: React.PointerEvent<HTMLButtonElement>) {
    if (note.disabled) return;
    if (event.button !== 0) return;
    // 新手势开始：上一次拖动留下的「丢掉这次 click」作废
    suppressClick.current = false;
    const box = event.currentTarget.getBoundingClientRect();
    const from = offsets[note.id] ?? { dx: 0, dy: 0 };
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;

    const move = (e: PointerEvent) => {
      const wantX = from.dx + (e.clientX - originX);
      const wantY = from.dy + (e.clientY - originY);
      if (!moved && Math.hypot(wantX - from.dx, wantY - from.dy) < DRAG_PX) return;
      moved = true;
      // 别拖出窗口：贴纸此刻的框 + 想走的偏移，夹回 0..innerWidth / innerHeight 里
      const offset = {
        dx: clamp(wantX, EDGE_KEEP_PX - box.left, window.innerWidth - box.right - EDGE_KEEP_PX),
        dy: clamp(wantY, EDGE_KEEP_PX - box.top, window.innerHeight - box.bottom - EDGE_KEEP_PX),
      };
      dragRef.current = { id: note.id, offset };
      setDrag({ id: note.id, offset });
    };

    /** 摘掉这次手势挂在 window 上的三个监听器。 */
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      detachDrag.current = null;
    };

    /** 收手势：*keep* 为假（指针事件被系统收走）= 这次拖动作废，贴纸回原来那一处。 */
    const finish = (keep: boolean) => {
      detach();
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      // 没拖动：这次手势就是一次点击，交给 click 那条路
      if (!moved || !live) return;
      // 拖完了：紧跟的那次 click 丢掉（有些指针实现压根不发 click，靠下一次 startDrag 清）
      suppressClick.current = true;
      if (!keep) return;
      // 松手吸附：离原位够近就贴回原位，否则吸到格上 —— 然后记在本机
      const at = snapOffset(live.offset);
      const next = { ...offsets, [note.id]: at };
      setOffsets(next);
      writeOffsets(next);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    detachDrag.current = detach;
  }

  // 四色按这一组 id 分（见 `colorsFor`）：四枚正好四色各一枚
  const colors = colorsFor(props.notes.map((note) => note.id));

  return (
    <div className="sticky-notes" role="group" aria-label="功能入口（便利贴）">
      {props.notes.map((note, index) => {
        const look = lookOf(note.id, colors[index]);
        const offset =
          drag?.id === note.id ? drag.offset : (offsets[note.id] ?? { dx: 0, dy: 0 });
        const flippedNow = flipped?.id === note.id;
        const shortcutHint = note.shortcut ? `（按 ${shortcutKey(note.shortcut)}）` : "";
        const classes = [
          "sticky-note",
          look.color,
          late ? "is-late" : "",
          drag?.id === note.id ? "is-dragging" : "",
          liftingId === note.id ? "is-lifting" : "",
          tearingId === note.id ? "is-tearing" : "",
          backId === note.id ? "is-returning" : "",
          flippedNow ? "is-flipped" : "",
          note.active ? "is-active" : "",
          note.disabled ? "is-disabled" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={note.id}
            type="button"
            className={classes}
            style={
              {
                "--note-dx": `${offset.dx}px`,
                "--note-dy": `${offset.dy}px`,
                "--note-tilt": `${look.tilt}deg`,
              } as CSSProperties
            }
            // 生活化文案在前、真名与快捷键在后：好看，但别让人猜「调一调」是干什么的
            title={`${note.text} —— ${note.realName}${shortcutHint}`}
            aria-label={`${note.text}：${note.realName}${shortcutHint}`}
            aria-pressed={note.toggle ? !!note.active : undefined}
            disabled={note.disabled}
            onPointerDown={(event) => startDrag(note, event)}
            onClick={() => clickNote(note)}
          >
            <span className="sticky-note-card">
              <span className="sticky-note-face front">
                <span className="sticky-note-text">{note.text}</span>
                <span className="sticky-note-curl" aria-hidden="true" />
              </span>
              <span className="sticky-note-face back">
                <span className="sticky-note-text">
                  {flipped?.id === note.id ? flipped.text : ""}
                </span>
                <span className="sticky-note-curl" aria-hidden="true" />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
