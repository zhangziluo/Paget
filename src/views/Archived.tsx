import { useCallback, useEffect, useState } from "react";

import { archiveDirPath, archivedBooks, restoreBook } from "../lib/core";
import { humanBytes, shortStamp } from "../lib/format";
import type { ArchivedBook } from "../lib/types";

/**
 * 「已归档」页：所有被封印的书 + 一键找回（齿轮里的第三个页签）。
 *
 * 列表**只读归档目录**：每本书的元信息（书名 / 封印时刻 / 原文件名 / 进度快照）都在
 * 自己的 zip 里，所以清掉本机缓存、甚至换一台机器，归档照样认得出来。找回走壳层的
 * `archive_restore`（解压 → 内核重新导入 → 进度写回），成功后刷新书架。
 */
export default function Archived(props: {
  /** 嵌入式（齿轮里）时交给 Desk 排版 */
  embedded?: boolean;
  /** 找回之后书架变了，通知外层重新同步 */
  onLibraryChanged: () => void;
}) {
  const [rows, setRows] = useState<ArchivedBook[]>([]);
  const [dir, setDir] = useState("");
  // 正在找回哪一个（空 = 空闲）
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      // 两个都是壳层的快查询：列表 + 归档目录本身
      const [books, path] = await Promise.all([archivedBooks(), archiveDirPath()]);
      setRows(books);
      setDir(path);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 找回一本：解压 → 内核重新导入 → 进度写回 → 刷新书架。 */
  async function restore(row: ArchivedBook) {
    setBusyId(row.archive_id);
    setNotice("");
    try {
      const back = await restoreBook(row.archive_id);
      setNotice(
        `《${back.title}》已经回到书架` +
          (back.progress_restored ? "，进度保持不变。" : "（进度没能写回，换个新一点的内核就好了。）"),
      );
      setError("");
      // 归档被消费掉了：重新列一遍
      await load();
      props.onLibraryChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId("");
    }
  }

  const body = (
    <section className="group">
      <h2>已归档书籍</h2>
      <p className="dim">
        限时书到期后会被打包收进归档目录 —— 文件没有被删除，只是换了个看不懂的名字藏起来。
        这里可以随时把它们找回来：解压、放回原处、进度照旧。
      </p>
      {dir ? <p className="dim archived-dir">归档目录：{dir}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="dim">还没有被封印的书。给一本书设「限时模式」，到期那天它就会来这里。</p>
      ) : (
        <ul className="archived-list">
          {rows.map((row) => (
            <li key={row.archive_id} className="archived-row">
              <div className="archived-main">
                <strong className="archived-title">{row.meta.title || row.archive_id}</strong>
                <span className="dim archived-meta">
                  {row.meta.author ? `${row.meta.author} · ` : ""}
                  封印于 {shortStamp(row.meta.sealed_at)}
                  {row.meta.due_at ? ` · 到期日 ${row.meta.due_at}` : ""} · {humanBytes(row.size_bytes)}
                </span>
                {/* 归档名看不懂是有意的：原文件名只在 zip 的元信息里 */}
                <span className="dim archived-path" title={row.zip_path}>
                  {row.meta.original_name || "（原件名未知）"} → {row.archive_id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void restore(row)}
                disabled={busyId !== ""}
                title="解压放回原处，并把阅读进度写回"
              >
                {busyId === row.archive_id ? "找回中…" : "找回"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  // 嵌入式：交给 Desk 排版；独立页：自带顶栏与「重新载入」
  if (props.embedded) {
    return body;
  }
  return (
    <main className="container">
      <header className="bar">
        <h1>已归档</h1>
        <span className="dim">被封印的书都躺在归档目录里</span>
        <button onClick={() => void load()}>重新载入</button>
      </header>
      {body}
    </main>
  );
}
