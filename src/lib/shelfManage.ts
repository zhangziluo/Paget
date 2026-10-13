/**
 * 书架「管理模式」的纯逻辑（与 DOM 无关）。
 *
 * 布局是一份小文档（内核的 `shelf.json`，老内核时回落到本机 `gui_settings` 的
 * `shelf.layout`）：
 *
 *     { "order": ["<书 id>", ...] }
 *
 * `order` 就是书在书架上的先后。**没进过这份表的书按内核给的顺序接在后面**
 * （`mergeOrder`），被删掉的书自动消失 —— 所以这份表永远不需要「迁移」。
 *
 * 怎么画（被拖那本的放大与阴影、相邻两本的压扁与弹性恢复、落点指示线、
 * 边缘停留 0.3s 的翻屏环、玩偶拦截）在 `components/BookshelfManager.tsx` 与
 * `styles/manage-mode.css`。
 */

import { getGuiSetting, setGuiSetting, setShelfLayout, shelfLayout } from "./core";

/** 布局存在本机 `gui_settings` 的哪个键（内核不认识它，与 `shelf.pinned` 同一套命名）。 */
export const MANAGE_LAYOUT_KEY = "shelf.layout";

/** 指针贴在屏幕左右边缘停留多久算「要翻屏」（需求：300ms）。 */
export const EDGE_HOLD_MS = 300;

/** 边缘判定带有多宽（px）：比翻页箭头那 150px 窄一点，免得随手一甩就把书带到别的屏。 */
export const EDGE_ZONE_PX = 96;

/** 拖动中的书放大到多少（需求：微微放大 1.1 + 阴影）。 */
export const DRAG_SCALE = 1.1;

/** 被让位挤到的相邻书压扁多少（需求：CSS scaleX 0.8）。 */
export const SQUEEZE_SCALE_X = 0.8;

/** 压扁 / 让位用多久（毫秒）—— 与 CSS 的 transition 是一对。 */
export const SQUEEZE_MS = 160;

/** 松手之后弹性恢复用多久（毫秒）—— 与 CSS 的 `@keyframes` 是一对。 */
export const SPRING_MS = 420;

/** 按下之后移动超过这么多像素才算「在拖」，否则当成点击（不动布局）。 */
export const DRAG_THRESHOLD_PX = 4;

/** 一份布局：书的先后。 */
export type ManageLayout = {
  order: string[];
};

/**
 * 一次拖拽命中的落点：第 *page* 屏、第 *row* 排、第 *gap* 个缝（0 = 这一排最左端，
 * 等于这一排的长度就是最右端）。`x` / `y` / `height` 是这个缝画在屏幕上的位置 ——
 * 落点指示线、以及「让位」那两本书都按它来。
 */
export type ManageHit = {
  page: number;
  row: number;
  gap: number;
  x: number;
  y: number;
  height: number;
  /** 指针这会儿是不是压在毛绒玩具身上（兔子要跳起来拦截） */
  overToy: boolean;
};

/**
 * 管理模式下正被拖着的那一件：一本书。
 *
 * 拖动、边缘停留翻屏、跨屏落位都由 `components/BookshelfManager.tsx` 画；
 * 真正改数据的是 `moveBook` 这个纯函数。
 */
export type ManageDrag = {
  /** 书 id */
  id: string;
  /** 浮起卡片上写什么（书名） */
  title: string;
};

/** 批量改书名的规则（管理模式的「选择」里用）。 */
export type ManageRename = {
  /** 在所有书名最前面拼上的字 */
  prefix: string;
  /** 在所有书名最后面拼上的字 */
  suffix: string;
  /** 要替换掉的那一段（空 = 不替换） */
  find: string;
  /** 用它替换 `find`（空 = 把这一段删掉） */
  replace: string;
};

