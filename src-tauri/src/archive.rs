//! Sealed books ("限时" mode): the file of an expired book is zipped away instead
//! of being deleted.
//!
//! A book the user marked as *limited* (a library-style loan) disappears from the
//! shelf the moment its due day starts.  Nothing is really deleted: the whole file
//! is packed into ``app_data_dir/archived/<sha8><rand>.zip``, the index record is
//! dropped through the core's `remove` (so the book list stays honest) and the book
//! vanishes from the shelf.  ``paget-archive.json`` rides **inside** the zip, so the
//! "已归档" page can list and restore everything from the archives alone -- the
//! SQLite cache may be thrown away at any time (see `db.rs`) and the archives stay
//! self-describing.
//!
//! Two deliberate choices:
//!
//! * **The zip is written by hand** (a 30 byte header per entry, deflate from
//!   `flate2`, a CRC-32 per entry).  The `zip` crate is not in this project's
//!   dependency tree, and the part of the format we need -- two entries, no ZIP64,
//!   no encryption, no data descriptors -- is small enough to stay readable, which
//!   also keeps it testable in `cargo test` without a webview (same spirit as
//!   `db.rs`).
//! * **The name hides the book**: ``<sha256(title)[0..8]><4 random chars>.zip``.
//!   The original name is kept *inside* the archive (`original_name`) and is what the
//!   restore puts back, so the unreadable name costs nothing.
//!
//! The archived file is usually the converted ``<title>_utf8.txt``: that is the only
//! copy of a book the core keeps (an imported epub is converted at import time and is
//! not stored).  A library entry pointing at a real ``.epub`` is archived just the
//! same -- this module never looks at the extension.

use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The directory sealed books live in, under `app_data_dir`.
pub const ARCHIVE_DIR: &str = "archived";

/// The entry inside every archive that carries [`ArchiveMeta`].
pub const META_ENTRY: &str = "paget-archive.json";

/// Refuse to read an archive bigger than this (a sealed book is a text file; a
/// 512 MB "zip" in that folder is not something to load into memory).
pub const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;

/// What a sealed book needs in order to be listed and restored.
///
/// It travels **inside** the zip (`META_ENTRY`), so an archive stays readable long
/// after the GUI cache, the index record or even this app has been replaced.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveMeta {
    /// 归档文件名本身（`<sha8><rand>.zip`）；由 `seal` 填
    pub archive_id: String,
    /// 内核的书 id（正文 SHA-1 前 12 位）——找回后应当对得上
    pub book_id: String,
    /// 书名（归档列表显示的「原书名」）
    pub title: String,
    /// 作者
    pub author: String,
    /// 封印前那个文件名（归档列表里显示，也是 zip 里正文条目的名字）
    pub original_name: String,
    /// 封印前那个绝对路径（只作记录：找回是内核 `import` 决定的，不由它指定）
    pub original_path: String,
    /// 封印时刻（本地时间，`YYYY-MM-DDTHH:MM:SS`，由前端给）
    pub sealed_at: String,
    /// 限时到期日（`YYYY-MM-DD`；空串 = 不是限时书）
    pub due_at: String,
    /// 正文总行数
    pub total_lines: i64,
    /// 总字数
    pub total_words: i64,
    /// 内核记录里的 `progress` 原样存下：找回时把行号 / 百分比 / 书签 / 读完写回
    pub progress: Value,
}

/// One row of the "已归档" page: the archive plus what it holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedBook {
    /// 归档文件名（对外的 id）
    pub archive_id: String,
    /// 归档 zip 的绝对路径（「在 Finder 里看一眼」）
    pub zip_path: String,
    /// 归档体积（字节）
    pub size_bytes: u64,
    /// 里面那份元信息
    pub meta: ArchiveMeta,
}

/// The directory holding the archives of *app_data* (not created here).
pub fn archive_dir(app_data: &Path) -> PathBuf {
    // 归档是 app_data_dir 下的一个固定子目录
    app_data.join(ARCHIVE_DIR)
}

