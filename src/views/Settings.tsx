import { useCallback, useEffect, useState } from "react";

import { configGet, configSet, corePaths } from "../lib/core";
import type { CorePaths } from "../lib/types";

/** One setting row: its dotted path, its short key and its current value. */
type Row = {
  path: string;
  key: string;
  value: unknown;
};

/** One settings.toml section and the rows under it. */
type Section = {
  name: string;
  rows: Row[];
};

/** How a value is edited (decided by the type of the current effective value). */
type Kind = "boolean" | "number" | "text";

/** The editor kind for one value; `null` (unset) is edited as text. */
function kindOf(value: unknown): Kind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

/** Render a value into the editable draft string. */
function toDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * A starting min/max/step for the slider, so the current value sits comfortably
 * inside the draggable range.
 *
 * Purely presentational: the exact value is still typed into the number box next
 * to it, and whatever the core receives through `config_set` is unchanged.
 */
function sliderRange(raw: string): { min: number; max: number; step: number } {
  const value = Number(raw);
  // 空串 / 非数字：给一个通用区间
  if (raw.trim() === "" || Number.isNaN(value)) {
    return { min: 0, max: 100, step: 1 };
  }
  // 0–1 之间多半是比例，用更细的步长才好拖
  if (value >= 0 && value <= 1) {
    return { min: 0, max: 1, step: 0.05 };
  }
  const step = Number.isInteger(value) ? 1 : 0.1;
  const max = value <= 100 ? 100 : Math.ceil(Math.abs(value) * 2);
  return { min: 0, max, step };
}

/**
 * The settings page: `werd config` for the GUI.
 *
 * It reads and writes the core's own ``settings.toml`` through `config_get` /
 * `config_set`, so a value changed here is the same value `werd config` shows --
 * the GUI keeps **no** copy of these, unlike its own `gui_settings` table.
 */
export default function Settings({ embedded = false }: { embedded?: boolean } = {}) {
  const [sections, setSections] = useState<Section[]>([]);
  const [paths, setPaths] = useState<CorePaths | null>(null);
  // 草稿：点号路径 -> 编辑框里的字符串
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const config = await configGet();
      // 按点号路径的前半段分组，顺序沿用内核给的就是 schema 的顺序
      const groups: Section[] = [];
      const nextDraft: Record<string, string> = {};
      for (const path of config.paths) {
        const dot = path.indexOf(".");
        const name = dot > 0 ? path.slice(0, dot) : "其它";
        const key = dot > 0 ? path.slice(dot + 1) : path;
        const value = config.values[path];
        // 同一个 section 连续出现就接在同一组后面
        const last = groups[groups.length - 1];
        const row: Row = { path, key, value };
        if (last && last.name === name) last.rows.push(row);
        else groups.push({ name, rows: [row] });
        nextDraft[path] = toDraft(value);
      }
      setSections(groups);
      setDraft(nextDraft);
      // 数据文件的位置一并显示（内核的 `paths`）
      setPaths(await corePaths());
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

  /** Coerce one draft string to the value the core expects and save it. */
  async function save(row: Row) {
    const raw = draft[row.path] ?? "";
    const kind = kindOf(row.value);
    let value: unknown;
    if (kind === "boolean") {
      value = raw === "true";
    } else if (kind === "number") {
      const parsed = Number(raw);
      // 空串 / 非数字直接挡在本地，别让内核回一条难懂的类型错误
      if (raw.trim() === "" || Number.isNaN(parsed)) {
        setError(`${row.path} 需要一个数字`);
        return;
      }
      value = parsed;
    } else {
      value = raw;
    }
    try {
      const result = await configSet(row.path, value);
      setNotice(`${result.path} = ${String(result.value)}（已保存）`);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  // 页面正文：嵌入式时直接返回它，让 Desk 统一包裹（自带顶栏则见文末）
  const body = (
    <>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      {paths ? (
        <section className="paths">
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

      {sections.map((section) => (
        <section key={section.name} className="group wood-card">
          <h2>{section.name}</h2>
          <div className="settings">
            {section.rows.map((row) => {
              const kind = kindOf(row.value);
              // 滑块只借用这个范围来拖动；精确值仍由旁边的数字框负责
              const range = sliderRange(draft[row.path] ?? "");
              return (
                <div className="setting-row" key={row.path}>
                  <label className="setting-key" htmlFor={`setting-${row.path}`}>
                    {row.key}
                  </label>
                  {kind === "boolean" ? (
                    <label className="switch">
                      <input
                        id={`setting-${row.path}`}
                        type="checkbox"
                        className="switch-input"
                        checked={draft[row.path] === "true"}
                        onChange={(event) => {
                          // 勾选即保存：布尔值没有"编辑中"的中间态
                          const next = event.currentTarget.checked ? "true" : "false";
                          setDraft((current) => ({ ...current, [row.path]: next }));
                          void save({ ...row, value: next === "true" });
                        }}
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-knob" />
                      </span>
                    </label>
                  ) : kind === "number" ? (
                    <>
                      <input
                        type="range"
                        className="slider"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={draft[row.path] ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.path]: event.currentTarget.value,
                          }))
                        }
                      />
                      <input
                        id={`setting-${row.path}`}
                        type="number"
                        className="slider-value"
                        step="any"
                        value={draft[row.path] ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.path]: event.currentTarget.value,
                          }))
                        }
                      />
                    </>
                  ) : (
                    <input
                      id={`setting-${row.path}`}
                      type="text"
                      className="text-input"
                      value={draft[row.path] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.path]: event.currentTarget.value,
                        }))
                      }
                    />
                  )}
                  <span className="dim setting-path">{row.path}</span>
                  {kind === "boolean" ? null : (
                    <button className="ghost" onClick={() => void save(row)}>
                      保存
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {sections.length === 0 && !busy ? (
        <p className="dim">读不到设置 —— 检查内核是否可用。</p>
      ) : null}
    </>
  );

  // 嵌入式：交给 Desk 排版；独立页：自带顶栏与「重新载入」
  if (embedded) {
    return body;
  }
  return (
    <main className="container">
      <header className="bar">
        <h1>设置</h1>
        <span className="dim">写入内核的 settings.toml</span>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? "刷新中…" : "重新载入"}
        </button>
      </header>
      {body}
    </main>
  );
}