/** 把存下来的那份（JSON 串 / 对象 / 坏值）归一化成一份能用的布局。 */
export function normalizeLayout(raw: unknown): ManageLayout {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const order: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.order)) {
    for (const id of source.order) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }

  return { order };
}

/** 这份布局存在哪儿：内核的 `shelf.json`（跟着书库走）还是本机 `gui_settings`（老内核的退路）。 */
export type LayoutHome = "kernel" | "local";

/**
 * 读回布局，顺便带回「它是从哪儿读到的」。
 *
 * **优先问内核**（`shelf_layout`）：摆在哪是跟着书库走的 —— 换机器、备份、终端
 * 书库看到的都是同一份。内核不认识这个方法（随包内核冻得早，或内核压根没起来）
 * 就回落到本机 `gui_settings` 里的老键 —— 两边都是同一个 `normalizeLayout` 归一化过的
 * 形状，所以调用方只多认一个 `home`，别的什么都不用改。
 */
export async function readLayout(): Promise<{ layout: ManageLayout; home: LayoutHome }> {
  try {
    const saved = await shelfLayout();
    // 内核认这个方法：它说的算（哪怕是空的 —— 那就是"还没摆过"）
    return { layout: normalizeLayout(saved), home: "kernel" };
  } catch {
    // 老内核 / 内核没起来：退回本机那份（读不到就是空布局）
    try {
      return { layout: normalizeLayout(await getGuiSetting(MANAGE_LAYOUT_KEY)), home: "local" };
    } catch {
      return { layout: normalizeLayout(null), home: "local" };
    }
  }
}

/**
 * 写回布局 —— 写到它原来待的地方（`readLayout` 给的那个 `home`）。
 *
 * 内核那边只收它认识的书 id（`library.json` 是权威），所以这里不需要再读回来校对。
 */
export async function writeLayout(layout: ManageLayout, home: LayoutHome): Promise<void> {
  // 内核版：跟着书库走，别处（书库 / 下一次打开）立刻能看到
  if (home === "kernel") {
    await setShelfLayout(layout);
    return;
  }
  // 本机版（老内核）：与置顶 / 限时同一套写法
  await setGuiSetting(MANAGE_LAYOUT_KEY, JSON.stringify(layout));
}

/**
 * 把「存过的顺序」与「内核这次给的书单」并起来：
 *
 * 存过的、还在书架上的书按存过的先后排在前面；内核新加的书（这次才导入的）按内核
 * 给的顺序接在后面；存过但已经不在了的（删除 / 封印掉的）自动消失。
 */
export function mergeOrder(bookIds: string[], order: string[]): string[] {
  const alive = new Set(bookIds);
  const merged = order.filter((id) => alive.has(id));
  const kept = new Set(merged);
  for (const id of bookIds) {
    if (!kept.has(id)) merged.push(id);
  }
  return merged;
}

/**
 * 第 *gap* 个缝对应「抽掉 *skipId* 之后」的第几位（拖书时算落点用）。
 *
 * 缝左边的书都算在自己前面；数的时候把被拖的那本跳掉 —— 与 `moveBook` 的坐标一致。
 */
export function orderIndexAt(order: string[], gap: number, skipId = ""): number {
  const at = Number.isFinite(gap) ? Math.max(0, Math.floor(gap)) : order.length;
  let count = 0;
  for (let index = 0; index < order.length && index < at; index += 1) {
    if (order[index] !== skipId) count += 1;
  }
  return count;
}

/**
 * 一条排里，横坐标 *x* 落在第几个缝上（0 = 最左端，`spans.length` = 最右端）。
 *
 * 每一格按自己的**中点**分左右半边：指针在它左半边 → 插在它前面，否则继续往右找。
 * 排右端那片空白（书没排满）自然落在最后一个缝上，所以「拖到这一排最右边」也能落位。
 */
export function gapInRow(spans: { x: number; width: number }[], x: number): number {
  if (!Number.isFinite(x)) return spans.length;
  for (let at = 0; at < spans.length; at += 1) {
    const span = spans[at];
    if (x < span.x + span.width / 2) return at;
  }
  return spans.length;
}

