/**
 * 阅读页的排版与配色偏好：正文字号 / 字重 / 字距 / 行距 / 段间距、页内边距，
 * 纸面主题（四套预设 + 白天黑夜 + 自定义底色 / 字色 + 自定义背景图），
 * 以及**光点导读那几样（光点 / 下划线 / 波浪线）的颜色**。
 *
 * 这些**不是**内核的数据 —— 内核不认识字号、字距与纸面配色 —— 所以和置顶 / 限时一样，
 * 存在界面自己的 `gui_settings` 里（键 `reader.prefs`），值是一段 JSON::
 *
 *     {"fontSize":20,"fontWeight":400,"letterSpacing":0,"lineHeight":1.95,"paraSpacing":0,
 *      "marginX":28,"marginTop":21,"marginBottom":35,"linkY":false,"font":"system",
 *      "theme":"parchment","dark":false,"customBg":"","customFg":"",
 *      "bgFill":"cover","bgFade":0,
 *      "guideDotColor":"","guideLineColor":"","guideWaveColor":""}
 *
 * `bgImage` 只在运行时出现：它是界面挑的那张 `data:image/...;base64,...`（挑图时先压到
 * 长边 2000px），空串 = 不铺背景图；它垫在纸色之上、正文之下，右侧书口与桌面不跟着变。
 * **它不进这段 JSON** —— 图由 Rust 单独存成 `reader/background.*`，开书时读回再填进这个
 * 字段。JSON 里只留摆放方式（`bgFill`）与淡化程度（`bgFade`）；否则拖一次字号滑杆就要把
 * 几 MB 的 base64 重写一遍，WAL 也跟着一起胖。
 *
 * 这里只放范围常量、调色板、归一化（纯函数）与两行读写；界面在 `views/Reader.tsx`，
 * 把结果直接当行内样式贴到 `.reader-lines`（含 `--reader-para-gap` 与光点导读那几个颜色变量）
 * 与阅读页容器的 CSS 变量上。
 *
 * **导读那两样颜色为什么也存这儿**（而不是跟着导读进度走）：进度（读到第几行 / 档位 / 标记）
 * 是**按书**存的（`readingGuide.ts` 的 localStorage），而「光点长什么颜色」与字号、纸色一样是
 * **这台机器上读书的样子**，换一本书也该是同一个 —— 所以它与排版偏好同一份。
 */

import { getGuiSetting, setGuiSetting } from "./core";
// 只借一个类型：面板上那几枚取色器要知道「现在是哪一号领路的」（不引它的任何代码，也不会成环）
import type { GuideMarker } from "./readingGuide";

/** 字号范围（px）。 */
export const FONT_MIN = 20;
export const FONT_MAX = 80;
/** 字重范围（CSS `font-weight` 的整百档）。 */
export const WEIGHT_MIN = 100;
export const WEIGHT_MAX = 900;
export const WEIGHT_STEP = 100;
/** 字距范围（px，允许负数收紧）。 */
export const LETTER_MIN = -1;
export const LETTER_MAX = 6;
/** 行距范围（倍；CSS `line-height` 的无单位倍数，1 = 与字号等高的最紧排法）。 */
export const LINE_MIN = 1.2;
export const LINE_MAX = 3.4;
/** 行距档位：0.05 一档，拖得出手感上的细微差别。 */
export const LINE_STEP = 0.05;
/** 段间距范围（em，跟着字号缩放；0 = 段落之间不额外留白，只靠正文里的空行）。 */
export const PARA_MIN = 0;
export const PARA_MAX = 2.5;
/** 段间距档位。 */
export const PARA_STEP = 0.1;
/** 页内边距范围（px）。 */
export const MARGIN_MIN = 0;
export const MARGIN_MAX = 300;

/** 排版偏好在 `gui_settings` 里的键名（与 `shelf.pinned` / `shelf.deadlines` 同一套命名）。 */
export const READER_PREFS_KEY = "reader.prefs";

/** 四套预设纸面主题。 */
export type ReaderTheme = "parchment" | "green" | "space" | "code";

