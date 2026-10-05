import { useCallback, useEffect, useState } from "react";

import { achievementsList, recordEvent } from "../lib/core";
import { metricText } from "../lib/format";
import type { Achievement } from "../lib/types";

/** One category's worth of in-progress achievements, in the core's own order. */
type Group = {
  category: string;
  items: Achievement[];
};

/**
 * The achievements page: what `werd achievements` prints.
 *
 * One deliberate side effect: opening the page records the `achievements_view`
 * event, exactly like the CLI does.  That is what drives the "成就猎人" counter,
 * and it is idempotent, so opening the page twice is harmless.
 */
export default function Achievements({ onBack }: { onBack?: () => void } = {}) {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 这次打开页面新解锁的（多半是别的机器/终端刚攒够的）
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

  return (
    <main className="container">
      <header className="bar">
        <h1>成就</h1>
        <span className="dim">
          已解锁 {done.length}/{rows.length}
        </span>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? "刷新中…" : "刷新"}
        </button>
        {/* 从玻璃徽章盒展开时，右上角提供回到书架的出口 */}
        {onBack ? (
          <button className="ghost back" onClick={onBack}>
            ← 返回书架
          </button>
        ) : null}
      </header>

      {error ? <p className="error">{error}</p> : null}
      {justUnlocked.length > 0 ? (
        <p className="notice">🏆 本次新解锁：{justUnlocked.join("、")}</p>
      ) : null}

      {done.length > 0 ? (
        <ul className="badges">
          {done.map((row) => (
            <li key={row.id} className="badge done">
              {/* 已解锁：实体奖牌 */}
              <span className="medal" aria-hidden="true">
                🏅
              </span>
              <strong>{row.name}</strong>
              <span className="dim">{row.category}</span>
              <p className="dim">{row.desc}</p>
              {row.unlocked_at ? <p className="dim">解锁于 {row.unlocked_at}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">还没有解锁任何成就 —— 读起来就有了。</p>
      )}

      {groups.length > 0 ? <h2>进行中</h2> : null}
      {groups.map((group) => (
        <section key={group.category} className="group">
          <h3>{group.category}</h3>
          <ul className="badges">
            {group.items.map((row) => {
              // 进度比例仍由内核的 current / required 算出，只是换成 CSS 画
              const percent =
                row.required > 0
                  ? Math.min(100, Math.round((row.current / row.required) * 100))
                  : 0;
              // 隐藏成就：解锁前只说"有这么个东西"，不剧透条件
              if (row.secret) {
                return (
                  <li key={row.id} className="badge locked">
                    <span className="medal" aria-hidden="true">
                      ❓
                    </span>
                    <p className="dim">隐藏成就（解锁后揭晓）</p>
                  </li>
                );
              }
              return (
                <li key={row.id} className="badge locked">
                  {/* 未解锁：暗色轮廓奖牌 */}
                  <span className="medal" aria-hidden="true">
                    🔒
                  </span>
                  <strong>{row.name}</strong>
                  <span className="dim">
                    {metricText(row.metric, row.current)}/
                    {metricText(row.metric, row.required)}
                  </span>
                  <div className="badge-bar">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <p className="dim">{row.desc}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
