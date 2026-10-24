/**
 * 设置页的措辞层（纯函数，不碰 DOM、不碰内核）。
 *
 * 这一层只干一件事：**把内核那套「点号路径 + 英文键」翻成一句人话**。
 * 一项都**不重算、不翻译数值** —— 生效值仍是 `config_get` 回来的那个，
 * 这里给的是「它叫什么、它是干什么的、现在是多少」。
 *
 * 单独成一层是为了能在 node 里钉住（与 `lib/statsText.ts` 同一个理由）：
 * 措辞是最容易改坏、又最看不出来的东西。
 *
 * 三件事值得说明：
 *
 * 1. **认不出来的键照常显示**：内核以后加了新设置项，这一层不必同步跟上 ——
 *    `settingWords()` 会回落成「键名当名字、没有解释」，页面照样能改它。**绝不猜**它是什么。
 * 2. **哪些项在界面上露面是另一层的事**：`lib/readerConfig.ts` 说了算 ——
 *    那里把「阅读页下栏的「翻页设置」」「留在「调一调」的」「界面上不列的（只有命令行
 *    阅读器会读）」分好了；这一层只管措辞，不管长在哪个页面。
 * 3. **数字带单位**：`plainValue()` 把「60」说成「60 分钟」，省得人对着裸数字猜。
 */

/** 一项设置的人话。 */
export type SettingWords = {
  /** 大白话名字（纸页上的主体，一行） */
  label: string;
  /** 一句话说清它是干什么的；认不出来的键是空串 */
  plain: string;
  /** 数字后面那个单位（「60 分钟」里的「分钟」） */
  unit?: string;
};

/**
 * 点号路径 -> 人话。键就是 `config_get` 回来的路径（`settings.toml` 的 `[节] 键`），
 * 顺序无所谓：页面的顺序由内核 `paths` 决定（那是 schema 的顺序）。
 *
 * 这里**只列界面上会露面的那些**（另外两档见 `lib/readerConfig.ts`）—— 只给命令行
 * 阅读器的项在这一层一个字都不写，界面上也就永远不会提到它们。
 */
const WORDS: Record<string, SettingWords> = {
  /* ---- reader：阅读页下栏「翻页设置」里的自动翻页 ---- */
  "reader.auto_scroll_interval": {
    label: "自动翻页：多久走一次",
    plain:
      "打开自动翻页后，每隔这么多秒自己往前走一次；可以写小数（比如 2.5 秒走一次）。" +
      "阅读页下栏那颗「自动翻页」按钮读的就是这一项。",
    unit: "秒",
  },
  "reader.auto_scroll_step": {
    label: "自动翻页：一次走多少",
    plain:
      "接着上一项 —— 每走一次前进多少。文字是「屏幕行」（屏幕上的行，不是正文行号）；" +
      "PDF 的图片模式一次前进这么多页，5 秒一页偏快，读 PDF 时把上一项调到 20~60 秒更合适。",
    unit: "行 / 页",
  },
  "reader.auto_scroll_check_minutes": {
    label: "自动翻页：多久抽查一次",
    plain:
      "自动翻页时每隔这么多分钟弹一道小题目，确认你还在看。填 0 就是从不抽查。" +
      "题目点哪一个选项都算作答，只有一直没人理才停下。",
    unit: "分钟",
  },
  "reader.auto_scroll_check_seconds": {
    label: "抽查后等几秒",
    plain: "题目弹出来之后等这么多秒；一直没人作答，自动翻页就停下来。",
    unit: "秒",
  },

  /* ---- stats：统计与勋章怎么算 ---- */
  "stats.daily_goal_minutes": {
    label: "每天的小目标",
    plain: "一天打算读多少分钟。统计页里那句「还差多少」按它算；填 0 就是不定目标。",
    unit: "分钟",
  },
  "stats.geo_lookup": {
    label: "要不要联网查位置",
    plain:
      "解锁「去过哪儿」这类地理勋章时，上网查一下所在城市。关掉就完全不联网 —— 这类勋章会一直空着，直到你哪天再打开它。",
  },

  /* ---- library / toc：文件放哪儿、章节怎么认（终端与界面共用） ---- */
  "library.novels_dir": {
    label: "电子书正文放在哪儿",
    plain:
      "导入的电子书转成 UTF-8 正文（.txt）之后放在这个目录。留空 = 用默认的 `~/novels`。改了只影响以后导入的书，已经在书架上的不会自己搬过去。",
  },
  "toc.patterns": {
    label: "章节标题怎么认",
    plain:
      "内核靠标题的样子认章节（比如「第十二章 出山」）。这里补你自己书的写法，多个用 `|` 隔开；留空就只用内核自带那套。",
  },
  "toc.cache_dir": {
    label: "章节缓存放哪儿",
    plain: "章节表、字数这类算出来的东西缓存在这个目录。随时可以删，下次读这本书会自动重建。",
  },

  /* ---- 界面的两个偏好（存在本机，不进内核 settings.toml） ---- */
  "shelf.spine_mode": {
    label: "书脊厚薄跟着字数走",
    plain: "开：书脊厚薄按每本的总字数算，一排摆几本也跟着重算，书架看着错落；关：所有书脊一样宽，一排平分。",
  },
  "shelf.import_flight": {
    label: "导入时让封面飞一下",
    plain:
      "开：从篮子导入之后，新封面一本本从篮口飞上架（书多就飞得更快），按 Esc 或点一下可以跳过；关：导入完直接就是摆好的书架。",
  },
  "shelf.ambient": {
    label: "书房的声音（白噪音）",
    plain:
      "开：打开就是一点背景声 —— 白天是风铃流水，夜里是两段虫鸣交替（6 点天亮、18 点天黑），循环处有 200ms 淡入淡出。点书架上层那台留声机会弹出曲目面板：上面是开关，下面可以手选九段声音（手选后单曲循环），最后一项「按昼夜自动」回到跟天色走。",
  },
};

