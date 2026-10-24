/**
 * 书房的白噪音：**打开就响**。声音来自 `src/assets/audio/` 里的真实采样，
 * 白天「风铃流水」、夜里「虫鸣（一）」与「虫鸣（二）」交替。
 *
 * 为什么按**昼夜**换声音：书房的天色本来就是跟着系统时间走的（`lib/sky.ts` 的
 * `skyOf`，6 点天亮、18 点天黑），声音跟着同一套判断走，「白天窗外有风铃、夜里窗外
 * 有虫鸣」才对得上屋子里的光。
 *
 * 用户也能自己挑：点架子上那台留声机，从弹出的曲目面板里选一首（见 `Shelf.tsx`
 * 的 `AmbientPicker`）。手选之后就一直**单曲循环**那一首，直到再选「按昼夜自动」。
 *
 * 三个容易踩的点，都在这里处理掉：
 *
 * - **循环接缝**：每一遍播放（以及虫鸣两首之间的交替）都要在**开头淡入 200ms、
 *   结尾淡出 200ms**，不然接缝处会「咔」一声。这里不用 `source.loop`，而是每一遍
 *   重新起一个 `AudioBufferSourceNode`，用它的 `onended` 接下一遍 —— 这样每一遍
 *   都能挂一条独立的音量包络（见 `startCycle`）。
 * - **自动播放**：桌面 WebView 里 `AudioContext` 一开始多半是 `suspended`（没被用户
 *   碰过就不让出声）。`play()` 先试着 `resume()`；还不行就挂一次性的
 *   `pointerdown` / `keydown` —— 用户点第一下（点书、翻页、点留声机都算）就响。
 * - **读档**：开没开存在 `localStorage`（键 `paget.ambient.v1`）、选的是哪首存在
 *   `paget.ambient.track.v1`，与玩偶摆法同一个道理 —— 首屏第一帧就要知道，
 *   `gui_settings` 是异步的，来不及。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { skyOf, type Sky } from "./sky";

import bonfireUrl from "../assets/audio/bonfire.mp3";
import cicada1Url from "../assets/audio/cicada-1.mp3";
import cicada2Url from "../assets/audio/cicada-2.mp3";
import cityRainUrl from "../assets/audio/city-rain.mp3";
import forestStreamUrl from "../assets/audio/forest-stream.mp3";
import indiaMarketUrl from "../assets/audio/india-market.mp3";
import tokyoStreetUrl from "../assets/audio/tokyo-street.mp3";
import wavesUrl from "../assets/audio/waves.mp3";
import windChimeUrl from "../assets/audio/wind-chime.mp3";

/** 本机偏好：白噪音开 / 关（默认开）。 */
export const AMBIENT_STORE_KEY = "paget.ambient.v1";

/** 本机偏好：手选的那一首（默认「按昼夜自动」）。 */
export const AMBIENT_MODE_STORE_KEY = "paget.ambient.track.v1";

/**
 * 设置页里那一条的「路径」：只用来在 `lib/settingsText.ts` 里取名字与那句说明，
 * 真正存的地方是上面的 localStorage 键 —— 与书脊 / 导入动画的 `shelf.*` 同样叫法。
 */
export const AMBIENT_SETTING_PATH = "shelf.ambient";

/** 九段声音（文件都在 `src/assets/audio/`，见下面的 `AMBIENT_TRACKS`）。 */
export type AmbientTrackId =
  | "wind-chime"
  | "cicada-1"
  | "cicada-2"
  | "forest-stream"
  | "city-rain"
  | "tokyo-street"
  | "bonfire"
  | "waves"
  | "india-market";

/** 一首曲目在界面上需要的东西。 */
export type AmbientTrackInfo = {
  id: AmbientTrackId;
  /** 中文名（留声机面板里那一行） */
  label: string;
  /** 打包后的地址（Vite 会哈希文件名） */
  url: string;
  /** 一行小字：说明它什么时候是默认的（没有就不显示） */
  hint?: string;
};

/**
 * 面板里的顺序：**三首默认的排前面**（白天风铃、夜里两段虫鸣），
 * 然后是另外六首。默认三首也列出来 —— 手选之后照样可以点回来。
 */
