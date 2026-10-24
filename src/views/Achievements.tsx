import { useCallback, useEffect, useState } from "react";

import { achievementsList, recordEvent } from "../lib/core";
import { metricText, shortStamp } from "../lib/format";
import { BACK_KEY_LABEL } from "../lib/shortcuts";
import type { Achievement } from "../lib/types";

/** One category's worth of in-progress achievements, in the core's own order. */
type Group = {
  category: string;
  items: Achievement[];
};

/**
 * 铁十字的轮廓（`viewBox` 100×100）—— 四臂向外张开、内四个角是**内凹**的小弧。
 *
 * 十二个"臂尖 / 腋下"的折点加四个 `Q`：控制点就是原来那个尖角，两端沿相邻的边
 * 各缩回 45%，于是弧线朝章心凹进去 —— 那是铁十字最认得出的一处细节。
 * 臂尖落在 10 / 90（给凹槽外圈留位置），尖宽 36、腋下宽 16。
 */
const CROSS_PATH =
  "M32 10 L68 10 L62.5 27.6 Q58 42 72.4 37.5 L90 32 L90 68 L72.4 62.5 Q58 58 62.5 72.4 " +
  "L68 90 L32 90 L37.5 72.4 Q42 58 27.6 62.5 L10 68 L10 32 L27.6 37.5 Q42 42 37.5 27.6 Z";

/** 把十字放大一点（外框 / 凹槽）：绕章心缩放，别让形状跑偏。 */
function scaled(pathScale: number): string {
  return `translate(50 50) scale(${pathScale}) translate(-50 -50)`;
}

/** 章心的花纹：`gold` 已授予 / `iron` 未授予 / `secret` 隐藏成就。 */
type MedalState = "gold" | "iron" | "secret";

/**
 * 名字里那枚符号（内核的 `name` 就长这样：`📖 开卷有益`）。
 *
 * 带 ZWJ 的组合（用户自己往定义里加的那种）与变体选择符（`🗄️`）都得连着一起吃，
 * 只留符号本身。
 */
const DEVICE_RE =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)\s*/u;

/** 名字里那枚符号 —— 画到章心上去。 */
export function deviceOf(name: string): string {
  return name.match(DEVICE_RE)?.[1] ?? "";
}

/** 名字本身（去掉符号 —— 它已经在章心上了，别再写第二遍）。 */
export function plainName(name: string): string {
  return name.replace(DEVICE_RE, "");
}

/**
 * The achievements page: the core's achievement report -- staged as a medal case.
 *
 * A dark lacquered board, one gilded **Iron Cross** per achievement.  Nothing about
 * the data changes: `achievementsList()` is `achievements.list_achievements`, so the
 * rows, the progress numbers and the unlock stamps are the core's own; the page only
 * decides how they are displayed (gold or bare iron, and the core's own emoji struck
 * into the middle of each cross).
 *
 * One deliberate side effect (unchanged): opening the page records the
 * `achievements_view` event, exactly like the CLI does.  That is what drives the
 * "成就猎人" counter, and it is idempotent, so opening the page twice is harmless.
 */
