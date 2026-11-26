"""从原始 GIF 逐帧导出高清透明 PNG 素材，供桌宠直接使用原图形象。

原图是 240×240 的索引色 GIF：抖动网点多、白/绿边界布满毛刺、整体发糊。
这里把它当作「白 / 绿 / 黑三色块的扁平插画」来还原，而不是逐像素硬判定：

  1) 以绿色 + 黑色 + 中性灰白（肚皮）为实体，从画布四边 flood fill 找外部背景，
     再只保留最大连通块；用绿色凸包几何补齐与背景同色的白色下半身。
  2) 把外轮廓、白肚皮、黑眼分别转成连续「色块场」：先中值/形态学滤波去掉
     抖动网点与孤立尖刺，再高斯柔化，最后软阈值得到平滑边界（不再是锯齿）。
  3) 在 3 倍分辨率（720×720）上重新合成扁平色块 + 平滑明暗渐变 + 抗锯齿 alpha，
     相当于把糊掉的原图矢量化重采样，边缘利落、三色块干净，且不改动原图造型。
"""
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Path("/Users/jason/Downloads/1795435804801.gif")
OUT = ROOT / "src" / "frames"
OUT.mkdir(parents=True, exist_ok=True)

BASE = 240
SCALE = 3
HI = BASE * SCALE                       # 输出分辨率：720×720


def convex_hull_mask(binary, h, w):
    """绿色像素的凸包：给出青蛙整体外轮廓，用于约束白色下半身的补齐范围。"""
    ys, xs = np.nonzero(binary)
    pts = sorted(set(zip(xs.tolist(), ys.tolist())))
    if len(pts) < 3:
        return binary.copy()

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).polygon(hull, fill=255)
    return np.asarray(img) > 0


def blur(arr, radius):
    if radius <= 0:
        return arr
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0


def clean_field(binary, median_k=5, open_k=3, close_k=3, soft=1.0):
    """把抖动二值掩膜清洗成 0..1 连续场：去孤立点 → 去尖刺 → 填小孔 → 柔化。"""
    img = Image.fromarray((binary.astype(np.uint8) * 255))
    if median_k:
        img = img.filter(ImageFilter.MedianFilter(median_k))
    if open_k:                                  # 开运算：去掉单像素毛刺
        img = img.filter(ImageFilter.MinFilter(open_k)).filter(ImageFilter.MaxFilter(open_k))
    if close_k:                                 # 闭运算：填掉抖动造成的小孔
        img = img.filter(ImageFilter.MaxFilter(close_k)).filter(ImageFilter.MinFilter(close_k))
    return blur(np.asarray(img).astype(np.float32) / 255.0, soft)


def ramp(field, lo, hi):
    """软阈值：把连续场压成带窄过渡带的色块权重，过渡带即平滑边界。"""
    return np.clip((field - lo) / (hi - lo), 0, 1).astype(np.float32)