export const AMBIENT_TRACKS: readonly AmbientTrackInfo[] = [
  { id: "wind-chime", label: "风铃流水", url: windChimeUrl, hint: "白天默认" },
  { id: "cicada-1", label: "虫鸣 · 一", url: cicada1Url, hint: "夜里默认" },
  { id: "cicada-2", label: "虫鸣 · 二", url: cicada2Url, hint: "夜里默认" },
  { id: "forest-stream", label: "森林溪流", url: forestStreamUrl },
  { id: "city-rain", label: "城市雨夜", url: cityRainUrl },
  { id: "tokyo-street", label: "东京街道", url: tokyoStreetUrl },
  { id: "bonfire", label: "篝火", url: bonfireUrl },
  { id: "waves", label: "海浪", url: wavesUrl },
  { id: "india-market", label: "印度市场", url: indiaMarketUrl },
];

const TRACK_BY_ID = new Map<AmbientTrackId, AmbientTrackInfo>(
  AMBIENT_TRACKS.map((track) => [track.id, track]),
);

/** 某一首的中文名（面板、留声机的 `title` 都用它）。 */
export function ambientTrackLabel(id: AmbientTrackId): string {
  return TRACK_BY_ID.get(id)?.label ?? "";
}

/**
 * 此时此刻该放哪几首：**白天一首（风铃流水），夜里两首（虫鸣一 / 二，交替）**。
 *
 * 判断交给 `skyOf`（与书房天色同一处），所以 5:59 是虫鸣、6:00 起是风铃，
 * 17:59 还是风铃、18:00 换成虫鸣。
 */
export function ambientProgramOf(sky: Sky): AmbientTrackId[] {
  return sky === "day" ? ["wind-chime"] : ["cicada-1", "cicada-2"];
}

/** 用户的选择：跟着昼夜走（自动），还是钉在某首上（单曲循环）。 */
export type AmbientMode = { kind: "auto" } | { kind: "track"; track: AmbientTrackId };

/**
 * 读回「开没开」。没存过 = **开**（这个功能的意义就是打开就有声）；
 * 存坏了 / 读不出来也回落到开 —— 不该因为一个偏好文件打不开就静音。
 */
export function loadAmbientOn(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(AMBIENT_STORE_KEY);
    if (raw === null) return true;
    return JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

/** 写回开 / 关；写不进去（配额满 / 隐私模式）只影响下次启动，不抛。 */
export function saveAmbientOn(on: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AMBIENT_STORE_KEY, JSON.stringify(on));
  } catch {
    // 存不上也比把书房搞崩强
  }
}

function isAmbientTrackId(value: unknown): value is AmbientTrackId {
  return typeof value === "string" && TRACK_BY_ID.has(value as AmbientTrackId);
}

/** 读回「选的是哪首」：没存过 / 存坏了 = **按昼夜自动**。 */
export function loadAmbientMode(): AmbientMode {
  try {
    if (typeof window === "undefined") return { kind: "auto" };
    const raw = window.localStorage.getItem(AMBIENT_MODE_STORE_KEY);
    if (raw === null) return { kind: "auto" };
    const parsed: unknown = JSON.parse(raw);
    return isAmbientTrackId(parsed) ? { kind: "track", track: parsed } : { kind: "auto" };
  } catch {
    return { kind: "auto" };
  }
}

/** 写回「选的是哪首」（自动存成 `"auto"`，否则存曲目 id）。 */
export function saveAmbientMode(mode: AmbientMode): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      AMBIENT_MODE_STORE_KEY,
      JSON.stringify(mode.kind === "auto" ? "auto" : mode.track),
    );
  } catch {
    // 同上：存不上只影响下次启动
  }
}

/**
 * 把 `AudioParam` 停在**此刻正在响的那个值**上，再往后排新的坡。
 *
 * 直接读 `param.value` 不行：它拿到的是最后一次 `setValueAtTime` 的值，不是自动
 * 化曲线跑到一半时的当前值 —— 快速连点开关会从旧值重新爬，听感上就是「跳一下」。
 * 支持 `cancelAndHoldAtTime` 的浏览器（Safari / Chrome 都支持）用它最准。
 */
