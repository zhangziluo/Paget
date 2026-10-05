import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { bookRecord } from "../lib/core";
import { addDays } from "../lib/deadlines";
import { duration, humanWords, shortStamp } from "../lib/format";
import type { BookRecord, BookRow } from "../lib/types";

/** 菜单里一条选项。 */
type Item = {
  key: string;
  icon: string;
  label: string;
  danger?: boolean;
  /** 当前内核不支持时禁用（鼠标悬停用 `hint` 说明原因） */
  disabled?: boolean;
  hint?: string;
  onSelect: () => void;
};

/** 内核不支持某个方法时，禁用的菜单项统一显示这句话。 */
const UNSUPPORTED_HINT = "当前内核版本不支持这个操作（需要较新的 werd 内核）";

/**
 * 书籍卡片的右键菜单（也用于触屏长按）。
 *
 * 位置用鼠标坐标，量出自身尺寸后再夹回窗口内，所以贴到右/下边缘时不会跑出屏幕。
 * 点菜单外的任何地方或按 Esc 都会关掉（由这里自己监听，父组件只管开关状态）。
 * 视觉是浅木色圆角卡片 + 柔和阴影，出现时淡入 + 轻微下落，和书房调性一致。
 */
export default function BookContextMenu(props: {
  book: BookRow;
  x: number;
  y: number;
  pinned: boolean;
  /** 这本书设着的限时到期日（`YYYY-MM-DD`；null = 没设） */
  limit: string | null;
  /** 内核认不认 `finish` / `remove`（启动时探出来，见 `lib/core.ts` 的 coreCapabilities） */
  canFinish: boolean;
  canRemove: boolean;
  onClose: () => void;
  onContinue: () => void;
  onStats: () => void;
  onProps: () => void;
  onTogglePin: () => void;
  onToggleFinished: () => void;
  onDelete: () => void;
  onLimit: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  // 最终落点：默认就是鼠标位置，量完尺寸后会被夹进窗口
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  // 布局完成、还没上屏时量尺寸并把位置收进窗口（左右上下各留 8px）
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(props.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(props.y, window.innerHeight - height - margin)),
    });
  }, [props.x, props.y]);

  // 点别处 / Esc 关闭
  useEffect(() => {
    const close = props.onClose;
    function onPointerDown(event: MouseEvent) {
      // 点在菜单里就不关（菜单项自己处理）
      if (box.current && event.target instanceof Node && box.current.contains(event.target)) {
        return;
      }
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  const items: Item[] = [
    { key: "continue", icon: "📖", label: "继续阅读", onSelect: props.onContinue },
    { key: "stats", icon: "📊", label: "阅读统计", onSelect: props.onStats },
    { key: "props", icon: "🔖", label: "属性", onSelect: props.onProps },
    {
      key: "pin",
      icon: "📌",
      label: props.pinned ? "取消置顶" : "置顶",
      onSelect: props.onTogglePin,
    },
    {
      key: "limit",
      icon: "⏳",
      // 设了限时就把到期日写在菜单上（到期那天 0 点，这本书会被收进归档）
      label: props.limit ? `限时模式（${props.limit}）` : "限时模式…",
      onSelect: props.onLimit,
    },
    {
      key: "finished",
      icon: props.book.finished ? "↩" : "✅",
      label: props.book.finished ? "标记未读" : "标记已读",
      // 老内核没有 finish 方法：禁用而不是点了报错
      disabled: !props.canFinish,
      hint: UNSUPPORTED_HINT,
      onSelect: props.onToggleFinished,
    },
    {
      key: "delete",
      icon: "🗑",
      label: "删除",
      danger: true,
      // 老内核没有单本 remove（只有 clear）：同样禁用
      disabled: !props.canRemove,
      hint: UNSUPPORTED_HINT,
      onSelect: props.onDelete,
    },
  ];

  return (
    <div ref={box} className="book-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`book-menu-item${item.danger ? " danger" : ""}`}
          disabled={item.disabled}
          title={item.disabled ? item.hint : undefined}
          onClick={() => {
            // 先收起菜单，再执行动作（弹窗也跟着菜单消失）
            props.onClose();
            item.onSelect();
          }}
        >
          <span className="book-menu-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="book-menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 一个居中的弹窗外壳（阅读统计 / 属性 / 删除确认共用）。 */
export function BookDialog(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Esc 也能关掉
  useEffect(() => {
    const close = props.onClose;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <div className="book-dialog-backdrop" onClick={props.onClose}>
      {/* 点弹窗本身不算"点外面" */}
      <div
        className="book-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="book-dialog-head">
          <h2>{props.title}</h2>
          <button type="button" className="icon-button" title="关闭" onClick={props.onClose}>
            ✕
          </button>
        </header>
        {props.children}
      </div>
    </div>
  );
}

/** 拉一次裸记录（导入日期、会话明细只有裸记录里才有）。 */
function useRecord(bookId: string): { record: BookRecord | null; error: string } {
  const [record, setRecord] = useState<BookRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    bookRecord(bookId)
      .then((loaded) => {
        if (alive) setRecord(loaded);
      })
      .catch((err) => {
        if (alive) setError(String(err));
      });
    return () => {
      alive = false;
    };
  }, [bookId]);
  return { record, error };
}

/** 阅读统计：总时长 / 当前进度 / 打卡天数（数 sessions 里不同的日期）。 */
export function BookStatsDialog(props: { book: BookRow; onClose: () => void }) {
  const { record, error } = useRecord(props.book.id);
  const sessions = record?.progress?.sessions ?? [];
  // 打卡天数 = 会话开始时间里的不同"日期"个数
  const days = new Set(
    sessions
      .map((entry) => String(entry.start || "").slice(0, 10))
      .filter((day) => day.length === 10),
  ).size;

  return (
    <BookDialog title={`阅读统计 · ${props.book.title || props.book.id}`} onClose={props.onClose}>
      {error ? <p className="error">{error}</p> : null}
      <dl className="book-facts">
        <div>
          <dt>总阅读时长</dt>
          <dd>{duration(props.book.total_time_seconds)}</dd>
        </div>
        <div>
          <dt>当前进度</dt>
          <dd>
            {props.book.percentage.toFixed(1)}% · 第 {props.book.current_line + 1}/
            {props.book.total_lines} 行
          </dd>
        </div>
        <div>
          <dt>打卡天数</dt>
          <dd>{record ? `${days} 天` : "…"}</dd>
        </div>
      </dl>
    </BookDialog>
  );
}

/** 属性：书名 / 作者 / 总字数 / 添加时间 / 最后阅读时间。 */
export function BookPropsDialog(props: { book: BookRow; onClose: () => void }) {
  const { record, error } = useRecord(props.book.id);
  return (
    <BookDialog title={`属性 · ${props.book.title || props.book.id}`} onClose={props.onClose}>
      {error ? <p className="error">{error}</p> : null}
      <dl className="book-facts">
        <div>
          <dt>书名</dt>
          <dd>{props.book.title || props.book.id}</dd>
        </div>
        <div>
          <dt>作者</dt>
          <dd>{props.book.author || "未知"}</dd>
        </div>
        <div>
          <dt>总字数</dt>
          <dd>{humanWords(props.book.total_words)}字</dd>
        </div>
        <div>
          <dt>添加时间</dt>
          <dd>{record?.import_date || "…"}</dd>
        </div>
        <div>
          <dt>最后阅读</dt>
          <dd>{props.book.last_read ? shortStamp(props.book.last_read) : "还没读过"}</dd>
        </div>
      </dl>
    </BookDialog>
  );
}

/** 删除这本书之前的二次确认。 */
export function ConfirmDeleteDialog(props: {
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BookDialog title="删除这本书" onClose={props.onClose}>
      <p className="book-dialog-message">{props.message}</p>
      <p className="dim">删掉的只是书目与转换后的正文；阅读时长与成就会保留。</p>
      <div className="book-dialog-actions">
        <button type="button" className="ghost" onClick={props.onClose} disabled={props.busy}>
          取消
        </button>
        <button type="button" className="danger" onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? "删除中…" : "删除"}
        </button>
      </div>
    </BookDialog>
  );
}

/** 限时的快捷档：从今天起 N 天。 */
const LIMIT_PRESETS: { days: number; label: string }[] = [
  { days: 1, label: "1 天后" },
  { days: 3, label: "3 天后" },
  { days: 7, label: "7 天后" },
  { days: 30, label: "30 天后" },
];

/**
 * 给一本书设「限时模式」：选一个到期日，那天 0 点这本书会被封印。
 *
 * 只用原生 `<input type="date">`，不引日期库；快捷档也走同一条 `addDays`（纯日期
 * 运算，见 `lib/deadlines.ts`），所以"3 天后"和手选那天的结果必然一致。
 */
export function LimitDialog(props: {
  book: BookRow;
  /** 现在设着的到期日（null = 没设） */
  current: string | null;
  /** 今天的本地日期（`YYYY-MM-DD`，由书架的时钟给） */
  today: string;
  busy: boolean;
  onSave: (day: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // 草稿：默认沿用当前值，没设过就空着（必须自己选一天才能保存）
  const [day, setDay] = useState(props.current ?? "");

  return (
    <BookDialog title={`限时模式 · ${props.book.title || props.book.id}`} onClose={props.onClose}>
      <p className="book-dialog-message">
        到期那天的 0 点，这本书会被打包收进归档目录 —— 文件不删，只是换个名字藏起来，
        书架上的位置会散成光点。
      </p>

      <div className="limit-chips">
        {LIMIT_PRESETS.map((preset) => {
          const target = addDays(props.today, preset.days);
          return (
            <button
              key={preset.days}
              type="button"
              className={`limit-chip${day && day === target ? " active" : ""}`}
              onClick={() => setDay(target)}
              disabled={!target}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <label className="limit-field">
        <span>到期日</span>
        <input
          type="date"
          value={day}
          min={props.today}
          onChange={(event) => setDay(event.currentTarget.value)}
        />
      </label>

      <p className="dim">
        想立刻看到效果，就把到期日选成今天：0 点已经过了，下一次检查就会封印它。
        之后在「设置与数据 → 已归档」里可以随时找回来，阅读进度不会丢。
      </p>

      <div className="book-dialog-actions">
        {props.current ? (
          <button type="button" className="ghost" onClick={props.onClear} disabled={props.busy}>
            取消限时
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={props.onClose} disabled={props.busy}>
          返回
        </button>
        <button type="button" onClick={() => props.onSave(day)} disabled={props.busy || !day}>
          {props.busy ? "保存中…" : "设成限时书"}
        </button>
      </div>
    </BookDialog>
  );
}

