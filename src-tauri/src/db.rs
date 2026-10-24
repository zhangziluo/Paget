//! The GUI's own SQLite cache: a **rebuildable** index, never the source of truth.
//!
//! `~/.wreader` (plain JSON/TOML, owned by the Python core) stays authoritative for
//! the shelf, the reading position, the statistics and the achievements -- see
//! `core_client.rs`.  This database only exists so that
//!
//! * the shelf renders instantly without asking the core for every book,
//! * full-text search does not have to read every book text on every keystroke,
//! * the GUI's own coordinate (an epub **CFI**) and its own settings survive a
//!   restart.
//!
//! Everything in here can be deleted at any time: [`Db::reset`] drops the cache and
//! the next sync rebuilds it from the core.  That is why there are no migrations
//! beyond a single `CREATE ... IF NOT EXISTS` schema, and why a schema change may
//! simply bump [`SCHEMA_VERSION`] and start over.
//!
//! Deviation from the first plan: the SQL lives here and runs through `sqlx`
//! directly instead of through `tauri-plugin-sql`, so that the schema, the CJK
//! tokenisation and the queries are all testable in `cargo test` without a webview
//! (see `tests/db.rs`).

use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

/// Bumped whenever [`SCHEMA`] changes in a way an old cache cannot survive.
///
/// The cache is disposable, so the policy is "detect and rebuild" rather than
/// "migrate one table at a time": see [`Db::open`].  Bumped to 2 when the PDF
/// fields (`format` / `pages` / `text_path`) joined the `books` table.
pub const SCHEMA_VERSION: i64 = 2;

/// The whole schema, applied on every start (`IF NOT EXISTS` makes it idempotent).
///
/// The `books` columns mirror the flat rows the core's `list` method returns
/// (see `core/wreader/serve.py::_book_rows`), so syncing is a straight copy.
///
/// Deliberately **DDL only**: connection settings such as WAL mode are applied once
/// in [`Db::open`], because a `PRAGMA` cannot run inside the transaction
/// [`Db::reset`] uses.
pub const SCHEMA: &str = r#"
-- 元信息：目前只存 schema 版本（它自己也属于缓存，reset 会一起重建）
CREATE TABLE IF NOT EXISTS cache_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL DEFAULT '',
    author              TEXT NOT NULL DEFAULT '',
    file_path           TEXT NOT NULL DEFAULT '',
    -- 图片模式的 pdf：format = 'pdf'、pages = 页数、text_path = 转成文字后的 txt
    -- （其它格式一律空值，所以老书架读出来与从前一样）
    format              TEXT NOT NULL DEFAULT '',
    pages               INTEGER NOT NULL DEFAULT 0,
    text_path           TEXT NOT NULL DEFAULT '',
    total_lines         INTEGER NOT NULL DEFAULT 0,
    total_words         INTEGER NOT NULL DEFAULT 0,
    chapter_count       INTEGER NOT NULL DEFAULT 0,
    current_line        INTEGER NOT NULL DEFAULT 0,
    percentage          REAL NOT NULL DEFAULT 0,
    last_read           TEXT,
    total_time_seconds  INTEGER NOT NULL DEFAULT 0,
    finished            INTEGER NOT NULL DEFAULT 0,
    tags                TEXT NOT NULL DEFAULT '[]',
    synced_at           TEXT NOT NULL
);

-- 书架默认按"最近在读"排：last_read 是定长 ISO 串，字典序就是时间序
CREATE INDEX IF NOT EXISTS books_recent ON books(last_read DESC);

-- 正文分块：全文搜索的单位。按章切开，命中后能直接跳到那一章
CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     TEXT NOT NULL,
    ordinal     INTEGER NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    line_start  INTEGER NOT NULL DEFAULT 0,
    line_end    INTEGER NOT NULL DEFAULT 0,
    text        TEXT NOT NULL,
    UNIQUE(book_id, ordinal)
);

-- 全文索引：独立表（不用 external content），重建时按 book_id 删了重插最省心。
-- id 就是 chunks.id，用来 JOIN 回原文与行号；列名与外层一致，但**内容必须经过
-- segment_cjk()**，见那里的长注释。
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    id UNINDEXED,
    book_id UNINDEXED,
    title,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- 阅读位置：GUI 存的坐标是 epub 的 CFI，与内核的行号并存、互不覆盖
CREATE TABLE IF NOT EXISTS positions (
    book_id     TEXT PRIMARY KEY,
    cfi         TEXT NOT NULL DEFAULT '',
    percentage  REAL NOT NULL DEFAULT 0,
    line        INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL
);

-- 界面自己的设置：内核不认识的东西（主题、字号、上次打开的书…）
CREATE TABLE IF NOT EXISTS gui_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"#;

/// Return `true` for the scripts that must be split into single-character tokens.
fn is_cjk(ch: char) -> bool {
    // 汉字（含扩展 A / 兼容区）、日文假名、谚文：中日韩书都得搜得动
    matches!(
        ch as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF
    )
}

/// Split CJK characters apart so SQLite's `unicode61` tokenizer indexes them.
///
/// `unicode61` treats a whole run of Han characters as **one token**, so an FTS5
/// `MATCH '三体'` can never hit `三体世界就在我们眼前`.  Putting a space on both
/// sides of every CJK character makes each one its own token, after which a
/// multi-character query works as a **phrase** (`MATCH '"三体"'`) -- which is
/// exactly what somebody typing a Chinese word expects.
///
/// This must be applied to the text that goes **into** `chunks_fts`, and every
/// query must be quoted as a phrase; `db_search` does both.  Latin text and
/// digits are left alone, so `MATCH 'paperback'` keeps working the normal way.
pub fn segment_cjk(text: &str) -> String {
    // 预分配：每个汉字会多出两个空格
    let mut out = String::with_capacity(text.len() + text.len() / 4);
    for ch in text.chars() {
        // CJK 两侧各垫一个空格，于是"一个字 = 一个 token"
        if is_cjk(ch) {
            // 连续汉字之间只留一个空格（不然会攒出两个，虽然无害但难读）
            if !out.ends_with(' ') {
                out.push(' ');
            }
            out.push(ch);
            out.push(' ');
        } else {
            // 其余字符原样保留（英文单词、数字、标点都不受影响）
            out.push(ch);
        }
    }
    out
}