/** 预设主题的选项（顺序 = 面板里的排列顺序）。 */
export const READER_THEMES: { id: ReaderTheme; label: string; hint: string }[] = [
  { id: "parchment", label: "羊皮纸", hint: "暖米黄，最接近原来的纸色" },
  { id: "green", label: "护眼绿", hint: "豆沙绿，长时间阅读不刺眼" },
  { id: "space", label: "深空蓝", hint: "冷蓝，夜里读着安静" },
  { id: "code", label: "代码", hint: "深蓝底白字（#00008b / #ffffff），像代码编辑器；亮暗同色" },
];

/** 自定义背景图的摆放方式（对应 CSS 的 `background-size` / `background-repeat`）。 */
export type ReaderBgFill = "cover" | "repeat" | "contain";

/** 背景图摆放的选项（顺序 = 面板里的排列顺序）。 */
export const READER_BG_FILLS: { id: ReaderBgFill; label: string; hint: string }[] = [
  { id: "cover", label: "铺满", hint: "放大铺满整张纸，多出来的部分裁掉" },
  { id: "repeat", label: "平铺", hint: "按图片原尺寸一块块铺开（适合小纹理）" },
  { id: "contain", label: "适应", hint: "整张图完整放进来，空出的地方露出纸色" },
];

/** 正文字体。 */
export type ReaderFont = "system" | "song" | "kai" | "fangsong" | "yuan" | "mono";

/**
 * 可选字体（顺序 = 面板里的排列顺序）。
 *
 * `stack` 直接贴成 CSS 的 `font-family`：**先西文后中文**，中文那几款在 macOS / Windows 上
 * 名字不一样，所以每种都排两三个候选名，最后兜一个通用族 —— 谁家有就用谁家的。
 *
 * 全部用**本机自带的字体**：这是个离线应用，不引 web font（也就没有下载 / 首屏闪烁的事）。
 * 真缺字体时浏览器会顺着列表往后找，最差落到 `serif` / `sans-serif`，版式不会塌。
 */
export const READER_FONTS: {
  id: ReaderFont;
  label: string;
  /** CSS 字体族列表（界面原样贴成 `font-family`） */
  stack: string;
  hint: string;
}[] = [
  {
    id: "system",
    label: "默认",
    // 与 App.css 里 `--font` 同一套 —— 阅读页原本就是这个，所以默认外观不变
    stack: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    hint: "跟着界面走（苹方 / 雅黑这类无衬线的黑体），版式最稳",
  },
  {
    id: "song",
    label: "宋体",
    stack: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif',
    hint: "衬线、横细竖粗 —— 纸书正文的味道",
  },
  {
    id: "kai",
    label: "楷体",
    stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif',
    hint: "带笔锋的楷书，读诗词 / 古文舒服",
  },
  {
    id: "fangsong",
    label: "仿宋",
    stack: '"STFangsong", "FangSong", "FangSong_GB2312", serif',
    hint: "细瘦的仿宋，字小也清楚",
  },
  {
    id: "yuan",
    label: "圆体",
    stack: '"Yuanti SC", "STYuanti", "PingFang SC", "Hiragino Sans GB", sans-serif',
    hint: "圆头的黑体，轻松一点",
  },
  {
    id: "mono",
    label: "等宽",
    stack: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
    hint: "等宽（西文 / 数字对得齐），读代码类文本用",
  },
];

/**
 * 一张纸的配色：底色、纸边（书页堆叠 + 书口）、墨色，以及纸面左侧那道很淡的光
 * 与书脊的暗影。全是现成的 CSS 颜色串，界面原样贴成 CSS 变量。
 */
export type ReaderPalette = {
  /** 纸面底色 */
  paper: string;
  /** 纸边（书页堆叠）的填充色 */
  edgeFill: string;
  /** 纸边 / 书口那一层层的线色 */
  edgeLine: string;
  /** 正文字色 */
  ink: string;
  /** 纸面左侧（书脊那侧）很淡的一层光 */
  sheen: string;
  /** 书脊的暗影 */
  spine: string;
};

/**
 * 「代码」主题：深蓝底白字（用户点名的那两个值），只有一版配色 —— 亮与暗**故意相同**，
 * 点「白天 / 黑夜」不会把它变样（它本来就是暗色）。
 *
 * 纸边比底色亮一档（与自定义色的 ±8% 同一条规则），纸边线 / 纸面的光 / 书脊的暗
 * 三样反正会由 `readerPalette` 从墨色与底色派生，这里先填成派生后的值，便于单独读这份表。
 */
