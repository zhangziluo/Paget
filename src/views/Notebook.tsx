import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  annotationLineLabel,
  annotationStyleLabel,
  annotationTint,
  loadAnnotations,
  notebookGroups,
  notebookSummary,
  toMarkdown,
  toText,
  type Annotation,
} from "../lib/annotations";
import { saveTextFile } from "../lib/core";

/** 导出文件名里的日期（本地时间，`YYYY-MM-DD`；不用 UTC，免得晚上导出成前一天）。 */
function todayStamp(now = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 一条划线是哪天划的（`YYYY-MM-DD`；坏日期就回空串，不显示）。 */
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : todayStamp(date);
}

/**
 * 笔记本：把**所有**书上的划线 + 批注按书收进一本，手绘风的一页纸。
 *
 * 数据全在 `lib/annotations.ts`（本机 `gui_settings` 的 `reader.annotations.v1`）——
 * 阅读页划线时写进去，这里只管读与分组展示，**不再问内核要任何东西**：
 * 原文快照就存在每条划线里，所以删掉的书、转换过格式的书也还读得到当时划的句子。
 *
 * 两个导出（md / txt）都走系统「另存为」（Rust 的 `save_text_file`），
 * 用户取消就什么都不写；导出成功在页顶回一句落地路径。
 */
export default function Notebook({ onBack }: { onBack?: () => void } = {}) {
  const [list, setList] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState<"md" | "txt" | null>(null);

  useEffect(() => {
    let alive = true;
    loadAnnotations()
      .then((items) => {
        if (!alive) return;
        setList(items);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Esc 回书架（与统计 / 勋章页同一个手势；正在输入时不抢）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !onBack) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const groups = useMemo(() => notebookGroups(list), [list]);
  const summary = useMemo(() => notebookSummary(list), [list]);

  /** 导出：弹系统「另存为」，成功 / 取消 / 失败都在这页顶上回一句。 */
  const exportAs = useCallback(
    async (kind: "md" | "txt") => {
      if (exporting || !list.length) return;
      setExporting(kind);
      setNotice("");
      try {
        const name = `笔记本-${todayStamp()}.${kind}`;
        const content = kind === "md" ? toMarkdown(list) : toText(list);
        const path = await saveTextFile(name, content);
        setNotice(path ? `已导出到 ${path}` : "没有导出（已取消）");
      } catch (err) {
        setNotice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setExporting(null);
      }
    },
    [exporting, list],
  );

  return (
    <main className="container notebook-page">
      <article className="notebook-sheet">
        <header className="notebook-head">
          <h1 className="notebook-title">笔记本</h1>
          <span className="notebook-tag" title="阅读页划过的线与写下的批注都收在这里">
            划线
          </span>
          <span className="notebook-stamp">
            {summary.books} 本 · {summary.marks} 条划线 · {summary.notes} 条批注
          </span>
          <div className="notebook-tools">
            <button
              type="button"
              onClick={() => void exportAs("md")}
              disabled={!list.length || exporting !== null}
              title="导出成 Markdown（系统「另存为」）"
            >
              {exporting === "md" ? "导出中…" : "导出 md"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void exportAs("txt")}
              disabled={!list.length || exporting !== null}
              title="导出成纯文本（系统「另存为」）"
            >
              {exporting === "txt" ? "导出中…" : "导出 txt"}
            </button>
            {onBack ? (
              <button
                type="button"
                className="ghost back"
                title="返回书架（Esc）"
                onClick={onBack}
              >
                ← 返回书架
              </button>
            ) : null}
          </div>
        </header>

        {notice ? (
          <p className="notebook-notice" role="status">
            {notice}
          </p>
        ) : null}

        {loading ? (
          <p className="dim">正在翻开笔记本…</p>
        ) : groups.length === 0 ? (
          <p className="notebook-empty">
            还没有划线。在阅读页选中一段文字，下面会浮出直线 / 波浪线 / 删除线三支笔，
            挑一个就好；点划过的字可以写批注，写下的都会收进这一页。
          </p>
        ) : (
          groups.map((group) => (
            <section className="notebook-book" key={group.bookId}>
              <h2 className="notebook-book-title">
                <span className="notebook-book-pin" aria-hidden="true" />
                《{group.title}》
              </h2>
              <p className="notebook-book-count">{group.items.length} 条划线</p>
              <ul className="notebook-entries">
                {group.items.map((ann) => (
                  <li className="notebook-entry" key={ann.id}>
                    <div className="notebook-entry-meta">
                      <span
                        className={`notebook-style notebook-style-${ann.style}`}
                        style={{ "--annot-color": ann.color } as CSSProperties}
                      >
                        {annotationStyleLabel(ann.style)}
                      </span>
                      <span className="notebook-line">{annotationLineLabel(ann)}</span>
                      <span className="notebook-date">{dateLabel(ann.createdAt)}</span>
                    </div>
                    <p
                      className="notebook-quote"
                      style={
                        {
                          "--annot-color": ann.color,
                          "--annot-tint": annotationTint(ann.color, 0.16),
                        } as CSSProperties
                      }
                    >
                      {ann.quote}
                    </p>
                    {ann.note.trim() ? (
                      <p className="notebook-note">
                        <span className="notebook-note-tag">批注</span>
                        {ann.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </article>
    </main>
  );
}
