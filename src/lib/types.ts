/**
 * TypeScript mirrors of what the reading core hands back.
 *
 * These are the *wire* shapes from `core/wreader/serve.py` (see `_book_rows` there);
 * they are deliberately plain data so the shelf can render them directly.
 */

/** One row of the shelf, as the core's `list` / `recent` / `search` return it. */
export type BookRow = {
  /** 书 id（正文 SHA-1 前 12 位，与内核用的是同一个） */
  id: string;
  title: string;
  author: string;
  file_path: string;
  /**
   * 书的形式：`"pdf"` 表示这本是**图片模式**的 PDF（阅读页默认画页面而不是排文字）。
   * 别的格式是空串；缓存里重建出来的行一定有它，老行没有时按 `""` 算。
   */
  format?: string;
  /** 图片模式 PDF 的页数（普通书是 0） */
  pages?: number;
  /** 「转换成文字」之后那份 txt 的路径（没转之前是空串） */
  text_path?: string;
  total_lines: number;
  total_words: number;
  chapter_count: number;
  /** 内核的坐标：源行号（0 起始） */
  current_line: number;
  percentage: number;
  last_read: string | null;
  total_time_seconds: number;
  finished: boolean;
  tags: string[];
  /**
   * 书签（`progress.bookmarks`）。只有内核 `sync_shelf` 回来的行才有这一项，
   * 从本地缓存读出来的书架没有（缓存表里不存书签），所以是可选的。
   */
  bookmarks?: Bookmark[];
};

/** One bookmark, exactly the shape `library.normalise_bookmarks` keeps. */
export type Bookmark = {
  line: number;
  label: string;
  created: string;
};

/** One chapter of the table of contents (`toc`). */
export type TocEntry = {
  /** 章节起始行（内核坐标，0 起始） */
  line: number;
  title: string;
  /** 这一章在书里的位置 */
  percentage: number;
};

/** A slice of a book's text (`text`); the core never returns a whole book. */
export type TextSlice = {
  book_id: string;
  total_lines: number;
  start: number;
  count: number;
  lines: string[];
};

/** One full-text search hit, from the GUI's own SQLite index. */
export type SearchHit = {
  book_id: string;
  title: string;
  line_start: number;
  line_end: number;
  /** 命中片段，`[` `]` 标出关键词 */
  snippet: string;
};

/** One line-level hit inside a single book (the reading page's search). */
export type BookSearchHit = {
  /** 命中那一行所属的章名（章前内容为空串） */
  title: string;
  /** 内核的行号（0 起始），点结果直接跳到这一行 */
  line: number;
  /** 命中片段，`[` `]` 标出关键词 */
  snippet: string;
};

/** What one in-book search found, plus whether the local index is usable. */
export type BookSearchResult = {
  hits: BookSearchHit[];
  /** `false` = 还没建索引；界面先调 `indexBook` 再搜一次 */
  indexed: boolean;
  /** `true` = 索引只覆盖了书的前半部分（很长的书） */
  truncated: boolean;
};

/**
 * The GUI's own reading position.
 *
 * `cfi` is this front end's precise locator; it stays empty for a book opened as
 * text (the core only knows line numbers).  `line` is the approximated source line
 * that also goes back to the core, so the terminal reader resumes at the same spot.
 */
export type GuiPosition = {
  book_id: string;
  cfi: string;
  percentage: number;
  line: number;
  updated_at: string;
};

/** What one indexing run did (the cache is a convenience, so it may truncate). */
export type IndexReport = {
  chunks: number;
  lines: number;
  truncated: boolean;
};

/** One newly unlocked achievement, as the core reports it. */
export type Unlocked = {
  id: string;
  name: string;
  unlocked_at: string;
};

/** The answer to `session` / `event` / `daily_open`. */
export type SessionResult = {
  saved: boolean;
  unlocked: Unlocked[];
};

/** One reading session, as the core keeps them in `progress.sessions`. */
export type SessionEntry = {
  /** 会话开始（ISO，秒级） */
  start?: string;
  /** 会话结束（同上） */
  end?: string;
  /** 这次读了多少行 */
  lines_read?: number;
};

/**
 * The raw index record behind `get_book`.
 *
 * Only the fields the GUI reads are typed: the record nests the interesting
 * numbers under `progress`, which the reader needs for its bookmark list and the
 * shelf's context menu needs for "打卡天数" / "属性".
 */
export type BookRecord = {
  id?: string;
  title?: string;
  author?: string;
  total_lines?: number;
  total_words?: number;
  /** 图片模式的 pdf：`"pdf"`；其余格式是空串 */
  format?: string;
  /** 图片模式 pdf 的页数 */
  pages?: number;
  /** 「转换成文字」之后那份 txt 的路径（没转之前是空串） */
  text_path?: string;
  /** 入库日期（YYYY-MM-DD，只有裸记录里有，扁平行里没有） */
  import_date?: string;
  progress?: {
    current_line?: number;
    percentage?: number;
    last_read?: string | null;
    total_time_seconds?: number;
    finished?: boolean;
    bookmarks?: Bookmark[];
    sessions?: SessionEntry[];
  };
};

/** One achievement with its progress, as the core's `achievements` returns it. */
export type Achievement = {
  id: string;
  name: string;
  desc: string;
  category: string;
  /** 隐藏成就：解锁前不剧透 */
  secret: boolean;
  /** 进度是相对的哪个指标（`total_time`、`books_read` …） */
  metric: string;
  current: number;
  required: number;
  unlocked: boolean;
  unlocked_at: string;
};

/** One day of the heatmap (`stats.heatmap`). */
export type HeatCell = {
  date: string;
  seconds: number;
  /** 强度字符（`·` `░` `▒` `▓` `█`） */
  level: string;
};

