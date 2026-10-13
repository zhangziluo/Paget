import { useCallback, useEffect, useState } from "react";

import { statsReport } from "../lib/core";
import { HEATMAP_CHARS, duration } from "../lib/format";
import { BACK_KEY_LABEL } from "../lib/shortcuts";
import {
  bookShare,
  durationWords,
  goalPercent,
  goalSentence,
  heatPlainLabel,
  nightSentence,
  streakSentence,
  todayHeadline,
} from "../lib/statsText";
import type { HeatCell, StatsReport } from "../lib/types";

/** Heatmap rows are weekdays, Monday first (`date.weekday()` order). */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * The statistics page: the very report the core renders -- only this time it
 * is written on a page of the notebook instead of printed as a table.
 *
 * Nothing is recomputed here: `statsReport()` returns `stats.build_report`, the
 * same dict the core returns, so the totals, the streak, the heatmap and
 * the terminal can never disagree.  What this page adds is **wording** -- the
 * sentences live in `lib/statsText.ts` (pure functions, pinned in node), and they
 * are handed the core's own seconds.  Durations read as `1 小时 5 分` (the same
 * `format.duration()` the book menu uses), so the only thing that differs from the
 * terminal is how it is said.
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

  const refresh = () => void load();

  // 出错 / 还没拿到报告时也长在纸上：点进来不会先看见一页木头
  if (error || !report) {
    return (
      <main className="container stats-page">
        <article className="stats-sheet">
          <PageHead busy={busy} onRefresh={refresh} onBack={onBack} />
          {error ? (
            <p className="error">这一页翻不开：{error}</p>
          ) : (
            <p className="stats-note">正在翻页…</p>
          )}
        </article>
      </main>
    );
  }

  return (
    <main className="container stats-page">
      <StatsSheet report={report} busy={busy} onRefresh={refresh} onBack={onBack} />
    </main>
  );
}

/**
 * 一页账本：把一份 `StatsReport` 画成纸上的字。
 *
 * 抽成独立组件（数据由外面递进来）是为了能在 node 里把它整页渲染出来点数 ——
 * 页面自己那个 `Stats` 得等 `statsReport()` 回来，SSR 里等不到。
 */
