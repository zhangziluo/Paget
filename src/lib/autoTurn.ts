/**
 * 自动翻页（免手翻）的纯逻辑 —— 与终端阅读器 `core/wreader/reader.py` 的 `auto_scroll_*`
 * 同一套语义，只是时间单位换成毫秒（前端只有 `Date.now()`）。
 *
 * 规矩（改一处就要两边一起改，注释里对着 reader.py 的名字写）：
 *
 * 1. **打开时排到一整拍之后**（`set_auto_scroll`）：刚打开不会立刻把页面抢走；
 * 2. **任何输入都往后推一整拍**（`defer_auto_scroll`）：人在自己读的时候，计时器不许抢页面；
 * 3. 每一拍前进 `step` 个单位 —— 文字是**屏幕行**，图片是**页**（见 `autoTurnPace` 的 `unit`）；
 * 4. **连续 `checkMinutes` 分钟**弹一道算术小校验题（`_make_auto_check_question`）；
 *    **点任一选项都算作答**（题只证明"人还在桌前"），`checkWait` 秒内没人作答就停下来；
 * 5. 没有可前进的余地（读到末尾）时由调用方停下来，并说清原因。
 *
 * 全是纯函数：状态进、状态出，时间由调用方给 —— 所以它能用 `npx tsx` 一条条钉住，
 * 不必开浏览器。
 */

/** 速度可调范围（秒）：与 reader.py 的 `AUTO_SCROLL_MIN/MAX_INTERVAL` 一致。 */
export const AUTO_TURN_MIN_INTERVAL = 0.5;
export const AUTO_TURN_MAX_INTERVAL = 600;
/** 一道校验题给几个选项（1 个正确 + 3 个干扰项）。 */
export const AUTO_CHECK_CHOICES = 4;

/** 一道「人还在吗」的算术题（终端的 `_make_auto_check_question`）。 */
export type AutoCheck = {
  /** 题目，如 `37 + 25` */
  prompt: string;
  /** 正确答案（答错也放过，只用来提示） */
  answer: string;
  /** 选项（含正确答案） */
  choices: string[];
  /** 正确答案在 `choices` 里的下标 */
  correct: number;
};

/** 自动翻页的全部状态（时间戳都是毫秒）。 */
export type AutoTurnState = {
  /** 开着没有 */
  on: boolean;
  /** 每一拍几秒 */
  interval: number;
  /** 每一拍前进几个单位（文字 = 屏幕行；图片 = 页） */
  step: number;
  /** 下一次翻页的时刻（ms；0 = 没排） */
  deadline: number;
  /** 多久弹一次校验题（秒；0 = 不校验） */
  checkPeriod: number;
  /** 弹题后等几秒（秒） */
  checkWait: number;
  /** 该弹题的时刻（ms；0 = 没排） */
  checkDeadline: number;
  /** 屏上那道题的最晚作答时刻（ms；0 = 屏上没有题） */
  checkUntil: number;
  /** 屏上那道题（null = 没有） */
  question: AutoCheck | null;
};

/** Clamp one interval into the range both front ends share. */
export function clampAutoInterval(seconds: number): number {
  // 非数字 / 非正数都退回默认值，免得算出"每 0 秒一翻"这种疯狂节奏
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
  return Math.min(AUTO_TURN_MAX_INTERVAL, Math.max(AUTO_TURN_MIN_INTERVAL, value));
}

/** A fresh, **off** state built from the core's four settings. */
export function initialAutoTurn(
  interval: number,
  step: number,
  checkMinutes: number,
  checkSeconds: number,
): AutoTurnState {
  // 初始一律是关着的：开不开由读者点，不由上次会话决定（终端也一样）
  return {
    on: false,
    interval: clampAutoInterval(interval),
    // 每次至少前进一个单位（终端的 max(1, int(step))）
    step: Math.max(1, Math.trunc(Number.isFinite(step) && step > 0 ? step : 1)),
    deadline: 0,
    // 0 = 不校验；负数也当 0
    checkPeriod: Math.max(0, Number.isFinite(checkMinutes) ? checkMinutes * 60 : 0),
    checkWait: Math.max(0, Number.isFinite(checkSeconds) ? checkSeconds : 0),
    checkDeadline: 0,
    checkUntil: 0,
    question: null,
  };
}

/** Arm the next quiz one period ahead; an already armed one is left alone. */
function scheduleAutoCheck(state: AutoTurnState, now: number): AutoTurnState {
  // 校验关着（period 为 0）或自动翻页没开：不排期
  if (!state.on || state.checkPeriod <= 0) {
    return { ...state, checkDeadline: 0 };
  }
  // 已经排过：原样留着 —— 每一拍都重排会让这道题永远不弹
  if (state.checkDeadline) return state;
  return { ...state, checkDeadline: now + state.checkPeriod * 1000 };
}