/// The first eight hex digits of the SHA-256 of a book title.
///
/// Eight hex digits (32 bits) is what the design asks for: long enough that two
/// different titles practically never share a prefix, short enough that the file
/// name stays unreadable and copy-pasteable.
pub fn title_hash(title: &str) -> String {
    let digest = Sha256::digest(title.as_bytes());
    let mut out = String::with_capacity(8);
    // 前 4 个字节 = 8 个十六进制字符
    for byte in digest.iter().take(4) {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

/// A four character suffix from `0-9a-z`.
///
/// Deliberately **not** a random-number crate: the seed is the nanosecond clock
/// mixed with the process id and a per-process counter, which is plenty to keep two
/// archives of the same title apart.  [`seal`] re-rolls on a collision anyway, so
/// the suffix is a convenience, not a correctness requirement.
fn random_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos() as u64)
        .unwrap_or(0);
    // xorshift64：把时钟、进程号、计数器混成一个种子
    let mut state = nanos
        ^ ((std::process::id() as u64) << 32)
        ^ COUNTER
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_mul(0x9E37_79B9_7F4A_7C15);
    // 种子为 0 会让 xorshift 永远停在 0
    if state == 0 {
        state = 0x2545_F491_4F6C_DD1D;
    }
    let mut suffix = String::with_capacity(4);
    for _ in 0..4 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        suffix.push(ALPHABET[(state % ALPHABET.len() as u64) as usize] as char);
    }
    suffix
}

/// The file name of a new archive: ``<sha8><rand>.zip``.
pub fn archive_id(title: &str) -> String {
    format!("{}{}.zip", title_hash(title), random_suffix())
}

/// Guard for an id that arrives from the front end: one plain file name, nothing
/// that could climb out of the archive directory.
pub fn safe_archive_id(raw: &str) -> Option<String> {
    let id = raw.trim();
    // 长度与字符集都收紧：归档名是我们自己生成的，外面的值只可能来自手改的界面状态
    if id.is_empty() || id.len() > 80 || id.contains("..") {
        return None;
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return None;
    }
    Some(id.to_string())
}

/// The file name an archive's payload is written to while it is being restored.
///
/// The payload has to be handed to the core's `import` (see
/// `lib.rs::archive_restore`) and the importer derives the title from the file name
/// -- so the temporary file is named after the **book title**, exactly like the
/// original import was, and the re-imported record therefore carries the same title
/// and the same book id (the content is unchanged).
pub fn payload_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|ch| {
            // 路径分隔符与 Windows 上的非法字符都换成下划线（CJK 保留）
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') || (ch as u32) > 0x7f {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    // 空标题（或全是非法字符）：兜个名字，免得写出 ".txt"
    if trimmed.is_empty() {
        return "sealed-book.txt".to_string();
    }
    format!("{}.txt", trimmed)
}

/// A DOS style ``(time, date)`` stamp for the zip headers, from the seal moment.
///
/// *sealed_at* is the front end's local timestamp (``YYYY-MM-DDTHH:MM:SS``), which is
/// exactly what a zip header wants: a **local** clock reading.  A value that cannot be
/// parsed (a hand-written archive) falls back to the DOS epoch (``1980-01-01``) instead
/// of guessing -- nothing reads this field for display, `ArchiveMeta::sealed_at` is the
/// authoritative moment.
fn dos_stamp(sealed_at: &str) -> (u16, u16) {
    parse_dos(sealed_at).unwrap_or((0, DOS_EPOCH_DAY))
}

/// ``(year - 1980) << 9 | month << 5 | day`` for 1980-01-01.
const DOS_EPOCH_DAY: u16 = (1 << 5) | 1;

/// Parse ``YYYY-MM-DDTHH:MM:SS`` into ``(dos_time, dos_date)``; `None` when malformed.
fn parse_dos(text: &str) -> Option<(u16, u16)> {
    let bytes = text.as_bytes();
    // 定长格式，分隔符位置必须对（`coreStamp` 写出来的就是这个形状）
    if bytes.len() < 19
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let field = |from: usize, to: usize| text.get(from..to)?.parse::<u16>().ok();
    let year = field(0, 4)?;
    let month = field(5, 7)?;
    let day = field(8, 10)?;
    let hour = field(11, 13)?;
    let minute = field(14, 16)?;
    let second = field(17, 19)?;
    // DOS 的日期字段是 7 位年（1980-2107）、4 位月、5 位日
    if !(1980..=2107).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let time = (hour << 11) | (minute << 5) | (second / 2);
    let date = ((year - 1980) << 9) | (month << 5) | day;
    Some((time, date))
}