/// Undo [`segment_cjk`] for display: drop the spaces that were inserted around CJK.
///
/// The spaces are only there to make the tokenizer split Han characters; showing
/// them to a reader would look plainly wrong, so every snippet that leaves this
/// module goes through here first.
pub fn desegment_cjk(text: &str) -> String {
    // 收成字符数组，方便看"左右邻居究竟是谁"
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (index, ch) in chars.iter().enumerate() {
        // 只处理空格，而且要满足"紧挨着 CJK"才认定是我们自己塞进去的
        if *ch == ' ' {
            let left = chars.get(index.wrapping_sub(1));
            let right = chars.get(index + 1);
            let left_is_cjk = left.map_or(false, |prev| is_cjk(*prev));
            let right_is_cjk = right.map_or(false, |next| is_cjk(*next));
            if left_is_cjk || right_is_cjk {
                continue;
            }
        }
        out.push(*ch);
    }
    out
}

/// Turn a user query into the FTS5 phrase expression used by both searches.
///
/// Returns `None` for a query that has no searchable characters, so callers can
/// answer with an empty result instead of letting FTS5 raise a syntax error.
fn fts_phrase(query: &str) -> Option<String> {
    // 先剔掉会破坏 FTS5 语法的字符（引号 / 星号 / 括号由我们自己加）
    let cleaned: String = query
        .chars()
        .filter(|ch| !"\"*()-".contains(*ch))
        .collect();
    // 与入库时同一套分段，否则短语对不上 token
    let needle = segment_cjk(cleaned.trim());
    if needle.trim().is_empty() {
        return None;
    }
    // 整串当一个短语（中文按字分词后，这正好等于"连续出现"）；末尾 * 允许只打了一半
    Some(format!("\"{}\"*", needle))
}

/// Find `needle` in `haystack`, ignoring case, starting at byte offset `from`.
///
/// Returns the byte range of the hit.  ASCII / CJK lower-casing keeps the byte
/// length, so offsets stay valid for slicing; the rare script whose lower-case
/// form changes length falls back to a case-sensitive search rather than risk
/// cutting a character in half.
fn find_ci_from(haystack: &str, needle: &str, from: usize) -> Option<(usize, usize)> {
    let lower = haystack.to_lowercase();
    let lowered = needle.to_lowercase();
    if lower.len() == haystack.len() && lowered.len() == needle.len() {
        let at = lower.get(from..)?.find(&lowered)?;
        let start = from + at;
        Some((start, start + needle.len()))
    } else {
        let at = haystack.get(from..)?.find(needle)?;
        let start = from + at;
        Some((start, start + needle.len()))
    }
}

/// A one-line preview around `line[start..end]`, with the hit wrapped in brackets.
///
/// The UI renders `[` `]` as `<mark>`, the same convention the shelf's chunk
/// snippets already use.  Context is counted in characters, not bytes, so a CJK
/// line is clipped at the same visual width as an English one.
fn line_snippet(line: &str, start: usize, end: usize) -> String {
    const BEFORE: usize = 18;
    const AFTER: usize = 36;
    let before_all = &line[..start];
    let before_count = before_all.chars().count();
    let before: String = before_all
        .chars()
        .skip(before_count.saturating_sub(BEFORE))
        .collect();
    let before = before.trim();
    let after_all = &line[end..];
    let after_count = after_all.chars().count();
    let after: String = after_all.chars().take(AFTER).collect();
    let after = after.trim();
    format!(
        "{}{}[{}]{}{}",
        if before_count > BEFORE { "…" } else { "" },
        before,
        &line[start..end],
        after,
        if after_count > AFTER { "…" } else { "" }
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookRow {
    /// 书 id（正文 SHA-1 前 12 位）
    pub id: String,
    /// 书名
    #[serde(default)]
    pub title: String,
    /// 作者
    #[serde(default)]
    pub author: String,
    /// 转换后的正文路径（GUI 不读它，只用来排查问题）
    #[serde(default)]
    pub file_path: String,
    /// 书的形式：`"pdf"` 表示**图片模式**的 PDF，其余格式是空串
    #[serde(default)]
    pub format: String,
    /// 图片模式 PDF 的页数（普通书是 0）
    #[serde(default)]
    pub pages: i64,
    /// 「转换成文字」之后那份 txt 的路径（没转之前是空串）
    #[serde(default)]
    pub text_path: String,
    /// 正文总行数（内核的坐标）
    #[serde(default)]
    pub total_lines: i64,
    /// 总字数
    #[serde(default)]
    pub total_words: i64,
    /// 章节数
    #[serde(default)]
    pub chapter_count: i64,
    /// 读到第几行（内核的坐标，GUI 只用它做近似）
    #[serde(default)]
    pub current_line: i64,
    /// 读了多少（0-100）
    #[serde(default)]
    pub percentage: f64,
    /// 上次阅读时间（定长 ISO 串，没有就是 null）
    #[serde(default)]
    pub last_read: Option<String>,
    /// 累计阅读秒数
    #[serde(default)]
    pub total_time_seconds: i64,
    /// 是否已读完
    #[serde(default)]
    pub finished: bool,
    /// 标签
    #[serde(default)]
    pub tags: Vec<String>,
}

/// One chapter-sized piece of a book text, ready to be indexed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    /// 第几块（从 0 开始，与章节目录一一对应）
    pub ordinal: i64,
    /// 这一块的标题（章名；没有就空串）
    #[serde(default)]
    pub title: String,
    /// 起始行（内核的行号，含）
    pub line_start: i64,
    /// 结束行（内核的行号，含）
    pub line_end: i64,
    /// 原文（**未**分词的；进 FTS 的副本在写库时现做）
    pub text: String,
}

/// One full-text search hit.
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    /// 命中的书
    pub book_id: String,
    /// 命中的那一块的章名
    pub title: String,
    /// 这一块覆盖的行区间（拿去给 `text` 方法取正文，或换算成百分比）
    pub line_start: i64,
    /// 同上
    pub line_end: i64,
    /// 命中片段（`[` `]` 标出关键词，已去掉分词用的空格）
    pub snippet: String,
}

/// One **line-level** hit inside a single book (the reading page's search).
///
/// The shelf only needs to know which chunk matched; the reading page needs to
/// jump to the exact line, so this carries the line number and a snippet of that
/// one line instead of the whole chunk.
#[derive(Debug, Clone, Serialize)]
pub struct BookHit {
    /// 命中那一行所属的章名（章前内容为空串）
    pub title: String,
    /// 内核的行号（0 起始）
    pub line: i64,
    /// 这一行里的一次命中片段（`[` `]` 标出关键词）
    pub snippet: String,
}

