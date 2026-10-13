/**
 * 键盘快捷键（书房与墙上那三页共用一份表）。
 *
 * 「书房」是应用本体，统计 / 成就 / 设置是从墙上挂件展开的一整页 —— 各配一个**单键**
 * 快捷方式。键位在这里定义一次：处理器（`views/Shelf.tsx` 与 `App.tsx`）与界面上的提示
 * （挂件的 `title`、返回按钮的 `title`）都读它，免得两处写拧。
 *
 * 为什么是单键：与这里已有的 `/`（搜索）、`←` `→`（翻屏）同一套手感 —— 手不用离开主键区。
 * **焦点在输入框里时一律让位**（`isTypingTarget`），带修饰键的组合也一概不抢（留给系统）。
 */
export type ShortcutId = "manage" | "stats" | "achievements" | "settings";

export type Shortcut = {
  id: ShortcutId;
  /** 按哪个键（小写，与 `KeyboardEvent.key.toLowerCase()` 对得上） */
  key: string;
  /** 界面上怎么称呼它（挂件的 title / 帮助文案） */
  label: string;
};

/** 四个快捷键（顺序就是习惯顺序：管理 · 统计 · 成就 · 设置）。 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: "manage", key: "m", label: "管理模式" },
  { id: "stats", key: "s", label: "统计" },
  { id: "achievements", key: "a", label: "成就" },
  { id: "settings", key: "g", label: "设置" },
];

/** 挂件页里「返回书架」的键：DOM 里叫 `Escape`，屏上写 `Esc`。 */
export const BACK_KEY = "Escape";
export const BACK_KEY_LABEL = "Esc";

/** 这个键该印成什么样（`m` → `M`）—— 工具提示与文档都走它，屏上不写小写。 */
export function shortcutKey(id: ShortcutId): string {
  return (SHORTCUTS.find((item) => item.id === id)?.key ?? "").toUpperCase();
}

/** 键盘事件里最小的那几个字段（这样这个函数在 node 里也测得动）。 */
export type ShortcutEvent = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** 长按自动重复：一次按键不该被当成连着好几下（管理模式会被切来切去） */
  repeat?: boolean;
};

/**
 * 这个事件按的是哪个快捷键（不是就回 `null`）。
 *
 * 只认**不带任何修饰键的单键**：`⌘S` 之类留给系统 / 浏览器，`Shift` + 字母也不掺和
 * （那是另一个快捷键的位置），长按重复的一律不算。
 */
export function shortcutFrom(event: ShortcutEvent): ShortcutId | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) {
    return null;
  }
  const key = event.key.toLowerCase();
  return SHORTCUTS.find((item) => item.key === key)?.id ?? null;
}

/**
 * 焦点是不是落在「正在打字」的地方（输入框 / 文本域 / 可编辑区域）。
 *
 * 那里一概不抢键：书房的搜索框、跳屏号那个输入框、设置页里那些数字框都要能正常打字。
 * 与阅读页那份判断同一套（见 `views/Reader.tsx`）—— 只用标签名与 `isContentEditable`，
 * 不碰 `instanceof`，这样 node 里拿个假对象也测得动。
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  // contentEditable 的元素 `tagName` 是 `DIV` 之类，所以除了标签名还要看这个属性
  return target.isContentEditable === true;
}

/**
 * 挂件页里按下一个键**该做什么**（`App.tsx` 只负责把结果落地：换浮层 / 记下锤子）。
 *
 * 判定与落地分开，是因为这一段全是「哪个键算数、什么时候不算数」的规矩 ——
 * 抽成纯函数才钉得住（`App.tsx` 里那段只剩三行 setState）。
 *
 * - `Esc` → `back`：回书房。**它是唯一不看焦点在哪儿的**（输入框里按 Esc 也是要走的意思）；
 * - `M` → `manage`：回书房并进管理模式（锤子递到手上）；
 * - `S` / `A` / `G` → `open`：**去哪儿**（统计 / 成就 / 设置）。回程统一交给 `Esc` ——
 *   这四个键都是「目的地」，不是开关。
 */
export type PageKeyAction =
  | { action: "back" }
  | { action: "manage" }
  | { action: "open"; id: ShortcutId };

export function pageKeyAction(event: ShortcutEvent): PageKeyAction | null {
  if (event.key === BACK_KEY) return { action: "back" };
  const id = shortcutFrom(event);
  if (!id) return null;
  return id === "manage" ? { action: "manage" } : { action: "open", id };
}
