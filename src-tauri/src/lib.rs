//! The Tauri shell: thin commands over the Python core and the local cache.
//!
//! Two halves, deliberately kept apart:
//!
//! * [`core_client`] talks to `python -m wreader.serve`, which **owns the data**
//!   (shelf, position, statistics, achievements).  Every read and every write that
//!   matters goes through it.
//! * [`db`] is this app's own SQLite **cache** -- a rebuildable index for the shelf,
//!   the full-text search and the GUI's epub CFI positions.
//! * [`archive`] is where a **有限时** book goes when its due day arrives: the file
//!   is zipped into `app_data_dir/archived/` instead of being deleted, and the book
//!   only leaves the library because the core was asked to drop it.
//!
//! So the front end calls `core_request` for anything authoritative and `invoke`s
//! the cache commands for anything that may be thrown away.

mod archive;
mod core_client;
mod db;

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

use core_client::CoreState;
use db::{BookRow, Chunk, CompactReport, Db, Hit, Position, StorageStats, MAX_INDEX_LINES};

/// The archive commands' return value: what one restore brought back.
#[derive(Debug, Serialize)]
pub struct RestoredBook {
    /// 归档文件名（这次找回的是哪一个封印）
    pub archive_id: String,
    /// 回到书架的那本书的 id（正文没变，通常与封印前一致）
    pub book_id: String,
    /// 书名
    pub title: String,
    /// 进度是否写回成功（内核没起来 / 老内核没有 `position` 时会是 false）
    pub progress_restored: bool,
}

// NOTE on rust-analyzer's "all proc-macro server workers have exited" -- it shows up
// on `#[derive]` / `#[tauri::command]` here (e.g. `archive_dir` below), and it is *not*
// about this file.  The editor's rust-analyzer (0.3.3073, 2026-10) and the proc-macro
// server that ships with the toolchain (1.87.0, 2025-05) disagree about the legacy
// span protocol, so the server dies while deserializing the very first request:
//
//     thread 'main' panicked at .../span/src/lib.rs:415:
//     assertion failed: id < InternId::MAX   (SyntaxContextId::from_u32)
//
// After that every `#[derive]` / `#[tauri::command]` in the crate is reported as a
// failed macro expansion.  The cure is a *matching pair of binaries*, not a smaller
// derive: `rust-toolchain.toml` pins the channel and lists the `rust-analyzer`
// component, which is what makes the extension spawn the toolchain's own server.
// `cargo check` is clean with or without it.


/// Forward one RPC call to the reading core.
///
/// This is the escape hatch that keeps the shell thin: the front end can reach any
/// method of `core/wreader/serve.py` (`ping`, `list`, `toc`, `text`, `session`, ...)
/// without a Rust command having to be added for each one.
#[tauri::command]
fn core_request(
    method: String,
    params: Option<Value>,
    state: State<'_, CoreState>,
) -> Result<Value, String> {
    // 参数一律给对象；没传就当空对象（内核接受的就是对象）
    let params = params.unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    // 内核的报错原话带出去，前端 catch 到就能直接显示给用户
    state.call(&method, params).map_err(|err| err.to_string())
}

/// Ask the core which version it is (a liveness check for the shelf header).
#[tauri::command]
fn core_version(state: State<'_, CoreState>) -> Result<String, String> {
    // 走一次真实调用：既拿到版本号，也证明内核还活着
    state.version().map_err(|err| err.to_string())
}

