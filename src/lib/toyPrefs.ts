/**
 * 摆件架上那几只毛绒玩偶的摆法：**每只各自放不放**、
 * 以及几只一起摆上时**相邻两只之间的间距**（见下面 `TOY_GAP_*`）。
 *
 * 与别的界面偏好一样是**本机**的东西（内核不认识玩偶），但这项**不进 `gui_settings`**：
 * 书架画的正是它，必须**首屏第一帧就摆对**，而 `gui_settings` 是异步读的 —— 走
 * `localStorage` 才不会「先摆出厂那只、再跳成你选的那只」（闪一下很难看）。
 *
 * 键名带版本（见 `TOY_STORE_KEY`）。更早那一版只记「选中哪一只」（键 `shelf_toy`、
 * 存的就是玩偶 id），首次读到新键时会把它**迁过来**：那只放上、其余不用 ——
 * 老用户打开还是自己那只，不用重新挑。
 *
 * **「朝向」那一路 2026-10-10 去掉了**：从前每只还能选「前 / 左 / 右 / 后」四面
 * （`facing` 字段 + `TOY_FACINGS` + `setToyFacing`），现在只剩**朝前**一种造型。
 * 存档因此少了一格，但**键名照旧 `v1`、不写迁移**：老存档里多出来的 `facing`
 * 没人读（`on` 还认），另外换键反而会把「哪几只摆着」一起丢掉 —— 得不偿失。
 * 造型只有正面一套，画法在 `App.css` 的 `.plush` 那一节（没有 `[data-facing]` 了）。
 *
 * **间距为什么另起一个键**（`TOY_GAP_STORE_KEY`）：摆法那份存档（`paget.shelf-toys.v1`）
 * 的形状是「每只一条 `{ on }`」，往里塞一个数字就得动它的类型与所有读写点；
 * 间距是**另一个维度**的东西（几只之间的关系，不是某一只自己的属性），单开一个键
 * 既不动老存档、也不用写迁移 —— 与「一个键一件事」的老规矩一致。
 *
 * 造型（`.plush-<id>`）在 `App.css` 里，这里只管**摆法**。
 */

/**
 * 可选的三只玩偶（兔子 / 猫头鹰 / 乌龟）。
 * `id` 同时是 CSS 类名 `.plush-<id>`；面板上也是用同一套造型当缩略图。
 */
export const TOYS: { id: string; label: string }[] = [
  { id: "rabbit", label: "兔子" },
  { id: "owl", label: "猫头鹰" },
  { id: "turtle", label: "乌龟" },
];

/** 一只玩偶摆在架子上的样子。 */
export type ToyPlacement = {
  /** 在架子上（false = 收起来了） */
  on: boolean;
};

/** 三只玩偶各是什么摆法（键 = 玩偶 id）。 */
export type ToySettings = Record<string, ToyPlacement>;

/**
 * 出厂摆法：**只有兔子**在架子上 —— 与从前（单只玩具那一版）打开时的样子一模一样。
 */
export const DEFAULT_TOY_SETTINGS: ToySettings = {
  rabbit: { on: true },
  owl: { on: false },
  turtle: { on: false },
};

/**
 * 相邻两只玩偶之间的间距（rem，直接当 `margin-left` 用）：
 *
 * - 范围 **-1 … 1.6rem**：往左是**挨在一起**（负数 = 互相搭上一点，造型边缘会轻轻压住）、
 *   往右是**分开**；1.6rem 与摆件架自己的 `gap` 同宽，再大就会把台灯挤到边上去。
 * - 出厂 **-0.6rem**：从前写死的那一档（三只并排约 12.6rem）—— 老用户升级后外观不变。
 * - 台阶 0.1rem：滑杆一格拉 0.1，够细也不至于让值变得难读。
 */
export const TOY_GAP_MIN = -1;
export const TOY_GAP_MAX = 1.6;
export const TOY_GAP_STEP = 0.1;
export const DEFAULT_TOY_GAP = -0.6;

/** 间距另存一个键（与摆法分开，见文件开头那段说明）。 */
export const TOY_GAP_STORE_KEY = "paget.shelf-toy-gap.v1";

/** 本机存档的键（带版本号：形状变了换它，老键留着不动。2026-10-10 去掉朝向时**故意没换**，见文件开头）。 */
export const TOY_STORE_KEY = "paget.shelf-toys.v1";

/** 更早那一版：单只玩具，存的就是玩偶 id（首读新键时迁过来）。 */
const LEGACY_TOY_KEY = "shelf_toy";

/**
 * 归一化一份摆法：**只认名单里的三只**（多出来的键直接丢掉，将来删玩偶时老存档也不会
 * 留个孤键）。
 *
 * 两条规则：
 * - **整个存档不存在**（第一次打开 / 读不出来 / 存成了别的类型）→ 出厂样子（兔子在架上）。
 * - 存档在，但某一只**没写到**或写坏了（`on` 不是真正的布尔）→ **那只算没摆**。
 *   不能给它填出厂值 —— 那样「只存了一只」的存档会莫名其妙多出兔子。
 *
 * 老存档里多出来的 `facing` 那一格**直接忽略**（从前有四个朝向，2026-10-10 去掉了）。
 */
