import { useEffect, useState } from "react";

/**
 * 书房的天色：**白天还是夜里**，只看本机的系统时间。
 *
 * 这套判断原先藏在 `views/Shelf.tsx` 里（窗外的天空、屋子的明暗、台灯亮不亮全靠它）。
 * 现在**白噪音**也要按同一个口径选声音（白天「风铃流水」、夜里两段「虫鸣」），
 * 所以把它挪到这里当选声音与画书房共同的**唯一一处** —— 两边各写一份 6 / 18 点的
 * 常量迟早会跑偏。
 *
 * 分界是整点：6 点天亮、18 点天黑（与从前一模一样）。
 */

/** 天亮 / 天黑的分界（按系统时间）：6 点天亮，18 点天黑。 */
export const DAY_START = 6;
export const NIGHT_START = 18;

/** 白天还是夜里。 */
export type Sky = "day" | "night";

/** 看系统时间决定现在是白天还是夜里。 */
export function skyOf(date: Date): Sky {
  const hour = date.getHours();
  return hour < DAY_START || hour >= NIGHT_START ? "night" : "day";
}

/**
 * 书房的天色（React 版）：半小时对一次表就够 —— 天色是慢慢变的，不用每秒重算。
 * 返回的字符串直接当 `main` 上的类名用，CSS 里写 `.study.day` / `.study.night` 两套。
 */
export function useSky(): Sky {
  const [sky, setSky] = useState<Sky>(() => skyOf(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setSky(skyOf(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return sky;
}