/// Refresh the cached shelf from the core and return the rows.
///
/// The core's `list` is the single source of truth; *synced_at* is supplied by the
/// front end, which is the side that knows the user's timezone (the cache only
/// needs a sortable stamp).
///
/// Every command in this file is **synchronous** on purpose.  Both sides of the
/// work are local (a pipe to the core, a SQLite file), so blocking the main thread
/// for a few milliseconds is simpler than plumbing `Send` futures -- which is also
/// where rustc's `implementation of Executor is not general enough` trap lives
/// whenever `sqlx` is awaited inside a generic `async fn`.
#[tauri::command]
fn sync_shelf(state: State<'_, CoreState>, cache: State<'_, Db>, synced_at: String) -> Result<Vec<BookRow>, String> {
    // 问内核要权威书单
    let value = state
        .call("list", Value::Object(serde_json::Map::new()))
        .map_err(|err| err.to_string())?;
    // `list` 回的是 {"books": [...]}；缺了就当作空书架
    let books = value
        .get("books")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let rows: Vec<BookRow> = serde_json::from_value(books)
        .map_err(|err| format!("unexpected book rows from the core: {}", err))?;
    // 覆盖式写进缓存（本地文件，毫秒级）
    tauri::async_runtime::block_on(cache.replace_books(&rows, &synced_at))
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

/// The cached shelf (no core round-trip), most recently read first.
#[tauri::command]
fn cached_shelf(state: State<'_, Db>) -> Result<Vec<BookRow>, String> {
    // 纯读缓存：内核还没起来时界面也能先把书架画出来
    tauri::async_runtime::block_on(state.list_books()).map_err(|err| err.to_string())
}

/// How one indexing run went, so the UI can be honest about truncation.
#[derive(Debug, Serialize)]
pub struct IndexReport {
    /// 写了多少块
    pub chunks: usize,
    /// 一共索引了多少行
    pub lines: i64,
    /// 是否因为 MAX_INDEX_LINES 提前停住了
    pub truncated: bool,
}

/// Build (or rebuild) the search index of one book.
///
/// The chapter table and the text are read **through the core**, so the line
/// numbers and the chapter titles are exactly the ones the terminal reader uses,
/// and indexing stops after [`MAX_INDEX_LINES`] lines -- a cache is a convenience,
/// not the data.
#[tauri::command]
fn index_book(state: State<'_, CoreState>, cache: State<'_, Db>, book_id: String) -> Result<IndexReport, String> {
    index_book_inner(&state, &cache, &book_id)
}

/// The body of [`index_book`], split out so the borrows stay concrete.
fn index_book_inner(core: &CoreState, cache: &Db, book_id: &str) -> Result<IndexReport, String> {
    // 书必须存在；`get_book` 找不到时 `book` 就是 null
    let lookup = core
        .call("get_book", serde_json::json!({ "book_id": book_id }))
        .map_err(|err| err.to_string())?;
    let record = lookup.get("book").cloned().unwrap_or(Value::Null);
    // 书没了（被 CLI 删掉 / id 写错）：报错，别建一份点不开的索引
    if record.is_null() {
        return Err(format!("unknown book id: {}", book_id));
    }
    // 正文总行数：切块的边界
    let total_lines = record.get("total_lines").and_then(Value::as_i64).unwrap_or(0);
    // 章节表：取 (行号, 章名) 序列，用来切块
    let toc = core
        .call("toc", serde_json::json!({ "book_id": book_id }))
        .map_err(|err| err.to_string())?;
    let chapters: Vec<(i64, String)> = toc
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .map(|entry| {
                    (
                        entry.get("line").and_then(Value::as_i64).unwrap_or(0),
                        entry
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    // 计划：每块最多 MAX_CHUNK_LINES 行（章节表与切块规则都是纯函数，有单测）
    let plans = db::chunk_plan(&chapters, total_lines);
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut indexed = 0i64;
    let mut truncated = false;
    for plan in plans {
        // 已经到上限：停在这里，并在报告里说明（不偷偷截断）
        if indexed >= MAX_INDEX_LINES {
            truncated = true;
            break;
        }
        // 这一块实际取多少行（不超过总上限）
        let room = (MAX_INDEX_LINES - indexed).min(plan.line_end - plan.line_start + 1);
        let text = read_lines_blocking(core, book_id, plan.line_start, room)?;
        // 内核回空说明这一段没内容了：跳过，别写空块
        if text.is_empty() {
            continue;
        }
        indexed += text.len() as i64;
        chunks.push(Chunk {
            ordinal: plan.ordinal,
            title: plan.title,
            line_start: plan.line_start,
            // 实际读到哪一行就记到哪一行（可能被上限截短）
            line_end: plan.line_start + text.len() as i64 - 1,
            text: text.join("\n"),
        });
    }

    // 落进缓存
    tauri::async_runtime::block_on(cache.reindex_book(book_id, &chunks))
        .map_err(|err| err.to_string())?;
    Ok(IndexReport {
        chunks: chunks.len(),
        lines: indexed,
        truncated,
    })
}

/// Ask the core for a slice of a book's text, 2000 lines at a time.
///
/// 2000 is the core's own per-request cap (`serve._MAX_TEXT_COUNT`), so this is the
/// narrowest paging that still fills a chunk in one round trip.
fn read_lines_blocking(
    core: &CoreState,
    book_id: &str,
    start: i64,
    count: i64,
) -> Result<Vec<String>, String> {
    // 累加出来的行
    let mut lines: Vec<String> = Vec::new();
    // 下一次该从哪一行接着要
    let mut cursor = start;
    while (lines.len() as i64) < count {
        // 本页要多少行（最后一页可能不满 2000）
        let want = (count - lines.len() as i64).min(2000);
        // 问内核要一页
        let value = core
            .call(
                "text",
                serde_json::json!({ "book_id": book_id, "start": cursor, "count": want }),
            )
            .map_err(|err| err.to_string())?;
        // 取这一页的正文
        let batch: Vec<String> = value
            .get("lines")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().unwrap_or_default().to_string())
                    .collect()
            })
            .unwrap_or_default();
        // 内核给不出更多了（到书末）：收工
        if batch.is_empty() {
            break;
        }
        // 接着要下一页
        cursor += batch.len() as i64;
        lines.extend(batch);
    }
    Ok(lines)
}

/// Full-text search over the cached index.
#[tauri::command]
fn search_cache(
    state: State<'_, Db>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Hit>, String> {
    // 默认 30 条，够翻一屏；上限 200 免得一次刷爆界面
    let limit = limit.unwrap_or(30).clamp(1, 200);
    tauri::async_runtime::block_on(state.search(&query, limit)).map_err(|err| err.to_string())
}

/// Search inside one book, returning exact line numbers for the reading page.
#[tauri::command]
fn search_book(
    state: State<'_, Db>,
    book_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<db::BookSearchResult, String> {
    // 阅读页一屏列得下的就这么多；上限与书架搜索一致，免得一次刷爆界面
    let limit = limit.unwrap_or(80).clamp(1, 200);
    tauri::async_runtime::block_on(state.search_book(&book_id, &query, limit))
        .map_err(|err| err.to_string())
}

/// Save the GUI's own reading position (an epub CFI plus the guessed line).
///
/// The **authoritative** position still goes to the core (`position` / `session`);
/// this only remembers the CFI, which the core has no concept of.
#[tauri::command]
fn save_gui_position(state: State<'_, Db>, position: Position) -> Result<(), String> {
    // 只写缓存
    tauri::async_runtime::block_on(state.save_position(&position)).map_err(|err| err.to_string())
}

/// Read the GUI's position back (``null`` when this book was never opened here).
#[tauri::command]
fn load_gui_position(state: State<'_, Db>, book_id: String) -> Result<Option<Position>, String> {
    // 纯读缓存
    tauri::async_runtime::block_on(state.load_position(&book_id)).map_err(|err| err.to_string())
}

/// Read one GUI setting (theme, font size, the last book opened, ...).
#[tauri::command]
fn get_gui_setting(state: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    // 定长键值表
    tauri::async_runtime::block_on(state.get_setting(&key)).map_err(|err| err.to_string())
}

/// Write one GUI setting.
#[tauri::command]
fn set_gui_setting(state: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    // 界面自己的设置，与内核的 settings.toml 互不干扰
    tauri::async_runtime::block_on(state.set_setting(&key, &value)).map_err(|err| err.to_string())
}

/// Throw the cache away (the next `sync_shelf` rebuilds it from the core).
#[tauri::command]
fn reset_cache(state: State<'_, Db>) -> Result<(), String> {
    // 只动 SQLite：内核的 ~/.wreader 一个字节都不碰。reset 会把空表重建好，
    // 所以清空之后界面不用重启就能继续用。
    tauri::async_runtime::block_on(state.reset()).map_err(|err| err.to_string())
}

/// How much disk the local cache uses, and how much of that is reclaimable.
#[tauri::command]
fn cache_storage(state: State<'_, Db>) -> Result<StorageStats, String> {
    // 纯读：设置页的「本机缓存」那一块显示它
    tauri::async_runtime::block_on(state.storage_stats()).map_err(|err| err.to_string())
}

/// Squeeze the cache file (FTS optimize + VACUUM + WAL truncate).
#[tauri::command]
fn compact_cache(state: State<'_, Db>) -> Result<CompactReport, String> {
    // 与 reset 不同：**一行都不删**，只把空洞还回去；设置页那颗「压缩缓存」就是它
    tauri::async_runtime::block_on(state.compact()).map_err(|err| err.to_string())
}

/// Ask the OS for the e-book files / folders to import (the shelf's "＋" button).
///
/// Returns the chosen absolute paths, or an empty list when the user cancelled.
/// The conversion and indexing still happen in the core's `import`, one path at a
/// time -- this command only answers *which paths* to hand over.
///
/// On macOS this is a single `NSOpenPanel` that allows **files and folders together,
/// with multiple selection**: exactly the "click one, or select several, or pick a
/// folder" the shelf promises.  `tauri-plugin-dialog` cannot express that (its
/// `open` chooses either files or directories, never both), which is why the panel
/// is built here instead of pulling the plugin in.
///
/// Windows / Linux 走下面那个 `desktop_picker`（`tauri-plugin-dialog`）：那边的系统对话框
/// 做不到「文件与文件夹同框」（`IFileOpenDialog` 开了 `FOS_PICKFOLDERS` 就只能选文件夹、
/// 不开就只能选文件），所以界面先问一句要哪一种 —— 见 [`picker_modes`] 与 `Shelf.tsx`
/// 那只篮子上的小菜单。
/// 「＋ 导入」这一步要挑什么（界面递来的 `mode`）。
///
/// macOS 那个面板（`NSOpenPanel`）文件与文件夹同框、还能多选，所以那边**不认这个参数**；
/// Windows / Linux 的系统对话框只能二选一，于是界面先问一句「文件还是文件夹」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
enum ImportPick {
    /// 挑文件（默认档）
    Files,
    /// 挑文件夹 —— 内核 `import` 会递归找全里面的书（`library.py` 的 rglob）
    Folder,
}

impl ImportPick {
    /// 把界面递来的字符串收成枚举。认不出来的一律当 `Files`：老前端不传这个参数，
    /// 新前端传错也还能用（比弹一个错好）。
    ///
    /// （macOS 上没人调它 —— 那边不认 `mode`；压掉那条 dead_code 警告免得糊住真问题。）
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("folder") | Some("dir") | Some("directory") => Self::Folder,
            _ => Self::Files,
        }
    }
}

/// 「＋」按一下之后该弹什么：`["panel"]` = 系统面板一次挑完（macOS），
/// `["files", "folder"]` = 先问一句挑文件还是挑文件夹（Windows / Linux）。
fn picker_modes() -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        vec!["panel"]
    } else {
        vec!["files", "folder"]
    }
}

/// 把上面那条判定交给界面（挂在篮子上，见 `Shelf.tsx` 的 `pickerModes`）。
#[tauri::command]
fn import_picker_modes() -> Vec<&'static str> {
    picker_modes()
}

#[tauri::command]
fn pick_import_paths(app: tauri::AppHandle, mode: Option<String>) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        // macOS 的面板本来就能同框多选，`mode` 在这里没有意义
        let _ = mode;
        return macos_picker::pick(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        return desktop_picker::pick(&app, ImportPick::parse(mode.as_deref()));
    }
}

/// macOS 侧的原生选择器：一次 `NSOpenPanel` 就能选文件、文件夹、还能多选。
#[cfg(target_os = "macos")]
mod macos_picker {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};

    /// Run the panel on the main thread (it must live there) and return its answer.
    pub fn pick(app: tauri::AppHandle) -> Result<Vec<String>, String> {
        // 同步命令通常就在主线程上跑：那就直接弹；否则丢给主线程，再等结果回来
        if MainThreadMarker::new().is_some() {
            return run();
        }
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(run());
        })
        .map_err(|err| err.to_string())?;
        rx.recv().map_err(|err| err.to_string())?
    }

    /// Show the panel (main thread only) and collect the chosen paths.
    fn run() -> Result<Vec<String>, String> {
        let marker =
            MainThreadMarker::new().ok_or_else(|| "not on the main thread".to_string())?;
        let panel = NSOpenPanel::openPanel(marker);
        // 文件与文件夹都能选，还能多选 —— 正好是"点一个 / 多选 / 选文件夹"
        panel.setCanChooseFiles(true);
        panel.setCanChooseDirectories(true);
        panel.setAllowsMultipleSelection(true);
        panel.setResolvesAliases(true);
        // 点 Cancel 时返回空列表，调用方什么都不做
        if panel.runModal() != NSModalResponseOK {
            return Ok(Vec::new());
        }
        let urls = panel.URLs();
        let mut paths = Vec::new();
        for url in urls.to_vec() {
            // 存的是绝对路径，内核 `import` 直接拿去用
            if let Some(path) = url.path() {
                paths.push(path.to_string());
            }
        }
        Ok(paths)
    }
}

