#!/usr/bin/env node
/**
 * Paget 存储体检（**只读**）
 *
 * 把仓库里最占地方的那几样、以及本机应用数据目录，各占多少盘列出来；
 * 末尾给出「想清的话该跑什么」——**脚本自己一个文件都不删**。
 *
 * 用法：
 *
 *     npm run storage            # 人看的报告
 *     npm run storage -- --json  # 给别的工具看的 JSON
 *
 * 为什么单独写一个而不是写进构建：`src-tauri/target` 是 Cargo 的构建产物、
 * `node_modules` 是 npm 的，两者都不该由构建脚本顺手清理；这里只负责把
 * 「谁在吃盘」量清楚，删不删由人决定。
 *
 * 应用缓存（SQLite）里的「可回收空间」要读库才能知道：机器上有 `sqlite3`
 * 就顺带查一下 `page_size / freelist_count`，没有就只报文件大小。
 */

import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

/** 仓库里按目录统计的几处（相对仓库根）；不存在的直接跳过。 */
const PROJECT_ENTRIES = [
  { name: "src-tauri/target", note: "Cargo 构建产物（可 cargo clean）" },
  { name: "node_modules", note: "npm 依赖（可 npm ci 重装）" },
  { name: "dist", note: "前端构建产物（可 npm run build 重建）" },
  { name: ".git", note: "版本历史（可 git gc 压一压）" },
  { name: ".wreader", note: "本机书库数据（书与进度，别乱删）" },
  { name: "core/.venv", note: "内核的 Python 虚拟环境（可重建）" },
  { name: "src-tauri/binaries", note: "冻结的内核二进制（可重编）" },
  { name: "src", note: "前端源码（含素材）" },
  { name: "processed", note: "处理后的素材" },
];

/** 应用数据目录里逐项展开的条目（Tauri 的 app_data_dir）。 */
const APP_ENTRIES = [
  { name: "cache.sqlite3", note: "本机缓存（设置页可压缩 / 清空）" },
  { name: "cache.sqlite3-wal", note: "SQLite 日志；空闲时应当很小" },
  { name: "cache.sqlite3-shm", note: "SQLite 共享内存" },
  { name: "covers", note: "封面图缓存（可删，会重新生成）" },
  { name: "reader", note: "阅读背景图" },
  { name: "core", note: "内核冻结二进制与运行数据" },
  { name: "archived", note: "归档数据" },
];

/** 字节 → 人话；缓存基本都在 KB / MB 量级。 */
function human(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * 递归量一个文件或目录占多少字节（不跟随符号链接）。
 *
 * 不跟随是故意的：`node_modules/.bin` 里全是链接，跟进去会把同一份文件算两遍。
 * 读不到的条目（权限 / 刚被删）直接跳过 —— 体检报告不该因为一个文件报错就整个中断。
 */
async function measure(target) {
  try {
    const info = await stat(target);
    if (info.isFile()) return { bytes: info.size, files: 1 };
    if (!info.isDirectory()) return { bytes: 0, files: 0 };
  } catch {
    return null;
  }
  let bytes = 0;
  let files = 0;
  const stack = [target];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const info = await stat(full);
          bytes += info.size;
          files += 1;
        } catch {
          // 刚被删 / 没权限：跳过
        }
      }
      // 符号链接与其它类型不计（见函数头）
    }
  }
  return { bytes, files };
}

/** Tauri 2 的 app_data_dir（identifier = com.paget.gui，见 tauri.conf.json）。 */
function appDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "com.paget.gui");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "com.paget.gui");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "com.paget.gui");
}

/**
 * 若机器上有 `sqlite3`，问一下缓存库里有多少页是空的。
 *
 * 这不是必须的：没有 CLI 就返回 null，报告里只留文件大小。
 */
function sqliteFreeBytes(file) {
  try {
    const output = execFileSync(
      "sqlite3",
      [file, "PRAGMA page_size; PRAGMA freelist_count; PRAGMA journal_mode;"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const [pageSize, freePages, journal] = output.trim().split(/\r?\n/);
    const size = Number(pageSize);
    const free = Number(freePages);
    if (!Number.isFinite(size) || !Number.isFinite(free)) return null;
    return { freeBytes: size * free, journal: journal || "" };
  } catch {
    return null;
  }
}

async function collect(base, entries) {
  const rows = [];
  for (const entry of entries) {
    const measured = await measure(path.join(base, entry.name));
    if (!measured) continue;
    rows.push({ ...entry, bytes: measured.bytes, files: measured.files });
  }
  return rows.sort((a, b) => b.bytes - a.bytes);
}

function printRows(rows) {
  const width = Math.max(...rows.map((row) => row.name.length), 10);
  for (const row of rows) {
    const size = human(row.bytes).padStart(9);
    console.log(`  ${row.name.padEnd(width)}  ${size}  ${row.note}`);
  }
}

function totalOf(rows) {
  return rows.reduce((sum, row) => sum + row.bytes, 0);
}

const [projectRows, appRows] = await Promise.all([
  collect(ROOT, PROJECT_ENTRIES),
  collect(appDataDir(), APP_ENTRIES),
]);

// 应用缓存里「已经空出来、但还没还给磁盘」的那部分：只读，不改文件
const cacheInfo = sqliteFreeBytes(path.join(appDataDir(), "cache.sqlite3"));

const projectTotal = totalOf(projectRows);
const appTotal = totalOf(appRows);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        project: { root: ROOT, total: projectTotal, entries: projectRows },
        appData: { dir: appDataDir(), total: appTotal, entries: appRows, cache: cacheInfo },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log("Paget 存储体检（只读，不会删任何东西）");
console.log("");
console.log(`仓库：${ROOT}`);
if (projectRows.length === 0) {
  console.log("  （这里什么都没有？确认是在 Paget 仓库里跑的）");
} else {
  printRows(projectRows);
  const width = Math.max(...projectRows.map((row) => row.name.length), 10);
  console.log(`  ${"合计".padEnd(width)}  ${human(projectTotal).padStart(9)}`);
}

console.log("");
console.log(`应用数据：${appDataDir()}`);
if (appRows.length === 0) {
  console.log("  （还没有应用数据：这个应用可能还没在这台机器上跑过）");
} else {
  printRows(appRows);
  const width = Math.max(...appRows.map((row) => row.name.length), 10);
  console.log(`  ${"合计".padEnd(width)}  ${human(appTotal).padStart(9)}`);
  if (cacheInfo) {
    const journal = cacheInfo.journal ? `，日志模式 ${cacheInfo.journal}` : "";
    console.log(`  缓存里可压缩回收：${human(cacheInfo.freeBytes)}${journal}`);
    console.log("  （设置页「本机缓存 → 压缩缓存」会做这件事，一行数据都不删）");
  }
}

// 下面只是「想清的时候该跑什么」，脚本不执行其中任何一条
console.log("");
console.log("想清的时候（自己决定；脚本不执行）：");
console.log("  cargo clean --manifest-path src-tauri/Cargo.toml   # 清 Cargo 构建产物，下次构建会重编");
console.log("  rm -rf dist                                        # 清前端产物，npm run build 会重建");
console.log("  npm ci                                             # 重装 node_modules（先删了再跑才省盘）");
console.log("  git gc --prune=now                                 # 压缩 .git 里的松散对象");
console.log("  应用缓存：设置页 →「本机缓存」→「压缩缓存」（保留数据，只回收空洞）");
