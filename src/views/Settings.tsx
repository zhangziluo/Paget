import { useCallback, useEffect, useState } from "react";

import { CoreItem, Item, Switch, kindOf, toDraft, type Row } from "../components/CoreSetting";
import { AMBIENT_SETTING_PATH, type AmbientState } from "../lib/ambient";
import {
  cacheStorage,
  compactCache,
  configGet,
  configSet,
  corePaths,
  getGuiSetting,
  setGuiSetting,
  type CacheStorage,
} from "../lib/core";
import { humanBytes } from "../lib/format";
import { IMPORT_FLIGHT_KEY, normalizeImportFlight } from "../lib/importFlight";
import { partitionSettings } from "../lib/readerConfig";
import { normalizeSpineMode, SPINE_MODE_KEY } from "../lib/shelfLayout";
import { plainValue, sectionWords, settingWords } from "../lib/settingsText";
import type { CorePaths } from "../lib/types";

/** One settings.toml section and the rows under it. */
type Section = {
  name: string;
  rows: Row[];
};

/**
 * The settings page: the settings the app itself reads -- written on a sheet of
 * **方格纸**（`styles/settings-page.css`），每一项都用大白话说清楚。
 *
 * It reads and writes the core's own ``settings.toml`` through `config_get` /
 * `config_set`, so a value changed here is the value the whole app reads --
 * the GUI keeps **no** copy of these, unlike its own `gui_settings` table.
 *
 * 措辞不在这里：**每一项的名字、那句话、现在是多少**都来自 `lib/settingsText.ts`
 * （纯函数，能在 node 里钉住）。认不出来的键照样显示、照样能改 —— 内核以后加了
 * 新设置项，这一页不必同步跟上。
 *
 * 数据这一层（RPC / 本机偏好）留在本组件，排版那一层是下面的 `SettingsSheet`：
 * 拆开是为了能在 node 里整页 SSR 出来点数（与统计页的 `StatsSheet` 同一个理由）。
 *
 * **阅读相关的那一节不在这里**（2026-10-11 起）：内核 `reader.*` 整节搬去了阅读页顶栏那颗
 * 「阅读设置」，分界线见 `lib/readerConfig.ts`（`partitionSettings`）—— 这一页只渲染剩下的
 * 几节（统计 / 书库 / 目录），并在原来那一节的位置留一句交代。
 */
