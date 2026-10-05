import { useCallback, useEffect, useState } from "react";

import "./App.css";
import { cachedShelf, coreVersion, resetCache, syncShelf } from "./lib/core";
import { coreStamp } from "./lib/format";
import type { BookRow } from "./lib/types";
import Achievements from "./views/Achievements";
import Desk from "./views/Desk";
import Reader from "./views/Reader";
import Shelf from "./views/Shelf";
import Stats from "./views/Stats";

/**
 * The shell: the study (bookshelf) plus the widgets that expand over it.
 *
 * There is **no tab bar** any more -- the study *is* the app.  The calendar, the
 * glass badge box and the gear are drawn by `Shelf` on the study wall; clicking one
 * expands the matching page here (statistics / achievements / settings+data), each
 * with its own back button in the top-right corner.  Every page still talks to the
 * same Python core through `src/lib/core.ts`, so no number is recomputed here.
 */
type Overlay = "stats" | "achievements" | "desk";

export default function App() {
  // 书架上的书（内核的 list 是唯一来源，缓存只是让它画得更快）
  const [books, setBooks] = useState<BookRow[]>([]);
  // 出错的原文（多半是"内核起不来"，直接把原因给用户看）
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 正在读的书；null = 显示当前页面
  const [open, setOpen] = useState<BookRow | null>(null);
  // 从墙上挂件展开的那一页；null = 书房本身
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  /** Pull the shelf from the core and refresh the cache. */
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      // 先把缓存里的书架画出来（一瞬间），再问内核要权威数据
      setBooks(await cachedShelf());
      // 界面不再展示版本号：这次调用同时充当"内核还活着"的探针（起不来就进 catch）
      await coreVersion();
      setBooks(await syncShelf(coreStamp(new Date())));
      setError("");
    } catch (err) {
      // 内核起不来是这里最可能的情形：原样显示原因（一般是没装 wreader）
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // 启动时同步一次
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Drop the cache and rebuild it from the core. */
  async function clearCache() {
    setBusy(true);
    try {
      await resetCache();
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
    // 重建
    await refresh();
  }

  /** 收起挂件，回到书房。 */
  function closeOverlay() {
    setOverlay(null);
  }

  // 阅读页是独占的：它有自己的顶栏与返回按钮，不显示书房
  if (open) {
    return (
      <Reader
        book={open}
        onClose={(reload) => {
          setOpen(null);
          // 读过之后书架上的进度/时长都变了，回去要刷新
          if (reload) void refresh();
        }}
      />
    );
  }

  // 挂件展开成一整页：统计 / 成就 / 设置与数据，各自右上角有返回书架
  if (overlay === "stats") {
    return (
      <div className="shell">
        <Stats onBack={closeOverlay} />
      </div>
    );
  }
  if (overlay === "achievements") {
    return (
      <div className="shell">
        <Achievements onBack={closeOverlay} />
      </div>
    );
  }
  if (overlay === "desk") {
    return (
      <div className="shell">
        <Desk onBack={closeOverlay} onLibraryChanged={() => void refresh()} />
      </div>
    );
  }

  // 书房：书脊 + 日历 / 徽章盒 / 齿轮 + 数字时钟
  return (
    <div className="shell">
      <Shelf
        books={books}
        busy={busy}
        error={error}
        onOpen={setOpen}
        onSync={() => void refresh()}
        onReset={() => void clearCache()}
        onOpenStats={() => setOverlay("stats")}
        onOpenAchievements={() => setOverlay("achievements")}
        onOpenDesk={() => setOverlay("desk")}
      />
    </div>
  );
}

