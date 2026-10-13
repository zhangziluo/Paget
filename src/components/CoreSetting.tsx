/**
 * 内核 `settings.toml` 里的一项在界面上长什么样 —— **「调一调」与阅读页的「阅读设置」共用**。
 *
 * 抽出来是因为 2026-10-11 用户要求「与阅读相关的设置项，全部移动到阅读页」：
 * 同一批控件从此有两个地方渲染，再各写一份迟早会长歪（措辞、单位、范围、
 * 「勾了就是存了」这些规矩都在这一层）。谁在哪儿露面由 `lib/readerConfig.ts` 说了算。
 *
 * 控件长相在 `styles/settings-page.css`（方格纸那一版，只认 `.set-*` 的骨架）
 * 与 `styles/reader-config.css`（阅读页那一版，跟着纸面主题走）里各画一遍 ——
 * 两处的底色不一样，不能互相借。
 */
import type { ReactNode } from "react";

import { plainValue, settingWords } from "../lib/settingsText";

/** 一项设置：它的点号路径与当前生效值。 */
export type Row = {
  path: string;
  value: unknown;
};

/** How a value is edited (decided by the type of the current effective value). */
export type Kind = "boolean" | "number" | "text";

/** The editor kind for one value; `null` (unset) is edited as text. */
export function kindOf(value: unknown): Kind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

/** Render a value into the editable draft string. */
export function toDraft(value: unknown): string {
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
export function sliderRange(raw: string): { min: number; max: number; step: number } {
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

/** 一项的外壳：大白话名字 + 控件 + 那句话 + 技术名那一行。 */
export function Item(props: {
  path: string;
  id: string;
  control: ReactNode;
  meta?: ReactNode;
  /** 技术名那一行要不要露（阅读页那块面板收着 —— 排版紧，排查时可以来「调一调」看） */
  showPath?: boolean;
}) {
  const words = settingWords(props.path);
  return (
    <div className="set-item">
      <div className="set-row">
        {/* 名字点一下就把光标送到控件上（`htmlFor` 对的是下面那个 id） */}
        <label className="set-label" htmlFor={props.id}>
          {words.label}
        </label>
        <span className="set-control">{props.control}</span>
      </div>
      {words.plain ? <p className="set-plain">{words.plain}</p> : null}
      <p className="set-meta">
        {/* 技术名照原样留着：排查时对得上 settings.toml 里的那一行 */}
        {props.showPath === false ? null : <code className="set-path">{props.path}</code>}
        {props.meta}
      </p>
    </div>
  );
}

/** 内核 `settings.toml` 里的一项：勾选框 / 铅笔线 + 数字 / 写在横线上的字。 */
export function CoreItem(props: {
  row: Row;
  draft: string;
  onDraft: (path: string, value: string) => void;
  onSave: (row: Row) => void;
  onToggle: (row: Row, next: boolean) => void;
  /** 见 `Item`：阅读页那块面板不露技术名 */
  showPath?: boolean;
}) {
  const row = props.row;
  const kind = kindOf(row.value);
  const id = `setting-${row.path}`;
  // 滑块只借用这个范围来拖动；精确值仍由旁边的数字框负责
  const range = sliderRange(props.draft);

  const control =
    kind === "boolean" ? (
      <Switch id={id} checked={props.draft === "true"} onChange={(next) => props.onToggle(row, next)} />
    ) : kind === "number" ? (
      <>
        <input
          type="range"
          className="slider"
          min={range.min}
          max={range.max}
          step={range.step}
          value={props.draft}
          aria-label={`${settingWords(row.path).label}（拖动）`}
          onChange={(event) => props.onDraft(row.path, event.currentTarget.value)}
        />
        <input
          id={id}
          type="number"
          className="slider-value"
          step="any"
          value={props.draft}
          onChange={(event) => props.onDraft(row.path, event.currentTarget.value)}
        />
      </>
    ) : (
      <input
        id={id}
        type="text"
        className="text-input"
        value={props.draft}
        onChange={(event) => props.onDraft(row.path, event.currentTarget.value)}
      />
    );

  return (
    <Item
      path={row.path}
      id={id}
      control={control}
      showPath={props.showPath}
      // 布尔行不给「保存」：勾了就是存了。其它行留一个按钮，并报出现在是多少（人话）
      meta={
        kind === "boolean" ? null : (
          <>
            <span className="set-now">现在：{plainValue(row.path, row.value)}</span>
            <button className="set-save" onClick={() => props.onSave(row)}>
              保存
            </button>
          </>
        )
      }
    />
  );
}

/**
 * 开关。
 *
 * 纸页上它画成**手画的方框 + 一个勾**（样式在 `settings-page.css`），
 * 但底层仍是 `input[type=checkbox]` —— 键盘、`Space`、无障碍那一套照旧。
 */
export function Switch(props: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch">
      <input
        id={props.id}
        type="checkbox"
        className="switch-input"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </label>
  );
}