/// 非 macOS 的原生选择器（Windows / Linux）——「＋ 导入」在那两个平台上走这条。
///
/// 系统对话框做不到 macOS 那个面板的「文件与文件夹同框多选」：Windows 的 `IFileOpenDialog`
/// 开了 `FOS_PICKFOLDERS` 就只能选文件夹、不开就只能选文件。所以退一步、由界面分成两项
/// （见 [`picker_modes`]），这里按 `want` 弹其中一种：
///
/// * `Files`  —— 多选文件（`blocking_pick_files`）
/// * `Folder` —— 多选文件夹（`blocking_pick_folders`）；内核 `import` 会递归找全里面的书
///
/// 两档都**不加扩展名过滤**：与 macOS 那个面板一样什么都不挡 —— 内核自己会挑出 `.txt` /
/// `.epub` / `.mobi` / `.azw3` / `.pdf`，别的类型会明确报「不支持」，而不是让用户在对话框里找不到文件。
///
/// 这个模块在 macOS 上**也会被编译**（只是没人调用它，靠 `allow(dead_code)` 压掉警告）：
/// 它只能在 Windows 上跑，而开发机是 macOS —— 不这样写，这段代码就一辈子过不了类型检查。
#[allow(dead_code)]
mod desktop_picker {
    use tauri_plugin_dialog::DialogExt;

    use super::ImportPick;

    /// 弹一次原生对话框；用户取消就返回空列表（与 macOS 那个面板一致）。
    pub fn pick(app: &tauri::AppHandle, want: ImportPick) -> Result<Vec<String>, String> {
        // 标题与 macOS 面板上那句保持一致
        let dialog = app.dialog().file().set_title("导入电子书");
        // `blocking_*` 的文档明说**不能在主线程上调**（会和事件循环互相等死），而同步命令
        // 恰好就在主线程上跑 —— 所以把这一次等待丢给一条临时线程。
        let picked = std::thread::spawn(move || match want {
            ImportPick::Folder => dialog.blocking_pick_folders(),
            ImportPick::Files => dialog.blocking_pick_files(),
        })
        .join()
        .map_err(|_| "选择器所在的线程崩了".to_string())?;
        // 取消 → None → 空列表；桌面平台上 `FilePath` 一定是真路径（手机端才有 content://）
        Ok(picked
            .unwrap_or_default()
            .into_iter()
            .filter_map(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
            .collect())
    }

    /// 弹一次「另存为」；取消回 `None`，成功回落地的绝对路径。
    ///
    /// 与 [`pick`] 一样：`blocking_*` 不能在主线程上调，所以这一次等待丢给临时线程。
    pub fn pick_save(app: &tauri::AppHandle, default_name: &str) -> Result<Option<String>, String> {
        let dialog = app
            .dialog()
            .file()
            .set_title("导出笔记本")
            .set_file_name(default_name);
        let picked = std::thread::spawn(move || dialog.blocking_save_file())
            .join()
            .map_err(|_| "保存对话框所在的线程崩了".to_string())?;
        Ok(picked
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned()))
    }
}

/// 把一段文本存成文件 —— 笔记本页的「导出 md / 导出 txt」。
///
/// 先弹一次系统「另存为」（macOS 用 `NSSavePanel`，Windows / Linux 用
/// `tauri-plugin-dialog` 的 `blocking_save_file`），用户取消就一个字都不写、回 `None`；
/// 成功则写盘并回落地路径（界面拿它显示一句「已导出到 …」）。
///
/// 写盘放在前端？不行 —— Tauri 的 WebView 不放行 `Blob` 下载，`<a download>` 会静默失败；
/// 而这条命令只有「问一句路径 + `std::fs::write`」两件事，比引一个插件小得多。
#[tauri::command]
fn save_text_file(
    app: tauri::AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    let picked = macos_saver::pick(app, &default_name)?;
    #[cfg(not(target_os = "macos"))]
    let picked = desktop_picker::pick_save(&app, &default_name)?;
    match picked {
        Some(path) => {
            std::fs::write(&path, content.as_bytes()).map_err(|err| err.to_string())?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// macOS 侧的「另存为」：`NSSavePanel`（与导入那个 `NSOpenPanel` 同一套办法）。
#[cfg(target_os = "macos")]
mod macos_saver {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;

    /// Run the save panel on the main thread (it must live there) and return its answer.
    pub fn pick(app: tauri::AppHandle, default_name: &str) -> Result<Option<String>, String> {
        // 同步命令通常就在主线程上跑：那就直接弹；否则丢给主线程，再等结果回来
        if MainThreadMarker::new().is_some() {
            return run(default_name);
        }
        let name = default_name.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(run(&name));
        })
        .map_err(|err| err.to_string())?;
        rx.recv().map_err(|err| err.to_string())?
    }

    /// Show the panel (main thread only) and return the chosen path.
    fn run(default_name: &str) -> Result<Option<String>, String> {
        let marker =
            MainThreadMarker::new().ok_or_else(|| "not on the main thread".to_string())?;
        let panel = NSSavePanel::savePanel(marker);
        // 允许在面板里顺手新建一个文件夹；
        panel.setCanCreateDirectories(true);
        // 预填文件名（扩展名也带上，用户改不改都行 —— 这里不限制类型，与导入面板同一口径）
        panel.setNameFieldStringValue(&NSString::from_str(default_name));
        // 点 Cancel 回 None，调用方什么都不做
        if panel.runModal() != NSModalResponseOK {
            return Ok(None);
        }
        Ok(panel.URL().and_then(|url| url.path()).map(|path| path.to_string()))
    }
}

/* ------------------------------------------------------------------ */
/* 内核数据放哪儿：开发在项目里，发布跟着用户走                              */
/* ------------------------------------------------------------------ */

/// 内核数据目录的环境变量名（与 `core/wreader/config.py` 的 `ENV_HOME` 一致）。
const ENV_CORE_HOME: &str = "WREADER_HOME";
/// 正文目录的环境变量名（同上，`ENV_NOVELS_DIR`）。
const ENV_CORE_NOVELS: &str = "WREADER_NOVELS_DIR";
/// 开发构建把数据放在项目里的哪个子目录（`.gitignore` 里也忽略它）。
const PROJECT_DATA_DIRNAME: &str = ".wreader";
/// 发布版把数据放在应用数据目录下的哪个子目录。
const APP_DATA_DIRNAME: &str = "core";

/// 数据根怎么挑（纯函数，好在 `cargo test` 里钉住）。
///
/// * `explicit`：用户自己设了 `$WREADER_HOME` → `None`，**一个字节都不动**；
/// * `dev_checkout`：`Some(项目根)` = 这是一次开发构建（debug）且那份源码树还在
///   → 项目里的 `.wreader/`（数据留在项目里，开发时最方便）；
/// * `app_data`：Tauri 给的应用数据目录（macOS `~/Library/Application Support/<id>`、
///   Windows `%LOCALAPPDATA%\<id>`）→ 它下面的 `core/`。
fn pick_core_home(
    explicit: bool,
    dev_checkout: Option<PathBuf>,
    app_data: Option<PathBuf>,
) -> Option<PathBuf> {
    if explicit {
        return None;
    }
    dev_checkout
        .map(|root| root.join(PROJECT_DATA_DIRNAME))
        .or_else(|| app_data.map(|dir| dir.join(APP_DATA_DIRNAME)))
}

/// 开发构建时的项目根（`env!("CARGO_MANIFEST_DIR")` 的上一级），而且是**这份源码树真的还在**时才算。
///
/// 只编进 debug 构建：**发布版里连这个路径字符串都不该有** —— 从前发布版也读它，于是「装出去的
/// app」会把书库写进那个 checkout 的 `.wreader/`（`strings` 已安装的 app 就能看到烧进去的路径），
/// 换一次源码位置 / 换个目录打包 / 换台机器，数据根就换成了另一个空目录 —— 书看着像被安装包删了。
#[cfg(debug_assertions)]
fn dev_checkout_root() -> Option<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent()?.to_path_buf();
    // 源码树不在（包被搬到别的机器、或者那份 checkout 删了）就当没有这一档
    (manifest.join("Cargo.toml").exists() && root.join("package.json").exists()).then_some(root)
}

/// 发布版：没有「项目里的数据」这一档（那个编译期路径也不会被编进二进制）。
#[cfg(not(debug_assertions))]
fn dev_checkout_root() -> Option<PathBuf> {
    None
}

