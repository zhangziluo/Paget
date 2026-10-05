/**
 * Shared formatting rules.
 *
 * Every function here mirrors a rule the Python core already uses, so the GUI and
 * `werd` never disagree about a number:
 *
 * * `percentageOf` is `library.position_percentage`,
 * * `formatHours` is `stats.format_hours`,
 * * `humanWords` is `library.human_words`,
 * * `progressBar` is `stats.progress_bar`,
 * * `metricText` is `cli._metric_text` (and its `_TIME_METRICS` list),
 * * `coreStamp` is the "local time, second precision" format `session.iso()` writes.
 */

/** Metrics that are measured in seconds, so they render as hours. */
const TIME_METRICS = new Set([
  "total_time",
  "night_time",
  "single_session",
  "weekend_time",
]);

/** The heatmap characters the core emits, coldest to brightest. */
export const HEATMAP_CHARS: string[] = ["·", "░", "▒", "▓", "█"];

/** The legend the core's CLI prints, paired with [`HEATMAP_CHARS`]. */
const HEAT_LABELS: Record<string, string> = {
  "·": "0",
  "░": "<20m",
  "▒": "<40m",
  "▓": "<1h",
  "█": "1h+",
};

/** Render a duration in seconds the way a reader thinks about it. */
export function duration(seconds: number): string {
  // 不到一分钟就报秒，一分钟以上报分钟，再往上带小时
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/**
 * Render a duration as ``X小时Y分钟`` -- the core's `stats.format_hours`.
 *
 * ``0分钟`` under a minute, ``45分钟`` under an hour, ``1小时`` on the hour and
 * ``6小时35分钟`` otherwise, so a one hour target reads ``1小时``.
 */
export function formatHours(seconds: number): string {
  // 负数兜成 0，并取整
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours && minutes) return `${hours}小时${minutes}分钟`;
  if (hours) return `${hours}小时`;
  return `${minutes}分钟`;
}

/** Render an ISO timestamp as ``2026-03-01 20:00``. */
export function shortStamp(value: string | null): string {
  // 内核存的是定长 ISO 串，截一下就够显示
  if (!value) return "还没读过";
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}

/**
 * Format a timestamp the way the core stores them: **local time, second precision**.
 *
 * Deliberately not `toISOString()`: that yields UTC with a `Z`, which the core
 * would parse as a timezone-aware datetime and then mix with its own naive
 * timestamps -- exactly the kind of mismatch that turns a "weekend reading"
 * comparison into a `TypeError`.
 */
export function coreStamp(value: Date): string {
  // 两位补零
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

/** The progress of *position*, using the very rule the core uses. */
export function percentageOf(position: number, totalLines: number): number {
  // 与 library.position_percentage 一字不差：(position+1)/total，最后一行正好 100%
  if (totalLines <= 0) return 0;
  const fraction = (Math.max(0, position) + 1) / totalLines;
  return Math.round(Math.min(fraction * 100, 100) * 10) / 10;
}

/** Render a word count the Chinese way (``5.7万``) -- the core's `library.human_words`. */
export function humanWords(count: number): string {
  const value = Math.trunc(count);
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

/** A compact text progress bar, the same rule as `stats.progress_bar`. */
export function progressBar(current: number, required: number, width = 14): string {
  // 分母至少为 1，避免除以 0
  const target = Math.max(1, Math.trunc(required));
  const done = Math.max(0, Math.trunc(current));
  const size = Math.max(1, Math.trunc(width));
  // 完成比例，最多 100%
  const ratio = Math.min(done, target) / target;
  const filled = Math.max(0, Math.min(size, Math.round(size * ratio)));
  return "█".repeat(filled) + "░".repeat(size - filled);
}

/** Render a metric value, as hours for the time based ones (`cli._metric_text`). */
export function metricText(metric: string, value: number): string {
  return TIME_METRICS.has(metric) ? formatHours(value) : String(value);
}

/** Turn a heatmap character into the label the legend uses. */
export function heatLabel(level: string): string {
  return HEAT_LABELS[level] ?? level;
}

/**
 * Render a file size the way a file manager does (``1.2 MB``).
 *
 * Only the "已归档" page needs this: an archive is a zip of one book, so plain
 * binary units (1 KB = 1024 B) are the least surprising thing to show.
 */
export function humanBytes(bytes: number): string {
  // 负数 / 小数都收成非负整数
  const value = Math.max(0, Math.trunc(bytes));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
