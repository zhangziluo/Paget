/**
 * 封印一本书时的两下：**书脊原位的光点飞散** + 一句轻提示。
 *
 * 全是纯 CSS（和过场 `BookTransition` 一个路子：不加图片、不用动画库）：书脊残影先
 * 淡出，光点再往外飘散。每颗光点的方向 / 距离 / 大小 / 延迟都由它的下标算出来 ——
 * 用黄金角散开，看着是随机的，但每次重放都一模一样，也不引随机数。
 *
 * 两个组件各自管自己的计时器：动画放完（或提示条待够时间）就调用 `onDone`，
 * 父组件只管把它们挂上去 / 摘下来。
 */

import { useEffect, useRef, type CSSProperties } from "react";

import type { SpineRect } from "./BookTransition";

/** 光点飞散的总时长（毫秒）—— 要和 App.css 里 `.seal-dot` 的动画时长对上。 */
export const SEAL_MS = 1600;

/** 提示条停留多久（毫秒，含淡入淡出）。 */
export const SEAL_TOAST_MS = 3600;

/** 光点数量（够密就行，不必更多：每颗都是一个 DOM 节点）。 */
const DOT_COUNT = 28;

/** 封印之后的轻提示文案（书架上那只毛绒兔子干的）。 */
export const SEAL_TOAST_TEXT = "这本书似乎被兔子藏起来了……";

/**
 * 第 *index* 颗光点的样式：方向按黄金角铺开，距离 / 大小 / 延迟按索引抖动。
 *
 * 值都走 CSS 自定义属性（`--seal-x` …），由 App.css 里的 `@keyframes` 消费，
 * 所以这里不写死任何动画时间。
 */
function dotStyle(index: number): CSSProperties {
  // 黄金角（137.508°）：连续几个下标也不会挤在同一个方向
  const angle = (index * 137.508 * Math.PI) / 180;
  // 距离、大小、延迟都按下标取模抖动一下
  const distance = 46 + ((index * 37) % 92);
  const size = 3 + ((index * 13) % 5);
  const delay = (index % 7) * 45;
  return {
    "--seal-x": `${(Math.cos(angle) * distance).toFixed(1)}px`,
    // 整体往上飘一点：光点往上散更像"消散"，也避开下面的书架底板
    "--seal-y": `${(Math.sin(angle) * distance - 28).toFixed(1)}px`,
    "--seal-size": `${size}px`,
    "--seal-delay": `${delay}ms`,
  } as CSSProperties;
}

/** 书脊原位的光点飞散；动画放完调用 `onDone`。 */
export function SealDissolve(props: {
  /** 书脊在屏幕上的位置（封印前量下来的，刷新后就找不到这个节点了） */
  rect: SpineRect;
  /** 书名（给读屏用） */
  title: string;
  onDone: () => void;
}) {
  // 回调放进 ref：父组件重渲染不会把计时器重置（同 BookTransition 的做法）
  const done = useRef(props.onDone);
  useEffect(() => {
    done.current = props.onDone;
  }, [props.onDone]);
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), SEAL_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      className="seal-stage"
      role="status"
      aria-label={`《${props.title}》正在消散`}
      style={{
        left: `${props.rect.x}px`,
        top: `${props.rect.y}px`,
        width: `${props.rect.width}px`,
        height: `${props.rect.height}px`,
      }}
    >
      {/* 书脊的残影：先亮一下再淡掉，让"原位"看得出来 */}
      <span className="seal-ghost" aria-hidden="true" />
      {/* 往外飘散的光点 */}
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <span key={index} className="seal-dot" style={dotStyle(index)} aria-hidden="true" />
      ))}
    </div>
  );
}

/** 封印之后的轻提示条；待够 [`SEAL_TOAST_MS`] 后调用 `onDone`。 */
export function SealToast(props: { text: string; onDone: () => void }) {
  // 同上：计时器只挂一次，别被父组件的重渲染打断
  const done = useRef(props.onDone);
  useEffect(() => {
    done.current = props.onDone;
  }, [props.onDone]);
  useEffect(() => {
    const id = window.setTimeout(() => done.current(), SEAL_TOAST_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="seal-toast" role="status">
      <span className="seal-toast-icon" aria-hidden="true">
        🐰
      </span>
      {props.text}
    </div>
  );
}