export function normalizeToySettings(input: unknown): ToySettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const factory: ToySettings = {};
    for (const toy of TOYS) factory[toy.id] = { ...DEFAULT_TOY_SETTINGS[toy.id] };
    return factory;
  }
  const raw = input as Record<string, unknown>;
  const next: ToySettings = {};
  for (const toy of TOYS) {
    const saved = raw[toy.id];
    const entry = (saved && typeof saved === "object" ? saved : {}) as Partial<ToyPlacement>;
    next[toy.id] = {
      on: entry.on === true,
    };
  }
  return next;
}

/** 架子上摆着哪几只（按名单顺序），每只带上名字 —— 书架渲染就照这个摆。 */
export function placedToys(settings: ToySettings): { id: string; label: string }[] {
  return TOYS.filter((toy) => settings[toy.id]?.on).map((toy) => ({
    id: toy.id,
    label: toy.label,
  }));
}

/** 放上 / 取下这一只（其余不动）。 */
export function toggleToy(settings: ToySettings, id: string): ToySettings {
  const entry = settings[id];
  if (!entry) return settings;
  return { ...settings, [id]: { ...entry, on: !entry.on } };
}

/** 本机的储物柜；没有 window（非浏览器环境）或访问就抛（隐私模式）时退化成「不存」。 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读回摆法。新键没有 / 存坏了就看一眼更早那一版（`shelf_toy` 里那只 = 放上它），
 * 都没有就是出厂样子。读不出来（隐私模式）也回落到出厂样子 —— 不该因此打不开书架。
 */
export function loadToySettings(): ToySettings {
  const shelf = storage();
  if (!shelf) return normalizeToySettings(null);
  try {
    const raw = shelf.getItem(TOY_STORE_KEY);
    if (raw) return normalizeToySettings(JSON.parse(raw));
  } catch {
    // 存坏了当没存过（下面还有老键那条退路）
  }
  try {
    const legacy = shelf.getItem(LEGACY_TOY_KEY);
    if (legacy && TOYS.some((toy) => toy.id === legacy)) {
      // 老版本「选中的那一只」= 摆上它、其余收着 —— 归一化里「没写到的 = 没摆」正好就是这意思
      return normalizeToySettings({ [String(legacy)]: { on: true } });
    }
  } catch {
    // 同上：读老键失败也只是回落出厂样子
  }
  return normalizeToySettings(null);
}

/** 写回摆法；写不进去（配额满 / 隐私模式）只影响下次启动，不抛。 */
export function saveToySettings(settings: ToySettings): void {
  try {
    storage()?.setItem(TOY_STORE_KEY, JSON.stringify(normalizeToySettings(settings)));
  } catch {
    // 存不上也比把书房搞崩强
  }
}

/**
 * 归一化间距：夹进 `TOY_GAP_MIN … TOY_GAP_MAX`、对齐到 `TOY_GAP_STEP` 那一档。
 *
 * 对齐时先 `toFixed(1)` 再转回数字 —— 浮点乘法会算出 `-0.6000000000000001` 这种值，
 * 直接写进 `style` 与滑杆的 `value` 会让滑杆对不齐台阶（拖到那一格会「跳」）。
 * 坏值一律回落出厂那一档；**`null` / 空串要显式挡掉** —— `Number(null)` 与 `Number("")`
 * 都是 0，不挡的话「没存过」会被读成「间距 0」。
 */
export function normalizeToyGap(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_TOY_GAP;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_TOY_GAP;
  const clamped = Math.min(TOY_GAP_MAX, Math.max(TOY_GAP_MIN, num));
  return Number((Math.round(clamped / TOY_GAP_STEP) * TOY_GAP_STEP).toFixed(1));
}

/**
 * 读回间距。没存过 / 存坏了 → 出厂那一档（-0.6rem）。
 * 与摆法不同，这一项**没有老键要迁**（它就是这次新加的）。
 */
export function loadToyGap(): number {
  const shelf = storage();
  if (!shelf) return DEFAULT_TOY_GAP;
  try {
    const raw = shelf.getItem(TOY_GAP_STORE_KEY);
    if (raw !== null) return normalizeToyGap(JSON.parse(raw));
  } catch {
    // 存坏了当没存过
  }
  return DEFAULT_TOY_GAP;
}

/** 写回间距；写不进去（配额满 / 隐私模式）只影响下次启动，不抛。 */
export function saveToyGap(gap: number): void {
  try {
    storage()?.setItem(TOY_GAP_STORE_KEY, JSON.stringify(normalizeToyGap(gap)));
  } catch {
    // 同上：存不上也别把书房搞崩
  }
}
