/**
 * The one place that talks to the Rust shell.
 *
 * Two kinds of call live here, and the difference matters:
 *
 * * `coreRequest(...)` forwards straight to the Python core
 *   (`python -m wreader.serve`), which **owns the data** -- shelf, position,
 *   statistics, achievements.
 * * the cache helpers (`syncShelf`, `searchCache`, ...) touch this app's own
 *   SQLite file, which can be deleted at any time and rebuilt from the core.
 *
 * Nothing in `src/` guesses a path or re-implements a rule: if a number has to be
 * written to `~/.wreader`, it goes through the core.
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  Achievement,
  ArchivedBook,
  BookMeta,
  BookRecord,
  Bookmark,
  BookRow,
  ConfigGet,
  ConfigSet,
  CorePaths,
  CoverInfo,
  ExportResult,
  GuiPosition,
  ImportDataResult,
  ImportResult,
  IndexReport,
  RemovalResult,
  RestoredBook,
  SearchHit,
  SessionResult,
  StatsReport,
  TextSlice,
  TocEntry,
  Unlocked,
} from "./types";

/** Forward one RPC call to the core (`ping`, `list`, `toc`, `text`, `session`, ...). */
export async function coreRequest<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invoke<T>("core_request", { method, params });
}

/** The core's version -- also the liveness check the shelf header shows. */
export function coreVersion(): Promise<string> {
  return invoke<string>("core_version");
}

/** Pull the shelf from the core and refresh the local cache. */
export function syncShelf(syncedAt: string): Promise<BookRow[]> {
  return invoke<BookRow[]>("sync_shelf", { syncedAt });
}

/** The cached shelf, without waiting for the core (instant first paint). */
export function cachedShelf(): Promise<BookRow[]> {
  return invoke<BookRow[]>("cached_shelf");
}

/** Build (or rebuild) the search index of one book. */
export function indexBook(bookId: string): Promise<IndexReport> {
  return invoke<IndexReport>("index_book", { bookId });
}

/** Full-text search over the local index. */
export function searchCache(query: string, limit = 30): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_cache", { query, limit });
}

/** Remember the GUI's own position (the authoritative one goes to the core). */
export function saveGuiPosition(position: GuiPosition): Promise<void> {
  return invoke<void>("save_gui_position", { position });
}

/** Read the GUI's position back (`null` when the book was never opened here). */
export function loadGuiPosition(bookId: string): Promise<GuiPosition | null> {
  return invoke<GuiPosition | null>("load_gui_position", { bookId });
}

/** Read one GUI setting. */
export function getGuiSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_gui_setting", { key });
}

/** Write one GUI setting. */
export function setGuiSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_gui_setting", { key, value });
}

/**
 * The shelf layout (the order books stand in) -- the core's ``shelf_layout``.
 *
 * This is one of the newer core methods (it landed in ``core/wreader/serve.py`` on
 * 2026-10-07 together with the shelf layout); an older frozen core answers
 * ``unknown method`` and the caller falls back to the local ``gui_settings``
 * copy instead (see ``lib/shelfManage.ts``).  The document is returned
 * **uninterpreted**: its shape and every default live in
 * ``shelfManage.normalizeLayout``.
 */
export function shelfLayout(): Promise<unknown> {
  return coreRequest<{ layout?: unknown }>("shelf_layout", {}).then((reply) => reply.layout ?? null);
}

/** Replace the shelf layout; the core answers with what it actually stored. */
export function setShelfLayout(layout: unknown): Promise<unknown> {
  return coreRequest<{ layout?: unknown }>("set_shelf_layout", { layout }).then(
    (reply) => reply.layout ?? null,
  );
}

/** Throw the cache away; the next sync rebuilds it from the core. */
export function resetCache(): Promise<void> {
  return invoke<void>("reset_cache");
}

/** A slice of a book's text, split exactly like the terminal reader splits it. */
export function bookText(
  bookId: string,
  start: number,
  count: number,
): Promise<TextSlice> {
  // 行号是两边唯一的共同坐标，所以这里只用 start / count
  return coreRequest<TextSlice>("text", { book_id: bookId, start, count });
}

/** A book's table of contents (served from the core's cache when it is fresh). */
export async function bookToc(bookId: string): Promise<TocEntry[]> {
  // 内核回的是 {"book_id":..., "entries":[...]}
  const answer = await coreRequest<{ entries: TocEntry[] }>("toc", {
    book_id: bookId,
  });
  return answer.entries ?? [];
}

/**
 * Write a finished reading session: position, duration and achievements.
 *
 * `ranges` is the list of `[start, end]` line ranges walked through, so the core
 * counts words it has not counted before (re-reading a page adds nothing).
 */
