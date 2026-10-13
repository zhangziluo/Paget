import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  DRAG_SCALE,
  EDGE_HOLD_MS,
  EDGE_ZONE_PX,
  type ManageDrag,
  type ManageHit,
} from "../lib/shelfManage";

/** 指针贴在左 / 右哪一侧（"" = 在中间）。 */
type Zone = "" | "left" | "right";

/**
 * 「管理模式」的那一层：管理条（完成 / 选中的那一件）+ 拖书的浮起卡片 +
 * 落点指示线 + 边缘停留 0.3s 翻屏的进度环。
 *
 * 它只管**交互**，不碰数据也不碰布局：
 *
 * - 指针每动一下，向父组件要一个「落在第几屏第几排第几个缝」的判定（`hitAt`）——
 *   坐标只有父组件有（书脊是它画的，量宽也在它那儿）；
 * - 落点**变了**才喊一声（`onHover`），父组件据此画出「相邻两本被挤扁」；
 * - 浮起卡片与指示线的位置**直接写 style**，不走 React 渲染 —— 指针一秒动几十次，
 *   每帧重渲染整面书架（几十张书脊）不值当（与阅读页光点同一条理由）；
 * - 松手把落点交回父组件（`onDrop`）：真正动顺序的是 `lib/shelfManage.ts` 里那几个
 *   纯函数，这一层一行数据都不改。
 *
 * 选中那一件（`pickedLabel`）也由父组件管：这里只把它写在管理条上、并给一枚「取消选中」。
 *
 * 边缘翻屏（需求：停留 300ms）：指针进到左右 96px 里就开始按住计时，进度用 rAF 写
 * 进指示环；满 300ms 翻一屏**并重新计时**（一直按着就一屏一屏过去）。已经到头 /
 * 到尾的那一侧不翻，指示环只亮不进展。`←` / `→` 在拖拽中也能翻（需求里的「或方向键」），
 * `Esc` = 把书放回原处（`onDrop(null)`）。**没在拖、但点中了一件东西时**，方向键则归
 * `views/Shelf.tsx` 那一层用来挪它（这里不管）。
 */
