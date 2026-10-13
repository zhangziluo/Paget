/**
 * 书架的分屏算术（纯函数，与 DOM 无关）。
 *
 * 摆法是「一排一格」：**主屏只有一排**（这一排的头一格摆着一只藤条篮子），**从第二屏起是三排**，
 * 每一排下面都垫一块白色挡板（`App.css` 的 `.shelf-rack.books::after`）。
 *
 * 一排摆得下几本**不写死，是一本一本排出来的**：每本书的书脊厚度由**总字数**算
 * （`spineWidthRem`），从左往右累加，这一排放不下就换排（`packShelfRows`），
 * 再把排按「1 / 3 / 3 …」切成屏（`planShelfPages`）。所以「一屏多少本」是排出来的结果。
 */

/** 主屏摆几排（只有一排）。 */
export const MAIN_ROWS = 1;

/** 其余屏摆几排（三排 —— 也就是「三个白色挡板」）。 */
export const PAGE_ROWS = 3;

/** 这一屏（0 = 主屏）摆几排。 */
export function shelfRowCount(index: number): number {
  return index === 0 ? MAIN_ROWS : PAGE_ROWS;
}

/** 书脊厚度这个偏好（动态 / 统一等宽）存在本机 `gui_settings` 的哪个键（内核不认识它）。 */
export const SPINE_MODE_KEY = "shelf.spine_mode";

/** 书脊厚度的下限（rem）：短篇 / 诗 / 解析不出字数的书都按它摆，书名照样排得下。 */
export const SPINE_MIN_REM = 4.2;

/** 书脊厚度的上限（rem）：上百万字的长篇也到此为止，不会占掉半条书架。 */
export const SPINE_MAX_REM = 7.6;

/**
 * 对数曲线的两个锚点（字数）：这个数及以下一律**保底**，这个数及以上一律**封顶**。
 *
 * 为什么是这两个数：`count_words`（内核）里中文按「字」、英文按「词」算，两边量级可比
 * —— 中文十万字 ≈ 英文十万词。需求给的是概念（「5k 以下保底、50 万以上封顶」），
 * 这里按同一思路把两端拉开，好让**常见长篇**（十几万到几十万字）落在曲线中段、
 * 厚薄看得出差别，而不是统统顶到上限。
 */
export const SPINE_LOG_LOW = 30_000;
export const SPINE_LOG_HIGH = 1_200_000;

/** 书脊上书名那一栏大约有多高（rem）—— 与 `App.css` 的 `.spine-title` 的 `max-height` 是一对。 */
export const SPINE_TITLE_ROOM_REM = 8.4;

/** 书名自动缩字号的下限（rem）：再长的书名也不缩到看不清，真放不下才由省略号兜底。 */
export const SPINE_TITLE_MIN_REM = 0.5;

/** 书脊厚薄这个偏好：只认 `"uniform"`（统一等宽），其余（没存过 / 存坏了）都当动态。 */
export function normalizeSpineMode(raw: unknown): "dynamic" | "uniform" {
  return raw === "uniform" ? "uniform" : "dynamic";
}

/**
 * 书脊厚度（rem）：按总字数做**对数**映射，夹在 [保底, 封顶] 之间。
 *
 * 对数而不是线性：十万字和一百万字，真实图书的厚度不是差十倍，只是几倍。
 * 字数 ≤ `SPINE_LOG_LOW` 直接给保底（几百字的诗也不会薄成一片纸），
 * ≥ `SPINE_LOG_HIGH` 直接封顶；中间一段按 `log(字数)` 均摊到 [保底, 封顶] 上。
 * 字数缺失 / 0 / 坏值（解析失败的书）也走保底那一档。
 */
export function spineWidthRem(words: number): number {
  const count = Number.isFinite(words) && words > 0 ? words : 0;
  if (count <= SPINE_LOG_LOW) return SPINE_MIN_REM;
  if (count >= SPINE_LOG_HIGH) return SPINE_MAX_REM;
  const ratio = Math.log(count / SPINE_LOG_LOW) / Math.log(SPINE_LOG_HIGH / SPINE_LOG_LOW);
  return SPINE_MIN_REM + (SPINE_MAX_REM - SPINE_MIN_REM) * ratio;
}

/** 这本书的厚度落在「最薄…最厚」之间的位置（0–1）—— 侧边那道厚度阴影按它加深。 */
export function spineDepth(widthRem: number): number {
  const span = SPINE_MAX_REM - SPINE_MIN_REM;
  if (!Number.isFinite(widthRem) || span <= 0) return 0;
  return Math.min(1, Math.max(0, (widthRem - SPINE_MIN_REM) / span));
}

