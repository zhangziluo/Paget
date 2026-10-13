/**
 * 内核设置的分工层（纯函数，不碰 DOM、不碰内核）。
 *
 * 只回答一件事：**哪一项在界面上露面、露在哪儿**。分界线只有这一处 ——
 * 「调一调」与阅读页下栏的「翻页设置」都从这里取，谁也别自己写一份 `startsWith`。
 *
 * 三档（2026-10-11 定）：
 *
 * 1. **`reader`：阅读页下栏那颗「翻页设置」里**（`READER_PANEL_KEYS`）—— 界面真的会读、
 *    而且正读着书的时候想调的那几项（自动翻页的节奏与抽查）。
 * 2. **`app`：留在「调一调」**（统计的小目标与联网、正文放哪儿、章节怎么认）。
 * 3. **`hidden`：界面上一个都不列**（`CLI_ONLY`）—— 它们只影响命令行阅读器。
 *    用户不需要去调它，界面上也就不必提它（列表之外的新设置照旧会显示，只是没有措辞）。
 *
 * 内核 `reader.*` 那一节里绝大多数属于第 3 档：那批是内核自带命令行前端的按键手感，
 * 界面一个都不读（界面的手感走阅读页下栏的 `Aa` 与本机 `gui_settings`）。
 */
import { settingWords } from "./settingsText";

/** 内核里 `reader.*` 那一节的点号前缀。 */
export const READER_PREFIX = "reader.";

/** 阅读页面板里列的键（点号路径的后半段）—— 界面真的会读的那几个。 */
const READER_PANEL_KEYS = [
  "auto_scroll_interval",
  "auto_scroll_step",
  "auto_scroll_check_minutes",
  "auto_scroll_check_seconds",
] as const;

/** 上面那几个的完整点号路径（查起来 O(1)）。 */
const PANEL = new Set(READER_PANEL_KEYS.map((key) => `${READER_PREFIX}${key}`));

/**
 * 只有命令行阅读器会读、又在 `reader.*` 之外的项：界面上也不列。
 *
 * 这两个分别是「终端里画不画格子图」与「终端里解锁勋章响不响」—— 界面的统计页与勋章页
 * 从来不看它们。`reader.*` 那一节不必写在这儿：那个前缀本身就是「命令行阅读器的手感」，
 * 面板没列到的（含内核以后新加的）一律不列。
 */
const CLI_ONLY_ELSEWHERE = ["stats.show_heatmap", "stats.achievement_sound"];

/** 上面那两个（查起来要 O(1)）。 */
const HIDDEN = new Set(CLI_ONLY_ELSEWHERE);

/** 这一项归内核 `reader.*` 那一节吗。 */
export function isReaderSetting(path: string): boolean {
  return path.startsWith(READER_PREFIX);
}

/** 界面上要不要列这一项（`false` = 只有命令行阅读器读它）。 */
export function isVisibleSetting(path: string): boolean {
  // reader.* 里只有面板那几个会露面，别的（含新加的）都不列
  if (isReaderSetting(path)) return PANEL.has(path);
  return !HIDDEN.has(path);
}

/**
 * 把内核给的路径分成三摞：阅读页面板里的、留在「调一调」的、界面上不列的。
 * 三摞都照内核给的顺序。
 */
export function partitionSettings(paths: string[]): {
  /** 阅读页下栏「翻页设置」里的 */
  reader: string[];
  /** 「调一调」里的 */
  app: string[];
  /** 界面上不列的（只有命令行阅读器读） */
  hidden: string[];
} {
  const reader: string[] = [];
  const app: string[] = [];
  const hidden: string[] = [];
  for (const path of paths) {
    if (isReaderSetting(path)) (PANEL.has(path) ? reader : hidden).push(path);
    else (HIDDEN.has(path) ? hidden : app).push(path);
  }
  return { reader, app, hidden };
}

/** 一节：小标题 + 一句话 + 这一节里的路径。 */
export type ReaderSettingSection = { title: string; plain: string; paths: string[] };

/**
 * 面板里的小节（顺序就是面板里的顺序）。只给这一批路径里真有的那些，空节不出现 ——
 * 内核哪天把某项拿掉，这里什么都不会坏。
 */
export function readerSections(paths: string[]): ReaderSettingSection[] {
  const rows = READER_PANEL_KEYS.map((key) => `${READER_PREFIX}${key}`).filter((path) =>
    paths.includes(path),
  );
  if (rows.length === 0) return [];
  return [
    {
      title: "自动翻页",
      plain:
        "下栏那颗「自动翻页」按这里的节奏走 —— 文字一次走「屏幕行」，PDF 的图片模式一次走一页。",
      paths: rows,
    },
  ];
}

/** 面板顶上那句交代：改的是哪儿、什么时候生效。 */
export function readerPanelLead(): string {
  return "改的是书库里的设置文件，改完立刻生效；正读着这本书的时候就能调。";
}

/** 设置项的名字（措辞只有 `settingsText.ts` 一份，这儿只是转个手）。 */
export function settingLabel(path: string): string {
  return settingWords(path).label;
}