/** 开 / 关自动翻页（终端的 `set_auto_scroll`）。 */
export function setAutoTurn(state: AutoTurnState, on: boolean, now = Date.now()): AutoTurnState {
  // 开着就把下一次排到一整拍之后；关掉时清零，下次打开才不会立刻翻
  const armed: AutoTurnState = { ...state, on, deadline: on ? now + state.interval * 1000 : 0 };
  // 关掉时连"在等作答的题"一起收掉：屏幕上不该留一道没人管的题
  const cleared: AutoTurnState = on ? armed : { ...armed, question: null, checkUntil: 0 };
  // 校验计时按"这一次连续自动翻页"从头算（关着时它会顺手清掉排期）
  return scheduleAutoCheck(cleared, now);
}

/** Push the next turn back by one full interval（终端的 `defer_auto_scroll`）。 */
export function deferAutoTurn(state: AutoTurnState, now = Date.now()): AutoTurnState {
  // 没开着：没什么可推的
  if (!state.on) return state;
  // 从"现在"重新排期（间隔可能刚在「阅读设置」里改过，所以每次都现读 state.interval）
  return { ...state, deadline: now + state.interval * 1000 };
}

/** Seconds until the next turn（终端的 `auto_scroll_wait`；没开就是 null）。 */
export function autoTurnWait(state: AutoTurnState, now = Date.now()): number | null {
  // 关着的时候不存在"下一次"
  if (!state.on) return null;
  // 已经过点的返回 0，调用方不用处理负数
  return Math.max(0, (state.deadline - now) / 1000);
}

/**
 * Turn the page when the interval has elapsed（终端的 `auto_scroll_tick`）。
 *
 * Returns the new state plus whether a turn is due.  The caller does the moving
 * (screen rows for text, pages for pictures) and decides what "no room left"
 * means, because only it knows the layout; a due beat re-arms immediately, so a
 * queued deadline stays "the next beat" instead of a backlog.
 */
export function tickAutoTurn(
  state: AutoTurnState,
  now = Date.now(),
): { state: AutoTurnState; turn: boolean } {
  // 没开着 / 没排期（0 = 没排，见 beginAutoCheck）/ 还没到点：都不翻
  if (!state.on || !state.deadline || now < state.deadline) return { state, turn: false };
  // 到点了：先把时刻推到下一拍（真正移动由调用方做）
  return { state: { ...state, deadline: now + state.interval * 1000 }, turn: true };
}

/** ``true`` when a quiz is owed right now（终端的 `auto_check_due`）。 */
export function autoCheckDue(state: AutoTurnState, now = Date.now()): boolean {
  // 没开自动翻页 / 没排期 / 屏上已经有一道题：都不弹
  if (!state.on || !state.checkDeadline || state.question) return false;
  return now >= state.checkDeadline;
}

/** Put a question on screen and start its countdown（终端的 `begin_auto_check`）。 */
export function beginAutoCheck(
  state: AutoTurnState,
  question: AutoCheck,
  now = Date.now(),
): AutoTurnState {
  return {
    ...state,
    question,
    checkUntil: now + state.checkWait * 1000,
    // 弹题期间不翻页：等结算之后再重新排一拍，免得文字在题目背后自己走
    deadline: 0,
  };
}

/**
 * Settle the quiz（终端的 `resolve_auto_check`）。
 *
 * **Any** choice counts: the point is to prove somebody is at the keyboard, not
 * to test arithmetic, so a wrong answer still continues.  No answer at all
 * (countdown over, or an explicit stop) switches the mode off -- a hands-free
 * reader scrolling for nobody is the whole problem this check exists for.
 */
export function resolveAutoCheck(
  state: AutoTurnState,
  answered: boolean,
  now = Date.now(),
): { state: AutoTurnState; keep: boolean } {
  // 先把屏幕上的题收掉，并把校验排期清零（下一轮要从头计时）
  const cleared: AutoTurnState = {
    ...state,
    question: null,
    checkUntil: 0,
    checkDeadline: 0,
  };
  // 没作答：停掉自动翻页（调用方负责把那句"为什么停"说出来）
  if (!answered) {
    return { state: setAutoTurn(cleared, false, now), keep: false };
  }
  // 作答了（对错都算）：继续，并把下一次翻页排到一整拍之后
  return { state: deferAutoTurn(setAutoTurn(cleared, true, now), now), keep: true };
}

/** Seconds left on the quiz on screen（终端的 `auto_check_remaining`）。 */
export function autoCheckRemaining(state: AutoTurnState, now = Date.now()): number {
  // 屏上没有题：没有倒计时
  if (!state.question) return 0;
  return Math.max(0, (state.checkUntil - now) / 1000);
}

/**
 * Apply freshly read settings to a running state（阅读页里改完设置立刻生效那一手）。
 *
 * 换掉「下一次从哪读」的几项，并**按新节奏从"现在"重排下一拍** —— 与终端改完速度就
 * `defer_auto_scroll` 一个道理：不改排期的话，把间隔从 60 秒调到 0.5 秒之后，
 * 用户还得再干等 60 秒才等到第一拍，看着像没生效。
 *
 * 两件事**一律不动**：开关（改个节奏不该把自动翻页关掉）、屏上正等作答的那道题
 * （连它的倒计时一起留着）。校验周期真变了才把下一道题按新周期重排。
 */
