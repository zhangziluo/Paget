# -*- coding: utf-8 -*-
"""生成 Paget 的应用图标：一本蓝色的书，封面上有两三个兔子的脚印。

纯标准库实现（这台机器上没有 Pillow）：形状用有符号距离场（SDF）表达，
每个像素按距离算覆盖率做抗锯齿，再按画家算法合成到预乘 alpha 的画面缓冲，
最后手写 PNG 头 + zlib 压缩输出。

用法：
    python3 packaging/make_icon.py [输出路径]     # 默认 /tmp/paget-icon.png
    npm run tauri icon /tmp/paget-icon.png        # 由它生成整套 icons/
"""

import math
import struct
import sys
import zlib
from array import array
from pathlib import Path

# 画布边长（Tauri 的 `tauri icon` 要求源图正方形，推荐 ≥1024）
SIZE = 1024
N = SIZE * SIZE

# 预乘 alpha 的四个通道（array('f') 省内存：4 × 4 MB）
RED = array("f", bytes(4 * N))
GRN = array("f", bytes(4 * N))
BLU = array("f", bytes(4 * N))
ALP = array("f", bytes(4 * N))


def clamp01(value: float) -> float:
    """把 0~1 之外的值截回边界。"""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def paint(x0: int, y0: int, x1: int, y1: int, sdf, color, alpha=1.0, aa=1.2) -> None:
    """把一个 SDF 形状合成到画面上（只在包围盒里扫，免得白跑整屏）。

    *sdf* 是 (px, py) -> 距离（负数在形状内部）；
    *color* 可以是 (r, g, b)，也可以是 (px, py) -> (r, g, b) 的渐变函数。
    *aa* 既是边缘羽化宽度，也是"软阴影"的模糊半径 —— 放大它就得到柔和渐变。
    """
    gradient = callable(color)
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(SIZE, x1)
    y1 = min(SIZE, y1)
    for y in range(y0, y1):
        py = y + 0.5
        base = y * SIZE
        for x in range(x0, x1):
            px = x + 0.5
            dist = sdf(px, py)
            if dist >= aa:
                continue
            # 距离 -> 覆盖率（dist <= 0 时完全覆盖，到 aa 处渐变到 0）
            cover = clamp01((aa - dist) / aa)
            if cover <= 0.0:
                continue
            src_a = cover * alpha
            if gradient:
                cr, cg, cb = color(px, py)
            else:
                cr, cg, cb = color
            inv = 1.0 - src_a
            i = base + x
            RED[i] = cr * src_a + RED[i] * inv
            GRN[i] = cg * src_a + GRN[i] * inv
            BLU[i] = cb * src_a + BLU[i] * inv
            ALP[i] = src_a + ALP[i] * inv


def round_rect(cx: float, cy: float, hw: float, hh: float, r: float):
    """圆角矩形 SDF。"""

    def sdf(px: float, py: float) -> float:
        dx = abs(px - cx) - (hw - r)
        dy = abs(py - cy) - (hh - r)
        ax = dx if dx > 0.0 else 0.0
        ay = dy if dy > 0.0 else 0.0
        return math.hypot(ax, ay) + min(max(dx, dy), 0.0) - r

    return sdf


def ellipse(cx: float, cy: float, rx: float, ry: float, rot: float = 0.0):
    """（可旋转的）椭圆 SDF —— 用单位圆距离按半径缩放来近似。"""
    cos_r = math.cos(rot)
    sin_r = math.sin(rot)
    scale = rx if rx < ry else ry

    def sdf(px: float, py: float) -> float:
        dx = px - cx
        dy = py - cy
        # 旋到椭圆自己的坐标系
        ux = dx * cos_r + dy * sin_r
        uy = -dx * sin_r + dy * cos_r
        k = math.hypot(ux / rx, uy / ry)
        if k == 0.0:
            return -scale
        return (k - 1.0) * scale

    return sdf


def bbox(cx: float, cy: float, hw: float, hh: float, pad: float):
    """形状的扫描包围盒（多留一点给羽化）。"""
    return (
        int(cx - hw - pad),
        int(cy - hh - pad),
        int(cx + hw + pad) + 1,
        int(cy + hh + pad) + 1,
    )

# ---------------------------------------------------------------- 书的几何
# 封面中心与半宽半高（右下留一点余量，好让阴影落下来）
COVER_CX, COVER_CY = 512.0, 500.0
COVER_HW, COVER_HH = 260.0, 372.0
RADIUS = 44.0