/**
 * 落在这个缝两侧、要被挤扁的那两本书（各找最近的一本）。
 * 返回的 id 交给 CSS 加 `.squeeze`（`scaleX(0.8)`），松手后弹性恢复。
 */
export function squeezeIds(order: string[], gap: number, skipId = ""): string[] {
  const at = Number.isFinite(gap) ? Math.max(0, Math.floor(gap)) : 0;
  const found: string[] = [];
  for (let index = at - 1; index >= 0; index -= 1) {
    if (order[index] !== skipId) {
      found.push(order[index]);
      break;
    }
  }
  for (let index = at; index < order.length; index += 1) {
    if (order[index] !== skipId) {
      found.push(order[index]);
      break;
    }
  }
  return found;
}

/**
 * 把 *bookId* 挪到「抽掉它之后」的第 *index* 位（坏值当末尾）。
 *
 * 拖拽时算出来的下标是**抽掉这本书之后**的坐标（`orderIndexAt` 已经把被拖的那本
 * 数掉了），所以这里不额外 ±1 —— 少一次「差一」的机会。
 */
export function moveBook(order: string[], bookId: string, index: number): string[] {
  if (!order.includes(bookId)) return order;
  const rest = order.filter((id) => id !== bookId);
  const at = Number.isFinite(index) ? Math.floor(index) : rest.length;
  rest.splice(Math.max(0, Math.min(rest.length, at)), 0, bookId);
  return rest;
}

/**
 * 方向键里哪几个算「往前一位 / 往后一位」：`←` `↑` = -1、`→` `↓` = +1，其余回 0。
 *
 * 书架是**横着排**的，所以上下与左右同义（一排排从左往右、从上往下读）—— 四个键都用来
 * 调顺序，不用记「哪个键才是横的」。判定抽在这里是为了钉得住（`views/Shelf.tsx` 里
 * 只剩下「挪一下」这一行）。
 */
export function nudgeStep(key: string): -1 | 0 | 1 {
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return 0;
}

/**
 * 把一本书在 `order` 里往前 / 往后挪**一位**（键盘排序：`step` 只看正负，负 = 往前）。
 *
 * 已经在最前 / 最后（或这本书不在架上）时**原样返回同一个数组** —— 调用方据此知道
 * 「这一下没动」，不必写回布局、也不必让整架重渲染（与拖拽落位是同一条规矩）。
 */
export function shiftBook(order: string[], bookId: string, step: number): string[] {
  const at = order.indexOf(bookId);
  if (at < 0) return order;
  const to = at + (step < 0 ? -1 : 1);
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(at, 1);
  next.splice(to, 0, bookId);
  return next;
}

/* ------------------------------------------------------------------ */
/* 批量编辑（选择模式下对多本书做的事）                                  */
/* ------------------------------------------------------------------ */

/** 这份规则会不会改动书名（四条全空 = 按了也没意义，按钮据此禁用）。 */
export function renameTouched(rule: ManageRename): boolean {
  return rule.prefix.length > 0 || rule.suffix.length > 0 || rule.find.length > 0;
}

/**
 * 按规则算出一本书的新书名。
 *
 * 四条都是**原样文本**、不是正则：`find` 为空就整段不替换（而不是「每本书名都插一遍空串」），
 * 于是「只加前缀」「只替换某一段」「两者一起」都由同一份规则表达。
 *
 * 先替换、再拼前缀后缀 —— 顺序固定，所以「查找/替换」永远只看**原来的**书名，
 * 不会把刚拼上的前缀又替换一遍。
 */
export function renamedTitle(title: string, rule: ManageRename): string {
  const base = rule.find ? title.split(rule.find).join(rule.replace) : title;
  return `${rule.prefix}${base}${rule.suffix}`;
}