export function recordSession(params: {
  bookId: string;
  line: number;
  percentage: number;
  seconds: number;
  linesRead: number;
  ranges: [number, number][];
  bookmarks: Bookmark[];
  started: string;
  ended: string;
}): Promise<SessionResult> {
  return coreRequest<SessionResult>("session", {
    book_id: params.bookId,
    position: params.line,
    percentage: params.percentage,
    seconds: params.seconds,
    lines_read: params.linesRead,
    ranges: params.ranges,
    // 与终端阅读器一样：位置、书签、时长一起交，且按行区间去重
    bookmarks: params.bookmarks,
    started: params.started,
    ended: params.ended,
  });
}

/**
 * Save just the position (crash insurance; no session is recorded).
 *
 * `bookmarks` is the whole list, exactly like the terminal reader writes it: the
 * core re-sorts and de-duplicates by line (`library.normalise_bookmarks`).
 */
export function saveCorePosition(
  bookId: string,
  line: number,
  percentage: number,
  totalLines: number,
  bookmarks: Bookmark[] = [],
): Promise<{ saved: boolean }> {
  return coreRequest<{ saved: boolean }>("position", {
    book_id: bookId,
    position: line,
    percentage,
    total: totalLines,
    // 书签是整份覆盖着写：内核按行号去重排序
    bookmarks,
  });
}

/** Record `daily_open` (streak / early bird / holiday achievements). */
export function recordDailyOpen(): Promise<SessionResult> {
  return coreRequest<SessionResult>("daily_open", {});
}

/** Record one achievement event (`achievements_view`, `book_finish`, ...). */
export function recordEvent(
  eventType: string,
  data: Record<string, unknown> = {},
): Promise<{ unlocked: Unlocked[] }> {
  // 事件名必须在 achievements.EVENTS 白名单里，否则内核会回一条 error
  return coreRequest<{ unlocked: Unlocked[] }>("event", {
    event_type: eventType,
    data,
  });
}

/** The lifetime statistics report (the same shape the core returns). */
export function statsReport(): Promise<StatsReport> {
  return coreRequest<StatsReport>("stats", {});
}

/** Every achievement with its progress and unlock time (the `achievements` method). */
export async function achievementsList(): Promise<Achievement[]> {
  const answer = await coreRequest<{ achievements: Achievement[] }>(
    "achievements",
    {},
  );
  return answer.achievements ?? [];
}

/** The effective settings plus the schema key order (the `config_get` method). */
export function configGet(): Promise<ConfigGet> {
  return coreRequest<ConfigGet>("config_get", {});
}

/** Set one `settings.toml` value by dotted path (the `config_set` method). */
export function configSet(path: string, value: unknown): Promise<ConfigSet> {
  return coreRequest<ConfigSet>("config_set", { path, value });
}

/** The core's data locations -- where the plain-text files live (the `paths` method). */
export function corePaths(): Promise<CorePaths> {
  return coreRequest<CorePaths>("paths", {});
}

/** The raw index record of one book (`null` when the id is unknown). */
export async function bookRecord(bookId: string): Promise<BookRecord | null> {
  const answer = await coreRequest<{ book: BookRecord | null }>("get_book", {
    book_id: bookId,
  });
  return answer.book;
}

/* ------------------------------------------------------------------ */
/* PDF：图片模式（图片由前端画）+ 「转换成文字」                          */
/* ------------------------------------------------------------------ */

/**
 * The bytes of a PDF book's own file, for the image reader.
 *
 * Comes from the shell (the front end cannot touch the disk), and the shell asks
 * the core which file belongs to that book first -- so no path is ever guessed
 * here.  The reply is **raw bytes** (`ArrayBuffer`), not a JSON array: a book is
 * several megabytes.
 */
export function readBookSource(bookId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("book_source", { bookId });
}

/**
 * 「转换成文字」: let the core extract this PDF's text layer and keep it.
 *
 * This is the slow half of the PDF story (a 785 page book takes about a minute),
 * which is exactly why the import does not do it: pictures first, text on demand.
 * The updated record comes back because several fields change at once.
 */
export async function convertPdfToText(bookId: string): Promise<BookRecord> {
  const answer = await invoke<{ book: BookRecord }>("convert_pdf", { bookId });
  return answer.book;
}

/** Fuzzy search by title, author or tag (``#tag`` searches tags only). */
export async function searchBooks(keyword: string): Promise<BookRow[]> {
  const answer = await coreRequest<{ books: BookRow[] }>("search", { keyword });
  return answer.books ?? [];
}

/** Scan a path, convert every new book to UTF-8 and index it (the `import` method). */
export function importBooks(path: string): Promise<ImportResult> {
  return coreRequest<ImportResult>("import", { path });
}