function holdAt(param: AudioParam, at: number): void {
  const cancellable = param as AudioParam & {
    cancelAndHoldAtTime?: (time: number) => AudioParam;
  };
  if (typeof cancellable.cancelAndHoldAtTime === "function") {
    cancellable.cancelAndHoldAtTime(at);
    return;
  }
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
}

/**
 * 每一遍（或每次换曲）的淡入 / 淡出时长（秒）。
 *
 * 200ms 是用户定的：短到听不出「音量在动」，长到能把循环接缝那一下盖过去。
 */
const FADE = 0.2;

/** 主音量：这是**背景**，不该盖过别的声音。 */
const MASTER_VOLUME = 0.7;

/** 正在响的那一遍：一个采样源 + 它自己的音量包络。 */
type Cycle = { source: AudioBufferSourceNode; gain: GainNode };

/** 播放器往外报的状态（`playing` 真的在响没有、`current` 此刻是哪首）。 */
type PlayerStatus = { playing: boolean; current: AmbientTrackId | null };

/** 两串曲目是不是同一套（同样的 id、同样的顺序）。 */
function sameSequence(
  a: readonly AmbientTrackId[] | null,
  b: readonly AmbientTrackId[] | null,
): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 白噪音的「播放器」：**一个 `AudioContext`、一条主音量、至多一遍正在响的采样**。
 *
 * 只在真的打开时才创建（`play` 里 `ensure`）—— 关着白噪音的人不该为它付一个
 * 音频线程；关掉只是淡出并停掉发声点，`AudioContext` 留着，再打开时立刻能响。
 */