/// What one in-book search found, plus whether the local index is usable.
#[derive(Debug, Clone, Serialize)]
pub struct BookSearchResult {
    /// 按行号从小到大排好的命中
    pub hits: Vec<BookHit>,
    /// `false` = 这本书还没建索引（界面可以先调 `index_book` 再搜一次）
    pub indexed: bool,
    /// `true` = 索引因 [`MAX_INDEX_LINES`] 只覆盖了书的前半部分
    pub truncated: bool,
}

/// A reading position saved by the GUI (an epub CFI, plus the guessed line).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    /// 书 id
    pub book_id: String,
    /// epub 的 CFI（GUI 的精确坐标）
    #[serde(default)]
    pub cfi: String,
    /// epub.js 报的百分比
    #[serde(default)]
    pub percentage: f64,
    /// 由百分比换算出的近似源行号（喂给内核用）
    #[serde(default)]
    pub line: i64,
    /// 写入时刻
    #[serde(default)]
    pub updated_at: String,
}

/// Turn one `books` row into the struct the front end receives.
fn book_from_row(row: &sqlx::sqlite::SqliteRow) -> BookRow {
    // tags 存的是 JSON 数组字符串；手改坏了就当空数组，不让一行脏数据打断整个书架
    let tags: Vec<String> = row
        .try_get::<String, _>("tags")
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    BookRow {
        id: row.try_get("id").unwrap_or_default(),
        title: row.try_get("title").unwrap_or_default(),
        author: row.try_get("author").unwrap_or_default(),
        file_path: row.try_get("file_path").unwrap_or_default(),
        format: row.try_get("format").unwrap_or_default(),
        pages: row.try_get("pages").unwrap_or_default(),
        text_path: row.try_get("text_path").unwrap_or_default(),
        total_lines: row.try_get("total_lines").unwrap_or_default(),
        total_words: row.try_get("total_words").unwrap_or_default(),
        chapter_count: row.try_get("chapter_count").unwrap_or_default(),
        current_line: row.try_get("current_line").unwrap_or_default(),
        percentage: row.try_get("percentage").unwrap_or_default(),
        last_read: row.try_get("last_read").ok(),
        total_time_seconds: row.try_get("total_time_seconds").unwrap_or_default(),
        // SQLite 没有 bool：0/1 在这里翻回 true/false
        finished: row.try_get::<i64, _>("finished").unwrap_or_default() != 0,
        tags,
    }
}

/// The GUI's own SQLite cache (see the module doc for why it is disposable).
pub struct Db {
    /// 连接池：几个连接足够，GUI 不会并发打数据库
    pool: SqlitePool,
}