export default function BookshelfManager(props: {
  /** 正在拖的那本书；null = 没在拖（管理条仍然显示）。原位留空由父组件自己画 */
  drag: ManageDrag | null;
  /** 这个屏幕坐标落在第几屏第几排第几个缝上（父组件用缓存的格子坐标算）；null = 不在任何一格 */
  hitAt: (x: number, y: number) => ManageHit | null;
  /** 落点变了（父组件据此画让位 / 压扁、玩偶拦截） */
  onHover: (hit: ManageHit | null) => void;
  /** 松手：落到这个点上（null = 落空 / 取消，书回原位） */
  onDrop: (hit: ManageHit | null) => void;
  /** 翻一屏（边缘停留满 300ms 或按方向键） */
  onTurn: (step: -1 | 1) => void;
  /** 当前屏 / 总屏数 —— 用来判断还能不能往那一侧翻 */
  page: { current: number; total: number };
  /** 布局存在哪儿：内核的 shelf.json（跟着书库走）还是本机 gui_settings（老内核的退路） */
  home: "kernel" | "local";
  onDone: () => void;
  /** 方向键排序选中的那一件叫什么（书名）；null = 手上没拿着东西 */
  pickedLabel: string | null;
  /** 放开手上那一件（点「取消选中」，与 `Esc` 同一条路） */
  onClearPick: () => void;

  /* ── 批量选择（管理模式的第二个子状态：勾书 → 批量改 / 删） ───────────── */

  /** 是不是「选择」状态：每根书脊上出现勾选框，管理条换成批量动作 */
  selecting: boolean;
  /** 已选几本 */
  selectedCount: number;
  /** 架上总共几本（全选按钮的可用性 & 文案） */
  totalBooks: number;
  /** 内核认不认 `set_meta` / `finish` / `remove`（老内核时对应动作禁用并说明） */
  canEditMeta: boolean;
  canFinish: boolean;
  canRemove: boolean;
  /** 进 / 出「选择」状态（进出都不动数据） */
  onToggleSelecting: () => void;
  /** 全选（整面书架）/ 清空选择 */
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** 批量动作：真正的数据操作在父组件，这一层只画按钮 */
  onBatchRename: () => void;
  onMarkFinished: (finished: boolean) => void;
  onBatchDelete: () => void;
}) {
  const ghost = useRef<HTMLSpanElement | null>(null);
  const mark = useRef<HTMLSpanElement | null>(null);
  const ring = useRef<HTMLSpanElement | null>(null);
  const [zone, setZone] = useState<Zone>("");
  const [turning, setTurning] = useState(false);
  // 指针每动一下都要读最新的回调与屏号：放进 ref，避免监听器里拿到过期的闭包
  const latest = useRef(props);
  latest.current = props;
  // 上一次报出去的落点（只有「换了格」才喊 onHover，免得每帧把书架重渲染一遍）
  const hitKey = useRef("");

  useEffect(() => {
    if (!props.drag) {
      setZone("");
      setTurning(false);
      return;
    }
    let side: Zone = "";
    let frame = 0;
    let timer: number | null = null;

    /** 边缘计时归零（离开边缘 / 翻完一屏 / 松手都走这儿）。 */
    const stopHold = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      if (ring.current) ring.current.style.setProperty("--hold", "0");
    };

    /** 按住不放：进度环 300ms 走满 → 翻一屏 → 重新计时（一直按着就一直翻）。 */
    const hold = (direction: -1 | 1) => {
      stopHold();
      const from = performance.now();
      const step = (now: number) => {
        const ratio = Math.min(1, (now - from) / EDGE_HOLD_MS);
        if (frame && ring.current) ring.current.style.setProperty("--hold", ratio.toFixed(3));
        if (ratio < 1) {
          frame = window.requestAnimationFrame(step);
          return;
        }
        frame = 0;
        // 到头 / 到尾的那一侧不翻：环停住，等用户自己放回去
        const page = latest.current.page;
        const at = direction < 0 ? page.current <= 0 : page.current >= page.total - 1;
        if (at) return;
        latest.current.onTurn(direction);
        hold(direction);
      };
      frame = window.requestAnimationFrame(step);
    };

    const move = (event: PointerEvent) => {
      const x = event.clientX;
      const y = event.clientY;
      // 1) 浮起的那本跟着指针走（直接写 transform，不走渲染）
      if (ghost.current) {
        ghost.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      // 2) 边缘：进到带子里就开始计时；换了一侧就重来
      const width = window.innerWidth;
      const next: Zone =
        x <= EDGE_ZONE_PX ? "left" : x >= width - EDGE_ZONE_PX ? "right" : "";
      if (next !== side) {
        side = next;
        setZone(next);
        stopHold();
        const page = latest.current.page;
        const blocked = next === "left" ? page.current <= 0 : page.current >= page.total - 1;
        setTurning(next !== "" && !blocked);
        if (next !== "" && !blocked) hold(next === "left" ? -1 : 1);
      }
      // 3) 落点：判定 + 变化时才通知父组件；指示线跟着写位置
      const hit = latest.current.hitAt(x, y);
      const key = hit ? `${hit.page}:${hit.row}:${hit.gap}:${hit.overToy ? 1 : 0}` : "";
      if (key !== hitKey.current) {
        hitKey.current = key;
        latest.current.onHover(hit);
      }
      if (mark.current) {
        mark.current.style.opacity = hit ? "1" : "0";
        if (hit) {
          mark.current.style.left = `${hit.x.toFixed(1)}px`;
          mark.current.style.top = `${hit.y.toFixed(1)}px`;
          mark.current.style.height = `${hit.height.toFixed(1)}px`;
        }
      }
    };

    const up = (event: PointerEvent) => {
      const hit = latest.current.hitAt(event.clientX, event.clientY);
      latest.current.onDrop(hit);
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        latest.current.onTurn(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.onDrop(null);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      stopHold();
      hitKey.current = "";
    };
  }, [props.drag]);

  return (
    <>
      {/* 管理条：排序态是「批量编辑 + 选中的那一件」，选择态换成「全选 / 批量改 / 批量删」*/}
      <div
        className={`manage-bar${props.selecting ? " selecting" : ""}`}
        role="toolbar"
        aria-label={props.selecting ? "批量编辑" : "书架管理"}
      >
        <span className="manage-title">
          <span aria-hidden="true">{props.selecting ? "☑️" : "🔨"}</span>{" "}
          {props.selecting ? "批量编辑" : "管理模式"}
        </span>
        {props.selecting ? (
          <span className="manage-selected-count" aria-live="polite">
            已选 {props.selectedCount} 本
          </span>
        ) : (
          /* 布局存在哪儿：内核（跟着书库走）还是本机（老内核的退路）—— 一个小标签说清楚 */
          <span
            className={`manage-home${props.home === "kernel" ? " kernel" : ""}`}
            title={
              props.home === "kernel"
                ? "布局跟着书库走（存在书库的 shelf.json 里）"
                : "这台机器的内核还不认识书架布局接口，先存在本机设置里"
            }
          >
            {props.home === "kernel" ? "内核" : "本机"}
          </span>
        )}

        {props.selecting ? (
          /* 选择态：全选 / 清空 + 三种批量动作（改书名 / 改阅读状态 / 删除）*/
          <>
            <div className="manage-batch" role="group" aria-label="批量动作">
              <button
                type="button"
                className="manage-action"
                title="把书架上的书全勾上（跨屏多选也在这一下里）"
                onClick={props.onSelectAll}
                disabled={props.totalBooks === 0 || props.selectedCount >= props.totalBooks}
              >
                全选
              </button>
              <button
                type="button"
                className="manage-action"
                title="清空当前的选择"
                onClick={props.onClearSelection}
                disabled={props.selectedCount === 0}
              >
                清空
              </button>
              <button
                type="button"
                className="manage-action"
                title={
                  props.canEditMeta
                    ? "给选中的这几本统一改书名（前缀 / 后缀 / 查找替换，走内核 set_meta）"
                    : "当前内核版本不支持改书名（需要较新的内核）"
                }
                onClick={props.onBatchRename}
                disabled={props.selectedCount === 0 || !props.canEditMeta}
              >
                ✏️ 改书名…
              </button>
              <button
                type="button"
                className="manage-action"
                title={
                  props.canFinish
                    ? "把选中的这几本标记为已读完（走内核 finish）"
                    : "当前内核版本不支持标记已读（需要较新的内核）"
                }
                onClick={() => props.onMarkFinished(true)}
                disabled={props.selectedCount === 0 || !props.canFinish}
              >
                ✅ 标记已读
              </button>
              <button
                type="button"
                className="manage-action"
                title={
                  props.canFinish
                    ? "把选中的这几本标记为未读（走内核 finish，进度不删）"
                    : "当前内核版本不支持标记未读（需要较新的内核）"
                }
                onClick={() => props.onMarkFinished(false)}
                disabled={props.selectedCount === 0 || !props.canFinish}
              >
                ↩ 标记未读
              </button>
              <button
                type="button"
                className="manage-action danger"
                title={
                  props.canRemove
                    ? "删除选中的这几本（会再确认一次）"
                    : "当前内核版本不支持删除（需要较新的内核）"
                }
                onClick={props.onBatchDelete}
                disabled={props.selectedCount === 0 || !props.canRemove}
              >
                🗑 删除
              </button>
            </div>
            <span className="manage-hint">
              {props.selectedCount === 0
                ? "点书脊勾选（可以跨屏多选）"
                : "再点已勾的书可取消"}
            </span>
            <button
              type="button"
              className="manage-back"
              title="回到排序：这时才能拖书脊排序"
              onClick={props.onToggleSelecting}
            >
              返回排序
            </button>
          </>
        ) : (
          /* 排序态：批量编辑开关 + 选中的那一件 */
          <>
            <button
              type="button"
              className="manage-select-toggle"
              title="进入批量编辑：点书脊勾选，然后批量改书名 / 改阅读状态 / 删除"
              onClick={props.onToggleSelecting}
            >
              ☑️ 批量编辑
            </button>
            {/* 手上拿着东西时（点过的书脊）：写清楚它是什么，并给一枚放开的按钮 */}
            {props.pickedLabel ? (
              <>
                <span className="manage-picked" title="用 ← ↑ → ↓ 挪它：← ↑ 往前一位、→ ↓ 往后一位">
                  已选中「{props.pickedLabel}」
                </span>
                <button
                  type="button"
                  className="manage-action"
                  title="放开这一件（与 Esc 同一条路），之后 ← / → 又是翻屏"
                  onClick={props.onClearPick}
                >
                  取消选中
                </button>
              </>
            ) : null}
            <span className="manage-hint">
              {props.drag
                ? "拖到屏幕左右边缘停留 0.3s（或 ← →）翻屏 · Esc 取消"
                : props.pickedLabel
                  ? "← ↑ 往前一位 · → ↓ 往后一位 · Esc 放开（放开后 ← → 才是翻屏）"
                  : "点一下书脊选中，再用方向键挪位置 · 拖动也能排序"}
            </span>
          </>
        )}

        <button type="button" className="manage-done" onClick={props.onDone}>
          完成
        </button>
      </div>

      {/* 拖书时跟着指针走的那张卡：位置由上面的 effect 直接写 transform */}
      {props.drag ? (
        <span
          className="drag-ghost"
          ref={ghost}
          style={{ "--drag-scale": String(DRAG_SCALE) } as CSSProperties}
          aria-hidden="true"
        >
          <span className="drag-ghost-title">{props.drag.title}</span>
        </span>
      ) : null}

      {/* 落点指示线：跟着指针写 left / top / height（没落在任何一格上就藏起来） */}
      <span className="drop-mark" ref={mark} aria-hidden="true" />

      {/* 边缘停留的进度环：按住不放就走满，满 300ms 翻一屏并重新计时 */}
      {zone ? (
        <span
          className={`turn-hold ${zone}${turning ? " running" : ""}`}
          ref={ring}
          aria-hidden="true"
        >
          <span className="turn-hold-fill" />
          <span className="turn-hold-text">
            {turning ? "正在翻屏…" : zone === "left" ? "已经是第一屏" : "已经是最后一屏"}
          </span>
        </span>
      ) : null}
    </>
  );
}