const CODE_PALETTE: ReaderPalette = {
  paper: "#00008b",
  edgeFill: "#141494",
  edgeLine: "rgba(255, 255, 255, 0.22)",
  ink: "#ffffff",
  sheen: "rgba(255, 255, 255, 0.16)",
  spine: "rgba(0, 0, 0, 0.66)",
};

/** 每套主题都有「亮 / 暗」两套配色 —— 白天黑夜就是在两者之间切（代码主题两版同色）。 */
export const READER_PALETTES: Record<ReaderTheme, { light: ReaderPalette; dark: ReaderPalette }> = {
  parchment: {
    light: {
      paper: "#f7eed9",
      edgeFill: "#ece0c4",
      edgeLine: "rgba(120, 90, 50, 0.22)",
      ink: "#33241a",
      sheen: "rgba(120, 90, 50, 0.1)",
      spine: "rgba(40, 25, 10, 0.7)",
    },
    dark: {
      paper: "#2b2016",
      edgeFill: "#241a11",
      edgeLine: "rgba(255, 226, 175, 0.12)",
      ink: "#f0e2c8",
      sheen: "rgba(0, 0, 0, 0.28)",
      spine: "rgba(0, 0, 0, 0.72)",
    },
  },
  green: {
    light: {
      paper: "#cce8cf",
      edgeFill: "#bcdcc0",
      edgeLine: "rgba(56, 92, 62, 0.22)",
      ink: "#20301f",
      sheen: "rgba(56, 92, 62, 0.1)",
      spine: "rgba(24, 44, 28, 0.7)",
    },
    dark: {
      paper: "#17251a",
      edgeFill: "#122017",
      edgeLine: "rgba(190, 232, 196, 0.12)",
      ink: "#dfeedf",
      sheen: "rgba(0, 0, 0, 0.3)",
      spine: "rgba(0, 0, 0, 0.72)",
    },
  },
  space: {
    light: {
      paper: "#dbe7f6",
      edgeFill: "#c7d7ee",
      edgeLine: "rgba(40, 70, 110, 0.24)",
      ink: "#1b2a41",
      sheen: "rgba(40, 70, 110, 0.1)",
      spine: "rgba(14, 26, 46, 0.7)",
    },
    dark: {
      paper: "#0f1b2b",
      edgeFill: "#0b1622",
      edgeLine: "rgba(160, 200, 245, 0.14)",
      ink: "#d7e5f7",
      sheen: "rgba(0, 0, 0, 0.32)",
      spine: "rgba(0, 0, 0, 0.75)",
    },
  },
  code: {
    // 深蓝底白字：两版同一份，切白天 / 黑夜不会变样
    light: CODE_PALETTE,
    dark: CODE_PALETTE,
  },
};

