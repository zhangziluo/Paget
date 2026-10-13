import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { bookRecord } from "../lib/core";
import { addDays } from "../lib/deadlines";
import { duration, humanWords, shortStamp } from "../lib/format";
import { renamedTitle, renameTouched, type ManageRename } from "../lib/shelfManage";
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
const UNSUPPORTED_HINT = "当前内核版本不支持这个操作（需要较新的内核）";

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

/** 把「逗号分隔的一行标签」拆成内核要的列表（中英文逗号都认，空项丢掉）。 */
function parseTags(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * 属性：书名 / 作者 / 标签可以直接改（走内核 `set_meta`），其余只读。
 *
 * 只有内核认 `set_meta` 时才摆输入框；老内核降级成原来那份只读清单，并说明
 * 为什么不能改（与右键菜单里禁用项同一套理由）。保存中 / 保存失败都留在弹窗里，
 * 别让用户去书架页脚找报错。成功由父组件关窗（它还要重同步书架），这里只管草稿。
 */
export function BookPropsDialog(props: {
  book: BookRow;
  /** 内核认不认 `set_meta`（启动时探出来，见 `lib/core.ts` 的 coreCapabilities） */
  canEdit: boolean;
  /** 父组件负责落库：成功即关窗，抛错就显示在这里 */
  onSave: (meta: { title: string; author: string; tags: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const { record, error } = useRecord(props.book.id);
  // 草稿：打开时照抄当前值；标签编成一行文本，保存时再拆回列表
  const [title, setTitle] = useState(props.book.title);
  const [author, setAuthor] = useState(props.book.author);
  const [tags, setTags] = useState((props.book.tags ?? []).join("，"));
  // 保存中 + 保存失败的原文
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  // 书名是这本书在书架上的身份：空了就不给保存（内核也会拒绝空书名）
  const canSave = props.canEdit && title.trim().length > 0 && !busy;
  // 图片模式的 pdf（还没转换成文字）：没有字数可算，事实区显示页数
  const isPdfImage = (props.book.format ?? "") === "pdf" && !props.book.text_path;

  /** 提交：父组件落库并关窗，这里只负责忙状态与把报错留在弹窗里。 */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setSaveError("");
    try {
      // 交给内核的是清洗过的三个值（书名 / 作者去掉首尾空白，标签已拆成列表）
      await props.onSave({
        title: title.trim(),
        author: author.trim(),
        tags: parseTags(tags),
      });
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BookDialog title={`属性 · ${props.book.title || props.book.id}`} onClose={props.onClose}>
      {error ? <p className="error">{error}</p> : null}
      {saveError ? <p className="error">{saveError}</p> : null}

      {props.canEdit ? (
        <form className="book-edit" onSubmit={submit}>
          <label className="book-edit-field">
            <span>书名</span>
            <input
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <label className="book-edit-field">
            <span>作者</span>
            <input value={author} onChange={(event) => setAuthor(event.currentTarget.value)} />
          </label>
          <label className="book-edit-field">
            <span>标签</span>
            <input
              value={tags}
              placeholder="用逗号分隔，例如：科幻，长篇"
              onChange={(event) => setTags(event.currentTarget.value)}
            />
          </label>
          <div className="book-dialog-actions">
            <button type="button" className="ghost" onClick={props.onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" disabled={!canSave}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="dim">{UNSUPPORTED_HINT}</p>
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
              <dt>标签</dt>
              <dd>{(props.book.tags ?? []).join("，") || "无"}</dd>
            </div>
          </dl>
        </>
      )}

      {/* 只读的那几项：文字量、入库日期与上次阅读 */}
      <dl className="book-facts">
        {/* pdf 图片模式没有字数可算：显示页数，不然这里永远是个 0 */}
        {isPdfImage ? (
          <div>
            <dt>总页数</dt>
            <dd>{props.book.pages ?? 0} 页</dd>
          </div>
        ) : (
          <div>
            <dt>总字数</dt>
            <dd>{humanWords(props.book.total_words)}字</dd>
          </div>
        )}
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

/** 删除之前的一次确认（单本 / 批量共用）。 */
export function ConfirmDeleteDialog(props: {
  message: string;
  busy: boolean;
  /** 弹窗标题；缺省是单本那句「删除这本书」，批量删除时换成「删除选中的 N 本」 */
  title?: string;
  /** 标题下面的小字说明；缺省讲「删掉的只是书目与正文」 */
  note?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BookDialog title={props.title ?? "删除这本书"} onClose={props.onClose}>
      <p className="book-dialog-message">{props.message}</p>
      <p className="dim">
        {props.note ?? "删掉的只是书目与转换后的正文；阅读时长与成就会保留。"}
      </p>
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

/**
 * 管理模式下「选择 → 批量改书名」的弹窗。
 *
 * 四条规则都是**原样文本**（不是正则，见 `lib/shelfManage.ts` 的 `ManageRename`）：
 * 前缀 / 后缀直接拼上，查找 / 替换按字面替换。表单本身不改任何数据 ——
 * 规则交给父组件（它才知道选了哪几本、并通过内核 `set_meta` 落库）；这里只负责
 * 草稿与那句「拿第一本做样板」的实时预览，让用户按之前就看得见结果。
 */
export function BatchRenameDialog(props: {
  /** 选中的本数 */
  count: number;
  /** 样板：第一本选中的书名（null = 没有可预览的；预览行不出现） */
  sample: string | null;
  busy: boolean;
  onApply: (rule: ManageRename) => void;
  onClose: () => void;
}) {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const rule: ManageRename = { prefix, suffix, find, replace };
  // 四条都空着就没什么可改的：按钮禁用（免得白跑一趟内核）
  const ready = renameTouched(rule) && !props.busy;
  const preview = props.sample !== null ? renamedTitle(props.sample, rule) : "";

  return (
    <BookDialog title={`批量改书名 · ${props.count} 本`} onClose={props.onClose}>
      <p className="book-dialog-message">
        给选中的 {props.count} 本书统一改书名：前缀 / 后缀直接拼上，查找 / 替换按字面替换
        （都是原样文字，不是正则）；作者与标签不动。
      </p>

      <div className="book-edit">
        <label className="book-edit-field">
          <span>前缀</span>
          <input
            value={prefix}
            autoFocus
            placeholder="拼在所有书名最前面"
            onChange={(event) => setPrefix(event.currentTarget.value)}
          />
        </label>
        <label className="book-edit-field">
          <span>后缀</span>
          <input
            value={suffix}
            placeholder="拼在所有书名最后面"
            onChange={(event) => setSuffix(event.currentTarget.value)}
          />
        </label>
        <label className="book-edit-field">
          <span>查找</span>
          <input
            value={find}
            placeholder="书名里要替换掉的那一段（留空 = 不替换）"
            onChange={(event) => setFind(event.currentTarget.value)}
          />
        </label>
        <label className="book-edit-field">
          <span>替换</span>
          <input
            value={replace}
            placeholder="换成的字（留空 = 删掉这一段）"
            onChange={(event) => setReplace(event.currentTarget.value)}
          />
        </label>
      </div>

      {props.sample !== null ? (
        <p className="batch-preview">
          示例：<span className="dim">{props.sample}</span> →{" "}
          <strong>{preview.trim() || "（空书名，内核会拒绝）"}</strong>
        </p>
      ) : null}

      <div className="book-dialog-actions">
        <button type="button" className="ghost" onClick={props.onClose} disabled={props.busy}>
          取消
        </button>
        <button type="button" onClick={() => props.onApply(rule)} disabled={!ready}>
          {props.busy ? "改名中…" : `改这 ${props.count} 本`}
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

