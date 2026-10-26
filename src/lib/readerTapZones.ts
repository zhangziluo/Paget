/**
 * 阅读页六个「点一下就做事」的区域：四角 + 左右两条边。
 *
 * 从前这六块是写死的（左上回书架、右上书签、左下目录、右下玩偶、左边上一页、右边下一页），
 * 现在每一块都能在阅读页下栏的「手势」面板里换成别的动作 —— 默认值仍就是原来那六样，
 * 所以不动设置的人手感一个字节都不变。
 *
 * 存的仍是**界面自己的** `gui_settings`（键 `reader.tapZones`），因为这不是书库的数据，
 * 而是「这台电脑上怎么点着读书」：
 *
 *     {"top-left":"shelf","top-right":"bookmark","bottom-left":"toc",
 *      "bottom-right":"toy","left-edge":"prev","right-edge":"next"}
 *
 * 这个文件只有类型、名单、默认值与归一化（纯函数）+ 两行读写；落点判断与动作派发在
 * `views/Reader.tsx`（比例热区 `CORNER_HIT` / `EDGE_HIT` 也在那边）。
 */

import { getGuiSetting, setGuiSetting } from "./core";

/** 六个区域的 id（顺序 = 面板里的排列顺序：先四角、后两条边）。 */
export const READER_TAP_ZONE_IDS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "left-edge",
  "right-edge",
] as const;

export type ReaderTapZone = (typeof READER_TAP_ZONE_IDS)[number];

/** 可以指派到这六块上的动作。 */
export const READER_TAP_ACTION_IDS = [
  "shelf",
  "bookmark",
  "toc",
  "toy",
  "prev",
  "next",
  "bars",
  "guide",
  "autoturn",
  "save",
  "search",
  "index",
  "image",
  "none",
] as const;

export type ReaderTapAction = (typeof READER_TAP_ACTION_IDS)[number];

/** 六个区域各做什么 —— 整份表就是存进 `gui_settings` 的那个对象。 */
export type ReaderTapZones = Record<ReaderTapZone, ReaderTapAction>;

/** 出厂那六样（与 2026-10 之前写死的行为逐一对得上）。 */
export const DEFAULT_READER_TAP_ZONES: ReaderTapZones = {
  "top-left": "shelf",
  "top-right": "bookmark",
  "bottom-left": "toc",
  "bottom-right": "toy",
  "left-edge": "prev",
  "right-edge": "next",
};

/** 区域的名字与位置提示（顺序 = 面板里的排列顺序）。 */
export const READER_TAP_ZONES: { id: ReaderTapZone; label: string; hint: string }[] = [
  {
    id: "top-left",
    label: "左上角",
    hint: "屏幕左上约 22% × 22% 的一块。默认「回书架」：在角上停一会儿浮出小书架，点略缩图才走",
  },
  {
    id: "top-right",
    label: "右上角",
    hint: "屏幕右上约 22% × 22% 的一块（书签丝带就在这儿）",
  },
  {
    id: "bottom-left",
    label: "左下角",
    hint: "屏幕左下约 22% × 22% 的一块",
  },
  {
    id: "bottom-right",
    label: "右下角",
    hint: "屏幕右下约 22% × 22% 的一块",
  },
  {
    id: "left-edge",
    label: "左边条",
    hint: "屏幕左边纵向中段的一条（约 18% 宽，不含上下两个角）",
  },
  {
    id: "right-edge",
    label: "右边条",
    hint: "屏幕右边纵向中段的一条（约 18% 宽，不含上下两个角）",
  },
];

/**
 * 动作的名字与「点了会怎样」（顺序 = 下拉框里的排列顺序）。
 *
 * 前六项就是出厂那六样；后面几项是把上下两栏里常用的按钮搬过来，手不用离开书页。
 * 「不做事」留着有用：把某一块设成它，就等于把那块热区还给选字。
 */
