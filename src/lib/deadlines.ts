/**
 * 限时模式：给一本书定一个到期日，那天 0 点它会被封印（见 `src-tauri/src/archive.rs`）。
 *
 * 到期日**不是**内核的数据 —— `werd` 不认识"限时"，所以这份状态和置顶一样存在界面
 * 自己的 `gui_settings` 里（键 `shelf.deadlines`），值形如::
 *
 *     {"a1b2c3d4e5f6": "2026-10-08"}
 *
 * 这里只放纯函数（解析、判定到期）与两行读写，界面在 `views/Shelf.tsx`：
 * 书架的时钟每秒都在跳，到期判定就搭在它上面，不需要另设定时器。
 */

import { getGuiSetting, setGuiSetting } from "./core";
import type { BookRow, DeadlineMap } from "./types";

/** 限时表在 `gui_settings` 里的键名（与置顶的 `shelf.pinned` 同一套命名）。 */
export const DEADLINES_KEY = "shelf.deadlines";

/** Two digit zero padding. */
function pad(part: number): string {
  return String(part).padStart(2, "0");
}

/**
 * The local date as ``YYYY-MM-DD``.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that is **UTC**, so an evening in
 * Asia would already count as "tomorrow" (and a deadline would fire a day early).
 */
export function localDay(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** *day* (``YYYY-MM-DD``) shifted by *days*; ``""`` when *day* is malformed. */
export function addDays(day: string, days: number): string {
  const moment = dueMoment(day);
  // 坏日期不该被"顺移"成一个看起来合法的新日期
  if (!moment) return "";
  moment.setDate(moment.getDate() + days);
  return localDay(moment);
}

/**
 * The very start of *day* in the local timezone (``00:00``), or ``null``.
 *
 * ``null`` means "not a deadline": a malformed string, or a date `Date` would silently
 * roll over (``2026-02-31``) -- a hand-edited value must never seal a book by accident.
 */
export function dueMoment(day: string): Date | null {
  // 只认定长日期串：`2026-10-8` 这种手写形式宁可当作没设
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const moment = new Date(year, month - 1, date);
  // Date 会把 2 月 31 日进位成 3 月 3 日：进位了就说明这不是个真日期
  if (moment.getFullYear() !== year || moment.getMonth() !== month - 1 || moment.getDate() !== date) {
    return null;
  }
  return moment;
}

/**
 * The books whose deadline has arrived, in shelf order.
 *
 * "到期日 0 点" is exactly this comparison: the due day's own midnight has passed.
 * A book without a (valid) deadline is never included.
 */
export function expiredBooks(
  books: BookRow[],
  deadlines: DeadlineMap,
  now: Date,
): BookRow[] {
  return books.filter((book) => {
    const due = dueMoment(deadlines[book.id] ?? "");
    return due !== null && now.getTime() >= due.getTime();
  });
}

/** 读回限时表；读不到 / 存坏了 / 值不是日期都当作"没设"。 */
export async function readDeadlines(): Promise<DeadlineMap> {
  try {
    const raw = await getGuiSetting(DEADLINES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // 必须是一张对象表，数组 / 字符串之类一律不算
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DeadlineMap = {};
    for (const [bookId, day] of Object.entries(parsed as Record<string, unknown>)) {
      // 只有能解析成真日期的值才留下（dueMoment 是唯一判据）
      if (typeof day === "string" && dueMoment(day)) out[bookId] = day;
    }
    return out;
  } catch {
    // 读不到只是"没有限时书"，不该影响书架
    return {};
  }
}

/** 写入限时表（调用方负责先把内存里的那份改好）。 */
export async function writeDeadlines(map: DeadlineMap): Promise<void> {
  await setGuiSetting(DEADLINES_KEY, JSON.stringify(map));
}