/// One entry of a hand written zip: a name and the bytes behind it.
type Entry = (String, Vec<u8>);

/// Write *entries* into a brand new zip at *path*.
///
/// deflate (method 8) is used unless the compressed bytes would be **bigger** than
/// the raw ones -- random data can do that -- in which case the entry is stored
/// (method 0).  Both are read back by `read_zip`, so the choice is invisible.
///
/// *sealed_at* only feeds the DOS timestamp in the headers (see [`dos_stamp`]).
fn write_zip(path: &Path, sealed_at: &str, entries: &[Entry]) -> io::Result<()> {
    let mut out = BufWriter::new(File::create(path)?);
    let (dos_time, dos_date) = dos_stamp(sealed_at);
    // 中央目录最后写，先攒在这里
    let mut central: Vec<u8> = Vec::new();
    let mut offset: u32 = 0;

    for (name, data) in entries {
        let name_bytes = name.as_bytes();
        // 条目名是 UTF-8（书名大多带中文）：必须置 general purpose bit 11，否则
        // `unzip` / Finder / Python 会按老式 cp437 解释，名字在归档外看就是乱码
        let flags: u16 = if name_bytes.is_ascii() { 0 } else { 0x0800 };
        let crc = crc32fast::hash(data);
        // 先压一遍，压不动就用原样存储（两种读回来都一样）
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data)?;
        let compressed = encoder.finish()?;
        let (method, bytes) = if compressed.len() < data.len() {
            (8u16, compressed)
        } else {
            (0u16, data.clone())
        };
        let size = data.len() as u32;
        let csize = bytes.len() as u32;

        // ---- 本地文件头（30 字节）+ 文件名 + 数据 ----
        let mut head = Vec::with_capacity(30 + name_bytes.len());
        head.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        head.extend_from_slice(&20u16.to_le_bytes()); // version needed
        head.extend_from_slice(&flags.to_le_bytes());
        head.extend_from_slice(&method.to_le_bytes());
        head.extend_from_slice(&dos_time.to_le_bytes());
        head.extend_from_slice(&dos_date.to_le_bytes());
        head.extend_from_slice(&crc.to_le_bytes());
        head.extend_from_slice(&csize.to_le_bytes());
        head.extend_from_slice(&size.to_le_bytes());
        head.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        head.extend_from_slice(&0u16.to_le_bytes()); // extra len
        head.extend_from_slice(name_bytes);
        out.write_all(&head)?;
        out.write_all(&bytes)?;

        // ---- 中央目录项（46 字节）+ 文件名 ----
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&flags.to_le_bytes());
        central.extend_from_slice(&method.to_le_bytes());
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&csize.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra
        central.extend_from_slice(&0u16.to_le_bytes()); // comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk number
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&offset.to_le_bytes()); // 本地头的位置
        central.extend_from_slice(name_bytes);

        offset += (30 + name_bytes.len() + bytes.len()) as u32;
    }

    // 中央目录 + EOCD（22 字节）
    let cd_offset = offset;
    let count = entries.len() as u16;
    out.write_all(&central)?;
    let mut end = Vec::with_capacity(22);
    end.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes()); // disk number
    end.extend_from_slice(&0u16.to_le_bytes()); // disk with the central directory
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&count.to_le_bytes());
    end.extend_from_slice(&(central.len() as u32).to_le_bytes());
    end.extend_from_slice(&cd_offset.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes()); // comment len
    out.write_all(&end)?;
    out.flush()
}

/// Read one little-endian `u16` at *at*; `None` when it would run past the end.
fn le16(bytes: &[u8], at: usize) -> Option<u16> {
    let slice = bytes.get(at..at + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

/// Read one little-endian `u32` at *at*; `None` when it would run past the end.
fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// A convenience for the "broken archive" errors below.
fn broken() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "broken zip entry")
}