export const READER_TAP_ACTIONS: { id: ReaderTapAction; label: string; hint: string }[] = [
  { id: "shelf", label: "回书架", hint: "先记好读到哪（位置 / 书签 / 时长 / 成就），再回书架" },
  { id: "bookmark", label: "书签", hint: "给屏顶这一行插上 / 拔掉书签" },
  { id: "toc", label: "目录", hint: "弹开 / 收起章节目录（点标题跳过去）" },
  { id: "toy", label: "玩偶", hint: "从右下角随机蹦一只毛绒玩具出来" },
  { id: "prev", label: "上一页", hint: "往上滚一屏（约一屏的高度）" },
  { id: "next", label: "下一页", hint: "往下滚一屏" },
  { id: "bars", label: "上下两栏", hint: "呼出 / 收起上下两栏（与点屏幕中间同一件事）" },
  { id: "guide", label: "光点导读", hint: "打开 / 关掉沿着当前行领读的小标记" },
  {
    id: "autoturn",
    label: "自动翻页",
    hint: "按「翻页设置」里的节奏自己往下走；再点一下停下",
  },
  { id: "save", label: "保存位置", hint: "把当前这一行立刻存进书库（平时每分钟也会自动存）" },
  { id: "search", label: "搜索本书", hint: "在本书正文里找关键词（与 ⌘F / 按 / 同一件事）" },
  {
    id: "index",
    label: "建立索引",
    hint: "给这本书建正文索引（书架里搜正文要用；很长的书只索引前半部分）",
  },
  {
    id: "image",
    label: "看图片（PDF）",
    hint: "PDF 转成文字之后切回图片模式；别的格式点它不做事",
  },
  { id: "none", label: "不做事", hint: "这一块点下去什么也不做（把热区还给选字与批注）" },
];

/** 手势表在 `gui_settings` 里的键名（与 `reader.prefs` / `shelf.pinned` 同一套命名）。 */
export const READER_TAP_ZONES_KEY = "reader.tapZones";

const ZONE_SET = new Set<string>(READER_TAP_ZONE_IDS);
const ACTION_SET = new Set<string>(READER_TAP_ACTION_IDS);

/** 这个字符串是不是一个合法的区域 id。 */
export function isReaderTapZone(value: unknown): value is ReaderTapZone {
  return typeof value === "string" && ZONE_SET.has(value);
}

/** 这个字符串是不是一个合法的动作 id。 */
export function isReaderTapAction(value: unknown): value is ReaderTapAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

/**
 * 把任意输入收成一份完整的表：认不出的区域 / 动作一律回落到出厂值。
 *
 * 为什么要「逐块兜底」而不是整份丢掉：将来删掉某个动作时，用户已经调好的另外五块
 * 不该跟着一起归零 —— 与 `normalizeReaderPrefs` 同一套想法。
 */
export function normalizeReaderTapZones(input: unknown): ReaderTapZones {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const next: ReaderTapZones = { ...DEFAULT_READER_TAP_ZONES };
  for (const zone of READER_TAP_ZONE_IDS) {
    const raw = source[zone];
    next[zone] = isReaderTapAction(raw) ? raw : DEFAULT_READER_TAP_ZONES[zone];
  }
  return next;
}

/** 现在这张表是不是出厂那六样（面板上的「恢复默认」靠它决定是否置灰）。 */
export function isDefaultReaderTapZones(zones: ReaderTapZones): boolean {
  return READER_TAP_ZONE_IDS.every(
    (zone) => zones[zone] === DEFAULT_READER_TAP_ZONES[zone],
  );
}

/** 读回手势表；读不到 / 存坏了都回落到默认值（界面状态丢了不算数据损失）。 */
export async function loadReaderTapZones(): Promise<ReaderTapZones> {
  try {
    const raw = await getGuiSetting(READER_TAP_ZONES_KEY);
    if (!raw) return { ...DEFAULT_READER_TAP_ZONES };
    return normalizeReaderTapZones(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_READER_TAP_ZONES };
  }
}

/** 写回手势表（调用方给什么都先归一化一遍，存进去的永远是干净的一份）。 */
export async function saveReaderTapZones(zones: ReaderTapZones): Promise<void> {
  await setGuiSetting(READER_TAP_ZONES_KEY, JSON.stringify(normalizeReaderTapZones(zones)));
}