export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 此刻正在响的那一遍（null = 没有） */
  private cycle: Cycle | null = null;
  /** 这一轮要按顺序放的曲目（一首 = 单曲循环；两首 = 交替循环） */
  private sequence: AmbientTrackId[] = [];
  private index = 0;
  /**
   * 代数：每次换曲 / 停止都 +1。异步的 `decodeAudioData` 与旧 `onended` 回来时，
   * 对不上代数就丢掉 —— 否则快速切歌时旧的一遍会抢着往下接。
   */
  private generation = 0;
  /** 用户**要**听的曲目：自动播放被挡住时，等第一次点击就放它 */
  private wanted: AmbientTrackId[] | null = null;
  /** 解好的缓冲，按 id 缓存（一首只解一次） */
  private readonly buffers = new Map<AmbientTrackId, AudioBuffer>();
  /** 正在解的（同一首别并发解两遍） */
  private readonly decoding = new Map<AmbientTrackId, Promise<AudioBuffer | null>>();
  /** 自动播放被挡住时挂在 window 上的那个「叫醒」函数（只挂一次） */
  private wake: (() => void) | null = null;
  private readonly notify: (status: PlayerStatus) => void;

  constructor(notify: (status: PlayerStatus) => void = () => {}) {
    this.notify = notify;
  }

  /**
   * 放这一串曲目（或者换成这一串）。
   *
   * 先 `resume()` 试试；被自动播放策略挡着（`suspended`）就挂一次性的
   * 「用户碰了窗口就 resume」—— 不弹任何提示，用户点第一下的时候声音自己来。
   */
  async play(sequence: AmbientTrackId[]): Promise<void> {
    const wanted = sequence.slice();
    this.wanted = wanted;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // 还是不让出声：下面交给手势
      }
    }
    if (ctx.state !== "running") {
      this.armWake();
      return;
    }
    // 等 `resume()` 的这会儿，用户可能已经把声音关了、或者已经点了另一首：
    // 只放「现在仍然想要的」那一串，否则关掉之后又被这一下重新响起来
    if (!sameSequence(this.wanted, wanted)) return;
    // 已经在放同一串了（比如 React 重渲染）就别从头再来
    if (sameSequence(this.sequence, wanted) && this.cycle) return;
    this.swap(wanted);
  }

  /** 关掉：淡出、停掉发声点，`AudioContext` 留着。 */
  stop(): void {
    this.wanted = null;
    this.generation += 1;
    this.disarm();
    this.sequence = [];
    this.index = 0;
    const ctx = this.ctx;
    if (ctx) this.fadeOutCycle(ctx.currentTime);
    this.notify({ playing: false, current: null });
  }

  /** 彻底收掉（组件卸载 / 应用退出）：连 `AudioContext` 一起关。 */
  dispose(): void {
    this.stop();
    this.disarm();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
    this.decoding.clear();
    if (ctx) {
      void ctx.close().catch(() => {
        // 已经关了再关一次会抛，不用管
      });
    }
  }

  /** 建 `AudioContext`（只建一次）与主音量。 */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const ctor =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctor) return null;
    try {
      const ctx = new ctor();
      const master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * 换成一串新的：旧的那一遍 200ms 淡出，新的一遍同时 200ms 淡入（叠着换，
   * 不硬切）。代数 +1，旧那遍的 `onended` / 还没解完的 buffer 回来时会自动作废。
   */
  private swap(sequence: AmbientTrackId[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.generation += 1;
    const generation = this.generation;
    this.fadeOutCycle(ctx.currentTime);
    this.sequence = sequence.slice();
    this.index = 0;
    void this.startCycle(generation);
  }

  /**
   * 把**这一遍**唱出来：解好的缓冲从一个 `AudioBufferSourceNode` 出去，
   * 自己的 `GainNode` 负责「开头 200ms 淡入、结尾 200ms 淡出」。
   * 唱完（`onended`）接下一首 —— 单曲就是自己，交替就是另一首。
   */
  private async startCycle(generation: number): Promise<void> {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || generation !== this.generation) return;
    const id = this.sequence[this.index];
    if (!id) return;

    const buffer = await this.load(ctx, id);
    if (!buffer || generation !== this.generation) return;
    if (ctx.state !== "running") {
      // 解缓冲的这会儿被系统挂起了：等下一次用户碰窗口再接着放
      this.armWake();
      return;
    }

    const at = ctx.currentTime + 0.02;
    const end = at + buffer.duration;
    // 太短的音频（理论上不会）也得留出淡入的位置，别让两条坡交叉
    const fadeStart = Math.max(at + FADE, end - FADE);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(1, at + FADE);
    gain.gain.setValueAtTime(1, fadeStart);
    gain.gain.linearRampToValueAtTime(0.0001, end);

    source.connect(gain);
    gain.connect(master);
    source.onended = () => this.cycleEnded(generation);
    source.start(at);

    this.cycle = { source, gain };
    this.notify({ playing: true, current: id });
  }

  /** 一遍唱完：轮到下一首（单曲 = 自己；交替 = 另一首），接着唱。 */
  private cycleEnded(generation: number): void {
    if (generation !== this.generation) return;
    if (this.sequence.length === 0) return;
    this.index = (this.index + 1) % this.sequence.length;
    void this.startCycle(generation);
  }

  /** 把正在响的那一遍淡出并停掉（已经停过的再停一次不抛）。 */
  private fadeOutCycle(at: number): void {
    const old = this.cycle;
    this.cycle = null;
    if (!old) return;
    holdAt(old.gain.gain, at);
    old.gain.gain.linearRampToValueAtTime(0, at + FADE);
    try {
      old.source.stop(at + FADE + 0.05);
    } catch {
      // 已经停过 / 已经断了，不用管
    }
  }

  /**
   * 解这一首（解过就取缓存）。`fetch` 的是 Vite 打包后的地址 ——
   * 开发时是 `http://localhost:1420/assets/...`，安装后是应用自己的协议，两边都能取。
   */
  private load(ctx: AudioContext, id: AmbientTrackId): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = this.decoding.get(id);
    if (pending) return pending;
    const info = TRACK_BY_ID.get(id);
    if (!info) return Promise.resolve(null);

    const job = fetch(info.url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(id, buffer);
        return buffer;
      })
      .catch(() => null)
      .finally(() => {
        this.decoding.delete(id);
      });

    this.decoding.set(id, job);
    return job;
  }

  /** 把「用户碰了窗口就 resume」挂上（`pointerdown` / `keydown` / `touchstart` 各一次）。 */
  private armWake(): void {
    if (this.wake || typeof window === "undefined") return;
    const wake = () => {
      this.disarm();
      const ctx = this.ctx;
      if (!ctx) return;
      void ctx
        .resume()
        .then(() => {
          const wanted = this.wanted;
          if (ctx.state === "running" && wanted) this.swap(wanted);
        })
        .catch(() => {
          // 这次还是不行（比如窗口根本没焦点）：下次碰窗口再说
        });
    };
    this.wake = wake;
    window.addEventListener("pointerdown", wake, true);
    window.addEventListener("keydown", wake, true);
    window.addEventListener("touchstart", wake, true);
  }

  private disarm(): void {
    const wake = this.wake;
    if (!wake || typeof window === "undefined") return;
    window.removeEventListener("pointerdown", wake, true);
    window.removeEventListener("keydown", wake, true);
    window.removeEventListener("touchstart", wake, true);
    this.wake = null;
  }
}

