/**
 * 阅读页的**划线 + 批注**，以及书架上那本「笔记本」的全部数据逻辑。
 *
 * 内核不认识划线与批注（它只记读到第几行、书签、统计），所以这份数据与置顶 / 限时 /
 * 排版偏好一样存在界面自己的 `gui_settings` 里（键 `reader.annotations.v1`），值是一段
 * JSON 数组，**跨书扁平**放着，每条自带 `bookId` / `bookTitle`：
 *
 *     [{ "id":"a1b2c3", "bookId":"9f2c…", "bookTitle":"书名",
 *        "spans":[{"line":128,"start":4,"end":18}],
 *        "style":"wave", "color":"#b23a3a",
 *        "quote":"被划线的原文", "note":"这里写批注",
 *        "createdAt":"2026-10-25T09:12:00.000Z" }]
 *
 * 为什么是这个形状：
 *
 * 1. **定位靠「行号 + 行内字符偏移」**，不靠字符串匹配 —— 同一句话在一本书里出现两次
 *    也能精准分开；跨段（跨多个 `<p class="reading-line">`）的选区拆成多条 `spans`，
 *    共用同一份样式 / 颜色 / 批注，所以「一条划线」始终是一个整体。
 * 2. **`quote` 与 `bookTitle` 都存快照**：笔记本页与导出不必回头找内核取原文 / 书名，
 *    删掉的书、转换过格式的书也仍能照着当时划的内容读。书源文字变了会以快照为准
 *    （与书签按行号定位的老问题同源，接受）。
 * 3. `createdAt` 用 ISO 字符串：排序、导出、显示日期都直接可用，不做本地化解析。
 *
 * 这个文件只放**纯函数**与两行读写（`loadAnnotations` / `saveAnnotations`）；
 * 界面在 `views/Reader.tsx`（划线、批注卡片）与 `views/Notebook.tsx`（整本笔记本）。
 */

import { getGuiSetting, setGuiSetting } from "./core";

/** 三种划线：直线（下划线）/ 波浪线 / 删除线。 */
export type AnnotationStyle = "line" | "wave" | "strike";

/** 一段划线落在**某一源行**里的字符区间（`start` 含、`end` 不含）。 */
export type AnnotationSpan = {
  /** 内核坐标的源行号（0 起始） */
  line: number;
  /** 行内起始字符下标 */
  start: number;
  /** 行内结束字符下标（不含） */
  end: number;
};

/** 一条划线（可能带一句批注）。 */
export type Annotation = {
  /** 稳定 id（删 / 改都按它找） */
  id: string;
  /** 哪本书（内核的书 id） */
  bookId: string;
  /** 划的时候那本书叫什么（快照；书删了笔记本也还认得） */
  bookTitle: string;
  /** 落在哪几行的哪些字（跨段时不止一条） */
  spans: AnnotationSpan[];
  style: AnnotationStyle;
  /** 划线的颜色（`#rrggbb`） */
  color: string;
  /** 划中的原文（快照，导出与笔记本直接用） */
  quote: string;
  /** 批注文字；空串 = 只划了线、还没写批注 */
  note: string;
  /** 创建时刻（ISO 字符串） */
  createdAt: string;
};

/** 划线数据在 `gui_settings` 里的键名（与 `reader.prefs` / `shelf.pinned` 同一套命名）。 */
export const ANNOTATIONS_KEY = "reader.annotations.v1";

/** 三种划线的名字与说明（顺序 = 工具条里的排列顺序）。 */
export const ANNOTATION_STYLES: readonly {
  id: AnnotationStyle;
  label: string;
  hint: string;
}[] = [
  { id: "line", label: "直线", hint: "文字下方一条实线" },
  { id: "wave", label: "波浪线", hint: "文字下方一条波浪线" },
  { id: "strike", label: "删除线", hint: "一条线穿过文字中间" },
];

/** 默认颜色：墨红（最像一支红笔）。 */
export const DEFAULT_ANNOTATION_COLOR = "#b23a3a";

/**
 * 工具条上的常用色（顺序 = 排列顺序）。
 *
 * 都是低饱和的「笔色」，压在米黄纸上不刺眼；想用别的颜色，工具条最右那枚取色器
 * 可以自己调（存下来仍是 `#rrggbb`）。
 */