/** Pack reading time, progress and achievements into one JSON bundle. */
export function exportData(path: string): Promise<ExportResult> {
  return coreRequest<ExportResult>("export", { path });
}

/** Merge an exported bundle into this machine (add-only). */
export function importData(path: string): Promise<ImportDataResult> {
  return coreRequest<ImportDataResult>("import_data", { path });
}

/** Drop index records whose converted text file is gone (the `prune` method). */
export function pruneLibrary(): Promise<RemovalResult> {
  return coreRequest<RemovalResult>("prune", {});
}

/** Empty the library; reading time and achievements are kept on purpose. */
export function clearLibrary(): Promise<RemovalResult> {
  return coreRequest<RemovalResult>("clear", {});
}

/**
 * Ask the OS for the e-book files / folders to import (the shelf's wicker-basket button).
 *
 * The Rust side opens the platform's own file browser -- on macOS a single panel
 * that accepts files *and* folders, single or multiple -- and answers with absolute
 * paths.  An empty list means the user cancelled; the conversion itself is still the
 * core's `import`, called once per path.
 */
/** 「＋ 导入」这一步要挑什么（与 Rust 侧的 `ImportPick` 一一对应）。 */
export type ImportPickMode = "files" | "folder";

/**
 * Ask the OS for the e-book files / folders to import (the shelf's wicker-basket button).
 *
 * The Rust side opens the platform's own file browser -- on macOS a single panel
 * that accepts files *and* folders, single or multiple -- and answers with absolute
 * paths.  An empty list means the user cancelled; the conversion itself is still the
 * core's `import`, called once per path.
 *
 * `mode` 只对 Windows / Linux 有意义：那两个平台的系统对话框做不到「文件与文件夹同框」，
 * 只能二选一（见 `importPickerModes`）。macOS 那个面板一次就能挑完，传什么都不影响。
 */
export function pickImportPaths(mode: ImportPickMode = "files"): Promise<string[]> {
  return invoke<string[]>("pick_import_paths", { mode });
}

/**
 * 「＋」按一下之后该弹什么：`["panel"]` = 系统面板一次挑完（macOS），
 * `["files", "folder"]` = 先问一句挑文件还是挑文件夹（Windows / Linux）。
 *
 * 界面据此决定是「一按就开面板」还是「先弹一个小菜单」—— 见 `Shelf.tsx` 的 `pickerModes`
 * 与 `components/ImportPickMenu.tsx`。
 */
export function importPickerModes(): Promise<string[]> {
  return invoke<string[]>("import_picker_modes");
}

/** Drop one book from the library, together with its converted text file. */
export function removeBook(bookId: string): Promise<RemovalResult> {
  return coreRequest<RemovalResult>("remove", { book_id: bookId });
}

/** Mark one book finished / unfinished (the shelf's "标记已读 / 未读"). */
export function setFinished(
  bookId: string,
  finished: boolean,
): Promise<{ book_id: string; finished: boolean }> {
  return coreRequest<{ book_id: string; finished: boolean }>("finish", {
    book_id: bookId,
    finished,
  });
}

/**
 * Edit one book's title / author / tags (the 「属性」 dialog's save button).
 *
 * This is a **label** change and nothing else: the core keeps the converted text
 * file, the chapter table, the position and the statistics exactly as they were,
 * so a typo fix can never cost reading progress.  It goes through the core (not
 * this app's SQLite) because the index is the single copy of the truth -- the
 * the book list shows the new title too.
 *
 * Comes back with the cleaned values (trimmed; tags split on commas by the core's
 * own rules), which is what the shelf re-reads on the next sync.
 */
export function setBookMeta(
  bookId: string,
  meta: { title: string; author: string; tags: string[] },
): Promise<BookMeta> {
  // 三个字段一起交：界面上的表单本来就是一份完整的草稿
  return coreRequest<BookMeta>("set_meta", {
    book_id: bookId,
    title: meta.title,
    author: meta.author,
    tags: meta.tags,
  });
}

/**
 * 探测用的假 book id：书 id 是正文 SHA-1 的前 12 位十六进制，这个字符串不可能撞上，
 * 所以拿它去问内核只会得到一条错误，**不会有任何副作用**（既删不掉书也改不了状态）。
 */
const PROBE_BOOK_ID = "__paget_capability_probe__";

/**
 * 这个内核认不认 *method*。
 *
 * 判据是内核固定的那条错误文案：不认识的方法回 `unknown method: <name>`，
 * 认识的方法则会走到参数校验、回 `unknown book id: <id>`（因为我们传的是假 id）。
 * 两者都是 `ServeError`，只有文案不同 —— 所以这里比对 `unknown method` 字样。
 * 其它错误（内核还没起来、传输断了）一律**按支持算**：真去调用时会有明确报错，
 * 不该因为一次探测失败就把菜单项永久禁掉。
 */
