import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { generatedCover, paletteOf } from "../lib/coverGenerator";
import {
  COUNTER_FADE_MS,
  LAND_MS,
  RISE_MS,
  STACK_MS,
  flightEnd,
  flightLandingPage,
  flightSchedule,
  flightStartMs,
} from "../lib/importFlight";
import type { BookRow } from "../lib/types";
import type { SpineRect } from "./BookTransition";

/**
 * 篮口在篮身那个盒子里的位置（篮子 5.6rem 高、篮身 2.5rem 坐在底下，
 * 所以沿口大约在自上而下 55.4% 处 —— 与 `App.css` 的 `.basket` / `.bk-body` 是一对）。
 */
const BASKET_RIM = 0.554;

/** 计数器比篮口再高多少（px）。 */
const COUNTER_LIFT = 60;

/** 计数器贴不到屏幕左沿时的最小中心（px）—— 篮子就在左边，别让它半个身子探出窗外。 */
const COUNTER_MIN_X = 78;

/** 阶段：篮口先摆出一叠封面 → 逐本飞 → 全部归位（计数器停留一会儿再淡出）。 */
type Phase = "stack" | "flying" | "settling";

/** 篮口那一叠：越靠外越往两边散、越往下沉、也越歪 —— 像一手牌那样摊开，
 *  一眼看得出「这一批有好几本」，而不是一张封面。 */
function fanOf(index: number, count: number): { x: number; y: number; rot: number } {
  const mid = (count - 1) / 2;
  const off = index - mid;
  return { x: off * 9, y: Math.abs(off) * 3 - Math.abs(mid) * 0.8, rot: off * 7 };
}

/**
 * 「导入飞行动画」：篮子里的新书一本本飞上书架。
 *
 * 这一步**不改任何数据** —— 书已经在架上了（父组件同步完才叫它），它只是一层
 * 给眼睛看的过场：篮口摆出这一批的封面 → 一本本沿抛物线飞向各自的格子 →
 * 「啪」一下弹进书架 → 计数器 +1 → 全部归位后停留 1.5 秒淡出。
 *
 * 纯 CSS 画（没有图片、没有 canvas），三层各管一个 transform 维度，互不打架：
 *
 * - `.import-fly`：位移（起飞点 → 落点，直线；延迟就是「第几本起飞」）；
 * - `.fly-arc`：抛物线那一拱 + 轻微旋转（±5°，像书在空中翻了个身）；
 * - `.fly-card`：封面卡本身的缩放 —— 升起 0.3→1，落地弹性 1.2→1 并化进格子。
 *
 * 起点/终点/时长全是算好的 px 与 ms，塞进 CSS 自定义属性（与 `.book-stage` 的
 * `--fly-x` 同一套做法），所以 `@keyframes` 里不写死任何坐标。
 *
 * **落点是量出来的**：书脊这一次提交才画上去（父组件同步完才有），所以量落点放在
 * `useLayoutEffect`（提交之后、画之前）。
 *
 * **跨屏飞行（M2）**：新书落在别的屏上时，这一层先请父组件**翻到第一本新书所在的那一屏**
 * （`onTurn`，翻屏动画照常播），翻过去之后那几根书脊就在 DOM 里了 —— 于是它们照常飞、照常落地；
 * 落在**更前 / 更后**那些屏上的（一次导入可能横跨两三屏）朝那一屏的方向**飞出画外**再淡出
 * （`.offscreen`，终点由 `lib/importFlight.ts` 的 `flightEnd` 算），看着就是「飞到旁边的书架上去了」。
 * 用户最后停在新书所在的那一屏 —— 正好看见自己刚导入的书。
 */