def cover_blue(px: float, py: float):
    """封面的蓝色渐变：上浅下深，像有光从左上打下来。"""
    top = COVER_CY - COVER_HH
    t = clamp01((py - top) / (2.0 * COVER_HH))
    # #4E93E4 -> #22509A
    return (
        0.306 + (0.133 - 0.306) * t,
        0.576 + (0.314 - 0.576) * t,
        0.894 + (0.604 - 0.894) * t,
    )


def build() -> None:
    """画出书本身（阴影 -> 书页 -> 书脊 -> 封面）。"""
    # 1) 投影：整本书往右下偏一点，做成柔和阴影
    shadow = round_rect(COVER_CX + 14, COVER_CY + 30, COVER_HW + 58, COVER_HH + 26, RADIUS + 10)
    paint(
        *bbox(COVER_CX + 14, COVER_CY + 30, COVER_HW + 58, COVER_HH + 26, 34),
        shadow,
        (0.04, 0.10, 0.22),
        alpha=0.34,
        aa=30.0,
    )

    # 2) 书页（奶油色）：比封面宽一点，右边露出"书口"
    pages = round_rect(COVER_CX + 20, COVER_CY, COVER_HW + 32, COVER_HH - 8, RADIUS - 4)
    paint(
        *bbox(COVER_CX + 20, COVER_CY, COVER_HW + 32, COVER_HH - 8, 4),
        pages,
        (0.965, 0.937, 0.867),
    )

    # 书口上的几条横线（页与页的分界）
    for index in range(5):
        y = COVER_CY - COVER_HH + 120 + index * 130
        line = round_rect(COVER_CX + COVER_HW + 24, y, 7.0, 1.6, 1.6)
        paint(
            *bbox(COVER_CX + COVER_HW + 24, y, 7.0, 1.6, 2),
            line,
            (0.72, 0.68, 0.60),
            alpha=0.9,
        )

    # 3) 书脊：比封面宽，于是封面左边会露出一条更深的蓝
    spine = round_rect(COVER_CX - 26, COVER_CY, COVER_HW + 30, COVER_HH, RADIUS)
    paint(
        *bbox(COVER_CX - 26, COVER_CY, COVER_HW + 30, COVER_HH, 4),
        spine,
        (0.106, 0.267, 0.545),
    )

    # 书脊上的两条压纹
    for offset in (10.0, 24.0):
        groove = round_rect(COVER_CX - 26 + offset - 16, COVER_CY, 1.4, COVER_HH - 26, 1.4)
        paint(
            *bbox(COVER_CX - 26 + offset - 16, COVER_CY, 1.4, COVER_HH - 26, 2),
            groove,
            (0.56, 0.71, 0.91),
            alpha=0.5,
        )

    # 4) 封面本体（蓝色渐变）+ 一圈深色描边，边界更利落
    cover = round_rect(COVER_CX, COVER_CY, COVER_HW, COVER_HH, RADIUS)
    paint(*bbox(COVER_CX, COVER_CY, COVER_HW, COVER_HH, 4), cover, cover_blue)

    def cover_edge(px: float, py: float) -> float:
        """封面轮廓的"环"SDF：|d| - w 只在边界附近那一圈里是负的。"""
        return abs(cover(px, py)) - 2.0

    paint(
        *bbox(COVER_CX, COVER_CY, COVER_HW, COVER_HH, 6),
        cover_edge,
        (0.086, 0.208, 0.416),
        alpha=0.55,
    )


def footprint(cx: float, cy: float, rot: float, scale: float = 1.0) -> None:
    """印一个兔子脚印：一个脚掌 + 三个脚趾（四个椭圆）。"""
    white = (1.0, 1.0, 1.0)
    # 脚掌：横向的椭圆
    pad = ellipse(cx, cy, 42.0 * scale, 30.0 * scale, rot)
    paint(*bbox(cx, cy, 44.0 * scale, 32.0 * scale, 2), pad, white, alpha=0.93)
    # 脚趾：三颗在脚掌正前方排成一道浅弧（局部坐标再按 rot 旋转）
    cos_r = math.cos(rot)
    sin_r = math.sin(rot)
    for ox, oy in ((-36.0, -50.0), (0.0, -64.0), (36.0, -50.0)):
        # 屏幕坐标是 y 向下，这里按 rot 旋转局部偏移
        tx = cx + (ox * cos_r - oy * sin_r) * scale
        ty = cy + (ox * sin_r + oy * cos_r) * scale
        toe = ellipse(tx, ty, 16.0 * scale, 13.5 * scale, rot)
        paint(*bbox(tx, ty, 18.0 * scale, 15.5 * scale, 2), toe, white, alpha=0.93)