impl Db {
    /// Open (creating it if needed) and make sure the schema matches this build.
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        // 目录不存在就先建出来（Tauri 只保证 app_config_dir 的父目录在某些平台存在）
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // 打开文件；create_if_missing 让第一次运行不用手工建库
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        // WAL：GUI 与终端可能同时开着，边读边写更稳。
        // ⚠️ 只能在事务之外设置，所以它不放在 SCHEMA 里（见 SCHEMA 的说明）。
        sqlx::query("PRAGMA journal_mode = WAL")
            .execute(&pool)
            .await?;
        let db = Self { pool };
        // 版本对不上就整库重建（缓存可以随时丢，见模块注释）
        db.ensure_schema().await?;
        Ok(db)
    }

    /// Apply [`SCHEMA`], rebuilding the cache when it was written by another build.
    async fn ensure_schema(&self) -> Result<(), sqlx::Error> {
        // 先保证元信息表在（全新文件、或上一版没建过）
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .execute(&self.pool)
        .await?;
        // 上次写库的 schema 版本
        let stored: Option<String> =
            sqlx::query_scalar("SELECT value FROM cache_meta WHERE key = 'schema_version'")
                .fetch_optional(&self.pool)
                .await?;
        // 版本一致：把 SCHEMA 再跑一遍（全是 IF NOT EXISTS，缺表能自愈）
        if stored.as_deref() == Some(SCHEMA_VERSION.to_string().as_str()) {
            sqlx::raw_sql(SCHEMA).execute(&self.pool).await?;
            return Ok(());
        }
        // 版本不一致（或从来没有）：丢掉整份缓存按新 schema 重来
        self.reset().await
    }

    /// Drop every cached table and rebuild an **empty** schema.
    ///
    /// The kernel's JSON is untouched -- that is the point.  The tables are rebuilt
    /// right here rather than left missing, because the UI can press "清空缓存" at
    /// any moment and then keeps using the cache without restarting.
    pub async fn reset(&self) -> Result<(), sqlx::Error> {
        // 一次事务里"拆掉再建好"：中途失败不会留下半张表
        let mut tx = self.pool.begin().await?;
        // 逐张删；FTS5 是虚拟表，一样得单独 DROP；cache_meta 也是缓存的一部分
        sqlx::raw_sql(
            "DROP TABLE IF EXISTS chunks_fts;
             DROP TABLE IF EXISTS chunks;
             DROP TABLE IF EXISTS positions;
             DROP TABLE IF EXISTS gui_settings;
             DROP TABLE IF EXISTS books;
             DROP TABLE IF EXISTS cache_meta;",
        )
        .execute(&mut *tx)
        .await?;
        // 按当前 schema 重建（空库）
        sqlx::raw_sql(SCHEMA).execute(&mut *tx).await?;
        // 记下这一版 schema 的版本号
        sqlx::query(
            "INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_version', ?1)",
        )
        .bind(SCHEMA_VERSION.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Replace the whole shelf with the rows the core just reported.
    ///
    /// One transaction, so a crash halfway cannot leave half a shelf behind, and
    /// chunks of books the core no longer knows about are dropped in the same pass.
    pub async fn replace_books(
        &self,
        rows: &[BookRow],
        synced_at: &str,
    ) -> Result<(), sqlx::Error> {
        // 事务：要么全换，要么一点都不动
        let mut tx = self.pool.begin().await?;
        // 先把旧书架清空（chunks 不动，下面按"内核还认不认这本书"收拾）
        sqlx::query("DELETE FROM books").execute(&mut *tx).await?;
        for row in rows {
            // tags 是数组：以 JSON 字符串存一列，读的时候再解析
            let tags = serde_json::to_string(&row.tags).unwrap_or_else(|_| "[]".to_string());
            sqlx::query(
                "INSERT INTO books (id, title, author, file_path, format, pages, text_path,
                 total_lines, total_words, chapter_count, current_line, percentage, last_read,
                 total_time_seconds, finished, tags, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )
            .bind(&row.id)
            .bind(&row.title)
            .bind(&row.author)
            .bind(&row.file_path)
            .bind(&row.format)
            .bind(row.pages)
            .bind(&row.text_path)
            .bind(row.total_lines)
            .bind(row.total_words)
            .bind(row.chapter_count)
            .bind(row.current_line)
            .bind(row.percentage)
            .bind(&row.last_read)
            .bind(row.total_time_seconds)
            // SQLite 没有 bool：true/false 存成 1/0
            .bind(if row.finished { 1i64 } else { 0i64 })
            .bind(tags)
            .bind(synced_at)
            .execute(&mut *tx)
            .await?;
        }
        // 内核里已经没有的书：正文块与全文索引也一起清掉（缓存只留有用的）
        sqlx::query("DELETE FROM chunks WHERE book_id NOT IN (SELECT id FROM books)")
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM chunks_fts WHERE book_id NOT IN (SELECT id FROM books)")
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// The cached shelf, most recently read first.
    pub async fn list_books(&self) -> Result<Vec<BookRow>, sqlx::Error> {
        // `last_read IS NULL` 排在后面：SQLite 里 NULL 最小，直接 DESC 会把没读过的顶上来
        let rows = sqlx::query(
            "SELECT id, title, author, file_path, format, pages, text_path, total_lines,
                    total_words, chapter_count, current_line, percentage, last_read,
                    total_time_seconds, finished, tags
             FROM books
             ORDER BY (last_read IS NULL), last_read DESC, title",
        )
        .fetch_all(&self.pool)
        .await?;
        // 每行翻译成 Rust 结构
        Ok(rows.iter().map(book_from_row).collect())
    }

    /// Replace one book's search chunks (called after a book is opened or synced).
    pub async fn reindex_book(&self, book_id: &str, chunks: &[Chunk]) -> Result<(), sqlx::Error> {
        // 事务：删旧 + 写新必须一起生效，否则搜索会短暂地缺一块
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM chunks WHERE book_id = ?1")
            .bind(book_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM chunks_fts WHERE book_id = ?1")
            .bind(book_id)
            .execute(&mut *tx)
            .await?;
        for chunk in chunks {
            // 原文进 chunks（给人看、给行号用）；RETURNING 拿到 id 给 FTS 表当主键
            let chunk_id: i64 = sqlx::query_scalar(
                "INSERT INTO chunks (book_id, ordinal, title, line_start, line_end, text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 RETURNING id",
            )
            .bind(book_id)
            .bind(chunk.ordinal)
            .bind(&chunk.title)
            .bind(chunk.line_start)
            .bind(chunk.line_end)
            .bind(&chunk.text)
            .fetch_one(&mut *tx)
            .await?;
            // ⚠️ 进 FTS 的那一份必须先分段（否则中文一个字都搜不到，见 segment_cjk）
            sqlx::query(
                "INSERT INTO chunks_fts (id, book_id, title, text) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(chunk_id)
            .bind(book_id)
            .bind(segment_cjk(&chunk.title))
            .bind(segment_cjk(&chunk.text))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Full-text search across the indexed chunks, best match first.
    pub async fn search(&self, query: &str, limit: i64) -> Result<Vec<Hit>, sqlx::Error> {
        // 空查询 / 只剩标点：直接回空（FTS5 对空 MATCH 会报语法错）
        let Some(expression) = fts_phrase(query) else {
            return Ok(Vec::new());
        };
        // snippet 的第三个参数是列下标：chunks_fts 的列是 (id, book_id, title, text)
        let rows = sqlx::query(
            "SELECT f.book_id AS book_id,
                    c.title AS title,
                    c.line_start AS line_start,
                    c.line_end AS line_end,
                    snippet(chunks_fts, 3, '[', ']', '…', 12) AS snippet
             FROM chunks_fts f
             JOIN chunks c ON c.id = f.id
             WHERE chunks_fts MATCH ?1
             ORDER BY bm25(chunks_fts)
             LIMIT ?2",
        )
        .bind(expression)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        // 片段里的空格是分词时塞进去的，显示前要去掉
        Ok(rows
            .iter()
            .map(|row| Hit {
                book_id: row.try_get("book_id").unwrap_or_default(),
                title: row.try_get("title").unwrap_or_default(),
                line_start: row.try_get("line_start").unwrap_or_default(),
                line_end: row.try_get("line_end").unwrap_or_default(),
                snippet: desegment_cjk(&row.try_get::<String, _>("snippet").unwrap_or_default()),
            })
            .collect())
    }

    /// Search **inside one book**, one hit per occurrence with its exact line.
    ///
    /// FTS5 narrows the candidate chunks (that is what the index is for), then the
    /// chunk text is walked line by line so the reading page can jump to the line
    /// instead of the chapter.  Every occurrence on a line is returned separately.
    /// When the query only matches after tokenisation (e.g. spaces between Han
    /// characters), a chunk-level snippet is kept as a fallback so the search
    /// still points somewhere useful.
    pub async fn search_book(
        &self,
        book_id: &str,
        query: &str,
        limit: i64,
    ) -> Result<BookSearchResult, sqlx::Error> {
        // 先看这本书有没有索引：没有就让界面去 `index_book`，别把「没建索引」当成「没搜到」
        let chunk_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM chunks WHERE book_id = ?1")
                .bind(book_id)
                .fetch_one(&self.pool)
                .await?;
        // 索引只覆盖到哪一行（超过 MAX_INDEX_LINES 的大书要如实说出来）
        let max_line: Option<i64> =
            sqlx::query_scalar("SELECT MAX(line_end) FROM chunks WHERE book_id = ?1")
                .bind(book_id)
                .fetch_one(&self.pool)
                .await?;
        let total_lines: i64 = sqlx::query_scalar("SELECT total_lines FROM books WHERE id = ?1")
            .bind(book_id)
            .fetch_optional(&self.pool)
            .await?
            .unwrap_or(0);
        let truncated =
            total_lines > 0 && max_line.map_or(false, |last| last + 1 < total_lines);

        if chunk_count == 0 {
            return Ok(BookSearchResult {
                hits: Vec::new(),
                indexed: false,
                truncated,
            });
        }
        let Some(expression) = fts_phrase(query) else {
            return Ok(BookSearchResult {
                hits: Vec::new(),
                indexed: true,
                truncated,
            });
        };
        // 用户实际输入的那串（去掉首尾空白）：用来在块内逐行找出每一次出现
        let needle = query
            .chars()
            .filter(|ch| !"\"*()-".contains(*ch))
            .collect::<String>();
        let needle = needle.trim();
        // 候选块多取一些：一个块里可能命中好几行，最后再按行号排序、截到 limit
        let candidates = (limit.saturating_mul(6)).clamp(20, 300);
        let rows = sqlx::query(
            "SELECT c.title AS title,
                    c.line_start AS line_start,
                    c.text AS text,
                    snippet(chunks_fts, 3, '[', ']', '…', 12) AS snippet
             FROM chunks_fts f
             JOIN chunks c ON c.id = f.id
             WHERE chunks_fts MATCH ?1 AND f.book_id = ?2
             ORDER BY bm25(chunks_fts)
             LIMIT ?3",
        )
        .bind(expression)
        .bind(book_id)
        .bind(candidates)
        .fetch_all(&self.pool)
        .await?;

        let mut hits: Vec<BookHit> = Vec::new();
        for row in &rows {
            let title: String = row.try_get("title").unwrap_or_default();
            let line_start: i64 = row.try_get("line_start").unwrap_or_default();
            let text: String = row.try_get("text").unwrap_or_default();
            let fallback = desegment_cjk(&row.try_get::<String, _>("snippet").unwrap_or_default());
            let mut found_in_chunk = false;
            // 块文本用 \n 拼接（见 index_book），逐行走就能直接拿到内核坐标
            for (offset, raw_line) in text.split('\n').enumerate() {
                let line = raw_line.trim_end_matches('\r');
                let mut from = 0usize;
                while !needle.is_empty() {
                    let Some((start, end)) = find_ci_from(line, needle, from) else {
                        break;
                    };
                    found_in_chunk = true;
                    hits.push(BookHit {
                        title: title.clone(),
                        line: line_start + offset as i64,
                        snippet: line_snippet(line, start, end),
                    });
                    // 至少往前挪一个字节，避免零宽匹配反复命中
                    let next = end.max(start + 1);
                    if next <= from {
                        break;
                    }
                    from = next;
                }
            }
            // 分词后命中、但原文里拼不出用户输入的整串（中文里夹了空格之类）：
            // 退到块级片段，至少仍能跳到这一块的第一行
            if !found_in_chunk && !fallback.is_empty() {
                hits.push(BookHit {
                    title: title.clone(),
                    line: line_start,
                    snippet: fallback,
                });
            }
        }
        // 一处一行、按书里的顺序排；同一行多个位置也保留（用户能逐个看上下文）
        hits.sort_by_key(|hit| hit.line);
        hits.truncate(limit.clamp(1, 200) as usize);
        Ok(BookSearchResult {
            hits,
            indexed: true,
            truncated,
        })
    }

    /// Save one GUI position (an epub CFI plus the approximated source line).
    pub async fn save_position(&self, position: &Position) -> Result<(), sqlx::Error> {
        // upsert：同一本书只留最新一条
        sqlx::query(
            "INSERT INTO positions (book_id, cfi, percentage, line, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(book_id) DO UPDATE SET
                 cfi = excluded.cfi,
                 percentage = excluded.percentage,
                 line = excluded.line,
                 updated_at = excluded.updated_at",
        )
        .bind(&position.book_id)
        .bind(&position.cfi)
        .bind(position.percentage)
        .bind(position.line)
        .bind(&position.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Read one saved position back (``None`` when the book was never opened here).
    pub async fn load_position(&self, book_id: &str) -> Result<Option<Position>, sqlx::Error> {
        // 单行查询：没写过就是 None
        let row = sqlx::query(
            "SELECT book_id, cfi, percentage, line, updated_at FROM positions WHERE book_id = ?1",
        )
        .bind(book_id)
        .fetch_optional(&self.pool)
        .await?;
        // 把可选行翻译成可选结构
        Ok(row.map(|row| Position {
            book_id: row.try_get("book_id").unwrap_or_default(),
            cfi: row.try_get("cfi").unwrap_or_default(),
            percentage: row.try_get("percentage").unwrap_or_default(),
            line: row.try_get("line").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }))
    }

    /// Read one GUI setting (``None`` when it was never set).
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        // 定长键值表：取不到就是没设过
        sqlx::query_scalar("SELECT value FROM gui_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
    }

    /// Write one GUI setting.
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        // upsert：界面设置随手改，单条语句就够，不需要事务
        sqlx::query(
            "INSERT INTO gui_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

/// Rows of text one chunk may hold before the indexer splits it again.
///
/// A "chapter" in a badly converted txt can be the entire book; splitting keeps a
/// single SQLite row -- and a single search snippet -- to a sane size.
pub const MAX_CHUNK_LINES: i64 = 20_000;

/// How much of one book the cache is willing to index, in lines.
///
/// The index is a convenience, not the data: a 147 MB novel would otherwise fill
/// the cache for no real gain, so indexing stops here.  `index_book` reports the
/// truncation instead of hiding it.
pub const MAX_INDEX_LINES: i64 = 200_000;

/// One piece of a book that should become one search chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkPlan {
    /// 第几块（0 起始，写进 chunks.ordinal）
    pub ordinal: i64,
    /// 章名；章前内容与"被切开的续块"用空串
    pub title: String,
    /// 起始行（0 起始、闭区间，内核的坐标）
    pub line_start: i64,
    /// 结束行（同上）
    pub line_end: i64,
}

/// Turn a chapter table into the list of chunks the indexer walks through.
///
/// *chapters* is what the core's `toc` method returns, as ``(line, title)`` pairs;
/// *total_lines* comes from the book record.  Everything before the first chapter
/// becomes a leading chunk, chapters longer than [`MAX_CHUNK_LINES`] are split, and
/// a book with no chapters at all becomes one chunk per [`MAX_CHUNK_LINES`] lines --
/// an unindexed book would be worse than a coarsely indexed one.
pub fn chunk_plan(chapters: &[(i64, String)], total_lines: i64) -> Vec<ChunkPlan> {
    // 正文为空就没有可索引的东西
    if total_lines <= 0 {
        return Vec::new();
    }
    // 章节表可能越界 / 重复（它是从正文正则解析出来的）：先夹进合法范围再排序去重
    let mut bounds: Vec<(i64, String)> = chapters
        .iter()
        .filter(|(line, _)| *line >= 0 && *line < total_lines)
        .map(|(line, title)| (*line, title.clone()))
        .collect();
    bounds.sort_by_key(|(line, _)| *line);
    bounds.dedup_by_key(|(line, _)| *line);

    // 每一章转成一段 (起, 止, 标题)，章前内容另起一段
    let mut spans: Vec<(i64, i64, String)> = Vec::new();
    let first = bounds.first().map(|(line, _)| *line).unwrap_or(0);
    if first > 0 {
        // 书名页 / 序言 / 版权页之类：也算一块，标题留空
        spans.push((0, first - 1, String::new()));
    }
    for (index, (line, title)) in bounds.iter().enumerate() {
        // 本章到下一章的前一行（最后一章到书末）
        let end = bounds
            .get(index + 1)
            .map(|(next, _)| *next - 1)
            .unwrap_or(total_lines - 1);
        spans.push((*line, end.max(*line), title.clone()));
    }
    // 一处章节都没有：整本按 MAX_CHUNK_LINES 切片
    if spans.is_empty() {
        spans.push((0, total_lines - 1, String::new()));
    }

    // 把超过上限的段落切开，顺便编号
    let mut plans: Vec<ChunkPlan> = Vec::new();
    for (start, end, title) in spans {
        let mut cursor = start;
        while cursor <= end {
            // 这一块最多吃 MAX_CHUNK_LINES 行
            let stop = (cursor + MAX_CHUNK_LINES - 1).min(end);
            plans.push(ChunkPlan {
                ordinal: plans.len() as i64,
                title: title.clone(),
                line_start: cursor,
                line_end: stop,
            });
            cursor = stop + 1;
        }
    }
    plans
}

#[cfg(test)]
mod tests {
    //! The cache is tested without a webview: schema, tokenisation, chunking and a
    //! real round trip through a temporary SQLite file.

    use super::*;
    use std::path::PathBuf;

    /// A unique temporary database path (no `tempfile` dependency needed).
    fn temp_db(name: &str) -> PathBuf {
        // 进程号 + 测试名 + 纳秒时间戳，保证并行跑也不撞车
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|delta| delta.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir()
            .join(format!(
                "paget-{}-{}-{}",
                std::process::id(),
                name,
                stamp
            ))
            .join("cache.sqlite3")
    }

    /// Build one book row with just the fields the shelf needs.
    fn book(id: &str, title: &str, percent: f64) -> BookRow {
        BookRow {
            id: id.to_string(),
            title: title.to_string(),
            author: "某人".to_string(),
            file_path: String::new(),
            // 普通文本：PDF 那三列留空（图片模式的 pdf 才会有值）
            format: String::new(),
            pages: 0,
            text_path: String::new(),
            total_lines: 10,
            total_words: 100,
            chapter_count: 2,
            current_line: 3,
            percentage: percent,
            last_read: Some("2026-03-01T20:00:00".to_string()),
            total_time_seconds: 600,
            finished: false,
            tags: vec!["科幻".to_string()],
        }
    }

    #[test]
    fn segmenting_puts_every_han_character_on_its_own() {
        // 逐字分词：中文串每个字两边都有空格
        assert_eq!(segment_cjk("三体"), " 三 体 ");
        // 中英混排：只有汉字被切开，英文原样
        assert_eq!(segment_cjk("ABC三体"), "ABC 三 体 ");
    }

    #[test]
    fn desegmenting_undoes_the_segmentation() {
        // 往返一致：显示前能还原成原来的样子
        let original = "三体世界就在我们眼前。";
        assert_eq!(desegment_cjk(&segment_cjk(original)), original);
        // 英文里本来就有的空格必须留着
        assert_eq!(desegment_cjk(&segment_cjk("a b c")), "a b c");
    }

    #[test]
    fn chunk_plan_honours_the_chapter_table() {
        // 两章：章前没有内容，所以就是两块
        let chapters = vec![(0i64, "第一章".to_string()), (5, "第二章".to_string())];
        let plans = chunk_plan(&chapters, 10);
        assert_eq!(plans.len(), 2);
        // 第一章覆盖 0..=4，第二章一路到书末
        assert_eq!((plans[0].line_start, plans[0].line_end), (0, 4));
        assert_eq!((plans[1].line_start, plans[1].line_end), (5, 9));
        assert_eq!(plans[0].title, "第一章");
    }

    #[test]
    fn chunk_plan_keeps_the_part_before_the_first_chapter() {
        // 第一章从第 3 行才开始：前面 0..=2 也得是一块（书名页 / 序言）
        let chapters = vec![(3i64, "第一章".to_string())];
        let plans = chunk_plan(&chapters, 8);
        assert_eq!(plans.len(), 2);
        assert_eq!((plans[0].line_start, plans[0].line_end), (0, 2));
        assert_eq!(plans[0].title, "");
    }

    #[test]
    fn chunk_plan_splits_a_chapter_that_is_too_long() {
        // 一章就超过上限：切成两块，编号连续
        let chapters = vec![(0i64, "唯一一章".to_string())];
        let plans = chunk_plan(&chapters, MAX_CHUNK_LINES + 5);
        assert_eq!(plans.len(), 2);
        // 第一块正好吃满上限，第二块接上剩下的 5 行
        assert_eq!(plans[0].line_end - plans[0].line_start + 1, MAX_CHUNK_LINES);
        assert_eq!(plans[1].line_end - plans[1].line_start + 1, 5);
        assert_eq!(plans[0].ordinal, 0);
        assert_eq!(plans[1].ordinal, 1);
    }

    #[test]
    fn chunk_plan_survives_a_book_without_chapters() {
        // 没识别出章节：整本一块，而不是返回空（空 = 一个字都搜不到）
        let plans = chunk_plan(&[], 100);
        assert_eq!(plans.len(), 1);
        assert_eq!((plans[0].line_start, plans[0].line_end), (0, 99));
    }

    #[test]
    fn chunk_plan_ignores_broken_chapter_rows() {
        // 手改坏的章节表：越界行号丢掉、重复行号去重、乱序排好
        let chapters = vec![
            (50i64, "越界".to_string()),
            (5, "后".to_string()),
            (0, "前".to_string()),
            (5, "重复".to_string()),
        ];
        let plans = chunk_plan(&chapters, 10);
        // 只剩两章（越界那条被丢、重复那条被去重）
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].line_start, 0);
        assert_eq!(plans[1].line_start, 5);
    }

    #[test]
    fn chunk_plan_of_an_empty_book_is_empty() {
        // 正文 0 行：没有任何可索引的东西
        assert!(chunk_plan(&[], 0).is_empty());
    }

    #[tokio::test]
    async fn in_book_search_returns_each_line_and_filters_by_book() {
        // 阅读页搜索要的是**行号**：同一个块里出现两次、跨两个块出现，都要分别列出来
        let path = temp_db("book-search");
        let db = Db::open(&path).await.expect("open");
        db.replace_books(
            &[
                book("aaa", "三体", 0.0),
                book("bbb", "另一本", 0.0),
                book("ccc", "没索引的书", 0.0),
            ],
            "2026-03-01T21:00:00",
        )
        .await
        .expect("replace");
        db.reindex_book(
            "aaa",
            &[
                Chunk {
                    ordinal: 0,
                    title: "第一章".to_string(),
                    line_start: 0,
                    line_end: 2,
                    text: "第一行\n三体世界就在眼前，三体人来了\n普通一行".to_string(),
                },
                Chunk {
                    ordinal: 1,
                    title: "第二章".to_string(),
                    line_start: 8,
                    line_end: 9,
                    text: "后文又提到三体\n末行".to_string(),
                },
            ],
        )
        .await
        .expect("index aaa");
        // 另一本书也命中同一个词：结果里绝不能混进来
        db.reindex_book(
            "bbb",
            &[Chunk {
                ordinal: 0,
                title: "别处".to_string(),
                line_start: 0,
                line_end: 0,
                text: "三体".to_string(),
            }],
        )
        .await
        .expect("index bbb");

        let found = db.search_book("aaa", "三体", 20).await.expect("search");
        assert!(found.indexed);
        assert!(!found.truncated, "10 行全都索引了");
        // 第二章那行也数上：三处命中，按行号排序（同一行的两处都保留）
        assert_eq!(
            found.hits.iter().map(|hit| hit.line).collect::<Vec<_>>(),
            vec![1, 1, 8]
        );
        assert_eq!(found.hits[0].title, "第一章");
        assert_eq!(found.hits[2].title, "第二章");
        // 片段用 [ ] 标出关键词，界面据此画 <mark>
        assert!(found.hits[0].snippet.contains("[三体]"), "{}", found.hits[0].snippet);

        // 搜不到 ≠ 没建索引
        let missing = db.search_book("aaa", "不存在的词", 20).await.expect("search");
        assert!(missing.indexed);
        assert!(missing.hits.is_empty());
        // 这本书一行都没索引：界面该先去 index_book
        let unindexed = db.search_book("ccc", "三体", 20).await.expect("search");
        assert!(!unindexed.indexed);
        assert!(unindexed.hits.is_empty());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn line_snippets_are_character_safe_and_marked() {
        // 长中文行只截命中附近，关键词用方括号标出来（按字符裁，不按字节）。
        // 前缀里夹一个四字节的 emoji：只要按字符裁，就不会切在字节中间而 panic。
        let line = format!("{}三体{}", "前😀".repeat(15), "后文".repeat(25));
        let start = line.find("三体").expect("hit");
        let snippet = line_snippet(line.as_str(), start, start + "三体".len());
        assert!(snippet.contains("[三体]"));
        assert!(snippet.starts_with('…'), "前文被截断时要有省略号");
        assert!(snippet.ends_with('…'), "后文被截断时要有省略号");
        assert!(snippet.contains("😀"), "不能把 emoji 切坏");
    }

    #[test]
    fn a_book_row_from_the_core_deserialises() {
        // 这是 `core/wreader/serve.py::_book_rows` 真实吐出来的形状（终端与 GUI 共用）。
        // 多出来的键（bookmarks / encoding…）BookRow 不声明，serde 默认忽略。
        let json = r#"{
            "id": "3e027c4de949",
            "title": "三体",
            "author": "刘慈欣",
            "file_path": "/tmp/novels/三体_utf8.txt",
            "encoding": "UTF-8",
            "total_lines": 812,
            "total_words": 21000,
            "import_date": "2026-03-01",
            "tags": ["科幻"],
            "current_line": 120,
            "percentage": 14.8,
            "last_read": "2026-03-01T20:00:00",
            "total_time_seconds": 3600,
            "finished": false,
            "bookmarks": [12],
            "chapter_count": 32
        }"#;
        // 解析成功就说明字段名对得上（谁把内核改成驼峰，这一条会立刻红）
        let row: BookRow = serde_json::from_str(json).expect("book row");
        assert_eq!(row.id, "3e027c4de949");
        assert_eq!(row.title, "三体");
        assert_eq!(row.tags, vec!["科幻".to_string()]);
        assert!(!row.finished);
    }

    #[test]
    fn a_position_from_the_front_end_deserialises() {
        // 前端 `invoke("save_gui_position", { position })` 送来的就是这一份
        // （`src/lib/types.ts` 的 GuiPosition，全部 snake_case）。
        let json = r#"{
            "book_id": "3e027c4de949",
            "cfi": "",
            "percentage": 14.8,
            "line": 120,
            "updated_at": "2026-03-01T20:00:00"
        }"#;
        // 字段名对不上就会在这里失败，而不是等到用户存位置时才发现
        let position: Position = serde_json::from_str(json).expect("position");
        assert_eq!(position.book_id, "3e027c4de949");
        assert_eq!(position.line, 120);
        // 反过来也要能序列化回同样的键名（Rust → JS 的方向）
        let back = serde_json::to_value(&position).expect("to value");
        assert!(back.get("book_id").is_some());
        assert!(back.get("updated_at").is_some());
    }

    #[tokio::test]
    async fn a_pdf_row_keeps_its_image_mode_fields() {
        // 图片模式的 pdf 靠这三列：书架据此知道「画页面」而不是「排文字」
        let path = temp_db("pdf-row");
        let db = Db::open(&path).await.expect("open");
        let mut row = book("pdf123", "扫描版", 0.0);
        row.format = "pdf".to_string();
        row.pages = 785;
        row.file_path = "/novels/扫描版_utf8.pdf".to_string();
        db.replace_books(&[row], "2026-03-01T21:00:00")
            .await
            .expect("replace");
        let rows = db.list_books().await.expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].format, "pdf");
        assert_eq!(rows[0].pages, 785);
        // 还没「转换成文字」：text_path 是空串
        assert_eq!(rows[0].text_path, "");
        // 转换成文字之后：text_path 与行数都跟着变，pages 不动（图片模式照样能用）
        let mut converted = rows[0].clone();
        converted.text_path = "/novels/扫描版_utf8.txt".to_string();
        converted.total_lines = 16456;
        db.replace_books(&[converted], "2026-03-01T21:01:00")
            .await
            .expect("replace");
        let rows = db.list_books().await.expect("list");
        assert_eq!(rows[0].text_path, "/novels/扫描版_utf8.txt");
        assert_eq!(rows[0].total_lines, 16456);
        assert_eq!(rows[0].pages, 785);
        // 收尾：临时库连同目录一起删掉
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn the_cache_round_trips_books_positions_and_settings() {
        // 全新的临时库：第一次打开会自动建 schema
        let path = temp_db("round-trip");
        let db = Db::open(&path).await.expect("open");
        // 书架：写两本再读回来
        db.replace_books(
            &[book("aaa", "三体", 12.5), book("bbb", "另一本", 0.0)],
            "2026-03-01T21:00:00",
        )
        .await
        .expect("replace");
        let rows = db.list_books().await.expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].title, "三体");
        assert_eq!(rows[0].percentage, 12.5);
        // tags 以 JSON 存一列，读回来必须还原成数组
        assert_eq!(rows[0].tags, vec!["科幻".to_string()]);
        // 位置：写一条、读一条
        db.save_position(&Position {
            book_id: "aaa".to_string(),
            cfi: "epubcfi(/6/4!/4/2/2)".to_string(),
            percentage: 12.5,
            line: 3,
            updated_at: "2026-03-01T21:00:00".to_string(),
        })
        .await
        .expect("save position");
        let saved = db.load_position("aaa").await.expect("load").expect("saved");
        assert_eq!(saved.cfi, "epubcfi(/6/4!/4/2/2)");
        // 没打开过的书：None（不是错误）
        assert!(db.load_position("zzz").await.expect("load").is_none());
        // 界面设置：写、读、没写过的是 None
        db.set_setting("theme", "dark").await.expect("set");
        let theme = db.get_setting("theme").await.expect("get");
        assert_eq!(theme.as_deref(), Some("dark"));
        assert!(db.get_setting("nope").await.expect("get").is_none());
        // 收拾现场：临时目录里不留垃圾
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[tokio::test]
    async fn a_chinese_word_can_be_found_by_full_text_search() {
        // 这一条就是 segment_cjk 存在的理由：不分词的话中文一个字都搜不到
        let path = temp_db("search");
        let db = Db::open(&path).await.expect("open");
        db.replace_books(&[book("aaa", "三体", 0.0)], "2026-03-01T21:00:00")
            .await
            .expect("replace");
        // 索引两块正文
        db.reindex_book(
            "aaa",
            &[
                Chunk {
                    ordinal: 0,
                    title: "第一章 科学边界".to_string(),
                    line_start: 0,
                    line_end: 1,
                    text: "汪淼看到了一串数字在眼前跳动。\n他抬头望向窗外的夜空。".to_string(),
                },
                Chunk {
                    ordinal: 1,
                    title: "第二章 台球".to_string(),
                    line_start: 2,
                    line_end: 3,
                    text: "“三体世界就在我们眼前。”丁仪说道。".to_string(),
                },
            ],
        )
        .await
        .expect("reindex");
        // 两字词（最常见的搜法）必须命中
        let hits = db.search("三体", 10).await.expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].book_id, "aaa");
        // 片段要去掉分词空格，并标出关键词
        assert!(
            hits[0].snippet.contains("[三体]"),
            "snippet was {:?}",
            hits[0].snippet
        );
        // 行号要能带回去（界面靠它跳转）
        assert_eq!(hits[0].line_start, 2);
        // 打了一半也能命中（短语末尾加了 *）
        assert_eq!(db.search("三体世", 10).await.expect("search").len(), 1);
        // 搜不到的词回空，而不是报错
        assert!(db.search("不存在的词", 10).await.expect("search").is_empty());
        // 空查询回空（FTS5 对空 MATCH 会报语法错，这一层挡住了）
        assert!(db.search("   ", 10).await.expect("search").is_empty());
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[tokio::test]
    async fn dropping_a_book_also_drops_its_index() {
        // 内核删掉一本书之后，缓存里不该还留着能搜到、点不开的碎片
        let path = temp_db("prune");
        let db = Db::open(&path).await.expect("open");
        db.replace_books(
            &[book("aaa", "三体", 0.0), book("bbb", "另一本", 0.0)],
            "2026-03-01T21:00:00",
        )
        .await
        .expect("replace");
        db.reindex_book(
            "bbb",
            &[Chunk {
                ordinal: 0,
                title: String::new(),
                line_start: 0,
                line_end: 0,
                text: "唯一的线索藏在这里。".to_string(),
            }],
        )
        .await
        .expect("reindex");
        assert_eq!(db.search("线索", 10).await.expect("search").len(), 1);
        // 只把 aaa 写回书架：bbb 已经被内核遗忘了
        db.replace_books(&[book("aaa", "三体", 0.0)], "2026-03-01T22:00:00")
            .await
            .expect("replace");
        assert!(db.search("线索", 10).await.expect("search").is_empty());
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[tokio::test]
    async fn reset_empties_the_cache_and_it_can_be_used_again() {
        // reset 是"把缓存丢掉"的入口，必须真的丢干净、而且之后还能用
        let path = temp_db("reset");
        let db = Db::open(&path).await.expect("open");
        db.replace_books(&[book("aaa", "三体", 0.0)], "2026-03-01T21:00:00")
            .await
            .expect("replace");
        assert_eq!(db.list_books().await.expect("list").len(), 1);
        db.reset().await.expect("reset");
        // 缓存空了
        assert!(db.list_books().await.expect("list").is_empty());
        // 再写一次照常工作
        db.replace_books(&[book("bbb", "回来了", 0.0)], "2026-03-01T22:00:00")
            .await
            .expect("replace");
        assert_eq!(db.list_books().await.expect("list").len(), 1);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }
}


