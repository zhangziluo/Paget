/**
 * 统计页的措辞层（纯函数，不碰 DOM、不碰内核）。
 *
 * 这一层只干一件事：**把内核回来的数字换成一句人话**。一个数字都不重算 ——
 * 所有入参都是 `StatsReport`（内核 `stats.build_report` 那份统计报告）
 * 里现成的秒数 / 天数 / 计数，由 `views/Stats.tsx` 原样递进来。
 *
 * 单独成一层是为了能在 node 里钉住：措辞是**最容易改坏、又最不容易看出来的**东西
 * （「还差 8 分钟」和「已经读满」写反了，页面照样渲染得漂漂亮亮）。
 *
 * 时长一律走 `format.duration()`（「1 小时 5 分」）—— 与书架右键菜单里那个「时长」
 * 同一个口径；数字本身仍是内核的秒数，所以跟内核那份统计报告不会打架，
 * 差的只是「怎么说」。
 */

import { duration } from "./format";

/**
 * 强度字符 -> 人话。键就是 `format.HEATMAP_CHARS` 那五个字符（内核 `stats.heat_char`
 * 的五档：0 / <20 分钟 / <40 分钟 / <1 小时 / 1 小时以上）。
 *
 * 这里另起一份而不是用 `format.heatLabel()`：那边是**内核 CLI 图例**的原文
 * （`0` `<20m` `1h+`），要和终端逐字一致；这一份是给纸页上的人看的。
 */
const HEAT_PLAIN: Record<string, string> = {
  "·": "没读",
  "░": "不到 20 分钟",
  "▒": "20 ~ 40 分钟",
  "▓": "40 分钟 ~ 1 小时",
  "█": "1 小时以上",
};

/** 一档强度的人话；不认识的字符原样返回。 */
export function heatPlainLabel(level: string): string {
  return HEAT_PLAIN[level] ?? level;
}

/**
 * 「今天」那一行大字：读了就报时长，没读就说没读。
 *
 * 不返回 `0 分钟` —— 纸页上第一眼看到的是「还没翻开书」，比一个零好看，也更催人。
 */
export function todayHeadline(todaySeconds: number): string {
  return todaySeconds > 0 ? duration(todaySeconds) : "还没翻开书";
}

/**
 * 今天这句：设没设目标、达没达标、还差多少。
 *
 * * 没设目标 -> 提示去哪儿设（那是内核 `stats.daily_goal_minutes`，在「调一调」的「设置」里）；
 * * 达标 -> 报喜，带一个勾（`goal_met` 是内核算的，不是这里比出来的）；
 * * 还差 -> 报出**还差多少**（不是已经读了多少 —— 差多少才是要接着做的事）。
 */
export function goalSentence(goalSeconds: number, todaySeconds: number, met: boolean): string {
  if (goalSeconds <= 0) {
    return "还没定每天的小目标 —— 去「调一调」里定一个，这里就替你盯着。";
  }
  const goal = duration(goalSeconds);
  if (met) return `今天的小目标（${goal}）已经读完啦 ✓`;
  if (todaySeconds <= 0) return `今天还没翻开书 —— 小目标是 ${goal}，读一点是一点。`;
  return `离今天的小目标（${goal}）还差 ${duration(goalSeconds - todaySeconds)}。`;
}

/**
 * 「坚持」那句：连着几天，今天算不算得上。
 *
 * 内核那条规矩（`stats.streak_days`）得说清楚：**今天读满 `streak_min_seconds`
 * 才算今天**；还不够的话，连着的那几天是从昨天往前数的，不会因为今天还没读就归零。
 * 所以这里分三种说法，别让人以为「连着 7 天」里已经包含了今天。
 */
export function streakSentence(
  streakDays: number,
  minSeconds: number,
  todaySeconds: number,
): string {
  const min = duration(minSeconds);
  if (streakDays <= 0) return `还没连起来 —— 一天读满 ${min}就算一天。`;
  if (todaySeconds >= minSeconds) return `连着读了 ${streakDays} 天，今天也算上了。`;
  return `连着读了 ${streakDays} 天 —— 今天再读满 ${min}，就再加一天。`;
}

/**
 * 凌晨（0~4 点）读到的那部分。**没读过就是 `null`**，页面那行整个不显示。
 *
 * 超过一半是在凌晨读的，就顺手认领一下「夜猫子」—— 这个称呼是从数字里读出来的
 * （`night_seconds` 相对 `total_seconds`），不是随便撒的糖。
 */
export function nightSentence(nightSeconds: number, totalSeconds: number): string | null {
  if (nightSeconds <= 0) return null;
  const night = `其中 ${duration(nightSeconds)}是凌晨 0~4 点读的`;
  if (totalSeconds > 0 && nightSeconds * 2 >= totalSeconds) return `${night} —— 夜猫子。`;
  return `${night}。`;
}

/**
 * 账本里那几行时长：读了就报时长，**一秒没读就说「还没读」**。
 *
 * 与 `todayHeadline` 同一个道理 —— 一页手写的账本上，一排「0 秒」比什么都像机器吐出来的。
 */
export function durationWords(seconds: number): string {
  return seconds > 0 ? duration(seconds) : "还没读";
}

/**
 * 「软件使用时间」：读书以外在应用里停留的累计时长。
 *
 * 这个数**不来自内核**（内核只认阅读），由 `lib/usage.ts` 在本机计时；
 * 与 `durationWords` 一样，一秒没记时不说「0 秒」，说「刚开始记」。
 */
export function usageWords(seconds: number): string {
  return seconds > 0 ? duration(seconds) : "刚开始记";
}

/** 今天的完成度（百分数，`0` 表示没设目标）。与内核同一条整除规矩：不足 1% 不算。 */
export function goalPercent(todaySeconds: number, goalSeconds: number): number {
  if (goalSeconds <= 0) return 0;
  return Math.max(0, Math.floor((todaySeconds * 100) / goalSeconds));
}

/** 一本书占总时长的百分比（2~100 的整数）—— 给「每本书读了多久」那根手绘条当宽度。 */
export function bookShare(seconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0 || seconds <= 0) return 0;
  // 至少留 2%：占比再小也看得见一小截，不然那本书像是没读过
  return Math.max(2, Math.min(100, Math.round((seconds / totalSeconds) * 100)));
}
