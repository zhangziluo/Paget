/**
 * The PDF image-mode helpers: which book is read as pictures, and where it is.
 *
 * A PDF is imported in **image mode** -- the file is kept untouched and the reader
 * paints its pages -- with the text view one press away (「转换成文字」).  Which of
 * the two a book uses is "how this machine shows this book", not "what this book
 * is", so it lives in the app's own `gui_settings` (one JSON key, the same shape
 * as the shelf's deadlines) and never in the core.
 */

/** `gui_settings` key holding the whole map. */
export const PDF_VIEW_KEY = "reader.pdf_view";

/** The two ways to read a PDF. */
export type PdfView = "image" | "text";

/** The view a PDF opens in when nothing was chosen: pictures, by design. */
export const DEFAULT_PDF_VIEW: PdfView = "image";

/**
 * Parse the stored map.
 *
 * Anything that is not a `{"<book_id>": "text"}` object counts as "nothing was
 * ever stored": a hand-broken pref must never make a book unreadable.
 */
export function readPdfViews(raw: string | null | undefined): Record<string, PdfView> {
  // 没存过：空表
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    // 不是普通对象（数组 / 数字 / 坏 JSON）：当没设过
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const views: Record<string, PdfView> = {};
    for (const [bookId, view] of Object.entries(parsed as Record<string, unknown>)) {
      // 只认明确写下的一种：别的值一律忽略
      if (view === "image" || view === "text") views[bookId] = view;
    }
    return views;
  } catch {
    return {};
  }
}

/** Which view one book should open in. */
export function pdfViewOf(views: Record<string, PdfView>, bookId: string): PdfView {
  // 缺省就是图片模式（这才是「pdf 默认按图片浏览」的落点）
  return views[bookId] ?? DEFAULT_PDF_VIEW;
}

/** A copy of *views* with one book's view set (what gets written back). */
export function withPdfView(
  views: Record<string, PdfView>,
  bookId: string,
  view: PdfView,
): Record<string, PdfView> {
  // 图片是默认值：写进去没有信息量，于是删掉这一项 —— map 永远是「例外的清单」
  const next = { ...views };
  if (view === DEFAULT_PDF_VIEW) delete next[bookId];
  else next[bookId] = view;
  return next;
}

/** One page's vertical box inside the scroll column. */
export type PageSlot = { top: number; bottom: number };

/**
 * The boxes of *pages* equal-sized pages: page *i* sits at `i * (height + gap)`.
 *
 * Every page of one PDF is the same size in practice, so the reader measures page
 * one and lays the rest out with this -- which is what makes the scroll maths
 * exact (see [`firstVisiblePage`]).
 */
export function pageSlots(pages: number, height: number, gap: number): PageSlot[] {
  return Array.from({ length: Math.max(0, Math.trunc(pages)) }, (_, index) => {
    const top = index * (height + gap);
    return { top, bottom: top + height };
  });
}

/**
 * Which page is on screen: the **first** one whose bottom edge is still below
 * *scrollTop* (with a little tolerance).
 *
 * Same rule as the text reader's "first visible line", so a picture book reports
 * progress in exactly the coordinate the core already knows (line == page).
 */
export function firstVisiblePage(slots: PageSlot[], scrollTop: number, offset = 8): number {
  // 一页都没有（还没铺开）：第 0 页
  if (slots.length === 0) return 0;
  const edge = scrollTop + offset;
  for (let index = 0; index < slots.length; index += 1) {
    // 这一页的下边缘还在视线以下：它就是「看得见的第一页」
    if (slots[index].bottom > edge) return index;
  }
  // 滚过头了：停在最后一页
  return slots.length - 1;
}

/** A page number for people: ``第 12 / 785 页``. */
export function pageLabel(page: number, pages: number): string {
  // 页码从 1 数起（内核的坐标从 0），越界也要给出一个能看的数字
  const total = Math.max(1, Math.trunc(pages));
  const current = Math.min(Math.max(1, Math.trunc(page) + 1), total);
  return `第 ${current} / ${total} 页`;
}
