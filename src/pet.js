/* 青蛙桌宠渲染层：直接播放原 GIF 帧序列，处理单击/拖拽/穿透与预览降级 */
(function () {
  'use strict';

  const api = window.petAPI || null;
  const demo = !api;
  const S = window.FrogShared;
  const F = window.FrogFrames;
  const canvas = document.getElementById('frog');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stage = document.getElementById('stage');

  const state = {
    mode: 'still',
    color: '#B4D855',
    gapMin: 1000,
    gapMax: 7000,
    scale: 1,
    clickThrough: true,
    sourceFacesLeft: true          // 原 GIF 形象头朝左；若判断相反可在设置中切换
  };

  let flip = false;                // 当前是否水平镜像
  let currentFrame = F.IDLE_FRAME;
  let raf = null;
  let token = 0;
  let stageAnim = null;
  let demoTimer = null;
  let lastJumpAt = 0;
  let demoX = 0, demoY = 0;
  let interactive = false;
  let dragging = false, dragged = false, startScreen = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function paint(frame) {
    currentFrame = frame === undefined ? F.IDLE_FRAME : frame;
    F.draw(ctx, currentFrame, flip);
  }
  window.__frogFrame = () => ({ frame: currentFrame, flip });

  /* 三种动作：静止=完全静态；原地跳/随机跳=播放同一段原 GIF 帧序列 */
  function playHop(dirX) {
    if (dirX) {
      const rightward = dirX > 0;
      // 规则：向哪个方向跳，头就朝向哪个方向。
      // 原图默认头朝左：向右跳需镜像成头朝右，向左跳保持原样。
      flip = rightward ? state.sourceFacesLeft : !state.sourceFacesLeft;
    }
    const myToken = ++token;
    if (raf) cancelAnimationFrame(raf);
    const seq = F.HOP_SEQUENCE;
    const t0 = performance.now();
    let shown = -1;

    function tick(now) {
      if (myToken !== token) return;
      const t = now - t0;
      let acc = 0, idx = 0;
      for (; idx < seq.length; idx++) {
        acc += F.frameDuration(seq[idx]);
        if (t < acc) break;
      }
      if (idx >= seq.length) {
        paint(F.IDLE_FRAME);
        raf = null;
        return;
      }
      if (seq[idx] !== shown) {
        paint(seq[idx]);
        shown = seq[idx];
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    token++;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    paint(F.IDLE_FRAME);
  }

  /* 冷却期内的点击反馈：轻微摆动，不打断动画 */
  function deny() {
    canvas.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }
    ], { duration: 260, easing: 'ease-in-out' });
  }

  function requestHop() {
    const now = Date.now();
    if (now - lastJumpAt < state.gapMin) { deny(); return; }
    lastJumpAt = now;
    if (api) api.requestHop();
    else { playHop(0); scheduleDemo(); }
  }

  /* 自动调度：两次跳跃开始时刻间隔 ≥1 秒且随机 */
  function scheduleDemo() {
    if (!demo) return;
    clearTimeout(demoTimer);
    if (state.mode === 'still') return;
    const gap = rand(state.gapMin, state.gapMax);
    const delay = Math.max(50, lastJumpAt + gap - Date.now());
    demoTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastJumpAt < state.gapMin) { scheduleDemo(); return; }
      lastJumpAt = now;
      if (state.mode === 'roam') {
        // 斜抛：步长基本恒定，方向角随机，横纵分量由此分解
        const step = rand(480, 620);
        const theta = rand(0, Math.PI * 2);
        const dx = Math.round(step * Math.cos(theta));
        const dy = Math.round(step * Math.sin(theta));
        demoMove(dx, dy);
        playHop(dx);
      } else {
        playHop(0);
      }
      scheduleDemo();
    }, delay);
  }

  /* 预览模式：按二次抛物线轨迹完成斜抛位移（与桌面窗口位移同一模型） */
  function demoMove(dx, dy) {
    const fromX = demoX, fromY = demoY;
    const toX = clamp(fromX + dx, -460, 460);
    const toY = clamp(fromY + dy, -400, 400);
    const ddx = toX - fromX, ddy = toY - fromY;
    const arc = Math.min(150, Math.hypot(ddx, ddy) * 0.30);
    demoX = toX; demoY = toY;
    if (stageAnim) stageAnim.cancel();
    const pos = (u, lift) =>
      `translate(${fromX + ddx * u}px, ${fromY + ddy * u - lift}px)`;
    stageAnim = stage.animate([
      { transform: pos(0, 0), offset: 0 },
      { transform: pos(0.25, arc * 0.75), offset: 0.25 },
      { transform: pos(0.50, arc), offset: 0.50 },
      { transform: pos(0.75, arc * 0.75), offset: 0.75 },
      { transform: pos(1, 0), offset: 1 }
    ], { duration: 900, easing: 'linear', fill: 'forwards' });
    stageAnim.onfinish = () => {
      stage.style.transform = `translate(${toX}px, ${toY}px)`;
      if (stageAnim) { stageAnim.cancel(); stageAnim = null; }
    };
  }

  /* ── 状态同步 ───────────────────────────────────────── */
  function applyState(patch) {
    const prevMode = state.mode;
    Object.assign(state, patch || {});
    S.applyFrogColor(state.color);
    F.setColor(state.color);
    document.documentElement.style.setProperty('--size', state.scale);
    if (state.mode === 'still') {
      if (raf) stopAnimation();
      else paint(F.IDLE_FRAME);
      flip = false;
      paint(F.IDLE_FRAME);
    } else if (prevMode === 'still' && !demo) {
      paint(F.IDLE_FRAME);
    } else {
      paint(currentFrame);       // 换色 / 朝向基准变化后立即重绘当前帧
    }
    if (demo) { syncDemoUI(); scheduleDemo(); }
  }

  /* ── 鼠标命中：透明区域不拦截桌面点击 ───────────────── */
  function isHit(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!el && el.id === 'hit-area';
  }
  function updateInteractive(e) {
    if (!api || !state.clickThrough) return;
    const hit = isHit(e);
    if (hit !== interactive) { interactive = hit; api.setInteractive(hit); }
  }

  window.addEventListener('mousemove', e => {
    updateInteractive(e);
    if (!dragging) return;
    const dx = e.screenX - startScreen.x, dy = e.screenY - startScreen.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    if (api) api.dragMove(dx, dy);
    else stage.style.transform = `translate(${demoX + dx}px, ${demoY + dy}px)`;
  });

  window.addEventListener('mousedown', e => {
    if (e.button !== 0 || !isHit(e)) return;
    dragging = true; dragged = false;
    startScreen = { x: e.screenX, y: e.screenY };
    document.body.classList.add('dragging');
    if (api) api.dragStart();
  });

  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    if (api) {
      api.dragEnd();
    } else {
      demoX += e.screenX - startScreen.x;
      demoY += e.screenY - startScreen.y;
      stage.style.transform = `translate(${demoX}px, ${demoY}px)`;
    }
    if (!dragged && isHit(e)) requestHop();
  });

  document.addEventListener('mouseleave', () => {
    if (api && state.clickThrough && interactive) {
      interactive = false;
      api.setInteractive(false);
    }
  });

  window.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (api) api.contextMenu();
  });

  /* ── 预览模式控制面板 ───────────────────────────────── */
  function buildDemoPanel() {
    document.body.classList.add('demo');
    const wrap = document.getElementById('swatches');
    S.PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = p.color;
      b.title = p.name;
      b.dataset.color = p.color;
      b.addEventListener('click', () => setColor(p.color));
      wrap.appendChild(b);
    });
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        if (state.mode === 'still') stopAnimation();
        syncDemoUI();
        scheduleDemo();
      });
    });
    document.querySelectorAll('.face-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.sourceFacesLeft = b.dataset.face === 'left';
        syncDemoUI();
      });
    });
    document.getElementById('demo-stop').addEventListener('click', () => {
      state.mode = 'still';
      clearTimeout(demoTimer);
      stopAnimation();
      syncDemoUI();
    });
    document.getElementById('custom-color').addEventListener('input', e => setColor(e.target.value));
    document.getElementById('gap-range').addEventListener('input', e => {
      state.gapMax = Number(e.target.value) * 1000;
      syncDemoUI(); scheduleDemo();
    });
    document.getElementById('size-range').addEventListener('input', e => {
      state.scale = Number(e.target.value) / 100;
      document.documentElement.style.setProperty('--size', state.scale);
      syncDemoUI();
    });
  }

  function setColor(hex) {
    state.color = hex;
    S.applyFrogColor(hex);
    F.setColor(hex);
    paint(currentFrame);
    syncDemoUI();
  }

  function syncDemoUI() {
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === state.mode));
    document.querySelectorAll('.face-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.face === 'left') === !!state.sourceFacesLeft));
    document.querySelectorAll('.swatch').forEach(b =>
      b.classList.toggle('active', b.dataset.color.toLowerCase() === state.color.toLowerCase()));
    const preset = S.PRESETS.find(p => p.color.toLowerCase() === state.color.toLowerCase());
    document.getElementById('color-name').textContent = preset ? preset.name : '自定义';
    document.getElementById('gap-label').textContent = (state.gapMax / 1000) + ' 秒';
    document.getElementById('gap-range').value = state.gapMax / 1000;
    document.getElementById('size-label').textContent = Math.round(state.scale * 100) + '%';
    document.getElementById('size-range').value = Math.round(state.scale * 100);
    document.getElementById('custom-color').value = state.color;
  }

  /* ── 启动 ───────────────────────────────────────────── */
  F.load().then(() => {
    if (demo) {
      buildDemoPanel();
      applyState({});
    } else {
      api.onState(applyState);
      api.onAction(a => {
        if (a.at) lastJumpAt = a.at;
        playHop(a.dirX || 0);
      });
      api.onDenied(p => {
        if (p && p.lastJumpAt) lastJumpAt = p.lastJumpAt;
        deny();
      });
      api.getState().then(applyState).catch(() => applyState({}));
      api.ready();
      paint(F.IDLE_FRAME);
    }
  });
})();
