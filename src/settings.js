/* 设置窗口：状态双向同步 */
(function () {
  'use strict';
  const api = window.petAPI;
  const S = window.FrogShared;
  const F = window.FrogFrames;
  const state = {
    mode: 'still', color: '#B4D855', gapMax: 7000, scale: 1,
    alwaysOnTop: true, clickThrough: true, autoLaunch: false,
    sourceFacesLeft: true
  };
  let framesReady = false;
  const MODE_TEXT = {
    still: '静止不动 · 仅单击时跳一次',
    hop: '持续原地上下跳',
    roam: '持续向随机方向跳'
  };

  const $ = id => document.getElementById(id);

  function renderPreview() {
    if (!framesReady) return;
    F.setColor(state.color);
    F.drawTo($('preview-frog'), F.IDLE_FRAME, false);
  }

  function render(patch) {
    Object.assign(state, patch || {});
    S.applyFrogColor(state.color);

    document.querySelectorAll('.mode').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === state.mode));
    $('subtitle').textContent = MODE_TEXT[state.mode] || '';

    $('gap').value = Math.round(state.gapMax / 1000);
    $('gap-value').textContent = `1 ~ ${Math.round(state.gapMax / 1000)} 秒`;
    $('size').value = Math.round(state.scale * 100);

    document.querySelectorAll('.swatch').forEach(b =>
      b.classList.toggle('active', b.dataset.color.toLowerCase() === state.color.toLowerCase()));
    const preset = S.PRESETS.find(p => p.color.toLowerCase() === state.color.toLowerCase());
    $('color-value').textContent = preset ? preset.name : '自定义';
    $('custom').value = state.color;

    $('alwaysOnTop').checked = !!state.alwaysOnTop;
    $('clickThrough').checked = !!state.clickThrough;
    $('autoLaunch').checked = !!state.autoLaunch;
    $('stop-jump').disabled = state.mode === 'still';
    document.querySelectorAll('.face-opt').forEach(b =>
      b.classList.toggle('active', (b.dataset.face === 'left') === !!state.sourceFacesLeft));
    renderPreview();
  }

  function buildSwatches() {
    const wrap = $('swatches');
    S.PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = p.color;
      b.title = p.name;
      b.dataset.color = p.color;
      b.addEventListener('click', () => api.setState({ color: p.color }));
      wrap.appendChild(b);
    });
  }

  function bind() {
    document.querySelectorAll('.mode').forEach(b =>
      b.addEventListener('click', () => api.setState({ mode: b.dataset.mode })));
    $('stop-jump').addEventListener('click', () => api.setState({ mode: 'still' }));
    document.querySelectorAll('.face-opt').forEach(b =>
      b.addEventListener('click', () =>
        api.setState({ sourceFacesLeft: b.dataset.face === 'left' })));

    $('gap').addEventListener('input', e => {
      $('gap-value').textContent = `1 ~ ${e.target.value} 秒`;
    });
    $('gap').addEventListener('change', e =>
      api.setState({ gapMax: Number(e.target.value) * 1000 }));

    $('size').addEventListener('change', e =>
      api.setState({ scale: Number(e.target.value) / 100 }));

    $('custom').addEventListener('input', e => {
      state.color = e.target.value;
      S.applyFrogColor(state.color);
      F.setColor(state.color);
      renderPreview();
      $('color-value').textContent = '自定义';
    });
    $('custom').addEventListener('change', e => api.setState({ color: e.target.value }));
    $('random-color').addEventListener('click', () => api.setState({ color: S.randomColor() }));

    ['alwaysOnTop', 'clickThrough', 'autoLaunch'].forEach(key => {
      $(key).addEventListener('change', e => api.setState({ [key]: e.target.checked }));
    });

    $('reset').addEventListener('click', () => api.resetPosition());
    $('quit').addEventListener('click', () => api.quit());
    $('close').addEventListener('click', () => api.closeSettings());
  }

  buildSwatches();
  bind();
  api.onState(render);
  api.getState().then(render).catch(() => render({}));
  F.load().then(() => { framesReady = true; renderPreview(); });
})();