export type ReaderPrefs = {
  /** 正文字号（px） */
  fontSize: number;
  /** 正文字重（100~900 的整百档） */
  fontWeight: number;
  /** 正文额外字距（px，负数收紧） */
  letterSpacing: number;
  /** 行距（倍，CSS `line-height` 的无单位倍数） */
  lineHeight: number;
  /** 段间距（em，段落之间额外留的白；0 = 只靠正文里的空行分隔） */
  paraSpacing: number;
  /** 左右页边距（px） */
  marginX: number;
  /** 上页边距（px） */
  marginTop: number;
  /** 下页边距（px）；「上下边距相等」打开时由上边距决定 */
  marginBottom: number;
  /** 上下边距是否联动 */
  linkY: boolean;
  /** 正文字体 */
  font: ReaderFont;
  /** 预设纸面主题 */
  theme: ReaderTheme;
  /** 亮暗：false = 白天，true = 黑夜（每套预设都有两版配色） */
  dark: boolean;
  /** 自定义纸面底色（`#rrggbb`）；空串 = 跟随预设主题 */
  customBg: string;
  /** 自定义字色（`#rrggbb`）；空串 = 跟随预设主题 */
  customFg: string;
  /**
   * 自定义背景图（`data:image/...;base64,...`）；空串 = 不铺背景图。
   *
   * 运行时用，**不写进 `gui_settings`**：图片单独存 `app_data_dir/reader/background.*`，
   * 开书时由 `loadReaderPrefs` + `readerBackground()` 填进来（见文件头）。
   *
   * 它垫在纸色之上、正文之下（见 `App.css` 的 `.reader-page.has-bg`）——
   * 只是「这张纸的花纹」，不影响书口、桌面与面板。
   */
  bgImage: string;
  /** 背景图的摆放方式：铺满 / 平铺 / 适应 */
  bgFill: ReaderBgFill;
  /** 背景图的淡化程度（0~100）：往图上盖一层纸色，越大字越清楚 */
  bgFade: number;
  /**
   * 自定义**光点**色（`#rrggbb`，那一颗贴着字底走的小球）；空串 = 出厂那颗琥珀
   * （`DEFAULT_GUIDE_DOT`）。高光 / 暗边 / 光晕都由它派生（见 `guideColorVars`）。
   */
  guideDotColor: string;
  /**
   * 自定义**下划线**色（`#rrggbb`，光点划过的那条线）；空串 = 出厂那套 ——
   * 光点模式下是淡琥珀（光点改成别的色时跟着光点走），下划线模式下**跟正文墨色**
   * （那道线本来就是「字底下那条线挪了个位置」，见 `App.css`）。
   */
  guideLineColor: string;
  /**
   * 自定义**波浪线**色（`#rrggbb`，波浪线那一号领路的那一段 —— 走法与下划线一样，
   * 只是笔迹是波浪的）；空串 = 出厂：**跟正文墨色**（像用同一支笔随手画的波浪）。
   */
  guideWaveColor: string;
};

/**
 * 默认排版：字号取范围下限 20px；行距 **1.95** 与原先 CSS 里 `.reader-lines` 的
 * `line-height` 一致、段间距 **0** 不额外留白、字体取 **`system`**（= 与 `App.css` 的
 * `--font` 同一套，也就是阅读页原本那个字体）—— 所以**默认外观与没有这些开关时完全一样**；
 * 页边距大致等于原先 CSS 里的 `1.3rem / 1.7rem / 2.2rem`（21 / 28 / 35）；
 * 字重 400、不加字距；羊皮纸主题；亮暗在第一次使用时跟随系统（见 `loadReaderPrefs`）。
 */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: FONT_MIN,
  fontWeight: 400,
  letterSpacing: 0,
  lineHeight: 1.95,
  paraSpacing: 0,
  marginX: 28,
  marginTop: 21,
  marginBottom: 35,
  linkY: false,
  font: "system",
  theme: "parchment",
  dark: false,
  customBg: "",
  customFg: "",
  bgImage: "",
  bgFill: "cover",
  bgFade: 0,
  guideDotColor: "",
  guideLineColor: "",
  guideWaveColor: "",
};

/** 把数字夹进 [low, high] 并取整；NaN / 空值落回下限。 */
function clamp(value: number, low: number, high: number): number {
  // 手输的坏值（NaN / 空）一律落回下限，别把 NaN 写进样式里
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * 按 *digits* 位小数把数字收进 [low, high]；NaN / 空值落回下限。
 *
 * 行距是 0.05 一档（两位小数）、字距是 0.1 一档（一位），所以位数由调用方给。
 */
function clampStep(value: number, low: number, high: number, digits: number): number {
  // 手输的坏值（NaN / 空）一律落回下限，别把 NaN 写进样式里
  if (!Number.isFinite(value)) return low;
  const scale = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, value)) * scale) / scale;
}

/** 字距要保留一位小数（0.5px 这种档位调得出来）。 */
function clampDecimal(value: number, low: number, high: number): number {
  return clampStep(value, low, high, 1);
}

/** 字重吸附到 100 的整数倍：只有整百档在字体里才有对应的字形。 */
function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READER_PREFS.fontWeight;
  const snapped = Math.round(value / WEIGHT_STEP) * WEIGHT_STEP;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, snapped));
}

/** 主题只认这四个 id，别的值（坏数据 / 将来扩展）一律回到羊皮纸。 */
function normalizeTheme(value: unknown): ReaderTheme {
  return value === "green" || value === "space" || value === "code" ? value : "parchment";
}