/// Locate the end-of-central-directory record and return `(cd_offset, count)`.
///
/// The record sits at the very end of the file unless a zip comment follows it, so
/// the scan walks backwards from the tail through the largest comment the format
/// allows (64 KiB).
fn find_central_directory(bytes: &[u8]) -> Option<(usize, usize)> {
    let start = bytes.len().saturating_sub(65_557);
    for at in (start..bytes.len().saturating_sub(21)).rev() {
        if le32(bytes, at) == Some(0x0605_4b50) {
            let count = le16(bytes, at + 10)? as usize;
            let offset = le32(bytes, at + 16)? as usize;
            return Some((offset, count));
        }
    }
    None
}

/// 归档里的正文条目（除元信息之外的第一个条目）。
fn payload_of(entries: &[Entry]) -> Option<&Vec<u8>> {
    entries
        .iter()
        .find(|(name, _)| name != META_ENTRY)
        .map(|(_, data)| data)
}

/// Read every entry of a zip written by [`write_zip`].
///
/// Stored (method 0) and deflated (method 8) entries are supported; anything else --
/// or a broken checksum -- is an error rather than a silent half-read.
fn read_zip(path: &Path) -> io::Result<Vec<Entry>> {
    let length = fs::metadata(path)?.len();
    // 体积上限：不要把整个归档读进内存
    if length > MAX_ARCHIVE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("archive is too large: {} bytes", length),
        ));
    }
    let bytes = fs::read(path)?;
    let (cd_offset, count) = find_central_directory(&bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not a zip archive"))?;

    let mut entries = Vec::with_capacity(count);
    let mut cursor = cd_offset;
    for _ in 0..count {
        if le32(&bytes, cursor) != Some(0x0201_4b50) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "broken central directory",
            ));
        }
        let method = le16(&bytes, cursor + 10).unwrap_or(0);
        let crc = le32(&bytes, cursor + 16).unwrap_or(0);
        let csize = le32(&bytes, cursor + 20).unwrap_or(0) as usize;
        let usize_ = le32(&bytes, cursor + 24).unwrap_or(0) as usize;
        let name_len = le16(&bytes, cursor + 28).unwrap_or(0) as usize;
        let extra_len = le16(&bytes, cursor + 30).unwrap_or(0) as usize;
        let comment_len = le16(&bytes, cursor + 32).unwrap_or(0) as usize;
        let local = le32(&bytes, cursor + 42).unwrap_or(0) as usize;
        let name_at = cursor + 46;
        let name_end = name_at.checked_add(name_len).ok_or_else(broken)?;
        let name =
            String::from_utf8_lossy(bytes.get(name_at..name_end).ok_or_else(broken)?).to_string();

        // 本地头里的 extra 长度可能与中央目录里不同，所以位置以本地头为准
        let local_name_len = le16(&bytes, local + 26).ok_or_else(broken)? as usize;
        let local_extra_len = le16(&bytes, local + 28).ok_or_else(broken)? as usize;
        let data_at = local + 30 + local_name_len + local_extra_len;
        let data_end = data_at.checked_add(csize).ok_or_else(broken)?;
        let raw = bytes.get(data_at..data_end).ok_or_else(broken)?;

        let data = match method {
            // 存储：原样
            0 => raw.to_vec(),
            // deflate：解压回原文
            8 => {
                let mut decoder = DeflateDecoder::new(raw);
                let mut buffer = Vec::with_capacity(usize_);
                decoder.read_to_end(&mut buffer)?;
                buffer
            }
            other => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("unsupported compression method: {}", other),
                ))
            }
        };
        // 校验和不合：说明这个归档坏了，宁可报错也别还回半份正文
        if crc != 0 && crc32fast::hash(&data) != crc {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("checksum mismatch in entry '{}'", name),
            ));
        }
        entries.push((name, data));
        cursor = name_end + extra_len + comment_len;
    }
    Ok(entries)
}


