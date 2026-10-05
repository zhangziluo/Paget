import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { paletteOf, type CoverSpec } from "../lib/coverGenerator";
import type { BookRow } from "../lib/types";

/** 封面卡片的尺寸（要和 App.css 里 `.cover-card` 的 width / height 对上）。 */
export const CARD_WIDTH = 300;
export const CARD_HEIGHT = 420;

/** 各阶段时长（毫秒）：抽书 0.5s → 横转封面 0.8s → 停留 3s → 翻页 0.5s。 */
const PULL_MS = 500;
const TURN_MS = 800;
const HOLD_MS = 3000;
const OPEN_MS = 500;
const BACK_MS = 450;

/**
 * 过场的阶段：抽书 → 横转 → 停留 → 翻页；`back` 是中途返回（回退到书架）。
 * 阶段名直接当 class 用（`.book-stage.<阶段>`），时长与动画都在 CSS 里对齐。
 */
type Phase = "pull" | "turn" | "hold" | "open" | "back";

/** 书脊在屏幕上的位置：回退时封面飞回这里，书脊也跟着归位。 */
export type SpineRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 点开一本书之后的过场（纯 CSS 3D，没有 three.js，也不加任何图片资源）。
 *
 * 四步：
 *
 * 1. **抽书**（0.5s）—— 这事发生在书架上（见 App.css 的 `.shelf.transitioning`），
 *    这一层同时把背景压暗 0.3；
 * 2. **横转**（0.8s）—— 卡片从侧着（`rotateY(90deg)`）转到正面朝人；
 * 3. **停留**（3s）—— 封面静止，书名 / 作者在底部淡入；点任意处跳过；
 * 4. **翻页**（0.5s）—— 整张卡片 `rotateY` 转到 -180° 露出"第一页"，
 *    架上那只毛绒玩具同时跳进书页里，然后交给阅读页（`onDone`）。
 *
 * 中途按 Esc / 点「← 返回书架」走第 5 步：封面缩小飞回书脊原位（`onCancel`）。
 * 整段不可被别处打断 —— 遮罩铺满整屏，只有"跳过"和"返回"两个出口。
 */
export default function BookTransition(props: {
  book: BookRow;
  /** 自动生成封面的方案（配色 + 中央那两个字） */
  spec: CoverSpec;
  /** 本地封面图的 data URL；有图就显示图，没有就按 spec 画一张 */
  image: string | null;
  /** 书脊在书架上的位置 */
  origin: SpineRect;
  /** 架上那只毛绒玩具（直接传节点，这里不必认识玩偶怎么画） */
  toy?: ReactNode;
  /** 翻页结束：交给阅读页 */
  onDone: () => void;
  /** 中途返回：回书架 */
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("pull");
  const { book, spec, image, origin, toy } = props;

  // 回调放进 ref：阶段推进只依赖 phase，父组件重渲染不会把计时器重置
  const handlers = useRef({ onDone: props.onDone, onCancel: props.onCancel });
  useEffect(() => {
    handlers.current = { onDone: props.onDone, onCancel: props.onCancel };
  }, [props.onDone, props.onCancel]);

  // 阶段推进：一步一步定时往前走，走完翻页就把控制权交给阅读页
  useEffect(() => {
    const timers: number[] = [];
    if (phase === "pull") {
      timers.push(window.setTimeout(() => setPhase("turn"), PULL_MS));
    } else if (phase === "turn") {
      timers.push(window.setTimeout(() => setPhase("hold"), TURN_MS));
    } else if (phase === "hold") {
      timers.push(window.setTimeout(() => setPhase("open"), HOLD_MS));
    } else if (phase === "open") {
      timers.push(window.setTimeout(() => handlers.current.onDone(), OPEN_MS));
    } else {
      // back：飞回书架的动画放完，才真的回到书架
      timers.push(window.setTimeout(() => handlers.current.onCancel(), BACK_MS));
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [phase]);

  // 返回键 = 第 5 步（翻页已经开始就不再理它了）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPhase((now) => (now === "open" || now === "back" ? now : "back"));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** 点任意处 = 跳过停留，直接进翻页（阶段 3 的"点任意位置"）。 */
  function skip() {
    setPhase((now) => (now === "pull" || now === "turn" || now === "hold" ? "open" : now));
  }

  /** 「← 返回书架」= 第 5 步：封面飞回书脊原位。 */
  function back() {
    setPhase((now) => (now === "pull" || now === "turn" || now === "hold" ? "back" : now));
  }

  // 回退要飞回书脊的位置：卡片是屏幕居中的，所以算的是"卡片中心 → 书脊中心"的位移
  const fly = useMemo(() => {
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    const spineX = origin.x + origin.width / 2;
    const spineY = origin.y + origin.height / 2;
    return {
      x: spineX - viewportWidth / 2,
      y: spineY - viewportHeight / 2,
      // 缩到书脊那么窄；留个下限，看着才像"飞回去"而不是"凭空消失"
      scale: Math.max(0.12, origin.width / CARD_WIDTH),
    };
  }, [origin]);

  const palette = paletteOf(spec);
  const style = {
    "--cover-from": palette.from,
    "--cover-to": palette.to,
    "--cover-ink": palette.ink,
    "--cover-accent": palette.accent,
    "--fly-x": `${fly.x.toFixed(1)}px`,
    "--fly-y": `${fly.y.toFixed(1)}px`,
    "--fly-scale": fly.scale.toFixed(3),
  } as CSSProperties;

  return (
    <div
      className={`book-stage ${phase}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={`正在打开《${book.title || book.id}》`}
      onClick={skip}
    >
      {/* 封面卡片：正面是封面，背面是翻开的"第一页" */}
      <figure
        className="cover-card"
        style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
      >
        <div className="cover-face cover-front">
          {image ? (
            // 有封面图（本地封面文件）：直接铺满卡片
            <img className="cover-image" src={image} alt="" />
          ) : (
            // 没有封面图：按书名 hash 出的配色画一张，中央放头两个字
            <div className="cover-drawn">
              <span className="cover-band" />
              <span className={`cover-initials ${spec.initials.length > 1 ? "two" : "one"}`}>
                {spec.initials}
              </span>
            </div>
          )}
          {/* 底部书名 / 作者：停留阶段才淡入 */}
          <figcaption className="cover-caption">
            <strong>{book.title || book.id}</strong>
            {book.author ? <span>{book.author}</span> : null}
          </figcaption>
          {/* 靠书脊那侧一道压痕，和书架上的书脊呼应 */}
          <span className="cover-spine-line" />
        </div>

        <div className="cover-face cover-back">
          <span className="cover-page-lines" />
          <span className="cover-page-first">第 1 页</span>
        </div>
      </figure>

      {/* 跳进书页里的毛绒玩具（翻页阶段才出现） */}
      {toy ? (
        <span className="stage-toy" aria-hidden="true">
          {toy}
        </span>
      ) : null}

      {/* 提示与返回：点任意处继续，Esc 或这个按钮回书架 */}
      <div className="stage-hint">
        <span>点击任意处继续</span>
        <button
          type="button"
          className="stage-back"
          onClick={(event) => {
            // 别让这次点击同时被当成"跳过"
            event.stopPropagation();
            back();
          }}
        >
          ← 返回书架
        </button>
        <span className="stage-esc">Esc 返回</span>
      </div>
    </div>
  );
}