/// 内核自己那份默认数据目录：macOS / Linux 是 `~/.wreader`，Windows 是 `%APPDATA%\wreader`
/// （与 `core/wreader/config.py` 的 `_app_dir` 对齐）。
fn core_default_home() -> Option<PathBuf> {
    if cfg!(windows) {
        return std::env::var_os("APPDATA")
            .map(|base| PathBuf::from(base).join("wreader"))
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData/Roaming/wreader"))
            });
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".wreader"))
}

/// 「老位置」都有哪些：项目里的 `.wreader/`（如果这份源码树还在）与内核自己的 `~/.wreader`。
fn legacy_core_homes(dev: Option<&Path>) -> Vec<PathBuf> {
    let mut homes = Vec::new();
    if let Some(root) = dev {
        homes.push(root.join(PROJECT_DATA_DIRNAME));
    }
    if let Some(default) = core_default_home() {
        homes.push(default);
    }
    homes
}

/// 递归复制目录，跳过点名的子目录与 `.DS_Store`（`cache/` 是可重建的章节缓存，不必搬）。
fn copy_dir_skipping(from: &Path, to: &Path, skip: &[&str]) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".DS_Store" || skip.iter().any(|skipped| *skipped == name) {
            continue;
        }
        let target = to.join(&name);
        if entry.path().is_dir() {
            copy_dir_skipping(&entry.path(), &target, skip)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 新家还空着时，从老位置**复制**一份过来（返回复制自哪儿）。
///
/// 两种老位置都要照顾：项目里的 `.wreader/`（以前那个「看编译期路径」的发布版写进去的）与
/// `~/.wreader`（内核自己的默认位置）。两份都在时挑**最近写过**的那份（目录 mtime），
/// 另一份只在该函数外留一行日志 —— 想用另一份就设 `$WREADER_HOME`。
///
/// 复制而不是搬走：项目里那份要继续给 `cargo dev` 用，`~/.wreader` 那份要继续给终端前端用。
/// 复制失败不拦启动（内核会在新家从零建一份）。
fn adopt_legacy_core_data(home: &Path, legacy: &[PathBuf]) -> Option<PathBuf> {
    if home.exists() {
        return None;
    }
    // 只有「真像一份数据目录」的才算候选（至少有索引或设置文件）
    let mut candidates: Vec<(&PathBuf, std::time::SystemTime)> = legacy
        .iter()
        .filter(|dir| dir.join("library.json").exists() || dir.join("settings.toml").exists())
        .map(|dir| {
            let written = std::fs::metadata(dir)
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (dir, written)
        })
        .collect();
    candidates.sort_by_key(|(_, written)| *written);
    let (source, _) = candidates.pop()?;
    copy_dir_skipping(source, home, &["cache"]).ok()?;
    Some(source.clone())
}

/// 定下内核的数据根（并把老位置那份收养过来），在 `setup` 里、拉内核之前调一次。
///
/// 优先级：`$WREADER_HOME` > 开发构建的项目 `.wreader/` > 应用数据目录 `<id>/core`。
fn prepare_core_data_root(app: &tauri::AppHandle) {
    let explicit = std::env::var_os(ENV_CORE_HOME).is_some();
    let dev = dev_checkout_root();
    let app_data = app.path().app_local_data_dir().ok();
    let Some(home) = pick_core_home(explicit, dev.clone(), app_data) else {
        return; // 用户自己设过：一个字节都不动
    };
    // 发布版第一次跑到新家时，把老位置那份复制过来（复制，不是搬走）
    if let Some(source) = adopt_legacy_core_data(&home, &legacy_core_homes(dev.as_deref())) {
        eprintln!(
            "paget: 内核数据已从 {} 复制到 {}（老位置原样留着）",
            source.display(),
            home.display()
        );
    }
    std::env::set_var(ENV_CORE_HOME, &home);
    if std::env::var_os(ENV_CORE_NOVELS).is_none() {
        std::env::set_var(ENV_CORE_NOVELS, home.join("novels"));
    }
}

/* ------------------------------------------------------------------ */
/* 封印：限时书到期后打包进 archived/，而不是删掉                          */
/* ------------------------------------------------------------------ */

/// 归档目录：`app_data_dir/archived/`（和封面缓存同级，都在应用数据目录下）。
fn sealed_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| archive::archive_dir(&dir))
        .map_err(|err| format!("cannot locate the app data directory: {}", err))
}

/// 从内核记录里取一个字符串字段（缺了就是空串）。
fn record_text(record: &Value, key: &str) -> String {
    record
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Where sealed books are kept (the "已归档" page shows this path).
#[tauri::command]
fn archive_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(sealed_dir(&app)?.to_string_lossy().to_string())
}

/// Every sealed book, most recently sealed first.
///
/// The list comes from the archives themselves (each zip carries its own
/// `paget-archive.json`), so it survives `reset_cache` and even a fresh install.
#[tauri::command]
fn archive_list(app: tauri::AppHandle) -> Result<Vec<archive::ArchivedBook>, String> {
    Ok(archive::list(&sealed_dir(&app)?))
}

/// Seal one book: pack its file into `archived/` and drop it from the library.
///
/// This is what a limited book's due day triggers (see `src/lib/deadlines.ts`).
/// The order matters: the zip is written **first**, while the original file is still
/// in place, and the core's `remove` runs **second** -- so a failure anywhere leaves
/// the book untouched (worst case the half-made zip is deleted again).
///
/// *due_at* / *sealed_at* are produced by the front end, which is the side that knows
/// the user's timezone (the same split as `sync_shelf`'s `synced_at`).
#[tauri::command]
fn archive_seal(
    app: tauri::AppHandle,
    core: State<'_, CoreState>,
    book_id: String,
    due_at: String,
    sealed_at: String,
) -> Result<archive::ArchivedBook, String> {
    // 1) 内核记录：书名 / 作者 / 正文路径 / 进度都从这里来
    let lookup = core
        .call("get_book", serde_json::json!({ "book_id": book_id }))
        .map_err(|err| err.to_string())?;
    let record = lookup.get("book").cloned().unwrap_or(Value::Null);
    if record.is_null() {
        return Err(format!("unknown book id: {}", book_id));
    }
    let source = std::path::PathBuf::from(record_text(&record, "file_path"));
    // 正文文件不在了（终端里清理过 / 手改过索引）：说不清要封什么，别硬来
    if !source.is_file() {
        return Err(format!("这本书的正文文件不在：{}", source.display()));
    }
    let meta = archive::ArchiveMeta {
        // 随机名由 seal() 生成，这里还不知道
        archive_id: String::new(),
        book_id: book_id.clone(),
        title: record_text(&record, "title"),
        author: record_text(&record, "author"),
        original_name: source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        original_path: source.to_string_lossy().to_string(),
        sealed_at,
        due_at,
        total_lines: record.get("total_lines").and_then(Value::as_i64).unwrap_or(0),
        total_words: record.get("total_words").and_then(Value::as_i64).unwrap_or(0),
        // 整块进度原样存下：找回时按它写回行号 / 百分比 / 书签 / 读完
        progress: record.get("progress").cloned().unwrap_or(Value::Null),
    };

    // 2) 打包（此刻原文件仍在原处，所以还能整体回退）
    let sealed = archive::seal(&sealed_dir(&app)?, &source, meta)
        .map_err(|err| format!("打包失败：{}", err))?;

    // 3) 让内核摘掉记录并删掉正文；内核不认这一步就把刚写的 zip 收回
    match core.call("remove", serde_json::json!({ "book_id": book_id })) {
        Ok(_) => Ok(sealed),
        Err(err) => {
            let _ = std::fs::remove_file(&sealed.zip_path);
            Err(format!("内核没能摘下这本书：{}", err))
        }
    }
}