/// Write the whole contents of *source* into a new archive in *dir*.
///
/// The zip holds two entries: the payload under its original file name and
/// [`META_ENTRY`].  `meta.archive_id` is filled in here (the caller cannot know the
/// random name yet) and the name is re-rolled until it is free.
///
/// **The original file is left in place** -- dropping it is the caller's job (in this
/// app: the core's `remove`), so a failure after this point can always be undone by
/// deleting the archive.
pub fn seal(dir: &Path, source: &Path, mut meta: ArchiveMeta) -> io::Result<ArchivedBook> {
    let payload = fs::read(source)?;
    // 正文大小上限（正常是几 MB 的文本）
    if payload.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("book is too large to seal: {} bytes", payload.len()),
        ));
    }
    fs::create_dir_all(dir)?;

    // 名字撞了就换一个随机后缀重试（同名书连着封两本时可能碰上）
    let mut id = archive_id(&meta.title);
    let mut target = dir.join(&id);
    let mut attempts = 0;
    while target.exists() && attempts < 16 {
        id = archive_id(&meta.title);
        target = dir.join(&id);
        attempts += 1;
    }
    meta.archive_id = id.clone();

    let meta_bytes = serde_json::to_vec_pretty(&meta)?;
    write_zip(
        &target,
        &meta.sealed_at,
        &[
            (meta.original_name.clone(), payload),
            (META_ENTRY.to_string(), meta_bytes),
        ],
    )?;

    let size_bytes = fs::metadata(&target)?.len();
    Ok(ArchivedBook {
        archive_id: id,
        zip_path: target.to_string_lossy().to_string(),
        size_bytes,
        meta,
    })
}

/// Read the metadata of one archive.
pub fn read_meta(archive: &Path) -> io::Result<ArchiveMeta> {
    let entries = read_zip(archive)?;
    let raw = entries
        .iter()
        .find(|(name, _)| name == META_ENTRY)
        .map(|(_, data)| data)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("archive has no {} entry", META_ENTRY),
            )
        })?;
    serde_json::from_slice(raw).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))
}

/// Write the payload of *archive* to *target* and return the archive's metadata.
pub fn extract_payload(archive: &Path, target: &Path) -> io::Result<ArchiveMeta> {
    let entries = read_zip(archive)?;
    let meta = read_meta(archive)?;
    let payload = payload_of(&entries).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "archive carries no book payload",
        )
    })?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, payload)?;
    Ok(meta)
}