export default function Achievements({ onBack }: { onBack?: () => void } = {}) {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [error, setError] = useState("");
  // 一开始就算"在忙"：第一眼是「正在打开陈列柜」，而不是一句"橱窗还是空的"
  const [busy, setBusy] = useState(true);
  // 这次打开页面新解锁的（多半是别的机器 / 终端刚攒够的）
  const [justUnlocked, setJustUnlocked] = useState<string[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      // 先补记一次"翻开了成就页"（幂等），再读权威列表
      const { unlocked } = await recordEvent("achievements_view");
      setRows(await achievementsList());
      setJustUnlocked(unlocked.map((item) => item.name));
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

  return (
    <main className="container ach-page">
      <AchievementsBoard
        rows={rows}
        busy={busy}
        error={error}
        justUnlocked={justUnlocked}
        onRefresh={() => void load()}
        onBack={onBack}
      />
    </main>
  );
}

/**
 * 一整块陈列板：把内核回来的那些行画成一墙金徽章。
 *
 * 与统计页同一个讲究：数据由外面递进来（`Achievements` 得等 `achievementsList()`，
 * SSR 里等不到），所以这一层能在 node 里整块渲染出来点数。
 */
export function AchievementsBoard(props: {
  rows: Achievement[];
  busy?: boolean;
  error?: string;
  justUnlocked?: string[];
  onRefresh?: () => void;
  onBack?: () => void;
}) {
  const rows = props.rows;
  const done = rows.filter((row) => row.unlocked);
  const pending = rows.filter((row) => !row.unlocked);
  // 未解锁的按分类分组：内核已经按 CATEGORY_ORDER 排好，顺序照搬即可
  const groups: Group[] = [];
  for (const row of pending) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) {
      last.items.push(row);
    } else {
      groups.push({ category: row.category, items: [row] });
    }
  }

  const tally = rows.length > 0 ? Math.round((done.length / rows.length) * 100) : 0;
  const loading = Boolean(props.busy) && rows.length === 0;
  const empty = !loading && !props.error && rows.length === 0;

  return (
    <section className="ach-case">
      {/* 金属渐变只定义一份，整墙徽章都引它 */}
      <MedalDefs />

      <header className="ach-head">
        <h1 className="ach-title">勋章墙</h1>
        <span className="ach-tag" title="这一页就是成就：数字都来自内核的成就表">
          成就
        </span>
        {/* 还没数出来时这一格空着（下面「正在打开陈列柜…」已经说了状态），别报 0 / 0 */}
        {rows.length > 0 ? (
          <p className="ach-tally">
            <b>{done.length}</b>
            <span className="ach-tally-of">/ {rows.length} 枚已授予</span>
          </p>
        ) : null}
        <div className="ach-tools">
          {props.onRefresh ? (
            <button onClick={props.onRefresh} disabled={props.busy}>
              {props.busy ? "刷新中…" : "刷新"}
            </button>
          ) : null}
          {props.onBack ? (
            <button
              className="ghost"
              title={`返回书架（${BACK_KEY_LABEL}）`}
              onClick={props.onBack}
            >
              ← 返回书架
            </button>
          ) : null}
        </div>
      </header>

      <div className="ach-gauge" aria-hidden="true">
        <span style={{ width: `${tally}%` }} />
      </div>

      {props.error ? <p className="error">陈列柜打不开：{props.error}</p> : null}
      {props.justUnlocked && props.justUnlocked.length > 0 ? (
        <p className="notice">🏆 本次新解锁：{props.justUnlocked.join("、")}</p>
      ) : null}

      {loading ? <p className="ach-note">正在打开陈列柜…</p> : null}
      {empty ? <p className="ach-note">橱窗还是空的 —— 读起来就有徽章了。</p> : null}

      {done.length > 0 ? (
        <section className="ach-block">
          <h2 className="ach-plate-title">已授予</h2>
          <ul className="ach-wall">
            {done.map((row) => (
              <li className="ach-badge is-gold" key={row.id}>
                <Medal state="gold" device={deviceOf(row.name)} />
                <strong className="ach-name">{plainName(row.name)}</strong>
                <span className="ach-meta">{row.category}</span>
                <p className="ach-desc">{row.desc}</p>
                {row.unlocked_at ? (
                  <span className="ach-date">授予于 {shortStamp(row.unlocked_at)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section className="ach-block">
          <h2 className="ach-plate-title">待授予</h2>
          {groups.map((group) => (
            <div key={group.category}>
              <h3 className="ach-cat">{group.category}</h3>
              <ul className="ach-wall">
                {group.items.map((row) => {
                  // 隐藏成就：徽章还没上金，连它是什么样子都得先藏着
                  if (row.secret) {
                    return (
                      <li className="ach-badge is-locked" key={row.id}>
                        <Medal state="secret" device="?" />
                        <strong className="ach-name">隐藏成就</strong>
                        <p className="ach-desc">解锁后揭晓 —— 它就在这条路上。</p>
                      </li>
                    );
                  }
                  // 进度比例仍由内核的 current / required 算出，只是换成金条
                  const percent =
                    row.required > 0
                      ? Math.min(100, Math.round((row.current / row.required) * 100))
                      : 0;
                  return (
                    <li className="ach-badge is-locked" key={row.id}>
                      <Medal state="iron" device={deviceOf(row.name)} />
                      <strong className="ach-name">{plainName(row.name)}</strong>
                      <span className="ach-progress">
                        <span className="ach-progress-bar">
                          <span style={{ width: `${percent}%` }} />
                        </span>
                        {metricText(row.metric, row.current)}/{metricText(row.metric, row.required)}
                      </span>
                      <p className="ach-desc">{row.desc}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <footer className="ach-foot">
        这些徽章都由内核算出来，数字只有一份。
      </footer>
    </section>
  );
}

/**
 * 一枚铁十字：凹槽里嵌着章体，章心上再敲一枚花纹（成就自己那枚符号）。
 *
 * 两层 `<svg>` 是故意的 —— 凹槽不能跟着章体一起发光（那就不是"凹进去"了），
 * 所以暖光只加在章体那一层上。
 */
function Medal({ state, device }: { state: MedalState; device: string }) {
  return (
    <span className={`ach-medal is-${state}`} aria-hidden="true">
      <svg className="ach-medal-socket" viewBox="0 0 100 100">
        <path d={CROSS_PATH} transform={scaled(1.17)} />
      </svg>
      <svg className="ach-medal-body" viewBox="0 0 100 100">
        {/* 外框比章面大一圈，做出"厚边"：真的铁十字是银框包铁心，这里是金框包金面 */}
        <path className="ach-cross-frame" d={CROSS_PATH} transform={scaled(1.07)} />
        <path className="ach-cross-face" d={CROSS_PATH} />
        <path className="ach-cross-bevel" d={CROSS_PATH} />
        <circle className="ach-cross-ring" cx="50" cy="50" r="21" />
        <circle className="ach-cross-core" cx="50" cy="50" r="19" />
      </svg>
      <span className="ach-medal-device">{device}</span>
    </span>
  );
}

/** 镀金 / 生铁两套金属渐变，外加斜面与凹槽 —— 一份给整墙用。 */
function MedalDefs() {
  return (
    <svg className="ach-defs" aria-hidden="true" focusable="false">
      <defs>
        {/* 镀金的章面：光从左上斜着打下来 */}
        <linearGradient id="ach-gold-face" x1="0.08" y1="0" x2="0.78" y2="1">
          <stop offset="0" stopColor="#fff8dd" />
          <stop offset="0.18" stopColor="#f7dc8a" />
          <stop offset="0.46" stopColor="#e2b63a" />
          <stop offset="0.74" stopColor="#bd8b12" />
          <stop offset="1" stopColor="#7d5806" />
        </linearGradient>
        {/* 外框再暗一档，章面才浮得起来 */}
        <linearGradient id="ach-gold-frame" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#ffeeb4" />
          <stop offset="0.34" stopColor="#d1a02a" />
          <stop offset="0.7" stopColor="#8f6510" />
          <stop offset="1" stopColor="#5d3f06" />
        </linearGradient>
        <radialGradient id="ach-gold-core" cx="0.36" cy="0.3" r="0.88">
          <stop offset="0" stopColor="#fffbe8" />
          <stop offset="0.4" stopColor="#f0c95f" />
          <stop offset="0.76" stopColor="#c1901c" />
          <stop offset="1" stopColor="#8a6208" />
        </radialGradient>

        {/* 没上金的生铁：冷灰蓝，哑光，纹章只是一道暗影 */}
        <linearGradient id="ach-iron-face" x1="0.08" y1="0" x2="0.78" y2="1">
          <stop offset="0" stopColor="#aab2ba" />
          <stop offset="0.24" stopColor="#828a93" />
          <stop offset="0.55" stopColor="#565d66" />
          <stop offset="0.82" stopColor="#373d44" />
          <stop offset="1" stopColor="#22272c" />
        </linearGradient>
        <linearGradient id="ach-iron-frame" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#c2c9d0" />
          <stop offset="0.34" stopColor="#6f7680" />
          <stop offset="0.7" stopColor="#41474e" />
          <stop offset="1" stopColor="#1f2328" />
        </linearGradient>
        <radialGradient id="ach-iron-core" cx="0.36" cy="0.3" r="0.88">
          <stop offset="0" stopColor="#9aa2aa" />
          <stop offset="0.45" stopColor="#5f666e" />
          <stop offset="1" stopColor="#282e34" />
        </radialGradient>

        {/* 斜面：左上受光、右下背光（两档金属共用一份） */}
        <linearGradient id="ach-bevel" x1="0" y1="0" x2="0.75" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.36" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="0.62" stopColor="#000000" stopOpacity="0.06" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.42" />
        </linearGradient>

        {/* 凹槽的壁：上沿被板子压出暗影、下沿接住一点光 */}
        <linearGradient id="ach-socket" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity="0.8" />
          <stop offset="0.5" stopColor="#000000" stopOpacity="0.42" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.12" />
        </linearGradient>
      </defs>
    </svg>
  );
}