/// Bring one sealed book back: unzip, re-import through the core, restore progress.
///
/// The payload is unpacked into a **temporary directory** and imported from there on
/// purpose: importing a file that already sits in `novels/` would make the core write
/// a second copy (`..._utf8(2).txt`).  The content is unchanged, so the core computes
/// the very same book id (the SHA-1 of the text) and the record comes back with the
/// same title; the position, the percentage, the bookmarks and the finished flag are
/// then written back from the archive's snapshot.
///
/// A successful restore deletes the archive (the book is on the shelf again); a failed
/// one keeps it, so nothing is lost by trying.
#[tauri::command]
fn archive_restore(
    app: tauri::AppHandle,
    core: State<'_, CoreState>,
    archive_id: String,
) -> Result<RestoredBook, String> {
    // 归档名来自界面状态：白名单挡住 "../" 之类的花样
    let archive_id = archive::safe_archive_id(&archive_id)
        .ok_or_else(|| format!("不认识的归档名：{}", archive_id))?;
    let zip_path = sealed_dir(&app)?.join(&archive_id);
    if !zip_path.is_file() {
        return Err(format!("找不到这个封印：{}", archive_id));
    }
    let meta = archive::read_meta(&zip_path).map_err(|err| format!("归档读不出来：{}", err))?;

    // 解到临时目录：直接放回 novels 会被内核再复制一份（变成两本书）
    let scratch = std::env::temp_dir().join(format!("paget-restore-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).map_err(|err| err.to_string())?;
    let payload = scratch.join(archive::payload_name(&meta.title));
    if let Err(err) = archive::extract_payload(&zip_path, &payload) {
        let _ = std::fs::remove_dir_all(&scratch);
        return Err(format!("解压失败：{}", err));
    }

    // 内核 import：正文没变 → book id 与封印前一致
    let imported = core
        .call(
            "import",
            serde_json::json!({ "path": payload.to_string_lossy() }),
        )
        .map_err(|err| {
            let _ = std::fs::remove_dir_all(&scratch);
            format!("内核没能重新导入这本书：{}", err)
        })?;
    let book_id = imported
        .get("imported")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        // 已经在库里（内容重复）时 imported 是空的：用归档里记的 id
        .unwrap_or_else(|| meta.book_id.clone());

    // 进度写回：行号 / 百分比 / 书签。失败不算致命（书已经回来了）
    let progress = meta.progress.clone();
    let progress_restored = core
        .call(
            "position",
            serde_json::json!({
                "book_id": book_id,
                "position": progress.get("current_line").and_then(Value::as_i64).unwrap_or(0),
                "percentage": progress.get("percentage").and_then(Value::as_f64).unwrap_or(0.0),
                "bookmarks": progress.get("bookmarks").cloned().unwrap_or(Value::Array(Vec::new())),
                "total": meta.total_lines,
            }),
        )
        .map(|value| value.get("saved").and_then(Value::as_bool).unwrap_or(true))
        .unwrap_or(false);
    if progress
        .get("finished")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let _ = core.call(
            "finish",
            serde_json::json!({ "book_id": book_id, "finished": true }),
        );
    }

    // 收尾：临时文件与归档都删掉（书已经回到书架，归档再留着只会多一条记录）
    let _ = std::fs::remove_dir_all(&scratch);
    let _ = std::fs::remove_file(&zip_path);

    Ok(RestoredBook {
        archive_id,
        book_id,
        title: meta.title,
        progress_restored,
    })
}

/* ------------------------------------------------------------------ */
/* 封面：本地封面图 + 「自动生成封面」方案的缓存                          */
/* ------------------------------------------------------------------ */

/// 一本 `app_data_dir/<name>/` 下的数据目录（封面、阅读背景……），不存在就建。
fn app_data_subdir(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

/// 封面缓存目录：`app_data_dir/covers/`。
///
/// 里面只有两类纯数据文件，随时可删：
/// * `<book_id>.jpg/png/webp` —— 这本书的封面图（有就用它）；
/// * `<book_id>.json` —— 上次算出来的「自动生成封面」方案（配色下标 + 中央那两个字），
///   下次直接读回来，不必重算，也不会因为以后改了配色表而突然换色。
fn covers_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_data_subdir(app, "covers")
}

/// 会被认成封面图的扩展名 → MIME。
const COVER_EXTENSIONS: [(&str, &str); 4] = [
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("png", "image/png"),
    ("webp", "image/webp"),
];

/// 书 id 只可能是正文 SHA-1 的前 12 位十六进制；这里再夹一层白名单，
/// 免得 id 里混进 `../` 把路径带出去。
fn safe_book_id(book_id: &str) -> Option<String> {
    let ok = !book_id.is_empty()
        && book_id.len() <= 64
        && book_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| book_id.to_string())
}

/// 找这本书的封面图：先看 `covers/<id>.<ext>`，再看正文文件旁边同名的那张
/// （`novels/三体.txt` → `novels/三体.jpg`）—— 两条都是「本地封面文件」。
fn find_cover(
    dir: &std::path::Path,
    book_id: &str,
    near: Option<&str>,
) -> Option<(std::path::PathBuf, &'static str)> {
    for (extension, mime) in COVER_EXTENSIONS {
        let candidate = dir.join(format!("{book_id}.{extension}"));
        if candidate.is_file() {
            return Some((candidate, mime));
        }
    }
    let near = near?;
    let source = std::path::Path::new(near);
    let stem = source.file_stem()?.to_str()?;
    let parent = source.parent()?;
    for (extension, mime) in COVER_EXTENSIONS {
        let candidate = parent.join(format!("{stem}.{extension}"));
        if candidate.is_file() {
            return Some((candidate, mime));
        }
    }
    None
}