export const ANNOTATION_COLORS: readonly string[] = [
  "#b23a3a", // 墨红
  "#b7791f", // 琥珀
  "#4c7a5e", // 竹青
  "#3b6ea5", // 靛蓝
  "#7b5ea7", // 紫
  "#5c5c5c", // 灰
];

/* ------------------------------------------------------------------ */
/* 归一化                                                                */
/* ------------------------------------------------------------------ */

const HEX = /^#[0-9a-fA-F]{6}$/;

function isStyle(value: unknown): value is AnnotationStyle {
  return value === "line" || value === "wave" || value === "strike";
}

/** 把任意输入收成合法的 `#rrggbb`；认不出就回空串。 */
export function normalizeAnnotationColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const hex = value.trim();
  return HEX.test(hex) ? hex.toLowerCase() : "";
}

/**
 * 笔色兑成一层**淡淡的半透明**（划线的底色、卡片上那条色标都用它）。
 *
 * 不用 CSS 的 `color-mix()`：老 WebView 不认，这条划线就会变成透明 —— 兑成 `rgba()`
 * 写在行内变量里，任何 WebView 都画得出来。
 */
export function annotationTint(color: string, alpha = 0.22): string {
  const hex = normalizeAnnotationColor(color) || DEFAULT_ANNOTATION_COLOR;
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0.22));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 收一段区间：必须是整数、`end > start`、行号非负；不合法回 null。 */
function normalizeSpan(raw: unknown): AnnotationSpan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Partial<AnnotationSpan>;
  const line = Number(item.line);
  const start = Number(item.start);
  const end = Number(item.end);
  if (!Number.isInteger(line) || line < 0) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start) return null;
  return { line, start, end };
}

/** 收一条划线；缺胳膊少腿的回 null（坏数据直接丢掉，不让它把整页弄崩）。 */
export function normalizeAnnotation(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Partial<Annotation>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const bookId = typeof item.bookId === "string" ? item.bookId.trim() : "";
  if (!id || !bookId) return null;
  const spans = Array.isArray(item.spans)
    ? item.spans.map(normalizeSpan).filter((span): span is AnnotationSpan => span !== null)
    : [];
  if (!spans.length) return null;
  const style = isStyle(item.style) ? item.style : "line";
  const color = normalizeAnnotationColor(item.color) || DEFAULT_ANNOTATION_COLOR;
  const quote = typeof item.quote === "string" ? item.quote : "";
  const note = typeof item.note === "string" ? item.note : "";
  const createdAt =
    typeof item.createdAt === "string" && item.createdAt.trim()
      ? item.createdAt
      : new Date().toISOString();
  const bookTitle = typeof item.bookTitle === "string" ? item.bookTitle : "";
  // 同一行内的区间排好序、去掉重复：渲染与导出都靠这个顺序
  const sorted = [...spans].sort((a, b) => a.line - b.line || a.start - b.start);
  return { id, bookId, bookTitle, spans: sorted, style, color, quote, note, createdAt };
}