def upscale(field):
    """把 240×240 的连续场用三次插值放大到 720×720，得到亚像素级平滑边界。"""
    img = Image.fromarray((np.clip(field, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((HI, HI), Image.Resampling.BICUBIC)).astype(np.float32) / 255.0


def high(field, lo, hi, feather=0.6):
    """清洗 → 放大 → 软阈值，返回高分辨率色块权重。"""
    return ramp(blur(upscale(field), feather), lo, hi)


# 高分辨率上的扁平色块配色（保留原图明暗关系，去掉抖动网点）
Y, X = np.mgrid[0:HI, 0:HI].astype(np.float32)
NY, NX = Y / HI, X / HI
darkness = np.clip(0.45 + (NY - 0.40) * 0.90 + (NX - 0.50) * 0.35, 0, 1)[..., None]
GREEN_LIGHT = np.array([192, 226, 108], np.float32)
GREEN_DARK = np.array([130, 170, 64], np.float32)
GREEN = GREEN_LIGHT * (1 - darkness) + GREEN_DARK * darkness
WHITE_SHADE = np.clip((NY - 0.48) * 0.70, 0, 1)[..., None]
# 白色色块调成柔和的灰白（接近原图偏灰的肚皮，但仍明显亮于绿色块）；
# 亮度保持在换色判定阈值之上，确保换绿色时肚皮不会被染色。
WHITE = np.array([230, 230, 224], np.float32) * (1 - WHITE_SHADE) + \
        np.array([200, 201, 193], np.float32) * WHITE_SHADE
BLACK = np.array([28, 32, 9], np.float32)
HILITE = np.array([252, 252, 248], np.float32)

gif = Image.open(SRC)
manifest = []
sheet = Image.new("RGB", (8 * 150, 7 * 150), (235, 238, 230))

for i in range(gif.n_frames):
    gif.seek(i)
    fr = gif.convert("RGBA")
    dur = gif.info.get("duration", 70)
    a = np.asarray(fr).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    sat = mx - mn

    green = (g > r * 1.08) & (g > b * 1.08) & (g > 100)
    black = (r < 115) & (g < 115) & (b < 115) & (sat < 80)
    # 肚皮是中性灰白（原图约 180,180,170），背景是纯白（约 252,252,255）
    neutral = (sat < 62) & (luma > 145) & (luma < 236)
    pure_bg_white = (mn > 235) & (sat < 25)

    h, w = green.shape
    gy, gx = np.nonzero(green)
    gx0, gx1, gy0, gy1 = gx.min(), gx.max(), gy.min(), gy.max()
    bw, bh = gx1 - gx0, gy1 - gy0

    # ── 1. 外轮廓 ──────────────────────────────────────────────
    region = np.zeros_like(green)
    region[max(0, gy0 - 3):min(h, gy1 + 4), max(0, gx0 - 3):min(w, gx1 + 4)] = True
    solid = green | black | (neutral & region)

    external = np.zeros_like(solid, dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not solid[y, x] and not external[y, x]:
                external[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not solid[y, x] and not external[y, x]:
                external[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not solid[ny, nx] and not external[ny, nx]:
                external[ny, nx] = True
                q.append((ny, nx))

    candidate = ~external
    seen = np.zeros_like(candidate, dtype=bool)
    best, best_size = None, 0
    for y0 in range(h):
        for x0 in range(w):
            if not candidate[y0, x0] or seen[y0, x0]:
                continue
            comp, qq = [], deque([(y0, x0)])
            seen[y0, x0] = True
            while qq:
                y, x = qq.popleft()
                comp.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        qq.append((ny, nx))
            if len(comp) > best_size:
                best_size, best = len(comp), comp

    silhouette = np.zeros((h, w), dtype=bool)
    if best:
        ys, xs = zip(*best)
        silhouette[np.array(ys), np.array(xs)] = True

    # 白色下半身与背景同色：用绿色凸包内的几何区域补齐，避免「白裙边」
    yy, xx = np.ogrid[:h, :w]
    cx, cy = gx0 + 0.30 * bw, gy1 - 0.30 * bh
    rx, ry = max(8, 0.24 * bw), max(8, 0.21 * bh)
    belly_ellipse = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1
    body = convex_hull_mask(green, h, w)
    silhouette |= belly_ellipse & body & ~pure_bg_white

    # ── 2. 三色块连续场（关键：不再逐像素判定，边界自然平滑） ─────
    alpha_field = clean_field(silhouette, median_k=5, open_k=3, close_k=3, soft=1.0)

    # 肚皮：原图是一条略带弧度的水平白带，下沿之外才是两只绿色小脚。
    # 用超椭圆（圆角带）直接给出主形状，边界天然平滑，不再依赖抖动像素，
    # 也不会因为扣除绿色而在白块里挖出缺口。
    u = (xx - gx0) / max(1.0, float(bw))
    v = (yy - gy0) / max(1.0, float(bh))
    top_slope = 0.06 * u                     # 顶边自左向右微微下斜
    du = (u - 0.29) / 0.245
    dv = (v - 0.765 - top_slope * 0.5) / 0.175
    superellipse = np.abs(du) ** 3 + np.abs(dv) ** 3 <= 1
    belly_field = blur(superellipse.astype(np.float32), 1.6)

    # 黑眼：闭运算把抖动造成的小孔填实，得到干净的实心眼；高光只取自眼内部，
    # 不再使用外扩区域，避免把眼睛周围的白色抖动点收进来形成白环/白点。
    eye_field = clean_field(
        black & silhouette, median_k=5, open_k=3, close_k=3, soft=0.9
    )
    eye_solid = np.asarray(
        Image.fromarray((black & silhouette).astype(np.uint8) * 255)
        .filter(ImageFilter.MaxFilter(7))
        .filter(ImageFilter.MinFilter(7))
    ) > 0
    hilite_field = clean_field(
        eye_solid & (luma > 175) & (sat < 70) & silhouette,
        median_k=0, open_k=0, close_k=0, soft=0.7
    )

    # ── 3. 高分辨率合成 ────────────────────────────────────────
    # 收窄过渡带 = 让色块边界更锐利（连续场插值，仍是抗锯齿的平滑曲线，不会回潮成锯齿）
    alpha = high(alpha_field, 0.32, 0.68, feather=0.5)       # 抗锯齿外轮廓
    belly = high(belly_field, 0.38, 0.62, feather=0.45)      # 平滑且利落的白/绿边界
    eye = high(eye_field, 0.40, 0.60, feather=0.4)
    hl = high(hilite_field, 0.36, 0.64, feather=0.35)

    rgb = GREEN.copy()
    rgb = rgb * (1 - belly[..., None]) + WHITE * belly[..., None]
    rgb = rgb * (1 - eye[..., None]) + BLACK * eye[..., None]
    rgb = rgb * (1 - hl[..., None]) + HILITE * hl[..., None]
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    # 轻度锐化并限幅：unsharp 的过冲只在色块边界出现，若不限幅会形成亮白/暗绿细线。
    # 把每个通道的变化限制在 ±9，保留边缘的轻微清晰度提升，同时彻底消除光晕。
    base = rgb.astype(np.float32)
    sharp = np.asarray(
        Image.fromarray(rgb, "RGB").filter(
            ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=5)
        )
    ).astype(np.float32)
    rgb = np.clip(base + np.clip(sharp - base, -9, 9), 0, 255).astype(np.uint8)

    out = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
    Image.fromarray(out, "RGBA").save(OUT / f"f{i:02d}.png", optimize=True)
    manifest.append({"i": i, "dur": dur})

    thumb = Image.fromarray(out, "RGBA").resize((150, 150), Image.Resampling.LANCZOS)
    sheet.paste(thumb, ((i % 8) * 150, (i // 8) * 150), thumb)

(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
(OUT / "manifest.js").write_text(
    "window.FROG_FRAME_DURATIONS = "
    + json.dumps([m["dur"] for m in manifest])
    + ";\n",
    encoding="utf-8",
)
sheet.save(ROOT.parent / "analysis" / "transparent_frames.png")
print(f"exported {len(manifest)} frames at {HI}x{HI} to {OUT}")