/// 极简 base64：只为把封面图塞进 `data:` URL，省一个依赖。
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let byte = |index: usize| *chunk.get(index).unwrap_or(&0) as u32;
        let packed = (byte(0) << 16) | (byte(1) << 8) | byte(2);
        out.push(TABLE[(packed >> 18) as usize & 63] as char);
        out.push(TABLE[(packed >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[packed as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 一本书的封面：本地封面图（data URL）+ 上次缓存的生成方案。
#[derive(Serialize)]
struct CoverInfo {
    image: Option<String>,
    spec: Option<String>,
}

/// 查这本书的封面。
///
/// 图片直接编码成 `data:` URL 返回 —— 前端一个 `<img src>` 就能用，既不必开
/// `asset:` 协议，也不用把磁盘路径暴露给页面。查不到就两项都是 `None`，
/// 前端按 `coverGenerator` 自己画一张（封面少了不该挡住看书）。
#[tauri::command]
fn cover_info(
    app: tauri::AppHandle,
    book_id: String,
    near: Option<String>,
) -> Result<CoverInfo, String> {
    // id 不合法就当作"这本书没有封面"，不报错
    let Some(id) = safe_book_id(&book_id) else {
        return Ok(CoverInfo {
            image: None,
            spec: None,
        });
    };
    let dir = covers_dir(&app)?;
    let image = match find_cover(&dir, &id, near.as_deref()) {
        // 封面图正常都远小于 8MB；真超了就不塞 data URL，改用自动生成的封面
        Some((path, mime)) => std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 8 * 1024 * 1024)
            .map(|bytes| format!("data:{};base64,{}", mime, base64(&bytes))),
        None => None,
    };
    let spec = std::fs::read_to_string(dir.join(format!("{id}.json"))).ok();
    Ok(CoverInfo { image, spec })
}

/// 记住「自动生成封面」的方案（`covers/<id>.json`），下次直接读回来。
#[tauri::command]
fn cover_save(app: tauri::AppHandle, book_id: String, spec: String) -> Result<(), String> {
    let Some(id) = safe_book_id(&book_id) else {
        return Ok(());
    };
    // 方案就是一行小 JSON；给个上限，别让人往这儿塞大文件
    if spec.len() > 4096 {
        return Err("cover spec too large".to_string());
    }
    let dir = covers_dir(&app)?;
    std::fs::write(dir.join(format!("{id}.json")), spec).map_err(|err| err.to_string())
}

/* ------------------------------------------------------------------ */
/* 阅读背景图：从 gui_settings 里搬出来，单独存一个文件                   */
/* ------------------------------------------------------------------ */

/// 阅读背景放在 `app_data_dir/reader/background.<ext>`。
///
/// 为什么不继续塞 `gui_settings.reader.prefs`：那份 JSON 每次改字号、行距、主题
/// 都要整段重写，图还在里面时每拖一下滑杆就要写 4~5 MB（WAL 跟着一起胖）。
/// 拆成文件后，偏好只剩几百字节，图只在挑图 / 首次迁移时写一次。
const BACKGROUND_EXTENSIONS: [(&str, &str); 4] = [
    ("webp", "image/webp"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("gif", "image/gif"),
];

/// 背景图解码后的上限：够放一张 4K 压过的照片，又不至于让前端把内存吃光。
const BACKGROUND_MAX_BYTES: usize = 8 * 1024 * 1024;

/// data URL 里认识的图片 MIME → 落盘扩展名。
fn background_extension(mime: &str) -> Option<&'static str> {
    match mime {
        "image/webp" => Some("webp"),
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// 把 `data:image/webp;base64,AAAA` 拆成 `(mime, 载荷)`。
///
/// 只认 base64 的 `data:` URL —— 前端 canvas 出来的就是这种；不是的话当作没有背景。
fn split_image_data_url(value: &str) -> Option<(&str, &str)> {
    let rest = value.trim().strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mime = meta.strip_suffix(";base64")?;
    if !mime.starts_with("image/") {
        return None;
    }
    Some((mime, payload))
}

/// base64 表里的一个字符 → 6 位值。
fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// 极简 base64 解码（[`base64`] 的逆运算）。
///
/// 只用于把前端传来的背景图写回磁盘；严格拒绝长度不对、非法字符和中间补位。
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let groups = bytes.len() / 4;
    for (index, chunk) in bytes.chunks(4).enumerate() {
        let padding = chunk.iter().rev().take_while(|byte| **byte == b'=').count();
        // 只有最后一组允许补位，且最多两位
        if padding > 2 || (padding > 0 && index + 1 != groups) {
            return None;
        }
        let mut packed = 0u32;
        for (position, byte) in chunk.iter().enumerate() {
            let value = if position >= 4 - padding {
                0
            } else {
                base64_value(*byte)? as u32
            };
            packed = (packed << 6) | value;
        }
        out.push((packed >> 16) as u8);
        if padding < 2 {
            out.push((packed >> 8) as u8);
        }
        if padding < 1 {
            out.push(packed as u8);
        }
    }
    Some(out)
}

/// 把已经解码好的图片字节写进 `reader/background.<ext>`。
///
/// [`store_reader_background`] 与开机迁移共用这一段：迁移老数据时手头已经是原始字节，
/// 不必再 base64 编一遍再解一遍。
fn write_reader_background_bytes(
    dir: &std::path::Path,
    bytes: &[u8],
    extension: &str,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("background image is empty".to_string());
    }
    if bytes.len() > BACKGROUND_MAX_BYTES {
        return Err("background image is too large".to_string());
    }
    std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    // 先把旧图（可能是别的扩展名）删掉：读的时候按扩展名找，留着旧的那张就会被读到
    clear_reader_background(dir);
    let target = dir.join(format!("background.{extension}"));
    // 先写临时文件再改名：中途崩了最多丢背景，不会留半张图给下一次启动
    let temporary = dir.join("background.tmp");
    std::fs::write(&temporary, bytes).map_err(|err| err.to_string())?;
    std::fs::rename(&temporary, &target).map_err(|err| err.to_string())?;
    Ok(())
}

/// 把一张 data URL 背景图写进 `reader/background.<ext>`，顺手清掉旧格式的那张。
fn store_reader_background(dir: &std::path::Path, value: &str) -> Result<(), String> {
    let (mime, payload) = split_image_data_url(value)
        .ok_or_else(|| "background must be a base64 image data URL".to_string())?;
    let extension =
        background_extension(mime).ok_or_else(|| "unsupported background image type".to_string())?;
    let bytes = base64_decode(payload).ok_or_else(|| "background is not valid base64".to_string())?;
    write_reader_background_bytes(dir, &bytes, extension)
}

/// 读回背景图，编码成前端直接能用的 `data:` URL；没有（或坏得读不出）就是 `None`。
fn load_reader_background(dir: &std::path::Path) -> Option<String> {
    for (extension, mime) in BACKGROUND_EXTENSIONS {
        let path = dir.join(format!("background.{extension}"));
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        // 超过上限的图当作没设置：宁可少一张背景，也别让 webview 拼一个几十 MB 的字符串
        if bytes.is_empty() || bytes.len() > BACKGROUND_MAX_BYTES {
            continue;
        }
        return Some(format!("data:{mime};base64,{}", base64(&bytes)));
    }
    None
}

/// 删掉所有格式的背景图（`None` = 用户按了"不用背景图"）。
fn clear_reader_background(dir: &std::path::Path) {
    for (extension, _) in BACKGROUND_EXTENSIONS {
        let _ = std::fs::remove_file(dir.join(format!("background.{extension}")));
    }
    let _ = std::fs::remove_file(dir.join("background.tmp"));
}

/// 读当前阅读背景（图片的 data URL；没设过就是 `None`）。
#[tauri::command]
fn reader_background(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app_data_subdir(&app, "reader")?;
    Ok(load_reader_background(&dir))
}

/// 保存 / 清除阅读背景。`data` 为 `None`（或空串）就删掉磁盘上那张图。
#[tauri::command]
fn set_reader_background(app: tauri::AppHandle, data: Option<String>) -> Result<(), String> {
    let dir = app_data_subdir(&app, "reader")?;
    match data {
        Some(value) if !value.trim().is_empty() => store_reader_background(&dir, &value),
        _ => {
            clear_reader_background(&dir);
            Ok(())
        }
    }
}

/// 前端 `readerPrefs.ts` 里的同一个键：阅读偏好存在 `gui_settings` 的这一行。
const READER_PREFS_KEY: &str = "reader.prefs";

/// 从老版偏好 JSON 里取出背景图，并给出「去掉 `bgImage` 之后」的 JSON。
///
/// 返回 `None` 的三种情况都表示**不要动它**：不是 JSON、没有 `bgImage` 这个键、
/// 或者那张图不是能认的 base64 图片（别为了省几 MB 把用户的图弄丢）。
/// 图是空串（老版本「没设背景」的默认值）时只返回删掉键的 JSON，`image` 为 `None`。
fn take_legacy_background(raw: &str) -> Option<(Option<(Vec<u8>, &'static str)>, String)> {
    let mut prefs: serde_json::Value = serde_json::from_str(raw).ok()?;
    let value = prefs.get("bgImage")?.clone();
    let image = match value.as_str() {
        None | Some("") => None,
        Some(data) => {
            let (mime, payload) = split_image_data_url(data)?;
            let extension = background_extension(mime)?;
            let bytes = base64_decode(payload)?;
            Some((bytes, extension))
        }
    };
    prefs.as_object_mut()?.remove("bgImage");
    let stripped = serde_json::to_string(&prefs).ok()?;
    Some((image, stripped))
}

/// 把老版本塞在 `reader.prefs` 里的那张背景图搬到 `reader/background.*`。
///
/// 以前整张图（base64，几 MB）都在偏好 JSON 里，每改一次字号就要重写一遍；现在
/// 偏好只留排版，图单独成文件。开机时搬一次，然后压一次库把腾出来的页还给磁盘。
///
/// 失败只返回 `Err` 给调用方丢掉：图还在 JSON 里，下次开书时前端会再试一次迁移，
/// 不能因为一张图没搬成就不让应用启动。
async fn migrate_reader_background(app: &tauri::AppHandle, db: &Db) -> Result<(), String> {
    let Some(raw) = db
        .get_setting(READER_PREFS_KEY)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(());
    };
    let Some((image, stripped)) = take_legacy_background(&raw) else {
        // 没有这个键 / 不是 JSON / 图认不出：一个字都不改
        return Ok(());
    };
    let had_image = image.is_some();
    if let Some((bytes, extension)) = image {
        let dir = app_data_subdir(app, "reader")?;
        write_reader_background_bytes(&dir, &bytes, extension)?;
    }
    db.set_setting(READER_PREFS_KEY, &stripped)
        .await
        .map_err(|err| err.to_string())?;
    if had_image {
        // 几 MB 刚从 JSON 里离开：别等下次启动的「空洞够多」判定，现在就收回去
        let _ = db.compact().await;
    }
    Ok(())
}

/// 测试用的小工具：每个用例一个独立临时目录，互不打扰。
#[cfg(test)]
mod tests_support {
    pub fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("paget-{name}-{}", std::process::id()));
        // 同名用例重跑时先把上一轮留下的清掉
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}

#[cfg(test)]
mod cover_tests {
    use super::{
        base64, base64_decode, clear_reader_background, find_cover, load_reader_background,
        safe_book_id, store_reader_background, take_legacy_background,
    };

    /// RFC 4648 的测试向量 —— 手写的 base64 必须一位不差，
    /// 否则封面图（data URL）会显示成一片空白。
    #[test]
    fn base64_matches_rfc4648() {
        let cases = [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ];
        for (input, expected) in cases {
            assert_eq!(base64(input.as_bytes()), expected, "input = {input:?}");
        }
    }
    /// 背景图的 base64 解码必须和编码对得上；坏输入宁可报错，别写出半张图。
    #[test]
    fn base64_decode_round_trips_and_rejects_junk() {
        let raw = [0u8, 1, 2, 255, 254];
        for payload in [
            b"f".as_slice(),
            b"fo".as_slice(),
            b"foo".as_slice(),
            b"foobar".as_slice(),
            raw.as_slice(),
        ] {
            let encoded = base64(payload);
            assert_eq!(
                base64_decode(&encoded).as_deref(),
                Some(payload),
                "encoded = {encoded:?}"
            );
        }
        for bad in ["A", "AAAAA", "A===", "!!!!", "=AAA", "AA A"] {
            assert!(base64_decode(bad).is_none(), "不该解出东西: {bad:?}");
        }
    }

    /// 背景图落盘成一张真正的文件，读回来还是同一个 data URL；换格式时旧图要清掉。
    #[test]
    fn background_is_stored_as_a_file_and_loaded_back() {
        let dir = super::tests_support::temp_dir("background-store");
        assert!(load_reader_background(&dir).is_none());

        let png = format!("data:image/png;base64,{}", base64(b"pretend png bytes"));
        store_reader_background(&dir, &png).expect("store png");
        assert!(dir.join("background.png").is_file());
        assert_eq!(load_reader_background(&dir).as_deref(), Some(png.as_str()));

        // 换成 webp：旧 png 必须先删，否则读回来还是上一张
        let webp = format!("data:image/webp;base64,{}", base64(b"pretend webp bytes"));
        store_reader_background(&dir, &webp).expect("store webp");
        assert!(!dir.join("background.png").exists());
        assert!(dir.join("background.webp").is_file());
        assert_eq!(load_reader_background(&dir).as_deref(), Some(webp.as_str()));

        // 写失败不该把已有背景弄丢（先校验，再动旧文件）
        assert!(store_reader_background(&dir, "data:text/plain;base64,QQ==").is_err());
        assert_eq!(load_reader_background(&dir).as_deref(), Some(webp.as_str()));

        clear_reader_background(&dir);
        assert!(load_reader_background(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 只认图片的 base64 data URL；别把 svg / 普通文本当背景写进磁盘。
    #[test]
    fn background_rejects_non_image_data_urls() {
        let dir = super::tests_support::temp_dir("background-reject");
        for bad in [
            "hello",
            "data:text/plain;base64,QQ==",
            "data:image/svg+xml;base64,QQ==",
            "data:image/png,QQ==",
        ] {
            assert!(
                store_reader_background(&dir, bad).is_err(),
                "不该接受: {bad:?}"
            );
        }
        assert!(load_reader_background(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 老偏好里的图要能原样取出来，其余排版项一个不少；JSON 里不再留 `bgImage`。
    #[test]
    fn legacy_background_is_taken_out_of_the_prefs_json() {
        let image = format!("data:image/png;base64,{}", base64(b"legacy bytes"));
        let raw = format!(r#"{{"fontSize":42,"bgImage":"{image}","bgFill":"cover"}}"#);
        let (extracted, stripped) =
            take_legacy_background(&raw).expect("老数据里应该能取出来");
        let (bytes, extension) = extracted.expect("图应该解出来了");
        assert_eq!(bytes, b"legacy bytes");
        assert_eq!(extension, "png");
        // 排版项都在，只有图被拿走了
        let parsed: serde_json::Value = serde_json::from_str(&stripped).unwrap();
        assert_eq!(parsed["fontSize"], 42);
        assert_eq!(parsed["bgFill"], "cover");
        assert!(parsed.get("bgImage").is_none());

        // 空串（老版本的「没设背景」）只清键，不该报错
        let (empty, stripped) =
            take_legacy_background(r#"{"fontSize":30,"bgImage":""}"#).expect("应当能清掉空键");
        assert!(empty.is_none());
        assert!(!stripped.contains("bgImage"));

        // 认不出 / 不该动的：原样返回 None，调用方一个字都不改
        for untouched in [
            "not json",
            r#"{"fontSize":30}"#,
            r#"{"fontSize":30,"bgImage":"hello"}"#,
            r#"{"fontSize":30,"bgImage":"data:text/plain;base64,QQ=="}"#,
        ] {
            assert!(
                take_legacy_background(untouched).is_none(),
                "不该动: {untouched:?}"
            );
        }
    }

    /// 书 id 的白名单：正常 id 放行；带路径分隔符 / 点号 / 空格 / 空的一律挡掉。
    #[test]
    fn book_id_whitelist_blocks_paths() {
        assert_eq!(safe_book_id("a1b2c3d4e5f6").as_deref(), Some("a1b2c3d4e5f6"));
        assert_eq!(
            safe_book_id("with-dash_under9").as_deref(),
            Some("with-dash_under9")
        );
        let too_long = "x".repeat(65);
        for bad in ["", "../etc/passwd", "a/b", "a b", "a.b", "中文", too_long.as_str()] {
            assert!(safe_book_id(bad).is_none(), "不该放行: {bad:?}");
        }
    }

    /// 找封面：先看 `covers/<id>.<ext>`，再看正文旁边同名的那张；
    /// 都没有就 None（前端会按书名自己画一张）。
    #[test]
    fn finds_cover_in_covers_dir_and_beside_the_book() {
        let root = std::env::temp_dir().join(format!("paget-cover-test-{}", std::process::id()));
        let covers = root.join("covers");
        std::fs::create_dir_all(&covers).unwrap();

        // 1) covers/<id>.png
        std::fs::write(covers.join("abc123.png"), b"png").unwrap();
        let (path, mime) = find_cover(&covers, "abc123", None).expect("covers 里那张");
        assert_eq!(mime, "image/png");
        assert_eq!(path, covers.join("abc123.png"));

        // 2) 正文旁边同名的那张：novels/三体.txt → novels/三体.jpg
        let novels = root.join("novels");
        std::fs::create_dir_all(&novels).unwrap();
        std::fs::write(novels.join("三体.txt"), b"text").unwrap();
        std::fs::write(novels.join("三体.jpg"), b"jpg").unwrap();
        let near = novels.join("三体.txt");
        let (path, mime) = find_cover(&covers, "def456", Some(near.to_str().unwrap()))
            .expect("正文旁边那张");
        assert_eq!(mime, "image/jpeg");
        assert_eq!(path, novels.join("三体.jpg"));

        // 3) 都没有 → None
        assert!(find_cover(&covers, "nothing", None).is_none());

        // 4) 不认识的扩展名不算封面
        std::fs::write(covers.join("weird.gif"), b"gif").unwrap();
        assert!(find_cover(&covers, "weird", None).is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

}

/// 「＋ 导入」那两条命令的边角：`mode` 只认两个值，菜单档数跟着平台走。
#[cfg(test)]
mod picker_tests {
    use super::{picker_modes, ImportPick};

    #[test]
    fn the_import_pick_argument_falls_back_to_files() {
        // 界面明确说要文件夹
        assert_eq!(ImportPick::parse(Some("folder")), ImportPick::Folder);
        // 大小写与空格都别计较（界面那边是照枚举写的，但别的调用方可能手打）
        assert_eq!(ImportPick::parse(Some(" FOLDER ")), ImportPick::Folder);
        assert_eq!(ImportPick::parse(Some("directory")), ImportPick::Folder);
        assert_eq!(ImportPick::parse(Some("files")), ImportPick::Files);
        // 老前端不传这个参数 → 文件；传了看不懂的值 → 也是文件（不弹错）
        assert_eq!(ImportPick::parse(None), ImportPick::Files);
        assert_eq!(ImportPick::parse(Some("胡写的")), ImportPick::Files);
    }

    #[test]
    fn the_picker_menu_matches_the_platform() {
        // macOS 那个面板文件与文件夹同框 → 一项；其它平台的对话框二选一 → 两项
        if cfg!(target_os = "macos") {
            assert_eq!(picker_modes(), vec!["panel"]);
        } else {
            assert_eq!(picker_modes(), vec!["files", "folder"]);
        }
    }
}

/// 内核数据根：**发布版不许再看编译期路径** —— 2026-10-14 那次「装上新版书全没了」的守门人。
#[cfg(test)]
mod data_root_tests {
    use super::{adopt_legacy_core_data, dev_checkout_root, pick_core_home};
    use std::path::PathBuf;

    /// 用户自己设了 `$WREADER_HOME` → 什么都不动（项目里那份也不碰）
    #[test]
    fn explicit_home_is_left_alone() {
        assert_eq!(
            pick_core_home(
                true,
                Some(PathBuf::from("/repo")),
                Some(PathBuf::from("/app"))
            ),
            None
        );
    }

    /// 开发构建（debug + 源码树在）→ 项目里的 `.wreader/`
    #[test]
    fn dev_build_keeps_data_in_the_project() {
        assert_eq!(
            pick_core_home(
                false,
                Some(PathBuf::from("/repo")),
                Some(PathBuf::from("/app"))
            ),
            Some(PathBuf::from("/repo/.wreader"))
        );
    }

    /// 发布版（`dev_checkout_root()` 给 None）→ 应用数据目录下的 `core/`：与「在哪儿编译」无关，
    /// 换一版、换台机器、把 checkout 挪个地方，用户的书都还在同一个地方。
    #[test]
    fn release_build_goes_to_the_app_data_dir() {
        assert_eq!(
            pick_core_home(false, None, Some(PathBuf::from("/app"))),
            Some(PathBuf::from("/app/core"))
        );
        // 应用数据目录都拿不到（平台不支持 / 权限异常）：宁可不设，也别指到一个不存在的地方
        assert_eq!(pick_core_home(false, None, None), None);
    }

    /// 本轮 `cargo test` 是 debug 构建、源码树就在旁边 → 那一档必须真的认得出来
    #[test]
    fn this_checkout_counts_as_a_dev_build() {
        let root = dev_checkout_root().expect("debug 构建应当认出项目根");
        assert!(root.join("package.json").is_file(), "{}", root.display());
    }

    /// 收养老数据：挑**最近写过**的那份、**复制**而不是搬走、可重建的 `cache/` 不搬
    #[test]
    fn adopts_the_most_recent_legacy_home_without_moving_it() {
        let root = std::env::temp_dir().join(format!("paget-home-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let older = root.join("repo/.wreader");
        let newer = root.join("home/.wreader");
        std::fs::create_dir_all(older.join("novels")).unwrap();
        std::fs::write(older.join("library.json"), br#"{"books":{"old":{}}}"#).unwrap();
        std::fs::write(older.join("novels/旧书.txt"), b"old").unwrap();
        // 让两份的 mtime 分得开：先睡一下再写后一份
        std::thread::sleep(std::time::Duration::from_millis(30));
        std::fs::create_dir_all(newer.join("novels")).unwrap();
        std::fs::create_dir_all(newer.join("cache")).unwrap();
        std::fs::write(newer.join("library.json"), br#"{"books":{"new":{}}}"#).unwrap();
        std::fs::write(newer.join("novels/新书.txt"), b"new").unwrap();
        std::fs::write(newer.join("cache/chapters.json"), b"cache").unwrap();

        let target = root.join("app/core");
        let source = adopt_legacy_core_data(&target, &[older.clone(), newer.clone()]).expect("该收养");

        assert_eq!(source, newer, "应当挑最近写过的那份");
        assert_eq!(
            std::fs::read(target.join("library.json")).unwrap(),
            br#"{"books":{"new":{}}}"#
        );
        assert!(target.join("novels/新书.txt").is_file());
        assert!(!target.join("cache").exists(), "可重建的 cache/ 不必搬");
        // 老位置原样留着（项目里那份还要给 `cargo dev` 用、`~/.wreader` 要给终端前端用）
        assert!(newer.join("library.json").is_file());
        assert!(older.join("library.json").is_file());

        // 新家已经有数据：不再收养（免得盖掉用户正在用的那份）
        std::fs::write(target.join("library.json"), br#"{"books":{"mine":{}}}"#).unwrap();
        assert_eq!(adopt_legacy_core_data(&target, &[older, newer]), None);

        // 两份都不像数据目录（既没 library.json 也没 settings.toml）→ 不动手
        let empty = root.join("empty/.wreader");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(adopt_legacy_core_data(&root.join("app2/core"), &[empty]), None);

        let _ = std::fs::remove_dir_all(&root);
    }
}

/* ------------------------------------------------------------------ */
/* PDF：图片模式（原样发字节给前端渲染）+ 「转换成文字」                    */
/* ------------------------------------------------------------------ */

/// 一份 PDF 最多发多大（512 MB）：正规电子书远小于它，超了多半是别的东西。
const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;

/// The bytes of a PDF book's own file, for the image-mode reader.
///
/// A PDF is browsed as **pictures** by default, so the front end needs the file
/// itself.  It cannot touch the disk, and the file is far too big to hand over as
/// JSON, so it is streamed back through [`tauri::ipc::Response`] -- raw bytes, not
/// an array of numbers.
///
/// The path is never guessed by the front end: it comes out of the core's record
/// for that book, and only a `file_path` ending in `.pdf` is served, so this
/// command can hand out a PDF and nothing else.
#[tauri::command]
fn book_source(
    core: State<'_, CoreState>,
    book_id: String,
) -> Result<tauri::ipc::Response, String> {
    // 书必须在库里：路径只从内核记录里取（前端永远不猜路径）
    let lookup = core
        .call("get_book", serde_json::json!({ "book_id": book_id }))
        .map_err(|err| err.to_string())?;
    let record = lookup.get("book").cloned().unwrap_or(Value::Null);
    // 书没了（被 CLI 删掉 / id 写错）：直说
    if record.is_null() {
        return Err(format!("unknown book id: {}", book_id));
    }
    let path = std::path::PathBuf::from(record_text(&record, "file_path"));
    // 只发 PDF：图片模式的正文来源就是它（别的格式前端有自己的读法）
    let is_pdf = path
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err(format!("not a PDF book: {}", path.display()));
    }
    // 先看体积再读：免得把一个几百 MB 的东西整个塞进内存
    let size = std::fs::metadata(&path)
        .map_err(|err| format!("cannot read {}: {}", path.display(), err))?
        .len();
    if size > MAX_SOURCE_BYTES {
        return Err(format!(
            "{} is too large to send ({} bytes)",
            path.display(),
            size
        ));
    }
    // 原样发字节：前端把它喂给 pdf.js 一页页画出来
    let bytes = std::fs::read(&path)
        .map_err(|err| format!("cannot read {}: {}", path.display(), err))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 「转换成文字」：让内核抽出这本 PDF 的文字层并记下来。
///
/// Deliberately **async**: extracting a 700 page book takes about a minute, and a
/// synchronous command would hold the main thread (the window stops repainting)
/// for that whole minute.  The work runs on the blocking pool instead, so the UI
/// keeps drawing its「正在转换」state -- one of the few commands that is not sync
/// on purpose (see the note about sync commands near the top of this file).
#[tauri::command]
async fn convert_pdf(app: tauri::AppHandle, book_id: String) -> Result<Value, String> {
    // 换一个 AppHandle 进阻塞线程池：主线程一个字节都不占
    let handle = app.clone();
    let work = tauri::async_runtime::spawn_blocking(move || {
        // 内核的 convert_pdf：抽文字层 + 更新索引（扫描版会明确报「没有文字层」）
        handle
            .state::<CoreState>()
            .call("convert_pdf", serde_json::json!({ "book_id": book_id }))
            .map_err(|err| err.to_string())
    });
    // 线程池里的 panic 也变回一条普通错误，别把界面挂在一个永不落地的 Promise 上
    work.await
        .map_err(|err| format!("the conversion worker died: {}", err))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Windows / Linux 上再挂一个对话框插件（macOS 走自带的 NSOpenPanel，见 macos_picker）：
    // 那边不必注册它，注册了也只是白多一份用不到的 JS API。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .setup(|app| {
            // 内核数据放哪儿：开发构建留在项目里，发布版跟着用户走（旧位置那份会先被复制过来）
            prepare_core_data_root(app.handle());
            // 缓存文件放在应用的配置目录里：随时可以删，删了下次启动自动重建
            let path = app.path().app_config_dir()?.join("cache.sqlite3");
            // setup 是同步的：只在启动时阻塞这一次，把库建好
            let cache = tauri::async_runtime::block_on(Db::open(&path))?;
            // 老版本的阅读背景图混在 `gui_settings.reader.prefs` 里：开机搬进独立文件，
            // 顺便把空出来的几 MB 还给磁盘（失败不挡启动，见函数注释）
            let _ = tauri::async_runtime::block_on(migrate_reader_background(app.handle(), &cache));
            app.manage(cache);
            // 内核是"按需启动"的（第一次调用时才拉起来），所以这里只是准备好状态；
            // 资源目录传进去，打包后的应用才找得到随包的那份冻结点内核
            app.manage(CoreState::new(app.path().resource_dir().ok()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_request,
            core_version,
            sync_shelf,
            cached_shelf,
            index_book,
            search_cache,
            search_book,
            save_gui_position,
            load_gui_position,
            get_gui_setting,
            set_gui_setting,
            reset_cache,
            cache_storage,
            compact_cache,
            reader_background,
            set_reader_background,
            pick_import_paths,
            import_picker_modes,
            save_text_file,
            cover_info,
            cover_save,
            book_source,
            convert_pdf,
            archive_dir,
            archive_list,
            archive_seal,
            archive_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
