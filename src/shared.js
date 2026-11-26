/* 颜色预设与三色块派生逻辑，桌宠窗口与设置窗口共用 */
(function () {
  const PRESETS = [
    { name: '经典绿', color: '#B4D855' },
    { name: '薄荷绿', color: '#7BD8A6' },
    { name: '湖水蓝', color: '#6CC4E8' },
    { name: '晴空蓝', color: '#7FA9F0' },
    { name: '薰衣草', color: '#B69BE8' },
    { name: '樱花粉', color: '#F2A6C0' },
    { name: '蜜橘橙', color: '#F5B75C' },
    { name: '珊瑚红', color: '#F28A72' },
    { name: '柠檬黄', color: '#E8DD63' },
    { name: '石墨灰', color: '#9AA7B0' }
  ];

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0
    };
  }

  function toHex({ r, g, b }) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  function mix(hex, target, t) {
    const a = hexToRgb(hex), b = hexToRgb(target);
    return toHex({
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    });
  }

  /* 由用户选择的绿色派生亮面/暗面，白、黑色块保持不变 */
  function derive(hex) {
    return {
      main: hex,
      light: mix(hex, '#FFFFFF', 0.32),
      shade: mix(hex, '#1A2200', 0.28)
    };
  }

  function applyFrogColor(hex) {
    const c = derive(hex);
    const root = document.documentElement.style;
    root.setProperty('--frog-main', c.main);
    root.setProperty('--frog-light', c.light);
    root.setProperty('--frog-shade', c.shade);
    return c;
  }

  function randomColor() {
    const h = Math.floor(Math.random() * 360);
    const s = 55 + Math.random() * 25;
    const l = 60 + Math.random() * 12;
    // HSL -> RGB
    const a = s / 100 * Math.min(l / 100, 1 - l / 100);
    const f = n => {
      const k = (n + h / 30) % 12;
      return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
  }

  const exported = { PRESETS, hexToRgb, toHex, mix, derive, applyFrogColor, randomColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.FrogShared = exported;
})();
