/* 原 GIF 帧渲染器：加载透明帧、按序列绘制、仅替换绿色色块（白肚皮与黑眼保留） */
(function () {
  'use strict';

  const S = window.FrogShared;
  const FRAME_COUNT = 53;
  const IDLE_FRAME = 49;                 // 原 GIF 末尾的静止帧
  // 从原 GIF 帧中编排的一次完整跳跃：静止 → 蓄力压扁 → 起跳 → 顶点 → 下落 → 落地压扁 → 回弹
  const HOP_SEQUENCE = [49, 1, 10, 12, 13, 0, 4, 6, 30, 39, 15, 24, 49];
  const DEFAULT_COLOR = '#B4D855';
  const ZOOM = 1.18;                 // 原 GIF 画布留白较多，等比放大使形象更醒目

  const images = [];
  const recolorCache = new Map();
  let color = DEFAULT_COLOR;
  let durations = window.FROG_FRAME_DURATIONS || [];

  function mixRgb(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }

  /* 按原帧亮度把绿色系像素映射到目标色的暗/中/亮三档，保留白与黑 */
  function recolor(index) {
    const src = images[index];
    const c = document.createElement('canvas');
    c.width = 240; c.height = 240;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, 240, 240);
    const p = data.data;

    const main = S.hexToRgb(color);
    const dark = mixRgb(main, S.hexToRgb('#1A2200'), 0.34);
    const light = mixRgb(main, S.hexToRgb('#FFFFFF'), 0.34);

    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const R = p[i], G = p[i + 1], B = p[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const luma = 0.299 * R + 0.587 * G + 0.114 * B;
      // 保留中性亮色（白色下半身 / 高光）与深色（黑色眼睛），其余含抖动网点的
      // 彩色像素统一映射到目标色，避免换色后残留黄绿色斑块。
      const keep = (mx - mn < 45 && luma > 165) || luma < 115;
      if (keep) continue;
      const t = Math.max(0, Math.min(1, (luma - 145) / 85));
      const col = t < 0.5 ? mixRgb(dark, main, t * 2) : mixRgb(main, light, (t - 0.5) * 2);
      p[i] = col.r; p[i + 1] = col.g; p[i + 2] = col.b;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  function source(index) {
    if (color.toLowerCase() === DEFAULT_COLOR.toLowerCase()) return images[index];
    const key = color + ':' + index;
    if (!recolorCache.has(key)) recolorCache.set(key, recolor(index));
    return recolorCache.get(key);
  }

  function load() {
    const jobs = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      jobs.push(new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = `frames/f${String(i).padStart(2, '0')}.png`;
        images[i] = img;
      }));
    }
    return Promise.all(jobs);
  }

  /* 把指定帧绘制到 240×240 的 2D 上下文，flip=true 时水平镜像 */
  function draw(ctx, index, flip) {
    const img = source(index);
    if (!img) return;
    ctx.clearRect(0, 0, 240, 240);
    ctx.save();
    if (flip) { ctx.translate(240, 0); ctx.scale(-1, 1); }
    ctx.translate(120, 120);
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-120, -120);
    ctx.drawImage(img, 0, 0, 240, 240);
    ctx.restore();
  }

  function drawTo(canvas, index, flip) {
    const ctx = canvas.getContext('2d');
    draw(ctx, index, flip);
  }

  function setColor(hex) {
    if (!hex || hex.toLowerCase() === color.toLowerCase()) return;
    color = hex;
    recolorCache.clear();
  }

  function frameDuration(index) {
    return durations[index] || 70;
  }

  function hopDuration() {
    return HOP_SEQUENCE.reduce((sum, f) => sum + frameDuration(f), 0);
  }

  window.FrogFrames = {
    FRAME_COUNT, IDLE_FRAME, HOP_SEQUENCE, DEFAULT_COLOR,
    load, draw, drawTo, setColor, frameDuration, hopDuration
  };
})();