export default function Settings({
  embedded = false,
  ambient,
}: { embedded?: boolean; ambient?: AmbientState } = {}) {
  const [sections, setSections] = useState<Section[]>([]);
  const [paths, setPaths] = useState<CorePaths | null>(null);
  // 草稿：点号路径 -> 编辑框里的字符串
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // 阅读页顶栏那块「阅读设置」里有没有东西（有就在原位置交代一句：这些不在这儿）
  const [hasReaderPanel, setHasReaderPanel] = useState(false);
  // 界面自己的偏好（不进内核 settings.toml，存本机 gui_settings）：书脊是动态厚薄还是统一等宽
  const [spineDynamic, setSpineDynamic] = useState(true);
  // 同一个地方（gui_settings）还存着一个开关：导入后放不放「书从篮子飞上架」那一段动画
  const [importFlight, setImportFlight] = useState(true);
  // 本机缓存（书目 / 全文索引 / 阅读位置的副本）：体积与压缩状态
  const [cache, setCache] = useState<CacheStorage | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheNotice, setCacheNotice] = useState("");

  /** 读一次缓存体积；读不到（旧内核 / 库还没建）就不显示这一块。 */
  const loadCache = useCallback(async () => {
    try {
      setCache(await cacheStorage());
    } catch {
      setCache(null);
    }
  }, []);

  useEffect(() => {
    void loadCache();
  }, [loadCache]);

  /** 压一次缓存：一行数据都不删，只把删书 / 重建索引留下的空洞还给磁盘。 */
  async function compactNow() {
    if (cacheBusy) return;
    setCacheBusy(true);
    setCacheNotice("");
    try {
      const report = await compactCache();
      setCache(report.after);
      const before = report.before.db_bytes + report.before.wal_bytes;
      const after = report.after.db_bytes + report.after.wal_bytes;
      setCacheNotice(
        before > after
          ? `收回了 ${humanBytes(before - after)}，缓存现在是 ${humanBytes(after)}。`
          : "已经很紧凑了，没有可回收的空间。",
      );
    } catch (err) {
      setCacheNotice(`压缩失败：${String(err)}`);
    } finally {
      setCacheBusy(false);
    }
  }

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const config = await configGet();
      // 哪些项在界面上露面由 `lib/readerConfig.ts` 说了算（分界线只有那一处）：
      // 阅读页顶栏「阅读设置」里的那几项、留在这一页的、以及界面上不列的，一次分好
      const { app, reader } = partitionSettings(config.paths);
      setHasReaderPanel(reader.length > 0);
      // 按点号路径的前半段分组，顺序沿用内核给的就是 schema 的顺序
      const groups: Section[] = [];
      const nextDraft: Record<string, string> = {};
      for (const path of app) {
        const dot = path.indexOf(".");
        const name = dot > 0 ? path.slice(0, dot) : "其它";
        const value = config.values[path];
        // 同一个 section 连续出现就接在同一组后面
        const last = groups[groups.length - 1];
        const row: Row = { path, value };
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

  // 读回书脊厚度这个界面偏好（与书架那边同一个键、同一个归一化函数）
  useEffect(() => {
    let alive = true;
    getGuiSetting(SPINE_MODE_KEY)
      .then((raw) => {
        if (alive) setSpineDynamic(normalizeSpineMode(raw) === "dynamic");
      })
      .catch(() => {
        // 读不到就维持默认的「动态」，不打断设置页
      });
    return () => {
      alive = false;
    };
  }, []);

  // 同一个做法读回「导入飞行动画」那个开关（书架那边用同一个键、同一个归一化函数）
  useEffect(() => {
    let alive = true;
    getGuiSetting(IMPORT_FLIGHT_KEY)
      .then((raw) => {
        if (alive) setImportFlight(normalizeImportFlight(raw));
      })
      .catch(() => {
        // 读不到就维持默认的「开」，不打断设置页
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 切换书脊厚度：先换界面再写本机；写不进去只回一条错，不改回来（下次开书以存下的为准）。 */
  async function chooseSpine(dynamic: boolean) {
    setSpineDynamic(dynamic);
    try {
      await setGuiSetting(SPINE_MODE_KEY, dynamic ? "dynamic" : "uniform");
      setNotice(`书脊厚薄：${dynamic ? "跟着字数走" : "统一等宽"}（已存本机）`);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  /** 切换导入飞行动画：同样是先换界面再写本机（存 `"on"` / `"off"`）。 */
  async function chooseImportFlight(on: boolean) {
    setImportFlight(on);
    try {
      await setGuiSetting(IMPORT_FLIGHT_KEY, on ? "on" : "off");
      setNotice(`导入飞行动画：${on ? "开" : "关"}（已存本机）`);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  /**
   * Coerce one draft string to the value the core expects and save it.
   *
   * *raw* 由调用方递进来，不再从 `draft` 里现读：布尔那一行「勾选即保存」是先
   * `setDraft` 再保存的，而 `setDraft` 要等下次渲染才生效 —— 从这里读会读到**上一轮**
   * 的草稿，于是第一次勾选反而把旧值写了回去（开关看着打开了，文件里还是关的）。
   * `raw` 由调用方给（就是它刚设进去的那个字符串），这个 off-by-one 就没有了。
   */
  async function save(row: Row, raw: string) {
    const kind = kindOf(row.value);
    let value: unknown;
    if (kind === "boolean") {
      value = raw === "true";
    } else if (kind === "number") {
      const parsed = Number(raw);
      // 空串 / 非数字直接挡在本地，别让内核回一条难懂的类型错误
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
      setNotice(`${settingWords(row.path).label}：已存成 ${plainValue(row.path, result.value)}`);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }

  const sheet = (
    <SettingsSheet
      sections={sections}
      paths={paths}
      draft={draft}
      spineDynamic={spineDynamic}
      importFlight={importFlight}
      cache={cache}
      cacheBusy={cacheBusy}
      cacheNotice={cacheNotice}
      hasReaderPanel={hasReaderPanel}
      ambient={ambient}
      busy={busy}
      error={error}
      notice={notice}
      onDraft={(path, value) => setDraft((current) => ({ ...current, [path]: value }))}
      onSave={(row) => void save(row, draft[row.path] ?? "")}
      // 勾选即保存：布尔值没有"编辑中"的中间态，所以把刚落下的那个值一起递过去
      onToggle={(row, next) => {
        const raw = next ? "true" : "false";
        setDraft((current) => ({ ...current, [row.path]: raw }));
        void save({ ...row, value: next }, raw);
      }}
      onSpine={(dynamic) => void chooseSpine(dynamic)}
      onImportFlight={(on) => void chooseImportFlight(on)}
      onCompactCache={() => void compactNow()}
      onRefresh={() => {
        void load();
        void loadCache();
      }}
    />
  );

  // 嵌入式：交给 Desk 排版；独立页：自己包一层居中容器
  if (embedded) return sheet;
  return <main className="container settings-page">{sheet}</main>;
}

/** 「书库文件都在哪儿」那几行的名目；键就是内核 `paths` 回来的四个字段。 */
const PATH_LABELS: { label: string; key: keyof CorePaths }[] = [
  { label: "书库目录（进度 / 统计 / 勋章）", key: "data_dir" },
  { label: "电子书正文（导入后转好的 .txt）", key: "novels_dir" },
  { label: "书目清单（一本一行）", key: "library_file" },
  { label: "这份设置文件", key: "settings_file" },
];

/**
 * 排版那一层：一页方格纸上的「调一调」清单。
 *
 * 数据全由外面递进来（没有 hooks、不碰内核），所以能在 node 里整页 SSR 出来点数 ——
 * 页面自己那个 `Settings` 得等 `config_get` 回来，SSR 里等不到。
 */
export function SettingsSheet(props: {
  sections: Section[];
  paths: CorePaths | null;
  /** 草稿：点号路径 -> 编辑框里的字符串 */
  draft: Record<string, string>;
  /** 界面自己的两个偏好（存本机） */
  spineDynamic: boolean;
  importFlight: boolean;
  /** 本机缓存体积（读不到就是 null：这一块整块不显示） */
  cache?: CacheStorage | null;
  cacheBusy?: boolean;
  cacheNotice?: string;
  /** 压缩缓存（VACUUM + FTS optimize + 截断 WAL），一行数据都不删 */
  onCompactCache?: () => void;
  /** 阅读页顶栏那块「阅读设置」里有没有东西（有才留那句交代） */
  hasReaderPanel: boolean;
  /**
   * 白噪音的开 / 关（应用级状态，`App.tsx` 一路转交到这里）。
   * 它与书房架子上那台留声机是**同一个**开关 —— 在哪儿点，另一处立刻跟着变。
   */
  ambient?: AmbientState;
  busy?: boolean;
  error?: string;
  notice?: string;
  onDraft: (path: string, value: string) => void;
  onSave: (row: Row) => void;
  /** 开关：勾上 / 取消（布尔值勾了就存，没有「保存」按钮） */
  onToggle: (row: Row, next: boolean) => void;
  onSpine: (dynamic: boolean) => void;
  onImportFlight: (on: boolean) => void;
  onRefresh?: () => void;
}) {
  return (
    <article className="settings-sheet">
      <header className="set-head">
        <h2 className="set-title">调一调</h2>
        <span className="set-tag" title="这一页就是设置：写的是内核的 settings.toml">
          设置
        </span>
        {props.onRefresh ? (
          <div className="set-tools">
            <button onClick={props.onRefresh} disabled={props.busy}>
              {props.busy ? "正在读…" : "重新读一遍"}
            </button>
          </div>
        ) : null}
        {/* 一句话说清这一页改的是谁的东西 */}
        <p className="set-lead">
          这里改的是书库里的 <code className="set-path">settings.toml</code>{" "}
          —— 书库、阅读位置、统计、勋章看到的都是同一份。每一项直接写进去，没有「确定 / 取消」。
        </p>
      </header>

      {props.error ? <p className="error">{props.error}</p> : null}
      {props.notice ? <p className="notice">{props.notice}</p> : null}

      {/* 书房的声音：白天风铃、夜里虫鸣，打开应用就在响。与架子上那台留声机是
          同一个开关（状态在 App.tsx），在哪儿点另一处立刻跟着变 */}
      {props.ambient ? (
        <section className="set-block">
          <h3>书房的声音</h3>
          <p className="set-block-lead">
            一点背景声 —— 白天是风铃流水，夜里是两段虫鸣交替（6 点天亮、18 点天黑）。
            点书架上层那台留声机会弹出曲目面板：上面是开关，下面能手选九段声音；
            手选之后单曲循环，最后一项「按昼夜自动」回到跟天色走。
          </p>
          <ToggleItem
            path={AMBIENT_SETTING_PATH}
            checked={props.ambient.on}
            onChange={(next) => {
              // 状态是受控的：只有真的和现在不一样才切（避免连点两次又切回去）
              if (next !== props.ambient?.on) props.ambient?.toggle();
            }}
          />
        </section>
      ) : null}

      {/* 界面自己的两个偏好：不进内核的 settings.toml，只存本机 gui_settings */}
      <section className="set-block">
        <h3>书架的样子</h3>
        <p className="set-block-lead">这两项只在界面里管用，存在本机 —— 换台机器就回到默认。</p>
        <ToggleItem path={SPINE_MODE_KEY} checked={props.spineDynamic} onChange={props.onSpine} />
        <ToggleItem
          path={IMPORT_FLIGHT_KEY}
          checked={props.importFlight}
          onChange={props.onImportFlight}
        />
      </section>

      {/* 书库文件都在哪儿 */}
      {props.paths ? (
        <section className="set-block">
          <h3>书库文件都在哪儿</h3>
          <p className="set-block-lead">
            书、进度、统计、勋章都在这几个文件里。想备份就直接拷它们（或者去「数据」那一页导出一份）。
          </p>
          <ul className="set-paths">
            {PATH_LABELS.map(({ label, key }) => (
              <li key={key}>
                <span className="set-paths-name">{label}</span>
                <span className="set-paths-value">{props.paths?.[key]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 本机缓存：书目 / 全文索引 / 阅读位置的一份副本，删了能从书库重建。
          删书或重建索引之后，SQLite 只在文件里留空洞、不会自己缩；这里给出可收回的
          空间，并提供一次 VACUUM（不删任何数据） */}
      {props.cache ? (
        <section className="set-block">
          <h3>本机缓存</h3>
          <p className="set-block-lead">
            书目、全文搜索和阅读位置在本机留了一份副本 —— 删掉也能从书库重建，书本身一个字节不动。
            删书 / 重建索引之后文件里会留下空洞，压一压就能把这块盘还回去。
          </p>
          <ul className="set-paths">
            <li>
              <span className="set-paths-name">缓存文件</span>
              <span className="set-paths-value">
                {humanBytes(props.cache.db_bytes + props.cache.wal_bytes)}
                {props.cache.wal_bytes > 0
                  ? `（其中还没并回去的日志 ${humanBytes(props.cache.wal_bytes)}）`
                  : ""}
              </span>
            </li>
            <li>
              <span className="set-paths-name">可以收回</span>
              <span className="set-paths-value">{humanBytes(props.cache.free_bytes)}</span>
            </li>
            <li>
              <span className="set-paths-name">里面有什么</span>
              <span className="set-paths-value">
                {props.cache.books} 本书 · {props.cache.chunks.toLocaleString("zh-CN")} 块正文索引
              </span>
            </li>
          </ul>
          <div className="set-tools set-tools-inline">
            <button
              type="button"
              onClick={props.onCompactCache}
              disabled={props.cacheBusy}
            >
              {props.cacheBusy ? "正在压缩…" : "压缩缓存"}
            </button>
          </div>
          {props.cacheNotice ? <p className="set-hint">{props.cacheNotice}</p> : null}
        </section>
      ) : null}

      {/* 阅读相关的那一档搬去阅读页了：原位置留一句交代，免得人以为它丢了 */}
      {props.hasReaderPanel ? (
        <section className="set-block">
          <h3>阅读的手感</h3>
          <p className="set-block-lead">
            「自动翻页」那几项在<b>阅读页顶栏那颗「阅读设置」</b>里 —— 正读着书的时候就能调，
            不用绕到这里来。改的仍是同一份书库设置，改完当场生效。
          </p>
        </section>
      ) : null}

      {/* 内核 settings.toml 的其余几节：顺序就是内核给的 schema 顺序，一节不落。
          `key` 里带上序号：内核若哪天把同一节拆成两段发过来（不连续），
          光用节名会撞 key。 */}
      {props.sections.map((section, index) => {
        const words = sectionWords(section.name);
        return (
          <section className="set-block" key={`${section.name}-${index}`}>
            <h3>{words.title}</h3>
            {words.plain ? <p className="set-block-lead">{words.plain}</p> : null}
            {section.rows.map((row) => (
              <CoreItem
                key={row.path}
                row={row}
                draft={props.draft[row.path] ?? ""}
                onDraft={props.onDraft}
                onSave={props.onSave}
                onToggle={props.onToggle}
              />
            ))}
          </section>
        );
      })}

      {props.sections.length === 0 && !props.busy ? (
        <p className="set-empty">
          读不到设置 —— 多半是内核这会儿没起来（报错原文就在上面那行）。先照它说的把内核弄起来，再点右上角「重新读一遍」。
        </p>
      ) : null}

      <footer className="set-foot">
        <span>每一项都直接写进书库，没有「确定 / 取消」这一步。</span>
        <span>「书房的声音」与「书架的样子」只存本机。</span>
      </footer>
    </article>
  );
}

/** `gui_settings` 里那两个偏好各存什么值 —— 「现在：…」那截要说人话，得递对词。 */
function guiToken(path: string, checked: boolean): string {
  if (path === SPINE_MODE_KEY) return checked ? "dynamic" : "uniform";
  return checked ? "on" : "off";
}

/** 界面自己的那一项：只存本机，勾一下就写，没有「保存」按钮。 */
function ToggleItem(props: {
  path: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = `setting-${props.path}`;
  return (
    <Item
      path={props.path}
      id={id}
      control={<Switch id={id} checked={props.checked} onChange={props.onChange} />}
      meta={
        <span className="set-now">现在：{plainValue(props.path, guiToken(props.path, props.checked))}</span>
      }
    />
  );
}
