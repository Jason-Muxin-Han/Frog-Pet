#!/usr/bin/env python3
"""只平滑青蛙外轮廓（alpha 与边缘颜色），内部白/绿/黑色块与网点质感原样保留。

原 GIF 去背景后外轮廓有两类问题：
  - 低不透明度的抖动绒毛，让边缘发毛、发虚；
  - 半透明边缘像素的 RGB 明显偏亮（浅绿/白），一旦被拉成不透明就形成亮绿描边。

处理链：
  1. 二值轮廓做中值 + 开闭运算，抹掉 1px 尖刺与孔洞（形状基本不变）；
  2. 高斯羽化 + 软阈值重映射，得到约 1px 的抗锯齿过渡带；
  3. 用 5x5 邻域内「完全不透明实体像素」的颜色均值，替换半透明带与
     新纳入的实体边缘，消除亮绿描边 / 白色光晕；内部像素一个都不动；
  4. 沿平滑后的实体外沿外扩 1px，加一条深橄榄色（与黑眼同色系）细轮廓线，
     带羽化，不遮盖白/绿/黑任一色块。

反复运行时请先从上一版交付包的 app.asar 恢复 src/frames/ 基准素材，
避免对已平滑的帧重复处理。
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "src" / "frames"
STROKE = np.array([46, 56, 16], dtype=np.uint8)   # 细轮廓线：深橄榄，与黑眼同色系


def entity_color_field(rgb, solid):
    """5x5 邻域内实体像素的 RGB 均值；实体本身颜色正常，用作边缘可信色。"""
    m = solid.astype(np.float32)
    acc = np.zeros(rgb.shape, dtype=np.float32)
    cnt = np.zeros(m.shape, dtype=np.float32)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            sm = np.roll(np.roll(m, dy, axis=0), dx, axis=1)
            sr = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1).astype(np.float32)
            acc += sr * sm[..., None]
            cnt += sm
    avg = np.clip(acc / np.maximum(cnt, 1)[..., None], 0, 255).astype(np.uint8)
    return avg, cnt > 0


def smooth_one(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    rgb = a[:, :, :3].copy()
    alpha = a[:, :, 3]
    solid = alpha >= 250                       # 颜色可信的完全不透明实体

    # 1) 轮廓形状平滑：去 1px 尖刺、补 1px 小孔，小脚等主体形状不变
    core = (
        Image.fromarray(((alpha >= 150) * 255).astype(np.uint8))
        .filter(ImageFilter.MedianFilter(3))
        .filter(ImageFilter.MinFilter(3))
        .filter(ImageFilter.MaxFilter(3))
        .filter(ImageFilter.MaxFilter(3))
        .filter(ImageFilter.MinFilter(3))
    )
    # 2) 羽化，收紧过渡带
    soft = np.asarray(core.filter(ImageFilter.GaussianBlur(0.9)), dtype=np.float32) / 255.0
    new_alpha = (np.clip((soft - 0.18) / 0.44, 0.0, 1.0) * 255).astype(np.uint8)

    # 3) 只替换偏亮的边缘像素；内部像素完全不动。
    #    取色源用「向内腐蚀 2px」的实体区，避开原本就偏亮的最外圈像素；
    #    腐蚀覆盖不到的极外缘再退回全部实体色兜底。
    inner = np.asarray(
        Image.fromarray((solid * 255).astype(np.uint8))
        .filter(ImageFilter.MinFilter(5))
    ) > 0
    field, has = entity_color_field(rgb, inner)
    field_all, has_all = entity_color_field(rgb, solid)
    field = np.where(has[..., None], field, field_all)
    has = has_all
    edge = (new_alpha > 0) & (new_alpha < 250)
    newly_solid = (new_alpha >= 250) & (alpha < 250)
    replace = (edge | newly_solid) & has
    rgb[replace] = field[replace]

    # 4) 外沿 1px 细轮廓线（外扩，不侵入内部色块）
    solid_img = Image.fromarray(((new_alpha >= 200) * 255).astype(np.uint8))
    dilated = np.asarray(solid_img.filter(ImageFilter.MaxFilter(3))) > 0
    ring = dilated & (new_alpha < 200)
    stroke_a = np.asarray(
        Image.fromarray((ring * 255).astype(np.uint8))
        .filter(ImageFilter.GaussianBlur(0.5))
    )
    stroke = np.zeros((*new_alpha.shape, 4), dtype=np.uint8)
    stroke[:, :, :3] = STROKE
    stroke[:, :, 3] = stroke_a

    frog_img = Image.fromarray(
        np.dstack([rgb, new_alpha]).astype(np.uint8), "RGBA"
    )
    Image.alpha_composite(
        Image.fromarray(stroke, "RGBA"), frog_img
    ).save(path)


def main():
    files = sorted(FRAMES.glob("f*.png"))
    for p in files:
        smooth_one(p)
    print(f"smoothed outer edges of {len(files)} frames at {FRAMES}")


if __name__ == "__main__":
    main()
