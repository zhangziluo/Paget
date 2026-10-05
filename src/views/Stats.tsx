import { useCallback, useEffect, useState } from "react";

import { statsReport } from "../lib/core";
import { HEATMAP_CHARS, formatHours, heatLabel } from "../lib/format";
import type { StatsReport } from "../lib/types";

/** Heatmap rows are weekdays, Monday first (`date.weekday()` order). */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * The statistics page: the very report `werd stats` renders.
 *
 * Nothing is recomputed here -- `statsReport()` returns `stats.build_report`, the
 * same dict `werd stats --json` prints, so the totals, the streak, the heatmap and
 * the terminal can never disagree.
 */
export default function Stats({ onBack }: { onBack?: () => void } = {}) {
  const [report, setReport] = useState<StatsReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await statsReport());
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 从书房挂件展开时，右上角提供回到书架的出口（独立使用时没有）
  const back = onBack ? (
    <button className="ghost back" onClick={onBack}>
      ← 返回书架
    </button>
  ) : null;

  if (error) {
    return (
      <main className="container">
        <header className="bar">
          <h1>统计</h1>
          {back}
        </header>
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!report) {
    return (
      <main className="container">
        <header className="bar">
          <h1>统计</h1>
          {back}
        </header>
        <p className="dim">载入统计…</p>
      </main>
    );
  }

  // 每日目标完成度：用整除算百分比，与 CLI 一致
  const goalPercent =
    report.daily_goal_seconds > 0
      ? Math.floor((report.today_seconds * 100) / report.daily_goal_seconds)
      : 0;

  return (
    <main className="container">
      <header className="bar">
        <h1>统计</h1>
        <span className="dim">截至 {report.generated_at.replace("T", " ")}</span>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? "刷新中…" : "刷新"}
        </button>
        {back}
      </header>

      <section className="cards">
        <div className="card">
          <span className="dim">总阅读时长</span>
          <strong>{report.total}</strong>
        </div>
        <div className="card">
          <span className="dim">今日</span>
          <strong>{formatHours(report.today_seconds)}</strong>
        </div>
        <div className="card">
          <span className="dim">本周</span>
          <strong>{formatHours(report.week_seconds)}</strong>
        </div>
        <div className="card">
          <span className="dim">本月</span>
          <strong>{formatHours(report.month_seconds)}</strong>
        </div>
        <div className="card">
          <span className="dim">连续</span>
          <strong>{report.streak_days} 天</strong>
          <span className="dim">每天 ≥{Math.floor(report.streak_min_seconds / 60)} 分钟</span>
        </div>
        <div className="card">
          <span className="dim">读完</span>
          <strong>{report.finished_books} 本</strong>
          <span className="dim">共读过 {report.books_read} 本</span>
        </div>
        <div className="card">
          <span className="dim">成就</span>
          <strong>
            {report.achievements.unlocked_count}/{report.achievements.total}
          </strong>
        </div>
        <div className="card">
          <span className="dim">最长一次</span>
          <strong>{formatHours(report.longest_session_seconds)}</strong>
        </div>
      </section>

      {report.daily_goal_seconds > 0 ? (
        <section className="goal">
          <div className="row">
            <span>每日目标 {formatHours(report.daily_goal_seconds)}</span>
            <span className="dim">
              今日 {formatHours(report.today_seconds)} · {goalPercent}%
              {report.goal_met ? " ✓" : ""}
            </span>
          </div>
          <progress value={Math.min(goalPercent, 100)} max={100} />
        </section>
      ) : null}

      <section>
        <h2>最近 {report.heatmap.length} 天</h2>
        <div className="heatmap">
          {report.heatmap_grid.map((week, weekday) => (
            <div className="heat-row" key={WEEKDAY_LABELS[weekday]}>
              <span className="dim heat-label">{WEEKDAY_LABELS[weekday]}</span>
              {week.map((cell, column) => {
                // null = 窗口之外的那几天，画个空白占位
                const level = cell ? HEATMAP_CHARS.indexOf(cell.level) : -1;
                return (
                  <span
                    key={column}
                    className={`heat heat-${level}`}
                    title={cell ? `${cell.date} · ${formatHours(cell.seconds)}` : ""}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="dim heat-legend">
          <span>强度：</span>
          {HEATMAP_CHARS.map((char) => (
            <span key={char} className="heat-legend-item">
              <span className={`heat heat-${HEATMAP_CHARS.indexOf(char)}`} />
              {heatLabel(char)}
            </span>
          ))}
        </p>
      </section>

      <section>
        <h2>本书累计</h2>
        {report.books.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>书名</th>
                <th>id</th>
                <th className="right">时长</th>
              </tr>
            </thead>
            <tbody>
              {report.books.map((book) => (
                <tr key={book.id}>
                  <td>{book.title || book.id}</td>
                  <td className="dim">{book.id}</td>
                  <td className="right">{formatHours(book.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">还没有阅读记录。</p>
        )}
      </section>
    </main>
  );
}
