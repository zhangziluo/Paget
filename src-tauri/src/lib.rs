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
use tauri::{Manager, State};

use core_client::CoreState;
use db::{BookRow, Chunk, Db, Hit, Position, MAX_INDEX_LINES};

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


/// Forward one RPC call to the reading core.
///
/// This is the escape hatch that keeps the shell thin: the front end can reach any
/// method of `wreader/serve.py` (`ping`, `list`, `toc`, `text`, `session`, ...)
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
#[tauri::command]
fn pick_import_paths(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        return macos_picker::pick(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // 其它平台没有自带的选择器（本项目不再引 tauri-plugin-dialog）；
        // 内核的命令行 `werd import <路径>` 仍然能导入。
        let _ = app;
        Err("图形化选择电子书目前只在 macOS 上提供；其它平台请用 `werd import <路径>`。".to_string())
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

/// Point the core's data at this checkout, so the Data tab's "数据位置" all stay
/// inside the project folder (unless the user already set the variables themselves).
///
/// The core reads `$WREADER_HOME` (default `~/.wreader`) and `$WREADER_NOVELS_DIR`
/// (default `~/novels`); the sidecar we spawn inherits these.  `env!` bakes the
/// build-time path of `src-tauri/`, so the switch only applies while that checkout is
/// still on disk -- a copy of the app on another machine quietly falls back to the
/// core's own defaults instead of pointing at a path that does not exist there.
fn use_project_data_root() {
    // `CARGO_MANIFEST_DIR` 是 <项目>/src-tauri，上一级就是项目根
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let Some(root) = manifest.parent() else { return };
    // 源码树不在（打包后换了机器）就什么都不设，走内核默认
    if !manifest.join("Cargo.toml").exists() || !root.join("package.json").exists() {
        return;
    }
    // 数据与正文都收进项目根的 .wreader/；用户自己设过的变量优先
    let home = root.join(".wreader");
    if std::env::var_os("WREADER_HOME").is_none() {
        std::env::set_var("WREADER_HOME", &home);
    }
    if std::env::var_os("WREADER_NOVELS_DIR").is_none() {
        std::env::set_var("WREADER_NOVELS_DIR", home.join("novels"));
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

/// 封面缓存目录：`app_data_dir/covers/`。
///
/// 里面只有两类纯数据文件，随时可删：
/// * `<book_id>.jpg/png/webp` —— 这本书的封面图（有就用它）；
/// * `<book_id>.json` —— 上次算出来的「自动生成封面」方案（配色下标 + 中央那两个字），
///   下次直接读回来，不必重算，也不会因为以后改了配色表而突然换色。
fn covers_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
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

#[cfg(test)]
mod cover_tests {
    use super::{base64, find_cover, safe_book_id};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 让内核把数据放进项目文件夹（数据 Tab 显示的四个路径都会落在里面）
            use_project_data_root();
            // 缓存文件放在应用的配置目录里：随时可以删，删了下次启动自动重建
            let path = app.path().app_config_dir()?.join("cache.sqlite3");
            // setup 是同步的：只在启动时阻塞这一次，把库建好
            let cache = tauri::async_runtime::block_on(Db::open(&path))?;
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
            save_gui_position,
            load_gui_position,
            get_gui_setting,
            set_gui_setting,
            reset_cache,
            pick_import_paths,
            cover_info,
            cover_save,
            archive_dir,
            archive_list,
            archive_seal,
            archive_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
