/**
 * 「导入飞行动画」的节奏（纯函数与常量，与 DOM 无关）。
 *
 * 这里只管**时间**：每本隔多久起飞、单本飞多久、收场前停多久。怎么画
 * （位移、抛物线、拖尾、计数器）在 `components/ImportFlight.tsx` 与 `App.css` 里。
 *
 * 队列越长节奏越紧：十本书若一本挨一本 1.3 秒地飞完要十几秒，没人愿意站着看 ——
 * 所以 6 本起加密间隔、再把单本飞行提速 20%。
 */

/** 「导入后放不放飞行动画」这个界面偏好存在本机 `gui_settings` 的哪个键（内核不认识它）。 */
export const IMPORT_FLIGHT_KEY = "shelf.import_flight";

/** 升起（封面从篮口立起来那 0.3s）—— 与飞行开头重叠，不是串行。 */
export const RISE_MS = 300;

/** 单本从篮子飞到书脊（飞行动画的主段）。 */
export const FLY_MS = 800;

/** 落地那下「啪」的弹性缩放。 */
export const LAND_MS = 200;

/** 篮子把这一批的封面「吐」出来、摆在篮口的那一下（之后才开始逐本起飞）。 */
export const STACK_MS = 520;

/** 全部归位后，计数器停留多久再淡出。 */
export const HOLD_MS = 1500;

/** 计数器（连同整层）淡出用多久 —— 在 `HOLD_MS` 之后才开始。 */
export const COUNTER_FADE_MS = 420;

/** 一次导入的节奏。 */
export type FlightSchedule = {
  /** 相邻两本起飞之间隔多久（毫秒） */
  staggerMs: number;
  /** 单本从篮子飞到书脊用多久（毫秒） */
  flyMs: number;
  /** 全部归位后，计数器停留多久再淡出（毫秒） */
  holdMs: number;
};

/**
 * 队列越短越从容、越长越紧凑：
 *
 * - **1 本**：没有间隔（也就没有计数器 —— 一本不用数，见 `ImportFlight`）；
 * - **2–5 本**：300ms 一本，看得清每一条弧线；
 * - **6 本以上**：加密到 150ms，单本飞行再提速 20%（`FLY_MS * 0.8`）。
 *
 * 10 本以上在 M1 里仍走「6 本以上」这一档（每 3 本并行起飞是后面的里程碑）。
 * 坏值（0 / 负数 / NaN）一律当 1 本处理 —— 调用方永远不会拿到负的间隔。
 */
export function flightSchedule(count: number): FlightSchedule {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (total <= 1) return { staggerMs: 0, flyMs: FLY_MS, holdMs: HOLD_MS };
  if (total <= 5) return { staggerMs: 300, flyMs: FLY_MS, holdMs: HOLD_MS };
  return { staggerMs: 150, flyMs: Math.round(FLY_MS * 0.8), holdMs: HOLD_MS };
}

/** 第 *index* 本什么时候起飞（毫秒；坏值夹回 0）。 */
export function flightStartMs(schedule: FlightSchedule, index: number): number {
  const at = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return at * schedule.staggerMs;
}

/**
 * 整段飞行动画（不含最后那 1.5s 停留）要多久：最后一本落地 + 弹一下。
 *
 * 抽出来是因为「什么时候可以收场」也得有个确定的数 —— 组件靠它（其实靠逐本落地的
 * 计时器）收场，测试直接断言它。
 */
export function flightTotalMs(count: number): number {
  const schedule = flightSchedule(count);
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  return flightStartMs(schedule, total - 1) + schedule.flyMs + LAND_MS;
}

/**
 * 这个偏好怎么读：只有明确的 `"off"` 才算关，其余（没存过 / 存坏了 / 认不出的值）
 * 一律当**开** —— 新装的人先看到飞行动画，不想要再去设置里关掉。
 */
export function normalizeImportFlight(raw: unknown): boolean {
  return raw !== "off";
}

/** 飞到别的屏时，终点再往外挪多少（px）—— 卡片整个出画，别在边上留半张脸。 */
export const OFFSCREEN_PX = 160;

/**
 * 这批新书**第一次落地**的那一屏 —— 也就是飞行动画要翻过去的那一屏。
 *
 * 取第一本所在的屏（`pages` 按书序给）。空数组 / 坏值回 0（＝主屏，也就是篮子在的地方）。
 */
export function flightLandingPage(pages: number[]): number {
  const first = pages.find((page) => Number.isFinite(page) && page >= 0);
  return first === undefined ? 0 : Math.floor(first);
}

/**
 * 这本书往哪一边飞出画外：0 = 就在飞行动画那一屏上（正常落地），
 * -1 = 往左（它落在更前面的一屏），1 = 往右（更后面的一屏）。
 */
export function flightSide(page: number, landing: number): -1 | 0 | 1 {
  if (!Number.isFinite(page) || !Number.isFinite(landing)) return 0;
  if (page === landing) return 0;
  return page < landing ? -1 : 1;
}

/** 一本飞行物的终点。 */
export type FlightEnd = {
  /** 终点（视口坐标，px） */
  ex: number;
  ey: number;
  /** 是不是「飞到别的屏上去了」（终点在画外，落地那一下换成淡出） */
  offscreen: boolean;
};

/**
 * 一本书飞到哪儿。
 *
 * - 落点在**这一屏**（`target` 量到了）：就是那一格的正中 —— 与 M1 一样；
 * - 落在**别的屏**（那一格这会儿不在 DOM 里，量不到 → `target === null`）：
 *   朝那一屏的方向飞出画外，高度保持**起飞高度**（篮口那一条），
 *   看着就是「飞到旁边的书架上去了」；到画外那一下淡出收场（CSS 的 `.offscreen`）。
 *
 * 起点 / 视口宽度都从外面传进来，所以这是个纯函数，`/tmp/importflight-check.ts` 直接断言。
 */
export function flightEnd(params: {
  /** 量到的落点（书脊格子）；量不到就是 null */
  target: { x: number; y: number; width: number; height: number } | null;
  /** 这本书在哪一屏 */
  page: number;
  /** 飞行动画在哪一屏 */
  landing: number;
  /** 起飞点（篮口正中） */
  launch: { x: number; y: number };
  /** 视口宽度 */
  viewportWidth: number;
}): FlightEnd {
  const { target, page, landing, launch } = params;
  if (target) {
    return { ex: target.x + target.width / 2, ey: target.y + target.height / 2, offscreen: false };
  }
  const side = flightSide(page, landing);
  const width = Number.isFinite(params.viewportWidth) ? params.viewportWidth : 0;
  return {
    ex: side < 0 ? -OFFSCREEN_PX : width + OFFSCREEN_PX,
    ey: launch.y,
    offscreen: true,
  };
}
