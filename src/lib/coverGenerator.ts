/**
 * 没有封面图时，封面由这里"算"出来（只算，不画）。
 *
 * 算法只有两步：**书名 → 稳定 hash → 一组预设配色**，再取**书名头两个字**
 * （英文 / 数字取首字母）放到正中央。同一本书在任何机器上都会得到同一张封面，
 * 所以"生成"本身是零成本、可复现的；算出来的方案会缓存到
 * `app_data_dir/covers/<id>.json`（见 core.ts 的 `bookCover` / `saveCoverSpec`），
 * 下次直接读回来 —— 这样以后就算改了配色表，老书也不会突然换色。
 *
 * 真正把封面画出来的是 DOM + CSS（`src/components/BookTransition.tsx` 的 `.cover-*`
 * 与 App.css 里对应的规则）：字体用当前主题的 `--font`，字号按字数是 1 个还是 2 个
 * 自适应，缩放到任何尺寸都清晰 —— 这也是不用预先渲染成图片的原因。
 */

/** 一套封面配色：底色（两端做渐变）、字色、一条装饰条。 */
export type CoverPalette = {
  /** 配色名（只用来读缓存时认得出是哪一套） */
  name: string;
  /** 渐变里偏亮的一端 */
  from: string;
  /** 渐变里偏暗的一端（书脊那侧） */
  to: string;
  /** 中央大字与书名 / 作者的颜色 */
  ink: string;
  /** 书脊位置上的一道装饰条 */
  accent: string;
};

/** 预设配色：10 套（要求至少 8 套），全是压得比较暗的木架色系，跟书架不打架。 */
export const COVER_PALETTES: CoverPalette[] = [
  { name: "赭红", from: "#8c3b2f", to: "#4a1b14", ink: "#f6e6c9", accent: "#e0a24e" },
  { name: "靛蓝", from: "#2f4f7a", to: "#16263f", ink: "#e8f0f8", accent: "#7fb0d8" },
  { name: "墨绿", from: "#3f6b4a", to: "#1c3324", ink: "#eaf3e4", accent: "#a8c98a" },
  { name: "深紫", from: "#5b3a70", to: "#2a1636", ink: "#f2e6f5", accent: "#c79ad8" },
  { name: "芥黄", from: "#a8791f", to: "#5c3d0d", ink: "#fdf3d8", accent: "#f0c95e" },
  { name: "砖橙", from: "#a2542a", to: "#552410", ink: "#fbe9d6", accent: "#f0a860" },
  { name: "松青", from: "#2c5c5c", to: "#123030", ink: "#e3f2ef", accent: "#7fc0b4" },
  { name: "酒红", from: "#7a2740", to: "#3c0f1e", ink: "#f8e3ea", accent: "#d97f9c" },
  { name: "石青", from: "#4a5566", to: "#232a33", ink: "#eceff4", accent: "#9fb0c4" },
  { name: "檀褐", from: "#6b4a26", to: "#33210f", ink: "#f7ead2", accent: "#d9a94e" },
];

/** 方案版本号：以后换算法 / 改配色表时把它 +1，旧缓存就会被当成"认不出"而重算。 */
export const COVER_SPEC_VERSION = 1;

/** 算出来的封面方案（缓存进 `covers/<id>.json` 的就是这个）。 */
export type CoverSpec = {
  /** 版本号（见 COVER_SPEC_VERSION） */
  v: number;
  /** COVER_PALETTES 里的下标 */
  palette: number;
  /** 封面中央那 1~2 个字 */
  initials: string;
};

/**
 * FNV-1a 32 位：稳定、无依赖、换机器也一样 —— 配色不需要"好看"的分布，
 * 只需要"同一本书永远是同一套"。
 */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // Math.imul 保证是 32 位整数乘法（普通 * 会丢精度）
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 书名号、书名里常见的包装字符，取字的时候先剥掉。 */
const TITLE_WRAP = /^[\s《〈【[(（]+|[\s》〉】\])）]+$/g;

/** 中央那两个字：中文书名取前两个字，英文 / 数字取头一两个字母，取不出就用「书」。 */
export function coverInitials(title: string): string {
  const clean = (title || "").replace(TITLE_WRAP, "").trim();
  if (!clean) {
    return "书";
  }
  const chars = [...clean];
  // 中日韩汉字（含扩展 A）：直接取前两个字
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(chars[0])) {
    return chars.slice(0, 2).join("");
  }
  // 拉丁 / 数字：取头两个字符的字母数字，大写显示
  const word = clean.match(/[A-Za-z0-9]/g);
  if (word && word.length > 0) {
    return word.slice(0, 2).join("").toUpperCase();
  }
  return chars[0];
}

/** 按书名算出一张封面：同一本书永远同一套配色、同两个字。 */
export function generatedCover(title: string): CoverSpec {
  return {
    v: COVER_SPEC_VERSION,
    palette: hashText(title || "无题") % COVER_PALETTES.length,
    initials: coverInitials(title),
  };
}

/** 取配色；下标越界（缓存被手改坏）就回落到第一套。 */
export function paletteOf(spec: CoverSpec): CoverPalette {
  return COVER_PALETTES[spec.palette] ?? COVER_PALETTES[0];
}

/**
 * 读回缓存里的方案。认不出（版本不对、字段缺失、JSON 坏了）一律返回 null ——
 * 调用方会退回本地重算，绝不会因为一份坏缓存就打不开书。
 */
export function parseCoverSpec(raw: string | null | undefined): CoverSpec | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const spec = parsed as Partial<CoverSpec>;
    const palette = Number(spec.palette);
    if (spec.v !== COVER_SPEC_VERSION) {
      return null;
    }
    if (!Number.isInteger(palette) || palette < 0 || palette >= COVER_PALETTES.length) {
      return null;
    }
    if (typeof spec.initials !== "string" || spec.initials.length === 0) {
      return null;
    }
    return { v: COVER_SPEC_VERSION, palette, initials: spec.initials.slice(0, 2) };
  } catch {
    return null;
  }
}