/** 把任意输入收成一串划线（坏的丢掉，重复 id 只留第一条）。 */
export function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Annotation[] = [];
  for (const item of raw) {
    const ann = normalizeAnnotation(item);
    if (!ann || seen.has(ann.id)) continue;
    seen.add(ann.id);
    out.push(ann);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 读写                                                                  */
/* ------------------------------------------------------------------ */

/** 读回整份划线表；读不到 / 坏 JSON 都回空表（界面状态，不是数据损失）。 */
export async function loadAnnotations(): Promise<Annotation[]> {
  try {
    const raw = await getGuiSetting(ANNOTATIONS_KEY);
    if (!raw) return [];
    return normalizeAnnotations(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 写回整份划线表（调用方保证已经归一化过）。 */
export async function saveAnnotations(list: Annotation[]): Promise<void> {
  await setGuiSetting(ANNOTATIONS_KEY, JSON.stringify(list));
}

/* ------------------------------------------------------------------ */
/* 增删改（都是纯函数，返回新数组）                                       */
/* ------------------------------------------------------------------ */

/** 这本书的划线，按行序排好。 */
export function annotationsOf(list: Annotation[], bookId: string): Annotation[] {
  return list
    .filter((ann) => ann.bookId === bookId)
    .sort((a, b) => a.spans[0].line - b.spans[0].line || a.spans[0].start - b.spans[0].start);
}

/** 放进去一条（同 id 覆盖），返回新数组。 */
export function upsertAnnotation(list: Annotation[], ann: Annotation): Annotation[] {
  const index = list.findIndex((item) => item.id === ann.id);
  if (index < 0) return [...list, ann];
  const next = [...list];
  next[index] = ann;
  return next;
}

/** 删掉一条。 */
export function removeAnnotation(list: Annotation[], id: string): Annotation[] {
  return list.filter((item) => item.id !== id);
}

/** 改一条的若干字段（批注 / 样式 / 颜色）。 */
export function patchAnnotation(
  list: Annotation[],
  id: string,
  patch: Partial<Pick<Annotation, "note" | "style" | "color">>,
): Annotation[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** 新 id：优先用 `crypto.randomUUID`，老 WebView 退回「时间 + 随机」。 */
export function newAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* 渲染：把一条划线摊到它在的每一行上                                     */
/* ------------------------------------------------------------------ */

/** 某一源行上的一小段标记（渲染用，已经摊平）。 */
export type LineMark = {
  id: string;
  start: number;
  end: number;
  style: AnnotationStyle;
  color: string;
  /** 这条划线带批注（行尾点一颗小点，让人知道点开有东西看） */
  hasNote: boolean;
  createdAt: string;
};

/** 这本书的划线按源行摊平成 `行号 -> 标记[]`（渲染 `.reading-line` 时直接查）。 */
export function marksByLine(list: Annotation[], bookId: string): Map<number, LineMark[]> {
  const map = new Map<number, LineMark[]>();
  for (const ann of list) {
    if (ann.bookId !== bookId) continue;
    const hasNote = ann.note.trim().length > 0;
    for (const span of ann.spans) {
      const marks = map.get(span.line) ?? [];
      marks.push({
        id: ann.id,
        start: span.start,
        end: span.end,
        style: ann.style,
        color: ann.color,
        hasNote,
        createdAt: ann.createdAt,
      });
      map.set(span.line, marks);
    }
  }
  return map;
}

/** 一行文字切成「有标记 / 没标记」的片段。 */
export type LineSegment = { text: string; mark: LineMark | null };

/**
 * 把一行切成片段。
 *
 * 同一条划线的区间可能落在好几个片段里（它中间又压了另一条划线），渲染时各片段都带
 * 同一个 `mark.id` —— 点哪一段都是同一条。重叠时**后创建的压住先创建的**（先到先得
 * 在这里会让人以为新划的没生效），所以按 `createdAt` 取最大的那条。
 */
export function lineSegments(line: string, marks: LineMark[]): LineSegment[] {
  if (!marks.length || !line) return [{ text: line, mark: null }];
  const length = line.length;
  // 区间夹进这一行的实际长度里（书源改过、行变短时也不越界）
  const valid = marks
    .map((mark) => ({ ...mark, start: Math.max(0, mark.start), end: Math.min(length, mark.end) }))
    .filter((mark) => mark.end > mark.start);
  if (!valid.length) return [{ text: line, mark: null }];
  const cuts = new Set<number>([0, length]);
  for (const mark of valid) {
    cuts.add(mark.start);
    cuts.add(mark.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: LineSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const mid = (start + end) / 2;
    // 盖住这一段的几条里，取最晚创建的那条
    let pick: LineMark | null = null;
    for (const mark of valid) {
      if (mid <= mark.start || mid >= mark.end) continue;
      if (!pick || mark.createdAt > pick.createdAt) pick = mark;
    }
    out.push({ text: line.slice(start, end), mark: pick });
  }
  return out.length ? out : [{ text: line, mark: null }];
}

/* ------------------------------------------------------------------ */
/* 笔记本：按书分组 + 导出                                                */
/* ------------------------------------------------------------------ */

/** 笔记本里的一组（一本书）。 */
export type NotebookGroup = {
  bookId: string;
  /** 书名（划线的快照；空串时退回 bookId） */
  title: string;
  /** 这一组的划线（按行序） */
  items: Annotation[];
  /** 最近一条划线的时刻（用来把最近划的那本书排前面） */
  latest: string;
};

/**
 * 按书分组：组内按行序（就是读书的顺序），组间按**最近划过**排前面。
 *
 * 同名的两本书不会混在一起 —— 分组键始终是 `bookId`，`title` 只用来显示。
 */
export function notebookGroups(list: Annotation[]): NotebookGroup[] {
  const byBook = new Map<string, NotebookGroup>();
  for (const ann of list) {
    const group = byBook.get(ann.bookId);
    if (!group) {
      byBook.set(ann.bookId, {
        bookId: ann.bookId,
        title: ann.bookTitle || ann.bookId,
        items: [ann],
        latest: ann.createdAt,
      });
      continue;
    }
    group.items.push(ann);
    if (ann.createdAt > group.latest) group.latest = ann.createdAt;
  }
  const groups = [...byBook.values()];
  for (const group of groups) {
    group.items.sort(
      (a, b) => a.spans[0].line - b.spans[0].line || a.spans[0].start - b.spans[0].start,
    );
  }
  groups.sort((a, b) => b.latest.localeCompare(a.latest));
  return groups;
}

/** 一条划线在笔记本里显示的位置（行号 +1，给人看的是从 1 数起）。 */
export function annotationLineLabel(ann: Annotation): string {
  const first = ann.spans[0];
  const last = ann.spans[ann.spans.length - 1];
  return first.line === last.line
    ? `第 ${first.line + 1} 行`
    : `第 ${first.line + 1}–${last.line + 1} 行`;
}

/** 划线样式的中文名（导出 / 提示里用）。 */
export function annotationStyleLabel(style: AnnotationStyle): string {
  return ANNOTATION_STYLES.find((item) => item.id === style)?.label ?? "划线";
}

/** 笔记本里的统计：几本书、几条划线、几条写了批注。 */
export function notebookSummary(list: Annotation[]): { books: number; marks: number; notes: number } {
  const books = new Set(list.map((ann) => ann.bookId)).size;
  const notes = list.filter((ann) => ann.note.trim().length > 0).length;
  return { books, marks: list.length, notes };
}

/** 批注 / 原文压成一行（导出 markdown 时引用块里不能随便断行）。 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 导出成 markdown。
 *
 * 一本书一节，一条划线一个小节：先引原文，再写批注（没批注就省掉那一行）。
 * 文件开头留一段统计，方便直接贴进任何笔记软件。
 */
export function toMarkdown(list: Annotation[]): string {
  const groups = notebookGroups(list);
  const { books, marks, notes } = notebookSummary(list);
  const lines: string[] = ["# 笔记本", ""];
  lines.push(`> ${books} 本书 · ${marks} 条划线 · ${notes} 条批注`, "");
  for (const group of groups) {
    lines.push(`## 《${oneLine(group.title)}》`, "");
    for (const ann of group.items) {
      lines.push(`### ${annotationLineLabel(ann)} · ${annotationStyleLabel(ann.style)}`, "");
      lines.push(`> ${oneLine(ann.quote)}`, "");
      if (ann.note.trim()) lines.push(`**批注**：${ann.note.trim()}`, "");
      lines.push("---", "");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** 导出成纯文本（没有 `#` / `>` 这些记号，拿去打印或贴进纯文本文档都干净）。 */
export function toText(list: Annotation[]): string {
  const groups = notebookGroups(list);
  const { books, marks, notes } = notebookSummary(list);
  const lines: string[] = ["笔记本", "", `${books} 本书 · ${marks} 条划线 · ${notes} 条批注`, ""];
  for (const group of groups) {
    lines.push(`《${oneLine(group.title)}》`, "────────────", "");
    for (const ann of group.items) {
      lines.push(`[${annotationLineLabel(ann)}] ${oneLine(ann.quote)}`);
      if (ann.note.trim()) lines.push(`批注：${ann.note.trim()}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