/** 一节（`settings.toml` 的一个 `[节]`）的人话：标题 + 一句引言。 */
export type SectionWords = {
  /** 大白话节名 */
  title: string;
  /** 这一节是给谁用的、和界面什么关系 */
  plain: string;
};

const SECTION_WORDS: Record<string, SectionWords> = {
  stats: {
    title: "统计与勋章",
    plain:
      "统计怎么算、勋章要不要联网这类事。数字只有一份，界面的统计页与勋章页读的就是它。",
  },
  library: {
    title: "电子书放在哪儿",
    plain: "书库文件的位置。改了只影响以后导入的书，已经在书架上的不会自己搬过去。",
  },
  toc: {
    title: "章节怎么认",
    plain: "目录（章节表）是按标题的样子认出来的，这里改的是认法。",
  },
};

/** 一个路径的最后一节（`reader.page_height` -> `page_height`）。 */
function lastSegment(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : path;
}

/**
 * 一项设置的人话。
 *
 * 认不出来的键：**名字用键名本身**（总比空白强，也对得上终端里的输出）、
 * 解释留空、不给范围标签 —— 页面照样能读能改，只是不替它编说明。
 */
export function settingWords(path: string): SettingWords {
  const known = WORDS[path];
  if (known) return known;
  return { label: lastSegment(path), plain: "" };
}

/** 一节的人话；不认识的节同上（标题用节名本身）。 */
export function sectionWords(name: string): SectionWords {
  const known = SECTION_WORDS[name];
  if (known) return known;
  return { title: name, plain: "" };
}

/** `reader.status_bar_format` 里那几个词各自是什么。 */
const STATUS_BAR_WORDS: Record<string, string> = {
  time: "此刻时间",
  chapter: "章节名",
  duration: "读了多久",
};

/** 一个值的人话（「60」->「60 分钟」、「」->「空」）。 */
function valueWords(path: string, value: unknown): string {
  // 没设过：`config_get` 给 null（`library.novels_dir` 就是），说清它回落成什么
  if (value === null || value === undefined) {
    if (path === "library.novels_dir") return "还没设 —— 按默认的 ~/novels";
    return "还没设 —— 按默认值";
  }
  if (typeof value === "boolean") return value ? "开" : "关";

  // 两个界面偏好的值不是字面值：说出它现在实际是什么样
  if (path === "shelf.spine_mode") return value === "dynamic" ? "跟着字数" : "一样宽";
  if (path === "shelf.import_flight") return value === "on" ? "飞过去" : "不飞";
  if (path === "shelf.ambient") return value === "on" ? "一直在响" : "静音";

  const text = String(value);
  if (text.trim() === "") {
    if (path === "toc.patterns") return "空 —— 只用内核自带那套";
    if (path === "reader.status_bar_format") return "空 —— 那行不显示";
    return "空";
  }

  // 状态栏那种 `a|b|c` 的值：拆成人话，比一串英文好读
  if (path === "reader.status_bar_format") {
    const parts = text
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => STATUS_BAR_WORDS[part] ?? part);
    return parts.length > 0 ? parts.join(" ｜ ") : "空 —— 那行不显示";
  }

  const unit = settingWords(path).unit;
  return unit ? `${text} ${unit}` : text;
}

/** 现在生效的值说成人话（页面里「现在：…」那一小截）。 */
export function plainValue(path: string, value: unknown): string {
  return valueWords(path, value);
}