export function StatsSheet(props: {
  report: StatsReport;
  busy?: boolean;
  onRefresh?: () => void;
  onBack?: () => void;
}) {
  const report = props.report;
  // 完成度只用来画那根描红的条（达没达标由内核的 `goal_met` 说了算）
  const goal = Math.min(goalPercent(report.today_seconds, report.daily_goal_seconds), 100);
  const night = nightSentence(report.night_seconds, report.total_seconds);

  return (
    <article className="stats-sheet">
      <PageHead
        stamp={report.generated_at.replace("T", " ")}
        busy={props.busy}
        onRefresh={props.onRefresh}
        onBack={props.onBack}
      />

      {/* 今天：进门先看这一个数 */}
      <section className="stats-today">
        <p className="stats-eyebrow">今天</p>
        <p className="stats-big">{todayHeadline(report.today_seconds)}</p>
        <p className="stats-say">
          {goalSentence(report.daily_goal_seconds, report.today_seconds, report.goal_met)}
        </p>
        {report.daily_goal_seconds > 0 ? (
          <p
            className="stats-goalbar"
            title={`今天 ${duration(report.today_seconds)} / 目标 ${duration(report.daily_goal_seconds)}`}
          >
            <span style={{ width: `${goal}%` }} />
          </p>
        ) : null}
      </section>

      {/* 这些天：本周 / 本月 / 一共 */}
      <section className="stats-block">
        <h3>这些天</h3>
        <ul className="stats-lines">
          <li>
            <span>这一周</span>
            <i className="stats-leader" />
            <b>{durationWords(report.week_seconds)}</b>
          </li>
          <li>
            <span>这个月</span>
            <i className="stats-leader" />
            <b>{durationWords(report.month_seconds)}</b>
          </li>
          <li>
            <span>从第一页到现在</span>
            <i className="stats-leader" />
            <b>{durationWords(report.total_seconds)}</b>
          </li>
        </ul>
      </section>
      {/* 坚持：连着几天 + 几件「读过多少」的小账 */}
      <section className="stats-block">
        <h3>坚持</h3>
        <p className="stats-say">
          {streakSentence(report.streak_days, report.streak_min_seconds, report.today_seconds)}
        </p>
        <ul className="stats-lines">
          <li>
            <span>一口气读得最久的一次</span>
            <i className="stats-leader" />
            <b>{durationWords(report.longest_session_seconds)}</b>
          </li>
          <li>
            <span>翻开过的书</span>
            <i className="stats-leader" />
            <b>{report.books_read} 本</b>
          </li>
          <li>
            <span>其中读完的</span>
            <i className="stats-leader" />
            <b>{report.finished_books} 本</b>
          </li>
          <li>
            <span>记下的生词</span>
            <i className="stats-leader" />
            <b>{report.vocab_count} 个</b>
          </li>
          <li>
            <span>查过的译文</span>
            <i className="stats-leader" />
            <b>{report.translations} 次</b>
          </li>
          <li>
            <span>攒到的勋章</span>
            <i className="stats-leader" />
            <b>
              {report.achievements.unlocked_count} / {report.achievements.total} 枚
            </b>
          </li>
        </ul>
        {/* 凌晨读过的（0~4 点）才有这一句；没读过整行不出现 */}
        {night ? <p className="stats-note">{night}</p> : null}
      </section>

      {/* 最近这些天：一格格手画的小方块 */}
      <section className="stats-block">
        <h3>最近 {report.heatmap.length} 天</h3>
        <div className="stats-days">
          {report.heatmap_grid.map((week, weekday) => (
            <div className="stats-days-row" key={WEEKDAY_LABELS[weekday]}>
              <span className="stats-days-label">{WEEKDAY_LABELS[weekday]}</span>
              {week.map((cell, column) => {
                // null = 窗口之外的那几天，占个位（列才对得齐，与内核的 heatmap_grid 一致）
                const level = cell ? HEATMAP_CHARS.indexOf(cell.level) : -1;
                return (
                  <span
                    key={column}
                    className={`stats-day lv${level}`}
                    title={cell ? dayTitle(cell) : ""}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p className="stats-days-legend">
          <span>一横排是一周，一竖列是同一个星期几：</span>
          {HEATMAP_CHARS.map((char) => (
            <span className="stats-days-legend-item" key={char}>
              <span className={`stats-day lv${HEATMAP_CHARS.indexOf(char)}`} />
              {heatPlainLabel(char)}
            </span>
          ))}
        </p>
      </section>

      {/* 每本书读了多久：手绘的占比条 + 时长 */}
      <section className="stats-block">
        <h3>每本书读了多久</h3>
        {report.books.length > 0 ? (
          <ul className="stats-books">
            {report.books.map((book) => (
              // 书 id 是内核的坐标，画在纸上没用 —— 悬停时才给（排查问题时对得上）
              <li key={book.id} title={`${book.id}｜占总时长的 ${bookShare(book.seconds, report.total_seconds)}%`}>
                <span className="stats-books-name">{book.title || book.id}</span>
                <span className="stats-books-bar">
                  <i style={{ width: `${bookShare(book.seconds, report.total_seconds)}%` }} />
                </span>
                <b>{duration(book.seconds)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="stats-note">还没有阅读记录 —— 翻开一本书，这一页就开始记了。</p>
        )}
      </section>

      <footer className="stats-foot">
        <span>这些数字都存在本机，只有一份 —— 界面上每一处读的都是它。</span>
      </footer>
    </article>
  );
}

/** 格子上的悬停提示：日期 + 那天读了多久（没读就说没读）。 */
function dayTitle(cell: HeatCell): string {
  return `${cell.date} · ${cell.seconds > 0 ? duration(cell.seconds) : "没读"}`;
}

/**
 * 页眉：标题 + 「记到几点」+ 两个按钮。
 *
 * 标题是**读书日记**（墙上那枚便利贴就写着「日记」），后面跟一枚小标签点明它是统计，
 * 省得按 `S` 进来的人以为自己走错了页。
 */
function PageHead(props: {
  stamp?: string;
  busy?: boolean;
  onRefresh?: () => void;
  onBack?: () => void;
}) {
  return (
    <header className="stats-head">
      <h1 className="stats-title">读书日记</h1>
      <span className="stats-tag" title="这一页就是统计：数字都来自内核">
        统计
      </span>
      {props.stamp ? <span className="stats-stamp">记到 {props.stamp}</span> : null}
      <div className="stats-tools">
        {props.onRefresh ? (
          <button onClick={props.onRefresh} disabled={props.busy}>
            {props.busy ? "刷新中…" : "刷新"}
          </button>
        ) : null}
        {props.onBack ? (
          <button
            className="ghost back"
            title={`返回书架（${BACK_KEY_LABEL}）`}
            onClick={props.onBack}
          >
            ← 返回书架
          </button>
        ) : null}
      </div>
    </header>
  );
}
