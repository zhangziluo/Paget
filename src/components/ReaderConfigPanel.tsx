/**
 * 阅读页顶栏那颗「阅读设置」点开的面板：内核 `reader.*` 那一整节。
 *
 * 2026-10-11 用户要求「与阅读相关的设置项，全部移动到阅读页，不需要从『调一调』设置处调整」——
 * 所以这一节不再出现在「调一调」里。谁归谁管只写在 `lib/readerConfig.ts` 那一处，
 * 两个页面都从它取，免得「搬了一半、剩下的一半没搬」。
 *
 * 读写与「调一调」一模一样：`config_get` / `config_set` 直接打在书库的 `settings.toml` 上，
 * 界面不留副本；每存一笔叫一声 `onSaved`，自动翻页因此能**当场**按新节奏走，
 * 不用关掉书再打开。
 */
import { useCallback, useEffect, useState } from "react";

import { CoreItem, kindOf, toDraft, type Row } from "./CoreSetting";
import { configGet, configSet } from "../lib/core";
import { partitionSettings, readerPanelLead, readerSections } from "../lib/readerConfig";
import { plainValue, settingWords } from "../lib/settingsText";

export default function ReaderConfigPanel(props: {
  /** 存好一项之后叫一声（参数是那一项的点号路径；自动翻页拿它立刻重读设置） */
  onSaved?: (path: string) => void;
}) {
  // 生效值、路径（内核 schema 顺序）与草稿：与「调一调」同一套三件
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [paths, setPaths] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const config = await configGet();
      const nextDraft: Record<string, string> = {};
      for (const path of config.paths) nextDraft[path] = toDraft(config.values[path]);
      setValues(config.values);
      setPaths(config.paths);
      setDraft(nextDraft);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // 打开面板才挂载，所以每开一次就是读一次（别处改过的值也跟着更新）
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 把草稿串变成内核认的值并存下去。
   *
   * *raw* 由调用方递进来，不从 `draft` 里现读 —— 布尔那一行是「勾选即保存」，
   * `setDraft` 要等下次渲染才生效，从这里读会读到**上一轮**的草稿（旧值又被写回去）。
   * 「调一调」那边踩过这个坑，这里照它写好的规矩来。
   */
  async function save(row: Row, raw: string) {
    const kind = kindOf(row.value);
    let value: unknown;
    if (kind === "boolean") {
      value = raw === "true";
    } else if (kind === "number") {
      const parsed = Number(raw);
      // 空串 / 非数字挡在本地，别让内核回一条难懂的类型错误
      if (raw.trim() === "" || Number.isNaN(parsed)) {
        setError(`${settingWords(row.path).label}：这里得填一个数字`);
        return;
      }
      value = parsed;
    } else {
      value = raw;
    }
    try {
      const result = await configSet(row.path, value);
      // 生效值以内核回来的那份为准（读完立刻反映在「现在：…」上）
      setValues((current) => ({ ...current, [row.path]: result.value }));
      setNotice(`${settingWords(row.path).label}：已存成 ${plainValue(row.path, result.value)}`);
      setError("");
      props.onSaved?.(row.path);
    } catch (err) {
      setError(String(err));
    }
  }

  const { reader } = partitionSettings(paths);
  const sections = readerSections(reader);

  return (
    <div className="reader-prefs reader-config" role="group" aria-label="阅读设置">
      {/* 一句话说清这一块改的是谁的东西、小牌子什么意思 */}
      <p className="reader-config-lead">{readerPanelLead()}</p>
      {error ? <p className="reader-config-msg error">{error}</p> : null}
      {notice ? <p className="reader-config-msg notice">{notice}</p> : null}
      {sections.length === 0 ? (
        <p className="reader-config-msg dim">
          {busy ? "正在读设置…" : "读不到设置 —— 多半是内核这会儿没起来。"}
        </p>
      ) : null}
      {sections.map((section) => (
        <section className="reader-config-block" key={section.title}>
          <h4 className="reader-config-title">{section.title}</h4>
          <p className="reader-config-plain">{section.plain}</p>
          {section.paths.map((path) => (
            <CoreItem
              key={path}
              row={{ path, value: values[path] }}
              draft={draft[path] ?? ""}
              // 面板窄，技术名那一行收起来（要对照 settings.toml 时去「调一调」看）
              showPath={false}
              onDraft={(drafted, value) => setDraft((current) => ({ ...current, [drafted]: value }))}
              onSave={(row) => void save(row, draft[row.path] ?? "")}
              // 勾选即保存：布尔值没有"编辑中"的中间态，把刚落下的那个值一起递过去
              onToggle={(row, next) => {
                const raw = next ? "true" : "false";
                setDraft((current) => ({ ...current, [row.path]: raw }));
                void save({ ...row, value: next }, raw);
              }}
            />
          ))}
        </section>
      ))}
      <p className="reader-config-foot">每一项都直接写进书库，没有「确定 / 取消」这一步。</p>
    </div>
  );
}
