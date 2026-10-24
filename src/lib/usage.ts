/**
 * 软件使用时间：**读书以外**在应用里停留的时长（书房 / 日记 / 勋章 / 设置与数据 / 已归档）。
 *
 * 为什么要单独记：内核的 `stats` 只认阅读（翻开一本书之后的 `session`），
 * 而「在这台软件上待了多久」不是读书数据 —— 内核不认识页面，也不该为界面记秒表。
 * 所以这一份留在本机 `localStorage`（键 `paget.usage.v1`），与玩偶摆法 / 白噪音同一个道理。
 *
 * 口径：
 * - 只算**窗口可见且在前台**、且**不在阅读页**的时间；
 * - 阅读页（文字 / PDF）的时间归内核的阅读统计，这里不重复记；
 * - 每秒一跳，5 秒落一次盘，暂停 / 隐藏 / 关窗时再补一笔；
 * - 只按定时器跳数累计，不按墙钟差值补 —— 系统睡眠回来不会一口气多出几个小时。
 *
 * 模块里只留一份 `cachedSeconds`：`useUsageTracker` 在 `App` 顶上走秒，
 * `useUsageSeconds` 在日记页订阅 —— 这样每秒的更新不会把整个书架重渲染一遍。
 *
 * 同一份计时还负责「🙈 我不看书」：它记**这一次运行**里的单次非阅读时长（沉浸模式
 * 另记一条连续时长，关掉沉浸就归零），每 5 分钟把当前峰值交给内核记进度 ——
 * 内核只存最大值，所以跨次启动的累计不会把这条成就凑出来。
 */

import { useEffect, useSyncExternalStore } from "react";

/** 本机存档的键（带版本号：形状变了换它，老键留着不动）。 */
export const USAGE_STORE_KEY = "paget.usage.v1";

/** 一跳一秒；落盘与界面刷新都按这个节奏。 */
const TICK_MS = 1_000;

/** 每走过这么多跳落一次盘（暂停 / 隐藏 / 关窗时也会落盘）。 */
const SAVE_EVERY_TICKS = 5;

/** 成就「我不看书」的门槛：单次满一小时。 */
export const NOT_READING_SECONDS = 3_600;

/** 进度上报的步长：每多 5 分钟告诉内核一次，勋章页的进度条才会动。 */
const REPORT_STEP_SECONDS = 5 * 60;

/** 上报失败（内核没起来）时，隔一分钟再试，别每秒都去敲门。 */
const REPORT_RETRY_MS = 60_000;

/** 一次异步上报：参数是当前的单次峰值秒数。 */
export type UsageReporter = (seconds: number) => void | Promise<unknown>;

type UsageStore = {
  seconds: number;
};

/** 模块里的那一份总秒数；`null` = 还没从本机读回来。 */
let cachedSeconds: number | null = null;

/**
 * 这一次运行里的非阅读秒数。
 *
 * 模块加载 = 程序启动，所以它天然「跨次启动不累计」；翻开书时停表，但不归零 ——
 * 阅读也算同一次使用，只是那段时间归内核的阅读统计。
 */
let runSeconds = 0;

/** 当前这一段连续沉浸模式的秒数；关掉沉浸 / 退出重开就归零。 */
let immersiveSeconds = 0;

/** 上一次 effect 建立时沉浸模式是不是开着（`paused` 变化让 effect 重跑时不能把沉浸计时清掉）。 */
let immersiveWasOn = false;

/** 已经成功上报到内核的峰值；下一次要多走 5 分钟才再报。 */
let reportedSeconds = 0;

/** 正在上报（避免同一秒发两次）。 */
let reporting = false;

/** 上次尝试上报的时刻（失败后按 `REPORT_RETRY_MS` 退避）。 */
let lastAttemptAt = 0;

/** 日记页的订阅者（书架不订阅，所以每秒走秒不会重渲染书房）。 */
const listeners = new Set<() => void>();

/** 本机的储物柜；没有 window（非浏览器环境）或访问就抛（隐私模式）时退化成「不存」。 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 归一化一份存档：只认**非负整数秒**。
 *
 * 兼容三种输入：`{ seconds: 123 }`（现在的形状）、裸数字 `123`（早先可能写成过这样）、
 * 数字字符串 `"123"`。坏值 / 负数 / 小数一律兜成 0 —— 统计页宁可显示「刚开始记」，
 * 也不能因为一份坏存档报 `NaN`。
 */
export function normalizeUsageSeconds(input: unknown): number {
  let value: unknown = input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    value = (input as Partial<UsageStore>).seconds;
  }
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** 读回总秒数；没存过 / 读坏了都回 0，不该因为一个统计打不开日记页。 */
export function loadUsageSeconds(): number {
  const shelf = storage();
  if (!shelf) return 0;
  try {
    const raw = shelf.getItem(USAGE_STORE_KEY);
    if (!raw) return 0;
    return normalizeUsageSeconds(JSON.parse(raw));
  } catch {
    return 0;
  }
}