/** 字体只认名单里的那几款；没存过 / 存坏了都回落默认（`system`）。 */
function normalizeFont(value: unknown): ReaderFont {
  const found = READER_FONTS.find((item) => item.id === value);
  return found ? found.id : "system";
}

/** 这一款字体的 CSS 字体族列表（界面直接贴成 `font-family`）。 */
export function readerFontStack(font: unknown): string {
  const id = normalizeFont(font);
  return READER_FONTS.find((item) => item.id === id)?.stack ?? READER_FONTS[0].stack;
}

/** 把 `#abc` / `#aabbcc` 解析成三个通道；不是合法颜色返回 null。 */
function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** 自定义色收成 `#rrggbb`；不是合法颜色就返回空串（=「跟随主题」）。 */
export function normalizeHexColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const rgb = parseHex(value);
  if (!rgb) return "";
  return `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 背景图只认 `data:image/...;base64,` 长串；坏数据 / 超长一律当作没有。
 *
 * 这个字段现在只用于**读回老数据**（图单独存文件，见文件头）；新数据在
 * `saveReaderPrefs` 里就被剔掉了。
 */
function normalizeBgImage(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/") || !trimmed.includes(";base64,")) return "";
  // 老版本压到长边 2400px，正常远小于这个上限；超了只可能是坏数据
  return trimmed.length > 16 * 1024 * 1024 ? "" : trimmed;
}

/** 摆放方式只认那三样；没存过 / 存坏了都回落「铺满」。 */
function normalizeBgFill(value: unknown): ReaderBgFill {
  return value === "repeat" || value === "contain" ? value : "cover";
}

/** 按比例把 *from* 混向 *to*（0 = 全是 from，1 = 全是 to）。 */
function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from) ?? [0, 0, 0];
  const b = parseHex(to) ?? [0, 0, 0];
  const mixed = a.map((part, index) => Math.round(part + (b[index] - part) * amount));
  return `#${mixed.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** 把一个颜色串转成带透明度的 `rgba(...)`（纸面的光、书脊的暗与背景图的淡化都要半透明）。 */