/// Every readable archive in *dir*, newest seal first.
///
/// A file that is not one of our archives (a `.DS_Store`, half a download) is skipped
/// instead of failing the whole list: the page it feeds is a plain view of a folder,
/// and one foreign file must not blank it out.
pub fn list(dir: &Path) -> Vec<ArchivedBook> {
    let mut rows: Vec<ArchivedBook> = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        // 目录还不存在：一本都没封印过
        return rows;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // 只看 .zip 文件
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
            continue;
        }
        let Ok(meta) = read_meta(&path) else {
            // 读不懂的文件（别人的 zip / 坏掉的归档）跳过，不拖垮整页
            continue;
        };
        let archive_id = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let size_bytes = entry.metadata().map(|info| info.len()).unwrap_or(0);
        rows.push(ArchivedBook {
            archive_id,
            zip_path: path.to_string_lossy().to_string(),
            size_bytes,
            meta,
        });
    }
    // 最近封印的排最前（sealed_at 是定长 ISO 串，倒序即时间倒序）
    rows.sort_by(|a, b| b.meta.sealed_at.cmp(&a.meta.sealed_at));
    rows
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例自己的临时目录（不碰用户数据，跑完删掉）。
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "paget-archive-test-{}-{}",
            name,
            std::process::id()
        ));
        // 上一次跑剩的（进程号复用）先清掉
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn meta_for(title: &str, source: &Path) -> ArchiveMeta {
        ArchiveMeta {
            archive_id: String::new(),
            book_id: "a1b2c3d4e5f6".to_string(),
            title: title.to_string(),
            author: "刘慈欣".to_string(),
            original_name: source.file_name().unwrap().to_string_lossy().to_string(),
            original_path: source.to_string_lossy().to_string(),
            sealed_at: "2026-10-08T00:00:03".to_string(),
            due_at: "2026-10-08".to_string(),
            total_lines: 812,
            total_words: 208_400,
            progress: serde_json::json!({
                "current_line": 120,
                "percentage": 14.8,
                "finished": false
            }),
        }
    }

    /// 归档名 = 书名 SHA-256 前 8 位 + 随机后缀 + `.zip`，且两次不同。
    #[test]
    fn archive_ids_are_hashed_and_unpredictable() {
        assert_eq!(title_hash("三体"), "9f4c311a");
        assert_eq!(title_hash("Harry Potter"), "f984f4bd");

        let first = archive_id("三体");
        let second = archive_id("三体");
        assert!(first.ends_with(".zip"));
        assert!(first.starts_with("9f4c311a"));
        // 8 位哈希 + 4 位随机 + ".zip"
        assert_eq!(first.len(), 16);
        // 同名书连封两本不该撞名
        assert_ne!(first, second);
        assert!(safe_archive_id(&first).is_some(), "自己生成的名字必须过白名单");
    }

    /// 白名单挡住路径分隔符、上跳与超长：手改过的界面状态不该写到归档目录外。
    #[test]
    fn archive_id_whitelist_blocks_paths() {
        let too_long = "x".repeat(81);
        for bad in ["", "  ", "../x.zip", "a/b.zip", "a\\b.zip", "中文.zip", too_long.as_str()] {
            assert!(safe_archive_id(bad).is_none(), "不该放行: {bad:?}");
        }
        assert_eq!(
            safe_archive_id(" 9f4c311ak3m2.zip ").as_deref(),
            Some("9f4c311ak3m2.zip")
        );
    }

    /// 还原用的临时文件名跟着书名（内核按文件名解析书名），CJK 保留。
    #[test]
    fn payload_names_follow_the_book_title() {
        assert_eq!(payload_name("三体"), "三体.txt");
        assert_eq!(payload_name("Harry Potter"), "Harry Potter.txt");
        // 路径分隔符被换掉，不会写出目录之外
        assert_eq!(payload_name("a/b:c"), "a_b_c.txt");
        // 空标题兜个默认名
        assert_eq!(payload_name("   "), "sealed-book.txt");
    }

    /// zip 头里的时间戳：从 `sealed_at` 解出来；解不出来就退回 DOS 原点，不许瞎猜。
    #[test]
    fn zip_timestamp_comes_from_the_seal_moment() {
        // 2026-10-08T00:00:03 → date = (46 << 9) | (10 << 5) | 8，time = 3 / 2
        let expected_date = (46u16 << 9) | (10 << 5) | 8;
        assert_eq!(parse_dos("2026-10-08T00:00:03"), Some((1, expected_date)));
        // 12:30:00（年份 2026 → 2026 - 1980 = 46）
        assert_eq!(
            parse_dos("2026-01-02T12:30:00"),
            Some(((12 << 11) | (30 << 5), (46 << 9) | (1 << 5) | 2))
        );
        // 手写坏的 / 不完整的值一律当"不知道"
        for bad in ["", "2026-10-08", "不是时间", "2026-13-40T99:99:99"] {
            assert_eq!(parse_dos(bad), None, "不该解析: {bad:?}");
        }
        // 兜底是 1980-01-01（DOS 原点）
        assert_eq!(dos_stamp(""), (0, (1 << 5) | 1));
    }

    /// 非 ASCII 条目名必须置 UTF-8 标志位（general purpose bit 11），
    /// 否则 `unzip` / Finder / Python 会按 cp437 解释，书名在归档外看就是乱码。
    #[test]
    fn non_ascii_entries_are_flagged_as_utf8() {
        let dir = scratch("flags");
        let source = dir.join("三体_utf8.txt");
        fs::write(&source, b"body").unwrap();
        let sealed = seal(&dir, &source, meta_for("三体", &source)).unwrap();
        let bytes = fs::read(&sealed.zip_path).unwrap();

        // 本地文件头：flags 在偏移 6
        assert_eq!(le16(&bytes, 6), Some(0x0800), "本地头该置 UTF-8 标志");
        // 中央目录：flags 在目录项 +8（目录起点从 EOCD 里读）
        let (cd_offset, _count) = find_central_directory(&bytes).unwrap();
        assert_eq!(
            le16(&bytes, cd_offset + 8),
            Some(0x0800),
            "中央目录该置 UTF-8 标志"
        );

        // 纯 ASCII 的归档不必置这一位（老工具也认）
        let plain = dir.join("plain.txt");
        fs::write(&plain, b"body").unwrap();
        let sealed = seal(&dir, &plain, meta_for("plain", &plain)).unwrap();
        let bytes = fs::read(&sealed.zip_path).unwrap();
        assert_eq!(le16(&bytes, 6), Some(0));

        let _ = fs::remove_dir_all(&dir);
    }

    /// 写进去再读出来：正文一个字节都不能变，元信息也要完整。
    #[test]
    fn round_trip_keeps_bytes_and_meta() {
        let dir = scratch("roundtrip");
        let source = dir.join("三体_utf8.txt");
        let text = "第一章 科学边界\n".repeat(500);
        fs::write(&source, &text).unwrap();

        let sealed = seal(&dir, &source, meta_for("三体", &source)).unwrap();
        // 原文件还在：删它是调用方的事，这一步之后失败还能整体回退
        assert!(source.is_file());
        assert_eq!(sealed.meta.archive_id, sealed.archive_id);

        let meta = read_meta(Path::new(&sealed.zip_path)).unwrap();
        assert_eq!(meta.title, "三体");
        assert_eq!(meta.original_name, "三体_utf8.txt");
        assert_eq!(meta.due_at, "2026-10-08");
        assert_eq!(meta.progress["current_line"], 120);

        let target = dir.join("restored.txt");
        let seen = extract_payload(Path::new(&sealed.zip_path), &target).unwrap();
        assert_eq!(seen.book_id, "a1b2c3d4e5f6");
        assert_eq!(fs::read_to_string(&target).unwrap(), text);

        let _ = fs::remove_dir_all(&dir);
    }

    /// 文本会被真的压小（不是"zip 里套了个原文件"）。
    #[test]
    fn text_payload_is_compressed() {
        let dir = scratch("compressed");
        let source = dir.join("重复.txt");
        let text = "三体世界就在我们眼前。\n".repeat(20_000);
        fs::write(&source, &text).unwrap();

        let sealed = seal(&dir, &source, meta_for("重复", &source)).unwrap();
        let raw = text.len() as u64;
        assert!(
            sealed.size_bytes * 2 < raw,
            "归档 {} 字节，原文 {} 字节 —— 没压住",
            sealed.size_bytes,
            raw
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// 列表：跳过不认识的文件，最近封印的排最前。
    #[test]
    fn list_skips_foreign_files_and_sorts_newest_first() {
        let dir = scratch("list");
        // 不是归档的文件：不该出现在列表里，也不该让列表失败
        fs::write(dir.join("notes.txt"), b"hello").unwrap();
        fs::write(dir.join("broken.zip"), b"not really a zip").unwrap();

        let older = dir.join("older.txt");
        fs::write(&older, b"old").unwrap();
        let mut first = meta_for("旧书", &older);
        first.sealed_at = "2026-10-01T00:00:00".to_string();
        seal(&dir, &older, first).unwrap();

        let newer = dir.join("newer.txt");
        fs::write(&newer, b"new").unwrap();
        let mut second = meta_for("新书", &newer);
        second.sealed_at = "2026-10-09T00:00:00".to_string();
        let newest = seal(&dir, &newer, second).unwrap();

        let rows = list(&dir);
        assert_eq!(rows.len(), 2, "只该看见两个真归档");
        assert_eq!(rows[0].archive_id, newest.archive_id);
        assert_eq!(rows[0].meta.title, "新书");
        assert_eq!(rows[1].meta.title, "旧书");
        assert!(rows[0].size_bytes > 0);

        // 目录不存在时也不是错误：一本都没封印过
        assert!(list(&dir.join("missing")).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    /// 坏归档要明确报错，而不是还回半份正文。
    #[test]
    fn broken_archives_are_rejected() {
        let dir = scratch("broken");
        let garbage = dir.join("garbage.zip");
        fs::write(&garbage, b"definitely not a zip archive").unwrap();
        assert!(read_meta(&garbage).is_err());
        assert!(extract_payload(&garbage, &dir.join("out.txt")).is_err());

        // 只有正文、没有元信息的 zip：导入时拿不到书名/进度，所以要报错
        let missing = dir.join("no-meta.zip");
        write_zip(
            &missing,
            "2026-10-08T00:00:03",
            &[("只有正文.txt".to_string(), b"hello".to_vec())],
        )
        .unwrap();
        assert!(read_meta(&missing).is_err());
        assert!(extract_payload(&missing, &dir.join("only.txt")).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}

