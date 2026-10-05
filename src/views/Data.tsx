import { useCallback, useEffect, useState } from "react";

import {
  clearLibrary,
  corePaths,
  exportData,
  importData,
  pruneLibrary,
} from "../lib/core";
import { formatHours } from "../lib/format";
import type {
  CorePaths,
  ExportResult,
  ImportDataResult,
  RemovalResult,
} from "../lib/types";

/** Which action is currently running (empty = idle), so only it is disabled. */
type Running = "" | "export" | "restore" | "maintenance";

/**
 * The data page: everything `werd data export|import` / `werd prune` /
 * `werd clear` do, grouped in one place (it lives behind the study's gear).
 *
 * Every action goes through the core, so the converted texts, the index and the
 * bundles are byte-for-byte what the terminal commands produce.  Paths are typed
 * rather than picked with a file dialog: exporting a bundle is a once-in-a-while
 * operation, and a typed path stays predictable.  Importing books, which *is*
 * frequent, moved to the shelf's "＋" button (see `Shelf.tsx`).
 */
export default function Data(props: {
  onLibraryChanged: () => void;
  embedded?: boolean;
}) {
  const [paths, setPaths] = useState<CorePaths | null>(null);
  // 两处路径输入：备份写到哪、从哪合并
  const [exportPath, setExportPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  // 各操作的最近一次结果
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [restored, setRestored] = useState<ImportDataResult | null>(null);
  const [maintenance, setMaintenance] = useState<RemovalResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<Running>("");
  // 「清空书库」是破坏性操作，需要二次确认。这里用页内确认条，而不是 window.confirm：
  // Tauri 的 WKWebView 没有实现 WKUIDelegate 的 confirm 面板，window.confirm() 不弹窗、
  // 恒返回 false，会让按钮看起来「按了没反应」（见下面「维护」分组的确认条）。
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await corePaths();
      setPaths(loaded);
      // 备份默认写进项目数据目录（内核的 data_dir，见 lib.rs 的 use_project_data_root）：
      // 打开这一页就能直接点「导出 / 导入备份」，不用先自己拼路径
      setExportPath(
        (current) => current || `${loaded.data_dir}/wreader-backup.json`,
      );
      setRestorePath(
        (current) => current || `${loaded.data_dir}/wreader-backup.json`,
      );
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Write a portable bundle of reading time / progress / achievements. */
  async function doExport() {
    // 同上：空路径给一句人话，而不是让按钮永远是灰的
    const path = exportPath.trim();
    if (!path) {
      setError("先填备份要写到哪个文件，例如项目文件夹里的 .wreader/wreader-backup.json");
      return;
    }
    setRunning("export");
    try {
      setExported(await exportData(path));
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning("");
    }
  }

  /** Merge a bundle back in (add-only). */
  async function doRestore() {
    const path = restorePath.trim();
    if (!path) {
      setError("先填要合并的备份文件路径");
      return;
    }
    setRunning("restore");
    try {
      setRestored(await importData(path));
      setError("");
      // 进度和成就都变了
      props.onLibraryChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning("");
    }
  }

  /** Drop index records whose text file is gone. */
  async function doPrune() {
    setRunning("maintenance");
    try {
      setMaintenance(await pruneLibrary());
      setError("");
      props.onLibraryChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning("");
    }
  }

  /** Empty the library (reading time and achievements survive on purpose). */
  async function doClear() {
    // 确认已在页内确认条里做过（window.confirm 在 Tauri 的 WKWebView 里恒为 false，
    // 用它当闸门会让这个按钮永远什么都不做）。这里不再关闭确认条：执行期间它显示
    // 「清空中…」，结束（成功或失败）后再收起。
    setRunning("maintenance");
    try {
      setMaintenance(await clearLibrary());
      setError("");
      props.onLibraryChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning("");
      setConfirmingClear(false);
    }
  }

  const busy = running !== "";

  // 页面正文：嵌入式时直接返回它，让 Desk 统一包裹（自带顶栏则见文末）
  const body = (
    <>
      {error ? <p className="error">{error}</p> : null}

      <section className="group">
        <h2>导出备份（werd data export）</h2>
        <div className="search">
          <input
            value={exportPath}
            onChange={(event) => setExportPath(event.currentTarget.value)}
            placeholder="写到哪个文件（默认：项目文件夹里的 .wreader/wreader-backup.json）"
          />
          <button onClick={() => void doExport()} disabled={busy}>
            {running === "export" ? "导出中…" : "导出"}
          </button>
        </div>
        {exported ? (
          <p className="notice">
            已写入 {exported.path}：{exported.books} 本书 · {exported.unlocked} 个成就 ·{" "}
            {formatHours(exported.seconds)}
          </p>
        ) : null}
      </section>

      <section className="group">
        <h2>导入备份（werd data import，只增不减）</h2>
        <div className="search">
          <input
            value={restorePath}
            onChange={(event) => setRestorePath(event.currentTarget.value)}
            placeholder="要合并的备份文件（默认同上）"
          />
          <button onClick={() => void doRestore()} disabled={busy}>
            {running === "restore" ? "合并中…" : "导入备份"}
          </button>
        </div>
        {restored ? (
          <p className="notice">
            已合并 {restored.path}：{restored.books} 本书 · 跳过 {restored.skipped} 本（本机没有的） ·
            {formatHours(restored.seconds)} · 累计 {restored.unlocked} 个成就
          </p>
        ) : null}
      </section>

      <section className="group">
        <h2>维护</h2>
        <div className="search">
          <button onClick={() => void doPrune()} disabled={busy}>
            清理失效书目（prune）
          </button>
          {confirmingClear ? (
            <>
              <span className="warn">
                清空后书目与转换后的正文会删除，阅读时长与成就保留。
              </span>
              <button
                className="danger"
                onClick={() => void doClear()}
                disabled={busy}
              >
                {running === "maintenance" ? "清空中…" : "确认清空"}
              </button>
              <button
                className="ghost"
                onClick={() => setConfirmingClear(false)}
                disabled={busy}
              >
                取消
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={() => setConfirmingClear(true)}
              disabled={busy}
            >
              清空书库（clear）
            </button>
          )}
        </div>
        {maintenance ? (
          <div className="report">
            <p className="notice">处理了 {maintenance.removed} 本</p>
            {maintenance.books.length > 0 ? (
              <ul>
                {maintenance.books.map((book) => (
                  <li key={book.id}>
                    {book.title || book.id} <span className="dim">{book.id}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 嵌入式（齿轮里）时，设置页已经有一份「数据位置」，这里不再重复 */}
      {paths && !props.embedded ? (
        <section className="group">
          <h2>数据位置</h2>
          <table className="table">
            <tbody>
              <tr>
                <td className="dim">数据目录</td>
                <td>{paths.data_dir}</td>
              </tr>
              <tr>
                <td className="dim">正文目录</td>
                <td>{paths.novels_dir}</td>
              </tr>
              <tr>
                <td className="dim">书目文件</td>
                <td>{paths.library_file}</td>
              </tr>
              <tr>
                <td className="dim">设置文件</td>
                <td>{paths.settings_file}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );

  // 嵌入式：交给 Desk 排版；独立页：自带顶栏与「刷新路径」
  if (props.embedded) {
    return body;
  }
  return (
    <main className="container">
      <header className="bar">
        <h1>数据</h1>
        <span className="dim">全部经由内核，与终端命令同一份实现</span>
        <button className="ghost" onClick={() => void load()}>
          刷新路径
        </button>
      </header>
      {body}
    </main>
  );
}