export default function ImportFlight(props: {
  /** 这一批新书（已经在架上了，这里只是把它们的封面飞过去） */
  books: BookRow[];
  /** 篮子（篮身那个盒子）的位置：起飞点由它算出来 */
  origin: SpineRect;
  /** 按书 id 找书脊在屏幕上的位置（父组件的 `spineRect`）；找不到回 null */
  resolveTarget: (bookId: string) => SpineRect | null;
  /** 这一批里每本书落在第几屏（跨屏飞行靠它决定翻到哪儿 / 往哪边飞出去） */
  pageOf: (bookId: string) => number;
  /** 书架这会儿停在第几屏 */
  page: number;
  /** 请父组件翻到第几屏（翻屏动画由父组件播） */
  onTurn: (page: number) => void;
  /** 全部归位、计数器淡完之后收场 */
  onDone: () => void;
}) {
  const { books, origin } = props;
  const total = books.length;
  const [phase, setPhase] = useState<Phase>("stack");
  // 已经归位几本：计数器就是它（与飞行物什么时候消失无关，那些卡片落地后自己淡掉）
  const [landed, setLanded] = useState(0);
  // 每一本的落点：null = 落在别的屏上（DOM 里没有那一格）
  const [targets, setTargets] = useState<(SpineRect | null)[] | null>(null);
  // 这一场飞行动画落在第几屏（= 第一本新书所在的屏）；null = 还没让父组件翻过去
  const landing = useMemo(() => flightLandingPage(books.map((book) => props.pageOf(book.id))), [books, props.pageOf]);
  const schedule = useMemo(() => flightSchedule(total), [total]);

  // 回调放进 ref：阶段推进只依赖 phase，父组件重渲染不会把计时器重置（与 BookTransition 同一套）
  const handlers = useRef({ onDone: props.onDone, onTurn: props.onTurn });
  useEffect(() => {
    handlers.current = { onDone: props.onDone, onTurn: props.onTurn };
  }, [props.onDone, props.onTurn]);

  /**
   * 先翻到新书那一屏（跨屏飞行）：翻屏是父组件的事（动画也在它那儿），
   * 翻完这一屏的书脊就进了 DOM，下面那个 effect 才量得到落点。
   */
  const turned = useRef(false);
  useEffect(() => {
    if (turned.current || props.page === landing) return;
    turned.current = true;
    handlers.current.onTurn(landing);
  }, [props.page, landing]);

  /**
   * 量落点：只量一次。
   *
   * 用 `useLayoutEffect`（提交之后、画之前）—— 书脊是父组件这次提交才画上去的，
   * 量早了会一本都找不到。量完 `setTargets` 触发一次同步重渲染，第一帧就带着坐标，
   * 所以看不到「从篮口跳到书脊」那一下。
   */
  const measured = useRef(false);
  useLayoutEffect(() => {
    // 还没翻到新书那一屏：这会儿量也量不到（那几根书脊不在 DOM 里），等翻过去再量
    if (measured.current || props.page !== landing) return;
    measured.current = true;
    setTargets(books.map((book) => props.resolveTarget(book.id)));
  }, [books, props.resolveTarget, props.page, landing]);

  // 起飞点：篮口正中
  const launch = useMemo(
    () => ({ x: origin.x + origin.width / 2, y: origin.y + origin.height * BASKET_RIM }),
    [origin],
  );

  /** 每一本：飞哪儿、什么时候起飞、在篮口那一叠里歪在哪儿。 */
  const shots = useMemo(
    () =>
      books.map((book, index) => {
        const target = targets?.[index] ?? null;
        // 终点：这一屏的书就是那一格正中；别的屏的书朝那一屏飞出画外（见 `flightEnd`）
        const end = flightEnd({
          target,
          page: props.pageOf(book.id),
          landing,
          launch,
          viewportWidth: typeof window === "undefined" ? 0 : window.innerWidth,
        });
        return {
          book,
          index,
          target,
          /** 飞到别的屏上去的那几本：落地那一下换成淡出（CSS 的 `.offscreen`） */
          offscreen: end.offscreen,
          spec: generatedCover(book.title || book.id),
          ex: end.ex,
          ey: end.ey,
          // 抛物线顶点抬多高：高低差越大抬得越高，最少 18px（「像被抛出去的」那一拱）
          arc: Math.max(18, Math.abs(end.ey - launch.y) * 0.28),
          delay: flightStartMs(schedule, index),
          fan: fanOf(index, books.length),
        };
      }),
    [books, targets, launch, schedule, landing, props.pageOf],
  );

  /** 一本都不用飞（比如这一批落在别的屏上）：直接收场，别把用户晾在这一层上。 */
  useEffect(() => {
    if (total === 0) handlers.current.onDone();
  }, [total]);

  // 篮口把封面摆出来 → 开飞（跨屏时**等翻到那一屏**再开飞：翻过去之前量不到落点）
  useEffect(() => {
    if (phase !== "stack" || props.page !== landing) return;
    const id = window.setTimeout(() => setPhase("flying"), STACK_MS);
    return () => window.clearTimeout(id);
  }, [phase, props.page, landing]);

  // 逐本落地：到点就 +1（落在别的屏上的那几本也照算，它们早就在架上了）；
  // 最后一本弹完 → 收场（计数器停 `holdMs` 再淡出）
  useEffect(() => {
    if (phase !== "flying" || shots.length === 0) return;
    const timers: number[] = [];
    shots.forEach((shot) => {
      timers.push(
        window.setTimeout(
          () => setLanded((now) => Math.max(now, shot.index + 1)),
          shot.delay + schedule.flyMs,
        ),
      );
    });
    const last = shots[shots.length - 1];
    timers.push(window.setTimeout(() => setPhase("settling"), last.delay + schedule.flyMs + LAND_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [phase, shots, schedule]);

  // 停留 + 淡出走完 → 收场
  useEffect(() => {
    if (phase !== "settling") return;
    const id = window.setTimeout(
      () => handlers.current.onDone(),
      schedule.holdMs + COUNTER_FADE_MS,
    );
    return () => window.clearTimeout(id);
  }, [phase, schedule]);

  /**
   * 跳过：点屏幕任意处（或按 Esc）—— 剩下的书瞬间全部归位，计数器直接显示 N/N，
   * 然后照常停留 + 淡出。已经收场了就不再理它。
   */
  function skip() {
    setPhase((now) => (now === "settling" ? now : "settling"));
    setLanded(total);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      skip();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // 订阅一次就够：skip 只用 setState（函数式更新），不依赖任何会变的值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 一本飞行物的全部变量：起飞点 / 落点 / 起飞延迟 / 落地延迟 / 三个时长 /
   * 篮口那一叠的偏移 / 封面色。CSS 那边 `@keyframes` 直接吃这些变量。
   */
  function flyStyle(shot: (typeof shots)[number]): CSSProperties {
    const palette = paletteOf(shot.spec);
    return {
      "--sx": `${launch.x.toFixed(1)}px`,
      "--sy": `${launch.y.toFixed(1)}px`,
      "--ex": `${shot.ex.toFixed(1)}px`,
      "--ey": `${shot.ey.toFixed(1)}px`,
      "--arc": `${shot.arc.toFixed(1)}px`,
      "--delay": `${shot.delay}ms`,
      "--land-delay": `${shot.delay + schedule.flyMs}ms`,
      "--fly-ms": `${schedule.flyMs}ms`,
      "--rise-ms": `${RISE_MS}ms`,
      "--land-ms": `${LAND_MS}ms`,
      "--fan-x": `${shot.fan.x.toFixed(1)}px`,
      "--fan-y": `${shot.fan.y.toFixed(1)}px`,
      "--fan-rot": `${shot.fan.rot.toFixed(1)}deg`,
      "--cover-from": palette.from,
      "--cover-to": palette.to,
      "--cover-ink": palette.ink,
      "--cover-accent": palette.accent,
    } as CSSProperties;
  }

  // 计数器：贴在篮口正上方；篮子贴着屏幕左边，所以中心再往右夹一道，别半个身子探出窗外
  const counterX = Math.max(COUNTER_MIN_X, launch.x);
  const counterY = launch.y - COUNTER_LIFT;

  return (
    <div
      className={`import-flight ${phase}`}
      onClick={skip}
      title="点任意处跳过（Esc 也可以）"
      aria-label={total > 1 ? `正在把 ${total} 本书放上书架` : "正在把这本书放上书架"}
      // 收场那两个时长也交给 CSS（`.import-flight.settling` 的动画延迟/时长），
      // 免得 CSS 里的默认值和 JS 这边的常量各说各话
      style={
        {
          "--counter-hold": `${schedule.holdMs}ms`,
          "--counter-fade": `${COUNTER_FADE_MS}ms`,
        } as CSSProperties
      }
    >
      {/* 飞行物：一本一张封面卡。开飞前它们就摆在篮口（keyframes 的 0% 帧就是那儿）；
          `.offscreen` 那几本是落在别的屏上的：朝那一屏飞出画外、到那儿淡出 */}
      {phase !== "settling"
        ? shots.map((shot) => (
            <span
              key={shot.book.id}
              className={`import-fly${shot.offscreen ? " offscreen" : ""}`}
              style={flyStyle(shot)}
            >
              <span className="fly-arc">
                <span className="fly-card">
                  <span className="cover-band" />
                  <span
                    className={`cover-initials ${
                      shot.spec.initials.length > 1 ? "two" : "one"
                    }`}
                  >
                    {shot.spec.initials}
                  </span>
                </span>
              </span>
            </span>
          ))
        : null}

      {/* 计数器：一张贴在篮子上方的便签（一本不用数，所以只有一本时不出现） */}
      {total > 1 ? (
        <div
          className="import-counter"
          style={{ left: `${counterX.toFixed(1)}px`, top: `${counterY.toFixed(1)}px` }}
          role="status"
          aria-live="polite"
        >
          已归位{" "}
          {/* key 换一下就重挂一次：数字是「滚」进来的，而不是直接跳 */}
          <span className="counter-num" key={landed}>
            {landed}
          </span>
          /{total} 本
        </div>
      ) : null}

      {phase !== "settling" ? <span className="import-skip-hint">点任意处跳过</span> : null}
    </div>
  );
}