def build_prints() -> None:
    """三个脚印，沿着封面从左下走到右上。"""
    footprint(388.0, 686.0, -0.34)
    footprint(516.0, 552.0, -0.34)
    footprint(644.0, 418.0, -0.34)

# ---------------------------------------------------------------- PNG 输出
def write_png(path: Path) -> None:
    """把画面缓冲写成 8 位 RGBA 的 PNG（手写 chunk，只用 zlib）。"""
    # 每行前面一个 filter 字节（0 = None），再逐像素把预乘还原成直通 alpha
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        base = y * SIZE
        for x in range(base, base + SIZE):
            a = ALP[x]
            if a <= 0.0:
                raw.extend((0, 0, 0, 0))
                continue
            raw.append(int(clamp01(RED[x] / a) * 255.0 + 0.5))
            raw.append(int(clamp01(GRN[x] / a) * 255.0 + 0.5))
            raw.append(int(clamp01(BLU[x] / a) * 255.0 + 0.5))
            raw.append(int(clamp01(a) * 255.0 + 0.5))

    def chunk(tag: bytes, data: bytes) -> bytes:
        """一个 PNG chunk：长度 + 标签 + 数据 + CRC。"""
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def preview() -> None:
    """在终端打一张 96×96 的字符预览 + 几个采样点，用来肉眼确认形状/配色对不对。"""
    step = SIZE // 96
    for row in range(96):
        line = []
        for col in range(96):
            # 取格子中心的那个像素
            x = col * step + step // 2
            y = row * step + step // 2
            i = y * SIZE + x
            alpha = ALP[i]
            if alpha < 0.25:
                line.append(" ")
                continue
            r = RED[i] / alpha
            g = GRN[i] / alpha
            b = BLU[i] / alpha
            # 注意顺序：白（兔脚印）的蓝通道最亮，书口的奶油色次之，别把奶油判成白
            if r > 0.88 and g > 0.88 and b > 0.90:
                line.append("W")  # 兔脚印
            elif r > 0.88 and g > 0.85:
                line.append("c")  # 书口（奶油）
            elif b > r + 0.15:
                line.append("#" if b < 0.62 else "b")  # 书脊 / 封面蓝
            else:
                line.append(".")
        print("".join(line))

    # 采样几个关键点，把真实颜色打出来（0-255）
    print()
    for label, (x, y) in (
        ("背景(50,50)", (50, 50)),
        ("书脊(230,500)", (230, 500)),
        ("封面中部(470,760)", (470, 760)),
        ("封面顶部(470,190)", (470, 190)),
        ("书口(790,500)", (790, 500)),
        ("脚印脚掌(516,552)", (516, 552)),
        ("脚印脚趾(516,495)", (516, 495)),
    ):
        i = y * SIZE + x
        alpha = ALP[i]
        if alpha <= 0.0:
            print("  {:18s} 全透明".format(label))
            continue
        print(
            "  {:18s} #{:02X}{:02X}{:02X}  alpha={:.2f}".format(
                label,
                int(clamp01(RED[i] / alpha) * 255 + 0.5),
                int(clamp01(GRN[i] / alpha) * 255 + 0.5),
                int(clamp01(BLU[i] / alpha) * 255 + 0.5),
                alpha,
            )
        )


def zoom(cx: float, cy: float, half: float = 112.0, cells: int = 46) -> None:
    """把一个局部放大成字符画（用来确认脚印的形状像不像）。"""
    step = (2.0 * half) / cells
    print("--- 放大 ({:.0f}, {:.0f}) 周围 ---".format(cx, cy))
    for row in range(cells):
        line = []
        for col in range(cells):
            x = int(cx - half + (col + 0.5) * step)
            y = int(cy - half + (row + 0.5) * step)
            i = y * SIZE + x
            alpha = ALP[i]
            if alpha < 0.25:
                line.append(" ")
                continue
            r = RED[i] / alpha
            g = GRN[i] / alpha
            # 脚印（近白）比蓝色封面亮得多
            line.append("#" if r > 0.75 and g > 0.78 else ".")
        print("".join(line))


def main() -> None:
    """画好、存盘、打预览。"""
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/paget-icon.png")
    build()
    build_prints()
    write_png(out)
    print("wrote", out, out.stat().st_size, "bytes")
    preview()
    zoom(516.0, 552.0)


if __name__ == "__main__":
    main()