export function hexToRgba(value: string, alpha: number): string {
  const rgb = parseHex(value) ?? [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** 这个底色算浅色吗（浅色纸用黑边、深色纸用白边）。 */
function isLightHex(value: string): boolean {
  const rgb = parseHex(value);
  if (!rgb) return true;
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150;
}

/**
 * 由偏好算出这一屏要用的整套配色。
 *
 * 先用「预设主题 + 亮暗」取一套现成的；自定义背景 / 字色若填了就**盖在上面**
 * （用户自己挑的颜色优先）。盖的时候纸边、纸面的光与书脊的暗都跟着重算 ——
 * 否则绿纸会配出一圈棕色的边。
 */
export function readerPalette(prefs: ReaderPrefs): ReaderPalette {
  const preset = READER_PALETTES[normalizeTheme(prefs.theme)][prefs.dark ? "dark" : "light"];
  const palette: ReaderPalette = { ...preset };
  if (prefs.customBg) {
    // 纸边比底色再深一点（浅色纸）或再亮一点（深色纸），像一叠纸的侧边
    palette.paper = prefs.customBg;
    palette.edgeFill = mixHex(
      prefs.customBg,
      isLightHex(prefs.customBg) ? "#000000" : "#ffffff",
      0.08,
    );
  }
  if (prefs.customFg) {
    palette.ink = prefs.customFg;
  }
  // 纸边线与纸面的光都从墨色来，书脊的暗固定偏黑：自定义颜色也能配出一致的层次
  palette.edgeLine = hexToRgba(palette.ink, 0.22);
  palette.sheen = hexToRgba(palette.ink, isLightHex(palette.paper) ? 0.1 : 0.16);
  palette.spine = hexToRgba("#000000", isLightHex(palette.paper) ? 0.5 : 0.66);
  return palette;
}

/* ------------------------------------------------------------------ */
/* 光点导读那两样颜色                                                   */
/* ------------------------------------------------------------------ */

/**
 * 出厂的光点色：**与 `App.css` 里 `.reading-guide-dot` 那条渐变的中停同一个值**
 * （那几句 `var()` 的兜底就是它），所以「没自定义过」时外观与从前一字不差。
 */
export const DEFAULT_GUIDE_DOT = "#ffd27a";

/**
 * 出厂的下划线色（光点模式下那条淡琥珀的底色）：`App.css` 里 `--guide-line` 的兜底
 * 就是它 @45%。下划线模式那条另有一套兜底（**正文墨色**），见 `guideColorVars`。
 */
export const DEFAULT_GUIDE_LINE = "#ffc864";

/**
 * 由偏好算出**光点导读那几个 CSS 变量**（界面贴在 `.reader-lines` 的行内样式上）。
 *
 * 三样各自的来历：
 * - `--guide-dot*`：光点那颗小球（渐变的中停 / 高光 / 暗边 / 两层光晕）。挑了颜色就由它派生：
 *   高光往白里混、暗边与光晕往黑里混 —— 于是**任何颜色都是一颗「受了光的小球」**，
 *   不用 `color-mix()`（那要 Safari 16.2+，这个项目一直只用 Safari 14 就有的东西）。
 * - `--guide-line`：**光点划过的那条线**（已读行那条下划线 + 当前行那条轨迹条）。
 *   下划线色填了就听它的；没填而**光点色改过**就跟着光点走（出厂时两者本就是同一支琥珀
 *   —— 「光点」与「它划过的线」是一套东西）。
 * - `--guide-crawl`：**下划线模式**那一段领路的线（见 `readingGuide.ts` 的 `guideCrawlAt`）。
 *   出厂是**正文墨色**（那道线就是「字底下那条线挪了个位置」）；下划线色填了就换成它。
 * - `--guide-wave`：**波浪线模式**那一号的颜色 —— 它**只在用户挑过之后**才写；
 *   没写时 CSS 里 `.guide-wave` 那份 `--guide-wave-line` 会让这一号跟正文墨色走
 *   （见 `App.css`）。它**不借下划线那支 `--guide-crawl`**：下划线色是行内写在同一个元素上的，
 *   行内优先级更高，借来就会串台（只改了「下划线」色，波浪线也跟着变色）。
 *
 * 一样都没自定义时返回空对象 —— 那么行内样式里一个颜色变量都不写，CSS 那边用自己的兜底值，
 * 于是**出厂外观与从前完全一样**。
 */
export function guideColorVars(
  prefs: Pick<ReaderPrefs, "guideDotColor" | "guideLineColor" | "guideWaveColor">,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const dot = normalizeHexColor(prefs.guideDotColor);
  if (dot) {
    vars["--guide-dot-mid"] = dot;
    vars["--guide-dot-hi"] = mixHex(dot, "#ffffff", 0.8);
    vars["--guide-dot-lo"] = mixHex(dot, "#000000", 0.28);
    vars["--guide-dot-glow"] = hexToRgba(mixHex(dot, "#000000", 0.16), 0.55);
    vars["--guide-dot-halo"] = hexToRgba(mixHex(dot, "#000000", 0.3), 0.22);
  }
  const line = normalizeHexColor(prefs.guideLineColor);
  if (line) {
    vars["--guide-line"] = hexToRgba(line, 0.45);
    vars["--guide-crawl"] = line;
  } else if (dot) {
    // 只改了光点：那条线跟着光点走（出厂时本就是同一支琥珀）；下划线 / 波浪线那两号不动
    vars["--guide-line"] = hexToRgba(dot, 0.45);
  }
  const wave = normalizeHexColor(prefs.guideWaveColor);
  if (wave) {
    // 波浪线那一号：自己的颜色（CSS 里 `.guide-wave` 把 `--guide-crawl` 指到它上）
    vars["--guide-wave"] = wave;
  }
  return vars;
}

/**
 * 面板上那几枚取色器**该显示什么颜色** —— 自定义色优先；没填就给这一档的「出厂色」：
 * 光点是那颗琥珀；下划线在**下划线模式**下出厂跟**正文墨色**、在别的模式下是淡琥珀的底色
 * （改了光点色时那条线跟着光点走）；波浪线出厂也**跟正文墨色**（一支笔随手画的波浪）。
 * 取色器因此总是与屏幕上那一条线同色。
 */
export function guideSwatchColor(
  prefs: ReaderPrefs,
  /** 当前纸面的正文墨色（`readerPalette(prefs).ink`） */
  ink: string,
  /** 现在是哪一号领路的（下划线模式下那条线出厂就是正文墨色） */
  marker: GuideMarker,
): { dot: string; line: string; wave: string } {
  const inkHex = normalizeHexColor(ink);
  const dot = prefs.guideDotColor || DEFAULT_GUIDE_DOT;
  let line = prefs.guideLineColor;
  if (!line) {
    line =
      marker === "underline" ? inkHex || DEFAULT_GUIDE_LINE : prefs.guideDotColor || DEFAULT_GUIDE_LINE;
  }
  const wave = prefs.guideWaveColor || inkHex || DEFAULT_GUIDE_LINE;
  return { dot, line, wave };
}

/** 系统现在是不是深色 —— 第一次用（还没存过偏好）时，亮暗默认跟着它。 */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/** 把任意输入收进合法范围；「上下边距相等」时下边距 = 上边距。 */
export function normalizeReaderPrefs(input: Partial<ReaderPrefs>): ReaderPrefs {
  const merged = { ...DEFAULT_READER_PREFS, ...input };
  const marginTop = clamp(merged.marginTop, MARGIN_MIN, MARGIN_MAX);
  const linkY = Boolean(merged.linkY);
  return {
    fontSize: clamp(merged.fontSize, FONT_MIN, FONT_MAX),
    fontWeight: clampWeight(merged.fontWeight),
    letterSpacing: clampDecimal(merged.letterSpacing, LETTER_MIN, LETTER_MAX),
    // 行距 0.05 一档：两位小数，别把 1.9500001 这种值写进样式
    lineHeight: clampStep(merged.lineHeight, LINE_MIN, LINE_MAX, 2),
    paraSpacing: clampDecimal(merged.paraSpacing, PARA_MIN, PARA_MAX),
    marginX: clamp(merged.marginX, MARGIN_MIN, MARGIN_MAX),
    marginTop,
    marginBottom: linkY ? marginTop : clamp(merged.marginBottom, MARGIN_MIN, MARGIN_MAX),
    linkY,
    font: normalizeFont(merged.font),
    theme: normalizeTheme(merged.theme),
    dark: Boolean(merged.dark),
    customBg: normalizeHexColor(merged.customBg),
    customFg: normalizeHexColor(merged.customFg),
    bgImage: normalizeBgImage(merged.bgImage),
    bgFill: normalizeBgFill(merged.bgFill),
    bgFade: clamp(merged.bgFade, 0, 100),
    guideDotColor: normalizeHexColor(merged.guideDotColor),
    guideLineColor: normalizeHexColor(merged.guideLineColor),
    guideWaveColor: normalizeHexColor(merged.guideWaveColor),
  };
}

/** 读回排版偏好；读不到 / 存坏了都回落到默认值（界面状态丢了不算数据损失）。 */
export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  try {
    const raw = await getGuiSetting(READER_PREFS_KEY);
    // 第一次用（还没存过）：亮暗跟着系统走，之后就以用户自己选的那一份为准
    if (!raw) return { ...DEFAULT_READER_PREFS, dark: systemPrefersDark() };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_READER_PREFS, dark: systemPrefersDark() };
    }
    return normalizeReaderPrefs(parsed as Partial<ReaderPrefs>);
  } catch {
    return { ...DEFAULT_READER_PREFS, dark: systemPrefersDark() };
  }
}

/**
 * 写回排版偏好（调用方保证已经是归一化过的值）。
 *
 * `bgImage` 有意剔掉：图单独存文件（见文件头）。这条写入在拖滑杆时每 400ms
 * 就会跑一次，留着几 MB 的 base64 会把 WAL 一起喂胖。
 */
export async function saveReaderPrefs(prefs: ReaderPrefs): Promise<void> {
  const stored: Partial<ReaderPrefs> = { ...prefs };
  delete stored.bgImage;
  await setGuiSetting(READER_PREFS_KEY, JSON.stringify(stored));
}
