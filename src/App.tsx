import { useCallback, useEffect, useState } from "react";

import "./App.css";
import { useAmbient } from "./lib/ambient";
import { cachedShelf, coreVersion, recordEvent, resetCache, syncShelf } from "./lib/core";
import { coreStamp } from "./lib/format";
import { isTypingTarget, pageKeyAction, type ShortcutId } from "./lib/shortcuts";
import type { BookRow } from "./lib/types";
import { useUsageTracker } from "./lib/usage";
import Achievements from "./views/Achievements";
import Desk, { type Tab as DeskTab } from "./views/Desk";
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

/**
 * 挂件页与快捷键的对应：按 `S` 开统计、`A` 开成就、`G` 开设置（齿轮那一页，默认就是「设置」标签）。
 *
 * 左列是 `lib/shortcuts.ts` 里的 id，右列是这里那个浮层的名字 —— 两边分开写是因为
 * 「设置」在界面上其实叫 `desk`（齿轮里有设置 / 数据 / 已归档三个页签）。
 */
const OVERLAY_OF: Partial<Record<ShortcutId, Overlay>> = {
  stats: "stats",
  achievements: "achievements",
  settings: "desk",
};

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
  // 齿轮里停在哪个页签（受控：按 G 永远落在「设置」，见下面那个 effect）
  const [deskTab, setDeskTab] = useState<DeskTab>("settings");
  // 书房那把小锤子在不在手上：由书房报上来（`Shelf` 的 `onManageChange`）—— 它一被挂件页
  // 顶掉就会重新挂载，所以这份状态得留在这里；去统计页看一眼再回来，手里还拿着锤子。
  const [managing, setManaging] = useState(false);
  // 沉浸模式：只能整理书架 —— 书、统计 / 成就 / 设置三枚贴纸、导入与右上角那些小圆钮全部停用。
  // 开关是墙上那枚「沉浸」贴纸（`Shelf` 报上来）。**只活在这一次运行里**：重启应用就回到
  // 正常模式，不会让人第二天打开时被一个记着的「沉浸」关在门外。
  const [immersive, setImmersive] = useState(false);
  // 白噪音：挂在**这一层**（不在书房里）—— 去统计页、去阅读页时书房卸掉了，声音还得在。
  // 书房那台留声机与设置页里的同一个开关都调它的 `toggle`（见 `lib/ambient.ts`）。
  const ambient = useAmbient();
  // 软件使用时间：只算读书以外的停留（书房 / 日记 / 勋章 / 设置），翻开书就停表。
  // 计时在模块里走（见 `lib/usage.ts`），这里不接 state —— 每秒走秒不该重渲染整个书架。
  // 同一个计时器还会把「单次使用峰值」报给内核，用来解锁「🙈 我不看书」。
  const reportUsage = useCallback(async (seconds: number) => {
    await recordEvent("usage", { seconds });
  }, []);
  useUsageTracker(open !== null, immersive, reportUsage);

  /**
   * Pull the shelf from the core and refresh the cache.
   *
   * 返回**这次刷新之后的书单**：导入那边要拿它比出「刚进来的那几本」，
   * 好把封面从篮子一格格飞过去（见 `components/ImportFlight.tsx`）。
   * 出错回空数组 —— 调用方本来就只拿它当"有没有新书"看。
   */
  const refresh = useCallback(async (): Promise<BookRow[]> => {
    setBusy(true);
    try {
      // 先把缓存里的书架画出来（一瞬间），再问内核要权威数据
      setBooks(await cachedShelf());
      // 界面不再展示版本号：这次调用同时充当"内核还活着"的探针（起不来就进 catch）
      await coreVersion();
      const fresh = await syncShelf(coreStamp(new Date()));
      setBooks(fresh);
      setError("");
      return fresh;
    } catch (err) {
      // 内核起不来是这里最可能的情形：原样显示原因
      setError(String(err));
      return [];
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

  /**
   * 挂件页里的键盘快捷键（书房那一份在 `views/Shelf.tsx`；两边不会同时生效 ——
   * 这一页开着时书房已经卸下了）。
   *
   * 四个键都是**「去哪儿」**，回程统一交给 `Esc`（三个页的返回按钮上都写着）：
   *
   * - `S` / `A` → 统计 / 成就；`G` → 设置（齿轮那一页，并把页签拨回「设置」——
   *   从「数据」页按 `G` 也是切标签，不会把人送回书架）；`M` → 回书房并进管理模式。
   *
   * 哪个键算什么由 `lib/shortcuts.ts` 的 `pageKeyAction` 判定（纯函数，node 里钉过）；
   * 这里只管落地。焦点在输入框里时除了 `Esc` 一概不抢 —— 设置页那些数字框要能正常打字。
   */
  useEffect(() => {
    if (!overlay) return;
    function onKeyDown(event: KeyboardEvent) {
      const act = pageKeyAction(event);
      if (!act) return;
      if (act.action !== "back" && isTypingTarget(event.target as HTMLElement | null)) return;
      event.preventDefault();
      if (act.action === "back") {
        setOverlay(null);
        return;
      }
      if (act.action === "manage") {
        // 回书房，并把那把锤子递到手上
        setManaging(true);
        setOverlay(null);
        return;
      }
      const next = OVERLAY_OF[act.id];
      if (!next) return;
      // `G` 是「去设置」：落在齿轮里、页签也得是「设置」
      if (act.id === "settings") setDeskTab("settings");
      setOverlay(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay]);

  // 阅读页是独占的：它有自己的顶栏与返回按钮，不显示书房
  if (open) {
    return (
      <Reader
        book={open}
        // 页内改了这本书（PDF 转换成文字之后行数/字数/章节都变了）：把那一行重新同步回来，
        // 阅读页拿到的分母才不会还是旧的
        onBookChanged={async (bookId) => {
          const fresh = await refresh();
          const row = fresh.find((item) => item.id === bookId);
          if (row) setOpen(row);
        }}
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
        <Desk
          onBack={closeOverlay}
          onLibraryChanged={() => void refresh()}
          tab={deskTab}
          onTab={setDeskTab}
          ambient={ambient}
        />
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
        // 沉浸模式的两道门都关在 App 这一层（书房里也各自挡了一道，见 `Shelf`）：
        // 开书、开统计 / 成就 / 设置都不再有效
        onOpen={(book) => {
          if (!immersive) setOpen(book);
        }}
        onSync={() => refresh()}
        onReset={() => void clearCache()}
        onOpenStats={() => {
          if (!immersive) setOverlay("stats");
        }}
        onOpenAchievements={() => {
          if (!immersive) setOverlay("achievements");
        }}
        onOpenDesk={() => {
          if (!immersive) setOverlay("desk");
        }}
        immersive={immersive}
        onToggleImmersive={() => setImmersive((on) => !on)}
        initialManaging={managing}
        onManageChange={setManaging}
        ambient={ambient}
      />
    </div>
  );
}