/** `useAmbient()` 交出来的东西：开没开、选的是哪首、真的在响没有、怎么切。 */
export type AmbientState = {
  /** 用户的选择：开 / 关 */
  on: boolean;
  /** 跟着昼夜走，还是钉在某一首上 */
  mode: AmbientMode;
  /** 此刻（或马上要）在响的那一首 */
  current: AmbientTrackId | null;
  /** `current` 的中文名 */
  label: string;
  /** 声音**真的在响**没有（默认开、但 WebView 可能还没允许自动播放） */
  playing: boolean;
  /** 开 / 关（留声机面板顶上那一行与设置页那个开关都调它） */
  toggle: () => void;
  /** 手选一首：钉在它上面单曲循环（顺带把声音打开） */
  selectTrack: (id: AmbientTrackId) => void;
  /** 回到「按昼夜自动」 */
  selectAuto: () => void;
};

/**
 * 白噪音的 React 入口：**挂在 `App` 顶上**（不在书房里）—— 去统计页、去阅读页
 * 时书房卸掉了，声音还得在。
 *
 * 每条职责各一个 effect：一个对表（半小时看一次昼夜）、一个跟着 `on` / 曲目
 * 开或换、一个只在卸载时收尾。换曲**不在清理里 stop** —— `play()` 自己会交叉淡入
 * 淡出，清理里再停一次反而会把新的一段也停掉。
 */
export function useAmbient(): AmbientState {
  const [on, setOn] = useState<boolean>(() => loadAmbientOn());
  const [mode, setMode] = useState<AmbientMode>(() => loadAmbientMode());
  const [sky, setSky] = useState<Sky>(() => skyOf(new Date()));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState<AmbientTrackId | null>(null);
  const playerRef = useRef<AmbientPlayer | null>(null);

  // 与书房天色同一个节奏：半小时对一次表，跨过 6 点 / 18 点就换声音
  useEffect(() => {
    const id = window.setInterval(() => setSky(skyOf(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // 这一轮该放的那一串：自动模式跟天色走，手选就是它自己（单曲循环）
  const sequence = useMemo<AmbientTrackId[]>(() => {
    if (mode.kind === "track") return [mode.track];
    return ambientProgramOf(sky);
  }, [mode, sky]);

  useEffect(() => {
    if (!on) {
      playerRef.current?.stop();
      setPlaying(false);
      return;
    }
    const player = (playerRef.current ??= new AmbientPlayer((status) => {
      setPlaying(status.playing);
      setCurrent(status.current);
    }));
    void player.play(sequence);
  }, [on, sequence]);

  // 卸载才收：关掉 AudioContext（StrictMode 在开发里会「挂上又拆掉」，重挂时
  // 上面的 effect 会重新造一个播放器，不会拿一个已经关掉的 context 去响）
  useEffect(
    () => () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [],
  );

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      saveAmbientOn(next);
      return next;
    });
  }, []);

  const selectTrack = useCallback((id: AmbientTrackId) => {
    const next: AmbientMode = { kind: "track", track: id };
    setMode(next);
    saveAmbientMode(next);
    // 选了一首就是「我要听这首」：关着的话顺手打开
    setOn((prev) => {
      if (prev) return prev;
      saveAmbientOn(true);
      return true;
    });
  }, []);

  const selectAuto = useCallback(() => {
    const next: AmbientMode = { kind: "auto" };
    setMode(next);
    saveAmbientMode(next);
  }, []);

  const shown = current ?? sequence[0] ?? null;

  return {
    on,
    mode,
    current: shown,
    label: shown ? ambientTrackLabel(shown) : "",
    playing,
    toggle,
    selectTrack,
    selectAuto,
  };
}

