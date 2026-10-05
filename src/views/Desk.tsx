import { useState } from "react";

import Archived from "./Archived";
import Data from "./Data";
import Settings from "./Settings";

/** 齿轮里的三个页签。 */
type Tab = "settings" | "data" | "archived";

/** 页签的顺序与标签（设置在前：那是点开齿轮最常干的事）。 */
const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "设置" },
  { id: "data", label: "数据" },
  { id: "archived", label: "已归档" },
];

/**
 * 齿轮里的一页：原来的「设置」和「数据」，再加上「已归档」。
 *
 * 三个子页各自跟内核（`config_get` / `config_set`、`import` / `export` / `prune` /
 * `clear`）或壳层（归档列表 / 找回）打交道，这里只负责用一排页签切换它们，并提供
 * 右上角的「返回书架」。点「刷新」时给当前页换 `key`，让它重新载入。
 */
export default function Desk(props: {
  onBack: () => void;
  onLibraryChanged: () => void;
}) {
  // 换 key 就重挂载当前页，等于让它重新拉一次数据
  const [nonce, setNonce] = useState(0);
  // 当前页签（默认设置）
  const [tab, setTab] = useState<Tab>("settings");

  return (
    <main className="container">
      <header className="bar">
        <h1>设置与数据</h1>
        <span className="dim">settings.toml · 导入 / 备份 / 维护 / 已归档</span>
        <button onClick={() => setNonce((value) => value + 1)}>刷新</button>
        <button className="ghost back" onClick={props.onBack}>
          ← 返回书架
        </button>
      </header>

      {/* 页签：设置 / 数据 / 已归档（同一页切换，省得来回滚动） */}
      <nav className="desk-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`desk-tab${tab === item.id ? " active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "settings" ? <Settings key={`settings-${nonce}`} embedded /> : null}
      {tab === "data" ? (
        <Data key={`data-${nonce}`} embedded onLibraryChanged={props.onLibraryChanged} />
      ) : null}
      {tab === "archived" ? (
        <Archived key={`archived-${nonce}`} embedded onLibraryChanged={props.onLibraryChanged} />
      ) : null}
    </main>
  );
}

