/**
 * 自动翻页的 React 壳：把 `autoTurn.ts` 那套纯状态机接到计时器、内核设置与输入上。
 *
 * 为什么住在 `lib/` 而不是某个组件里：**两个阅读页都要同一份行为**（文字 `Reader.tsx`
 * 滚「屏幕行」、图片 `PdfReader.tsx` 翻「页」），只有"前进什么"不同 —— 那是调用方传进来的
 * `advance(step)`。
 *
 * 四件事都在这儿收口：
 *
 * * 从内核读四个设置（`reader.auto_scroll_*`，缺了 / 读不到就用终端那套默认值）；
 * * 250 ms 心跳：到点就 `advance(step)`；该弹校验题就弹；题在屏上就不再翻页；
 * * **任何输入都推后一整拍**（滚轮 / 按键 / 触摸 / 点击）—— 与终端每次按键都
 *   `defer_auto_scroll` 同理：人在自己读时，计时器不许抢页面；
 * * 校验题超时没人作答 → 停掉，并把「为什么停」交给 `onStop` 说出来。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { configGet } from "./core";
import {
  autoCheckDue,
  autoCheckRemaining,
  autoTurnPace,
  beginAutoCheck,
  deferAutoTurn,
  initialAutoTurn,
  makeAutoCheck,
  reconfigureAutoTurn,
  resolveAutoCheck,
  setAutoTurn,
  tickAutoTurn,
  type AutoCheck,
  type AutoTurnState,
} from "./autoTurn";

/** 心跳：250 ms 一跳（终端是 50 ms 轮询，前端不必那么勤） */
const HEARTBEAT_MS = 250;
/** 设置里的四个键（与 `core/wreader/config.py` 的 reader 段同名） */
const INTERVAL_KEY = "reader.auto_scroll_interval";
const STEP_KEY = "reader.auto_scroll_step";
const CHECK_MINUTES_KEY = "reader.auto_scroll_check_minutes";
const CHECK_SECONDS_KEY = "reader.auto_scroll_check_seconds";
/** 内核读不到时的兜底（与终端的 DEFAULT_AUTO_* 一致） */
const FALLBACK_INTERVAL = 5;
const FALLBACK_STEP = 1;
const FALLBACK_CHECK_MINUTES = 10;
const FALLBACK_CHECK_SECONDS = 30;