async function coreSupports(method: string): Promise<boolean> {
  try {
    // 假 id + 缺省参数：老内核回 unknown method，新内核回 unknown book id
    await coreRequest(method, { book_id: PROBE_BOOK_ID });
    // 居然成功了：说明后端行为超出预期，保守当作支持
    return true;
  } catch (err) {
    // 只有明确"不认识这个方法"才判定不支持
    return !String(err).includes("unknown method");
  }
}

/**
 * 界面用得到的、可能缺席的内核方法。
 *
 * `remove` / `finish` / `set_meta` 是内核后续版本才加进 `core/wreader/serve.py` 的；
 * 随包内核若是从更早的源码冻出来的，书架右键菜单里的「删除」「标记已读」与
 * 「属性」里的编辑框就会报 `unknown method`。`shelf_layout` 同理（2026-10-07 才加）：
 * 探不到就把书架布局留在本机 `gui_settings`，而不是报错。启动时探一次，探测不到的
 * 项直接降级（见 `Shelf.tsx` 与 `BookContextMenu.tsx`）。
 */
export async function coreCapabilities(): Promise<{
  remove: boolean;
  finish: boolean;
  setMeta: boolean;
  /** 内核认不认书架布局（`shelf_layout` / `set_shelf_layout`） */
  shelfLayout: boolean;
}> {
  // 逐个探：将来内核只加其中一个也不会被误判
  const remove = await coreSupports("remove");
  const finish = await coreSupports("finish");
  const setMeta = await coreSupports("set_meta");
  const shelfLayout = await coreSupports("shelf_layout");
  return { remove, finish, setMeta, shelfLayout };
}

/**
 * 这本书的封面：本地封面图（data URL）+ 上次缓存下来的生成方案。
 *
 * 两个来源都在壳层查（内核不管封面），而且是"就近优先"：
 *
 * 1. `app_data_dir/covers/<id>.{jpg,jpeg,png,webp}` —— 放这儿的就是这本书的封面；
 * 2. 正文 txt 旁边同名的那张图（`novels/某本书.txt` 旁边放 `某本书.jpg`）——
 *    所以 `near` 要传 `file_path`。
 *
 * 两条都没有就返回 `{ image: null, spec }`，前端按 `coverGenerator` 自己画一张。
 */
export function bookCover(bookId: string, near?: string): Promise<CoverInfo> {
  return invoke<CoverInfo>("cover_info", { bookId, near: near ?? null });
}

/** 把「自动生成封面」的方案写进 `app_data_dir/covers/<id>.json`，下次直接读回来。 */
export function saveCoverSpec(bookId: string, spec: string): Promise<void> {
  return invoke<void>("cover_save", { bookId, spec });
}

/* ------------------------------------------------------------------ */
/* 限时模式：到期封印 / 找回                                             */
/* ------------------------------------------------------------------ */

/**
 * The archive directory (`app_data_dir/archived`), for display on the "已归档" page.
 *
 * Where a booked file goes instead of being deleted: it is zipped there and the
 * library record is dropped through the core's `remove`, so the book list stays honest
 * while nothing is actually lost.
 */
export function archiveDirPath(): Promise<string> {
  return invoke<string>("archive_dir");
}

/**
 * Every sealed book, most recently sealed first.
 *
 * Read from the archives themselves (each zip carries its own metadata), so the list
 * survives `reset_cache` -- the SQLite cache is disposable by design.
 */
export function archivedBooks(): Promise<ArchivedBook[]> {
  return invoke<ArchivedBook[]>("archive_list");
}

/**
 * Seal one book: pack its file into `archived/` and drop it from the library.
 *
 * *dueAt* / *sealedAt* come from here because the front end is the side that knows the
 * user's timezone (the same split as `syncShelf`'s stamp).  The Rust side writes the
 * zip **first** and asks the core to remove the book **second**, so a failure leaves
 * the book exactly where it was.
 */
export function sealBook(
  bookId: string,
  dueAt: string,
  sealedAt: string,
): Promise<ArchivedBook> {
  return invoke<ArchivedBook>("archive_seal", { bookId, dueAt, sealedAt });
}

/**
 * Bring one sealed book back: unzip, re-import through the core, write progress back.
 *
 * The archive is deleted once the book is on the shelf again; a failure keeps it, so
 * trying costs nothing.
 */
export function restoreBook(archiveId: string): Promise<RestoredBook> {
  return invoke<RestoredBook>("archive_restore", { archiveId });
}