/** 中日韩（含全角标点、假名、谚文）算一个「宽」字符 —— 竖排里它占一个整字的长度。 */
function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/**
 * 竖排书名的「长度」（em）：中日韩一字算 1，其它字符（拉丁字母 / 数字 / 半角标点）算 0.55
 * —— 竖排里拉丁字母是转过 90° 的，占的纵向位置比汉字少，空格不占。
 *
 * 特别长的书名不再精确累加（算出来也只会落在字号下限那一档）。
 */
export function spineTitleLength(title: string): number {
  let length = 0;
  for (const char of title) {
    if (char.trim() === "") continue;
    length += isWide(char) ? 1 : 0.55;
  }
  return Math.min(length, 60);
}

/**
 * 书脊上那行书名的字号（rem）：长书名自动缩小，保证**整条**书名排得下（不截断）。
 *
 * 十来个字的书名算出来就是 1rem —— 也就是现在这个字号，所以普通书脊的外观不变；
 * 特别长的书名缩到 `SPINE_TITLE_MIN_REM` 为止，再长才轮到 CSS 的省略号。
 */
export function spineTitleFontRem(title: string): number {
  const length = spineTitleLength(title);
  if (length <= 0) return 1;
  // 1.06 ≈ 每个字的纵向占位（1em 字身 + 0.05em 字距）
  const fitted = SPINE_TITLE_ROOM_REM / (length * 1.06);
  return Math.max(SPINE_TITLE_MIN_REM, Math.min(1, fitted));
}

/**
 * 把书按书脊厚度排进书架：从左往右累加，这一排放不下就换下一排（贪心）。
 *
 * `widths` 是每本书的厚度（与 `rowWidth` 同一单位，调用方按根字号换成 px）；
 * 返回**每一排装着哪几本**（下标，指向 `widths`）。`firstRowExtra` 是主屏第一排要
 * 先留给那只藤条篮子的宽度（其余屏传 0）。排不满的那一排右端会空着 —— 「错落」就是这个意思。
 */
export function packShelfRows(
  widths: number[],
  rowWidth: number,
  gap: number,
  firstRowExtra = 0,
): number[][] {
  const total = Number.isFinite(rowWidth) && rowWidth > 0 ? rowWidth : 0;
  const space = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const extra = Number.isFinite(firstRowExtra) && firstRowExtra > 0 ? firstRowExtra : 0;
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  let budget = Math.max(0, total - extra);
  for (let index = 0; index < widths.length; index += 1) {
    const value = widths[index];
    const width = Number.isFinite(value) && value > 0 ? value : 0;
    // 这一排已经有书了，再放一本就超宽 → 换排（第一本永远放得下，不会死循环）
    if (row.length > 0 && used + space + width > budget + 0.01) {
      rows.push(row);
      row = [index];
      used = width;
      budget = total;
      continue;
    }
    used += row.length === 0 ? width : space + width;
    row.push(index);
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * 翻屏：从第 *current* 屏往 *step* 屏走（一般就是 ±1），夹在 `[0, total - 1]` 里。
 *
 * 返回值与 `current` 相同 = **已经在头 / 尾**，调用方据此判断「这一下没动」
 * —— 比如 `←` 停在第一屏时就不该 `preventDefault`，按键该留给系统（列表滚动之类）。
 * 坏值（NaN / 小数 / 越界）一律先收进合法范围，所以它不会返回一个不存在的屏号。
 */
export function stepPage(current: number, total: number, step: number): number {
  const count = Number.isFinite(total) ? Math.max(1, Math.floor(total)) : 1;
  const last = count - 1;
  const at = Math.max(0, Math.min(last, Number.isFinite(current) ? Math.floor(current) : 0));
  const move = Number.isFinite(step) ? Math.trunc(step) : 0;
  return Math.max(0, Math.min(last, at + move));
}

/**
 * 一屏：这一屏的每一排，装着哪几本（下标，指向传进 `packShelfRows` 的宽度数组）。
 */
export type ShelfPagePlan = number[][];

/**
 * 把排切成屏：**主屏 1 排、其余每屏 3 排**。
 *
 * 末尾不足的**补成空排** —— 排数固定，排高才不跳、白挡板数也永远是需求说的那个数
 * （主屏 1 块、其余屏 3 块）。一本书都没有时也返回「一屏一排」（那只藤条篮子得留着）。
 */
export function planShelfPages(rows: number[][]): ShelfPagePlan[] {
  const pages: ShelfPagePlan[] = [rows.length > 0 ? [rows[0]] : [[]]];
  for (let at = 1; at < rows.length; at += PAGE_ROWS) {
    const chunk = rows.slice(at, at + PAGE_ROWS);
    while (chunk.length < shelfRowCount(pages.length)) chunk.push([]);
    pages.push(chunk);
  }
  return pages;
}