export function reconfigureAutoTurn(
  state: AutoTurnState,
  interval: number,
  step: number,
  checkMinutes: number,
  checkSeconds: number,
  now = Date.now(),
): AutoTurnState {
  const fresh = initialAutoTurn(interval, step, checkMinutes, checkSeconds);
  const next: AutoTurnState = {
    ...state,
    interval: fresh.interval,
    step: fresh.step,
    checkPeriod: fresh.checkPeriod,
    checkWait: fresh.checkWait,
  };
  // 没开着 / 屏上正有一道题：没有"下一拍"要排（题在屏上时 deadline 本来就是 0）
  if (!next.on || next.question) return next;
  // 开着：下一拍按新节奏从现在起算
  const armed: AutoTurnState = { ...next, deadline: now + next.interval * 1000 };
  // 校验周期变了：下一道题也按新周期重排（旧周期已经不作数了）
  if (next.checkPeriod !== state.checkPeriod) {
    return scheduleAutoCheck({ ...armed, checkDeadline: 0 }, now);
  }
  return armed;
}

/** Describe the pace, e.g. ``每 5 秒 1 行（12 行/分钟）``. */
export function autoTurnPace(state: AutoTurnState, unit: "行" | "页"): string {
  // 每分钟走几个单位：把"速度"换算成一个更直观的数字（终端也是这么说的）
  const perMinute = (state.step * 60) / state.interval;
  const seconds = Number.isInteger(state.interval) ? String(state.interval) : state.interval.toFixed(1);
  const rate = perMinute >= 10 ? String(Math.round(perMinute)) : perMinute.toFixed(1);
  return `每 ${seconds} 秒 ${state.step} ${unit}（${rate} ${unit}/分钟）`;
}

/** One number in ``0..max``, using *random* (injected so tests can pin it). */
function pickInt(random: () => number, max: number): number {
  // 夹住：随机源被替换成常数时也不越界
  const value = Math.floor(random() * (max + 1));
  return Math.min(max, Math.max(0, value));
}

/**
 * Build one four-choice arithmetic question, everything within 100.
 *
 * Same shape and same ranges as the terminal's `_make_auto_check_question`, so a
 * reader cannot tell which front end asked.  *random* is injectable: a test can
 * pin one question down instead of hoping for it.
 */
export function makeAutoCheck(random: () => number = Math.random): AutoCheck {
  // 先摇一个运算符出来（+ - * /），再按它挑操作数
  const operator = ["+", "-", "*", "/"][pickInt(random, 3)];
  let left = 0;
  let right = 0;
  let result = 0;
  if (operator === "+") {
    // 和不超过 100：先挑第一个加数，第二个只能填剩下的额度
    left = 1 + pickInt(random, 98);
    right = 1 + pickInt(random, 100 - left - 1);
    result = left + right;
  } else if (operator === "-") {
    // 被减数不超过 100，结果至少 1（不做"减到 0"这种送分题）
    left = 2 + pickInt(random, 98);
    right = 1 + pickInt(random, left - 2);
    result = left - right;
  } else if (operator === "*") {
    // 积不超过 100：两个因数取 2~10
    left = 2 + pickInt(random, 8);
    right = 2 + pickInt(random, Math.max(0, Math.floor(100 / left) - 2));
    result = left * right;
  } else {
    // 除法要整除：先挑除数与商，再乘出被除数（被除数也不会超过 100）
    right = 2 + pickInt(random, 8);
    const quotient = 2 + pickInt(random, Math.max(0, Math.floor(100 / right) - 2));
    result = quotient;
    left = right * quotient;
  }
  // 干扰项候选：答案附近的几个数（差 1、2、10），夹进 0~100 且不与答案重复
  const pool = [
    result + 1,
    result - 1,
    result + 2,
    result - 2,
    result + 10,
    result - 10,
  ].filter((value) => value >= 0 && value <= 100 && value !== result);
  // 洗一洗再取前几个（偏移量两两不同，所以这一批里不会自己撞车）
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = pickInt(random, index);
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  const choices = pool.slice(0, AUTO_CHECK_CHOICES - 1).map(String);
  // 候选不够时（答案是 1 或 100 这类贴边值）用随机数补足，同样不许重复
  while (choices.length < AUTO_CHECK_CHOICES - 1) {
    const filler = String(pickInt(random, 100));
    if (filler !== String(result) && !choices.includes(filler)) choices.push(filler);
  }
  // 正确选项插在随机位置：不然"总是按第 1 个"就能过关
  const correct = pickInt(random, AUTO_CHECK_CHOICES - 1);
  choices.splice(correct, 0, String(result));
  return { prompt: `${left} ${operator} ${right}`, answer: String(result), choices, correct };
}
