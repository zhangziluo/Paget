import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ImportPickMode } from "../lib/core";

/** 菜单挂在哪儿：篮子在屏幕上的位置（`getBoundingClientRect` 那四个值）。 */
export type ImportPickAnchor = { left: number; top: number; right: number; height: number };

/**
 * 「＋ 导入」在 Windows / Linux 上先弹的这两项。
 *
 * macOS 的系统面板文件与文件夹同框，一次就能挑完（`importPickerModes()` 回 `["panel"]`），
 * 所以这个菜单在 macOS 上永远不出现；Windows / Linux 的系统对话框只能二选一
 * （`IFileOpenDialog` 开 `FOS_PICKFOLDERS` 就只能选文件夹、不开就只能选文件），
 * 于是先问一句要哪一种。两个平台上的解释都写在 Rust 侧 `desktop_picker` 的注释里。
 *
 * 位置：默认挂在篮子右边、与它垂直居中，量出自身尺寸后夹回窗口内（与 `BookContextMenu`
 * 同一套做法）。收起有三条路：点菜单项、按 Esc、点那层透明遮罩 —— 遮罩压在篮子上，
 * 所以「再点一次篮子」也会先落到遮罩上，等于关掉它（不会又把它打开）。
 *
 * 视觉沿用书脊右键菜单那张木色卡片（`.book-menu`）：同一个书房里该长一个样。
 */
export default function ImportPickMenu(props: {
  /** 篮子的位置：菜单挂在它旁边 */
  anchor: ImportPickAnchor;
  /** 选定了哪一种：调用方去开对话框（`files` 多选文件 / `folder` 多选文件夹） */
  onPick: (mode: ImportPickMode) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  // 最终落点：先按「篮子右边」摆着，量完尺寸再夹回窗口（见 useLayoutEffect）
  const [pos, setPos] = useState({ left: props.anchor.right + 8, top: props.anchor.top });

  // 布局完成、还没上屏时量尺寸并收进窗口（四周各留 8px）
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const margin = 8;
    // 先想着放篮子右边；右边放不下（贴到窗口右沿）就翻到左边去
    let left = props.anchor.right + margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, props.anchor.left - width - margin);
    }
    // 与篮子垂直居中，再夹回窗口
    const top = Math.max(
      margin,
      Math.min(
        props.anchor.top + props.anchor.height / 2 - height / 2,
        window.innerHeight - margin - height,
      ),
    );
    setPos({ left, top });
  }, [props.anchor]);

  // Esc 收起（点别处由下面那层遮罩负责 —— 它比窗口监听更准：压在篮子上就不会误触发篮子的点击）
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
    <>
      {/* 透明遮罩：吃掉这一下点击并收起菜单（不给下面的篮子） */}
      <div className="import-pick-scrim" aria-hidden="true" onPointerDown={props.onClose} />
      <div
        className="book-menu import-pick"
        role="menu"
        aria-label="导入电子书"
        ref={box}
        style={pos}
      >
        <button
          type="button"
          role="menuitem"
          className="book-menu-item"
          onClick={() => props.onPick("files")}
        >
          <span className="book-menu-icon" aria-hidden="true">
            📖
          </span>
          <span className="book-menu-label">
            选择电子书文件…
            <span className="import-pick-hint">可多选 · .txt / .epub / .mobi / .azw3 / .pdf</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="book-menu-item"
          onClick={() => props.onPick("folder")}
        >
          <span className="book-menu-icon" aria-hidden="true">
            📁
          </span>
          <span className="book-menu-label">
            选择一个文件夹…
            <span className="import-pick-hint">连同子文件夹一起找</span>
          </span>
        </button>
      </div>
    </>
  );
}