/** One row of the weekly grid (`stats.heatmap_grid`); `null` fills the edges. */
export type HeatWeek = (HeatCell | null)[];

/** One book's lifetime reading time (`stats.books`). */
export type StatsBook = {
  id: string;
  title: string;
  seconds: number;
};

/**
 * The whole reading statistics report -- the very dict the core returns
 * prints (`stats.build_report`), so the GUI and the terminal cannot drift.
 */
export type StatsReport = {
  generated_at: string;
  today: string;
  total_seconds: number;
  /** 已经是 `format_hours` 之后的成品串 */
  total: string;
  today_seconds: number;
  week_seconds: number;
  month_seconds: number;
  daily_goal_seconds: number;
  goal_met: boolean;
  streak_days: number;
  streak_min_seconds: number;
  books_read: number;
  finished_books: number;
  vocab_count: number;
  translations: number;
  night_seconds: number;
  longest_session_seconds: number;
  achievements: {
    unlocked: string[];
    unlocked_count: number;
    total: number;
  };
  books: StatsBook[];
  daily: Record<string, number>;
  heatmap: HeatCell[];
  heatmap_grid: HeatWeek[];
};

/** The core's data locations (`paths`), so the user can find or back them up. */
export type CorePaths = {
  data_dir: string;
  novels_dir: string;
  library_file: string;
  settings_file: string;
};

/** The answer to `config_get`: every effective value plus the key order. */
export type ConfigGet = {
  /** 点号路径 -> 生效值（默认值已合并进来） */
  values: Record<string, unknown>;
  /** 点号路径列表，顺序就是 schema 里的顺序 */
  paths: string[];
};

/** The answer to `config_set`: the canonical path and the value that landed. */
export type ConfigSet = {
  path: string;
  value: unknown;
};

/**
 * `set_meta` 的回执：改完后的三个字段（见 `lib/core.ts` 的 `setBookMeta`）。
 *
 * 内核在这里只动这三项标签，正文、章节表、位置与统计一概不碰。
 */
export type BookMeta = {
  book_id: string;
  title: string;
  author: string;
  tags: string[];
};

/** One book named in a receipt (import / prune / clear). */
export type BookBrief = {
  id: string;
  title: string;
};

/** The answer to `import`: what was scanned, imported, skipped and failed. */
export type ImportResult = {
  path: string;
  /** 目录里看过的候选项总数 */
  scanned: number;
  imported: BookBrief[];
  /** 内容重复被跳过的文件名 */
  duplicates: string[];
  /** [文件名, 原因] */
  failed: [string, string][];
  unlocked: Unlocked[];
};

/** The answer to `export`: where the bundle landed and what went in. */
export type ExportResult = {
  path: string;
  books: number;
  unlocked: number;
  seconds: number;
};

/** The answer to `import_data`: what the merge added (add-only). */
export type ImportDataResult = {
  path: string;
  books: number;
  /** 本机不认识、被跳过的书 */
  skipped: number;
  seconds: number;
  unlocked: number;
};

/** The answer to `prune` / `clear`: how many went and which. */
export type RemovalResult = {
  removed: number;
  books: BookBrief[];
};

/**
 * 这本书的封面 —— 由壳层（Rust）查出来的，**内核不管封面**。
 *
 * `image` 是本地封面图的 data URL（没有就是 null），`spec` 是上次缓存下来的
 * 「自动生成封面」方案（JSON 文本，见 `lib/coverGenerator.ts`）。
 */
export type CoverInfo = {
  image: string | null;
  spec: string | null;
};

/* ------------------------------------------------------------------ */
/* 限时模式（到期封印）与「已归档」                                      */
/* ------------------------------------------------------------------ */

/**
 * 限时书：书 id -> 到期日（`YYYY-MM-DD`）。
 *
 * 内核不认识"到期日"，这是界面自己的状态，和置顶一样存在本机 SQLite 的
 * `gui_settings` 里（键 `shelf.deadlines`，见 `lib/deadlines.ts`）。
 */
export type DeadlineMap = Record<string, string>;

/**
 * 归档里那份元信息（zip 内的 `paget-archive.json`，见 `src-tauri/src/archive.rs`）。
 *
 * 它**跟着归档一起走**，所以列表与找回都只靠归档目录本身：本机缓存（SQLite）
 * 随时可以清掉，归档仍然自解释。
 */
export type ArchiveMeta = {
  /** 归档文件名（`<书名哈希前8位><随机后缀>.zip`） */
  archive_id: string;
  /** 封印前的书 id（正文 SHA-1 前 12 位；找回后通常与它一致） */
  book_id: string;
  title: string;
  author: string;
  /** 封印前那个文件名 */
  original_name: string;
  /** 封印前那个绝对路径 */
  original_path: string;
  /** 封印时刻（本地时间，秒级，`coreStamp` 的格式） */
  sealed_at: string;
  /** 限时到期日（`YYYY-MM-DD`；空串 = 不是限时书） */
  due_at: string;
  total_lines: number;
  total_words: number;
  /** 内核记录里 `progress` 的快照：找回时按它写回进度、书签与读完 */
  progress: BookRecord["progress"] | null;
};

/** 「已归档」列表里的一行。 */
export type ArchivedBook = {
  archive_id: string;
  /** 归档 zip 的绝对路径（排查问题时给用户看） */
  zip_path: string;
  /** 归档体积（字节） */
  size_bytes: number;
  meta: ArchiveMeta;
};

/** `archive_restore` 的回执：找回了哪一本、进度有没有写回。 */
export type RestoredBook = {
  archive_id: string;
  book_id: string;
  title: string;
  progress_restored: boolean;
};