/** Read one numeric setting, falling back when it is missing or nonsense. */
function numberSetting(values: Record<string, unknown>, key: string, fallback: number): number {
  // 内核给的值可能是字符串（settings.toml 里手写的），所以先 Number()
  const value = Number(values[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** What the two readers get back from [`useAutoTurn`]. */
export type AutoTurn = {
  /** 开着没有 */
  on: boolean;
  /** 节奏提示，如「每 5 秒 1 行（12 行/分钟）」 */
  pace: string;
  /** 开 / 关（顶栏那颗按钮） */
  toggle: () => void;
  /** 停掉（调用方判定"读到末尾"时喊的） */
  stop: () => void;
  /** 重新读一遍那四项设置（阅读页里改完设置，立刻按新节奏走） */
  reload: () => void;
  /** 屏上的校验题（null = 没有） */
  check: AutoCheck | null;
  /** 这道题还剩几秒 */
  remaining: number;
  /** 作答（点任一选项都算；作答之后继续翻页） */
  answer: () => void;
};

export function useAutoTurn(options: {
  /** 前进一拍；参数是设置里的 `step`（文字 = 屏幕行数，图片 = 页数） */
  advance: (step: number) => void;
  /** 每一拍的单位，只影响提示里的说法 */
  unit: "行" | "页";
  /** 停下来的原因（读到末尾 / 校验没作答）—— 调用方负责显示出来 */
  onStop: (reason: string) => void;
}): AutoTurn {
  // 设置读回来之前是 null：宁可按钮先没反应，也不要拿错节奏先翻起来
  const [state, setState] = useState<AutoTurnState | null>(null);
  // 心跳里既要读最新状态、又不能在 setState 的 updater 里做副作用（advance 就是副作用），
  // 所以留一份 ref —— 与 Shelf.tsx 里那些"回调进 ref"的做法同一个理由
  const stateRef = useRef<AutoTurnState | null>(null);
  stateRef.current = state;
  // 最近一次心跳的时刻：校验题在屏上时靠它每秒重画倒计时
  const [clock, setClock] = useState(0);
  // 设置重读的记号：阅读页里改完设置把它 +1，上面那个 effect 就再读一遍
  const [revision, setRevision] = useState(0);
  // 调用方每次渲染给的回调都放进 ref：心跳用的一定是最新那个闭包
  const advanceRef = useRef(options.advance);
  advanceRef.current = options.advance;
  const onStopRef = useRef(options.onStop);
  onStopRef.current = options.onStop;

  // 设置每次读到就灌进去：第一次是建一份新的，之后只换"下一次从哪读"的几项
  // （开关 / 计时 / 屏上的题一律不动，见 reconfigureAutoTurn）
  const applyConfig = useCallback((values: Record<string, unknown>) => {
    const interval = numberSetting(values, INTERVAL_KEY, FALLBACK_INTERVAL);
    const step = numberSetting(values, STEP_KEY, FALLBACK_STEP);
    const minutes = numberSetting(values, CHECK_MINUTES_KEY, FALLBACK_CHECK_MINUTES);
    const seconds = numberSetting(values, CHECK_SECONDS_KEY, FALLBACK_CHECK_SECONDS);
    setState((current) =>
      current
        ? reconfigureAutoTurn(current, interval, step, minutes, seconds)
        : initialAutoTurn(interval, step, minutes, seconds),
    );
  }, []);

  // 设置读一次；`revision` 每变一次再读一次 —— 阅读页那块「阅读设置」里改完靠它立刻生效
  useEffect(() => {
    let alive = true;
    configGet()
      .then((config) => {
        if (alive) applyConfig(config.values ?? {});
      })
      .catch(() => {
        // 内核连不上也得能用：按终端的默认值摆着，按钮照样能开
        if (alive) applyConfig({});
      });
    return () => {
      alive = false;
    };
  }, [applyConfig, revision]);

  // 心跳：只在开着的时候跑（依赖 `state?.on`，开关一次重启一次，别的一律读 ref）
  useEffect(() => {
    if (!state?.on) return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      if (!current?.on) return;
      const now = Date.now();
      // 1) 该弹校验题了：弹（题一上屏就不翻页，见 beginAutoCheck）
      if (autoCheckDue(current, now)) {
        setState(beginAutoCheck(current, makeAutoCheck(), now));
        return;
      }
      // 2) 题在屏上：等作答；倒计时走完就当"没人作答"，停下来
      if (current.question) {
        setClock(now);
        if (autoCheckRemaining(current, now) <= 0) {
          setState(resolveAutoCheck(current, false, now).state);
          onStopRef.current("校验题没有作答，自动翻页已停");
        }
        return;
      }
      // 3) 到点就前进一拍；真正怎么前进由调用方决定（滚屏幕行 / 翻页）
      const ticked = tickAutoTurn(current, now);
      if (!ticked.turn) return;
      setState(ticked.state);
      advanceRef.current(ticked.state.step);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [state?.on]);

  // 任何输入都推后一整拍：只监听"人在这儿"的几种信号，程序自己滚动不算
  useEffect(() => {
    const defer = () => {
      const current = stateRef.current;
      if (!current?.on) return;
      setState(deferAutoTurn(current));
    };
    // pointerdown 覆盖鼠标与触摸；wheel / keydown 是桌面上的另外两种"我在看"
    const names: (keyof WindowEventMap)[] = ["wheel", "keydown", "touchstart", "pointerdown"];
    for (const name of names) window.addEventListener(name, defer, { passive: true });
    return () => {
      for (const name of names) window.removeEventListener(name, defer);
    };
  }, []);

  /** 开 / 关：顶栏那颗按钮走这条。 */
  const toggle = useCallback(() => {
    setState((current) => (current ? setAutoTurn(current, !current.on) : current));
  }, []);

  /** 停掉：调用方判定"读到末尾"时走这条。 */
  const stop = useCallback(() => {
    setState((current) => (current ? setAutoTurn(current, false) : current));
  }, []);

  /** 作答：点任一选项都算（题只证明人还在桌前）。 */
  const answer = useCallback(() => {
    setState((current) => (current ? resolveAutoCheck(current, true).state : current));
  }, []);

  /** 重读设置：阅读页那块「阅读设置」存好一笔就叫一声（只影响节奏，不动开关）。 */
  const reload = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  return {
    on: state?.on ?? false,
    pace: state ? autoTurnPace(state, options.unit) : "",
    toggle,
    stop,
    reload,
    check: state?.question ?? null,
    // 题在屏上时才倒计时（clock 每次心跳都变，所以这里会跟着重画）
    remaining: state?.question ? autoCheckRemaining(state, clock || Date.now()) : 0,
    answer,
  };
}