/** 写回总秒数；写不进去（配额满 / 隐私模式）只影响下次启动，不抛。 */
export function saveUsageSeconds(seconds: number): void {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  try {
    storage()?.setItem(USAGE_STORE_KEY, JSON.stringify({ seconds: value } satisfies UsageStore));
  } catch {
    // 存不上也比把书房搞崩强
  }
}

/** 当前累计秒数（首次调用时从本机读档）。 */
export function getUsageSeconds(): number {
  if (cachedSeconds === null) cachedSeconds = loadUsageSeconds();
  return cachedSeconds;
}

/** 日记页订阅「又过了一秒」；返回退订函数。 */
export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 把新的一秒告诉所有订阅者（只有日记页真的在听）。 */
function emitUsage(): void {
  for (const listener of listeners) listener();
}

/**
 * 现在算不算「在用软件」。
 *
 * 三个条件缺一不可：**没在读书**、**页面可见**、**窗口在前台**。
 * 窗口被别的应用盖住 / 系统弹了文件选择框 / 应用被最小化时都不算 ——
 * 否则把设置页开着去吃饭，这一项会一直涨。
 */
function isActive(paused: boolean): boolean {
  return (
    !paused &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

/**
 * 把当前的单次峰值交给内核（成就「我不看书」）。
 *
 * 只在跨过 5 分钟刻度时上报，满一小时的那一秒一定会上报一次。内核只存最大值，
 * 因此这份上报只是让进度条能动，不会把多次启动的时长加成总额。上报失败就退避
 * 一分钟再试；成功后 `reportedSeconds` 往前推，直到一小时为止。
 */
function reportPeak(report?: UsageReporter): void {
  if (!report || reporting) return;
  const peak = Math.max(runSeconds, immersiveSeconds);
  if (peak <= 0) return;
  // 一小时以内每 5 分钟一报；满一小时必须报（哪怕刚好卡在 3600）
  const due =
    peak >= NOT_READING_SECONDS
      ? reportedSeconds < NOT_READING_SECONDS
      : peak >= reportedSeconds + REPORT_STEP_SECONDS;
  if (!due) return;
  const now = Date.now();
  if (now - lastAttemptAt < REPORT_RETRY_MS) return;
  lastAttemptAt = now;
  reporting = true;
  Promise.resolve()
    .then(() => report(peak))
    .then(() => {
      reportedSeconds = Math.max(reportedSeconds, peak);
    })
    .catch(() => {
      // 内核暂时不在（重启中 / 崩了）：下一次退避结束再试
    })
    .finally(() => {
      reporting = false;
    });
}

/**
 * 在 `App` 顶上走秒：传 `paused = true` 时停表（阅读页）。
 *
 * `immersive` 是书房沉浸模式开着没有；`report` 用来把单次峰值交给内核
 * （成就「我不看书」）。不返回 state：它只负责把模块里的总数往前推，
 * 日记页自己订阅。
 */
export function useUsageTracker(
  paused: boolean,
  immersive = false,
  report?: UsageReporter,
): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    getUsageSeconds();
    // 沉浸模式刚开始：连续沉浸计时从 0 起；关掉则清零。`paused` 变化让
    // effect 重跑时 `immersiveWasOn` 仍是 true，所以不会把一段沉浸切碎。
    if (!immersive) {
      immersiveSeconds = 0;
      immersiveWasOn = false;
    } else if (!immersiveWasOn) {
      immersiveSeconds = 0;
      immersiveWasOn = true;
    }
    let ticksSinceSave = 0;
    let stopped = false;

    const save = () => {
      if (cachedSeconds !== null) saveUsageSeconds(cachedSeconds);
      ticksSinceSave = 0;
    };

    const tick = () => {
      if (!isActive(paused)) return;
      cachedSeconds = getUsageSeconds() + 1;
      // 这一次运行的单次时长：阅读时停表、但不归零（仍属同一次启动）
      runSeconds += 1;
      // 连续沉浸时长：只在这一段沉浸里累加，关掉就归零
      if (immersive) immersiveSeconds += 1;
      emitUsage();
      reportPeak(report);
      ticksSinceSave += 1;
      if (ticksSinceSave >= SAVE_EVERY_TICKS) save();
    };

    const id = window.setInterval(tick, TICK_MS);

    // 隐藏 / 失焦 / 关窗时先落盘：内存里那一秒不会因为切走就丢掉
    const onVisibility = () => {
      if (document.visibilityState !== "visible") save();
    };
    const onBlur = () => save();
    const onPageHide = () => save();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      save();
    };
  }, [paused, immersive, report]);
}

/**
 * 日记页读当前累计秒数：`useSyncExternalStore` 让订阅只发生在这一页。
 *
 * 服务端（SSR 冒烟）没有 `window`，`getUsageSeconds()` 会回 0，与客户端首帧一致。
 */
export function useUsageSeconds(): number {
  return useSyncExternalStore(subscribeUsage, getUsageSeconds, getUsageSeconds);
}
