/* 青蛙桌宠主进程：透明置顶窗口、系统托盘、跳跃调度、随机方向位移、状态持久化 */
const {
  app, BrowserWindow, ipcMain, Menu, Tray, screen, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { PRESETS, randomColor } = require('./shared.js');

const PET_W = 300;
const PET_H = 300;
const GAP_MIN = 1000;            // 硬性下限：两次跳跃至少间隔 1 秒
const HOP_MS = 900;              // 单次跳跃动画时长

const DEFAULTS = {
  mode: 'still',                 // still | hop | roam
  color: '#B4D855',
  gapMin: GAP_MIN,
  gapMax: 7000,
  scale: 1,
  alwaysOnTop: true,
  clickThrough: true,
  autoLaunch: false,
  sourceFacesLeft: true,         // 原 GIF 形象头朝左
  pos: null
};

let state = { ...DEFAULTS };
let petWin = null;
let settingsWin = null;
let tray = null;
let jumpTimer = null;
let roamTimer = null;
let saveTimer = null;
let lastJumpAt = 0;
let interactive = false;
let dragOrigin = null;
let settingsFile = '';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── 持久化 ───────────────────────────────────────────── */
function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return { ...DEFAULTS, ...saved, gapMin: GAP_MIN };
  } catch (_) {
    return { ...DEFAULTS };
  }
}
function saveState() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(state, null, 2)); } catch (_) {}
}
function savePositionDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const [x, y] = petWin.getPosition();
    state.pos = { x, y };
    saveState();
  }, 400);
}

/* ── 窗口 ─────────────────────────────────────────────── */
function initialPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  const p = state.pos || {
    x: area.x + area.width - PET_W - 48,
    y: area.y + area.height - PET_H - 48
  };
  return {
    x: clamp(Math.round(p.x), area.x, Math.max(area.x, area.x + area.width - PET_W)),
    y: clamp(Math.round(p.y), area.y, Math.max(area.y, area.y + area.height - PET_H))
  };
}

function createPetWindow() {
  const pos = initialPosition();
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: state.alwaysOnTop,
    backgroundColor: '#00000000',
    title: '青蛙桌宠',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  petWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
  if (process.platform === 'darwin') petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile(path.join(__dirname, 'pet.html'));
  petWin.on('moved', savePositionDebounced);
  petWin.on('closed', () => { petWin = null; });
  applyMouseThrough();
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 400,
    height: 690,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#171c14',
    title: '青蛙桌宠 · 设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('close', e => { e.preventDefault(); settingsWin.hide(); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function applyMouseThrough() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.setIgnoreMouseEvents(state.clickThrough && !interactive, { forward: true });
}

function broadcast() {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:state', state);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('pet:state', state);
}

/* ── 动作调度 ─────────────────────────────────────────── */
function scheduleNext() {
  clearTimeout(jumpTimer);
  if (state.mode === 'still') return;
  const gap = rand(GAP_MIN, Math.max(GAP_MIN + 1000, state.gapMax));
  const delay = Math.max(80, lastJumpAt + gap - Date.now());
  jumpTimer = setTimeout(() => {
    if (Date.now() - lastJumpAt < GAP_MIN) { scheduleNext(); return; }
    doJump(state.mode === 'roam' ? 'roam' : 'hop');
    scheduleNext();
  }, delay);
}

function doJump(kind) {
  lastJumpAt = Date.now();
  let dirX = 0;
  if (kind === 'roam') dirX = startRoam(HOP_MS);
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('pet:action', {
      type: kind, dirX, duration: HOP_MS, at: lastJumpAt
    });
  }
}

/* 斜抛运动：一次跳跃的步长 L（速率 × 时间）在窄范围内基本恒定，
   随机方向角 θ 决定横向与纵向分速度：dx = L·cosθ、dy = L·sinθ，
   因此速度恒定时横纵分量随方向此消彼长。
   垂直方向受重力形成二次抛物线：y(u) = y0 + dy·u - 4A·u(1-u)。 */
function startRoam(duration) {
  if (!petWin || petWin.isDestroyed()) return 0;
  clearInterval(roamTimer);
  const [sx, sy] = petWin.getPosition();
  const display = screen.getDisplayNearestPoint({ x: sx, y: sy });
  const area = display.workArea;
  const minX = area.x + 8, maxX = area.x + area.width - PET_W - 8;
  const minY = area.y + 8, maxY = area.y + area.height - PET_H - 8;
  const step = rand(480, 620);      // 步长（速率 × 时间）再次加大，方向分解后单次位移更明显
  // 贴近屏幕边缘时，随机方向可能被工作区夹紧而让实际位移大幅缩水。
  // 重新采样方向（仍完全随机），直到实际位移足够接近步长，最多 18 次并保留最优解。
  // 贴边时纯随机方向容易被工作区夹紧；先给一个朝屏幕内侧的候选，
  // 保证大步长不会被削掉，其余仍是完全随机的方向角。
  const centerX = area.x + area.width / 2, centerY = area.y + area.height / 2;
  const inward = Math.atan2(
    centerY - (sy + PET_H / 2), centerX - (sx + PET_W / 2)
  );
  let tx = sx, ty = sy, dist = 0;
  for (let k = 0; k < 18; k++) {
    const theta = k === 0 ? inward + rand(-0.6, 0.6) : rand(0, Math.PI * 2);
    const dx = Math.round(step * Math.cos(theta));
    const dy = Math.round(step * Math.sin(theta));
    const cx = clamp(sx + dx, minX, maxX);
    const cy = clamp(sy + dy, minY, maxY);
    const d = Math.hypot(cx - sx, cy - sy);
    if (d > dist) { tx = cx; ty = cy; dist = d; }
    if (dist >= step * 0.93) break;
  }
  const arc = Math.min(155, dist * 0.30);  // 拱高只小幅增加，避免大步长时跳出屏幕
  const t0 = Date.now();
  roamTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) { clearInterval(roamTimer); return; }
    const u = Math.min(1, (Date.now() - t0) / duration);
    petWin.setPosition(
      Math.round(sx + (tx - sx) * u),
      Math.round(sy + (ty - sy) * u - 4 * arc * u * (1 - u))
    );
    if (u >= 1) { clearInterval(roamTimer); roamTimer = null; savePositionDebounced(); }
  }, 16);
  return tx - sx;
}

/* ── 状态更新 ─────────────────────────────────────────── */
function updateState(patch) {
  Object.assign(state, patch || {});
  state.gapMin = GAP_MIN;
  state.gapMax = clamp(Number(state.gapMax) || 7000, 2000, 12000);
  state.scale = clamp(Number(state.scale) || 1, 0.7, 1.5);
  state.mode = ['still', 'hop', 'roam'].includes(state.mode) ? state.mode : 'still';
  state.sourceFacesLeft = state.sourceFacesLeft !== false;

  if (petWin && !petWin.isDestroyed()) petWin.setAlwaysOnTop(!!state.alwaysOnTop, 'floating');
  applyMouseThrough();
  try { app.setLoginItemSettings({ openAtLogin: !!state.autoLaunch }); } catch (_) {}
  scheduleNext();                 // 模式或间隔上限变化后重新排程

  saveState();
  broadcast();
  rebuildTray();
}

function toggleVisibility() {
  if (!petWin || petWin.isDestroyed()) return;
  if (petWin.isVisible()) petWin.hide(); else petWin.show();
  rebuildTray();
}

function resetPosition() {
  if (!petWin || petWin.isDestroyed()) return;
  state.pos = null;
  const p = initialPosition();
  petWin.setPosition(p.x, p.y);
  saveState();
}

/* ── 托盘 / 右键菜单 ──────────────────────────────────── */
function buildMenu() {
  const modeItems = [
    ['still', '① 静止不动（仅单击时跳一次）'],
    ['hop', '② 持续原地上下跳'],
    ['roam', '③ 持续向随机方向跳']
  ].map(([value, label]) => ({
    label, type: 'radio', checked: state.mode === value,
    click: () => updateState({ mode: value })
  }));

  const colorItems = PRESETS.map(p => ({
    label: p.name, type: 'radio',
    checked: state.color.toLowerCase() === p.color.toLowerCase(),
    click: () => updateState({ color: p.color })
  }));

  const gapItems = [[3, '1 ~ 3 秒'], [5, '1 ~ 5 秒'], [7, '1 ~ 7 秒'], [12, '1 ~ 12 秒']]
    .map(([v, label]) => ({
      label, type: 'radio', checked: state.gapMax === v * 1000,
      click: () => updateState({ gapMax: v * 1000 })
    }));

  return Menu.buildFromTemplate([
    { label: '🐸 青蛙桌宠 FrogPet', enabled: false },
    { type: 'separator' },
    ...modeItems,
    {
      label: '⏹ 停止跳跃（切回静止）',
      enabled: state.mode !== 'still',
      click: () => updateState({ mode: 'still' })
    },
    { type: 'separator' },
    { label: '绿色色块', submenu: [
      ...colorItems,
      { type: 'separator' },
      { label: '随机颜色', click: () => updateState({ color: randomColor() }) },
      { label: '自定义颜色…', click: () => createSettingsWindow() }
    ] },
    { label: '跳跃间隔（每次随机）', submenu: gapItems },
    { type: 'separator' },
    {
      label: petWin && petWin.isVisible() ? '隐藏青蛙' : '显示青蛙',
      click: toggleVisibility
    },
    { label: '设置…', click: () => createSettingsWindow() },
    { label: '恢复默认位置', click: resetPosition },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}

function rebuildTray() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build',
    process.platform === 'darwin' ? 'tray@1x.png' : 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') icon.setTemplateImage(false);
  tray = new Tray(icon);
  tray.setToolTip('青蛙桌宠 · 右键打开菜单');
  rebuildTray();
  if (process.platform !== 'darwin') tray.on('click', () => tray.popUpContextMenu());
}

/* ── IPC ──────────────────────────────────────────────── */
function registerIpc() {
  ipcMain.handle('pet:state-get', () => state);

  ipcMain.on('pet:ready', () => broadcast());

  ipcMain.on('pet:request-hop', () => {
    if (Date.now() - lastJumpAt < GAP_MIN) {
      if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:denied', { lastJumpAt });
      return;
    }
    doJump('hop');
    scheduleNext();
  });

  ipcMain.on('pet:set-interactive', (_e, value) => {
    interactive = !!value;
    applyMouseThrough();
  });

  ipcMain.on('pet:drag-start', () => {
    clearInterval(roamTimer);
    roamTimer = null;
    dragOrigin = petWin && !petWin.isDestroyed() ? petWin.getPosition() : null;
  });

  ipcMain.on('pet:drag-move', (_e, d) => {
    if (!dragOrigin || !petWin || petWin.isDestroyed()) return;
    petWin.setPosition(
      Math.round(dragOrigin[0] + d.dx),
      Math.round(dragOrigin[1] + d.dy)
    );
  });

  ipcMain.on('pet:drag-end', () => { dragOrigin = null; savePositionDebounced(); });

  ipcMain.on('pet:context-menu', () => { buildMenu().popup(); });

  ipcMain.on('pet:open-settings', () => createSettingsWindow());
  ipcMain.on('settings:close', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide(); });
  ipcMain.on('settings:set', (_e, patch) => updateState(patch));
  ipcMain.on('app:reset-position', resetPosition);
  ipcMain.on('app:quit', () => app.quit());
}

/* ── 应用生命周期 ─────────────────────────────────────── */
// 开发自检使用独立配置目录：既不抢占正式实例的单实例锁，也不会污染用户设置
if (process.env.FROG_CAPTURE || process.env.FROG_OPEN_SETTINGS) {
  app.setPath('userData', path.join(app.getPath('userData'), 'dev-selftest'));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (petWin && !petWin.isDestroyed()) petWin.show();
    createSettingsWindow();
  });

  app.whenReady().then(() => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    try { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); } catch (_) {}
    state = loadState();
    registerIpc();
    createPetWindow();
    createTray();
    try { app.setLoginItemSettings({ openAtLogin: !!state.autoLaunch }); } catch (_) {}
    if (process.platform === 'darwin') app.dock.hide();   // 桌宠常驻菜单栏托盘
    scheduleNext();
    // 自检开关：FROG_OPEN_SETTINGS / FROG_CAPTURE 仅用于开发环境验证界面
    if (process.env.FROG_OPEN_SETTINGS) setTimeout(() => createSettingsWindow(), 700);
    if (process.env.FROG_CAPTURE) setTimeout(async () => {
      try {
        const shot = await petWin.webContents.capturePage();
        fs.writeFileSync('/tmp/frog-pet-window.png', shot.toPNG());
        if (settingsWin && !settingsWin.isDestroyed()) {
          const panel = await settingsWin.webContents.capturePage();
          fs.writeFileSync('/tmp/frog-settings-window.png', panel.toPNG());
        }
        console.log('[FrogPet] screenshots saved to /tmp/frog-*-window.png');
      } catch (e) { console.error('[FrogPet] capture failed:', e.message); }
    }, 2600);
    // 自检：跳跃动画是否播放、随机方向跳是否真的移动窗口
    if (process.env.FROG_CAPTURE) {
      setTimeout(() => doJump('hop'), 3000);
      setTimeout(async () => {
        const dbg = await petWin.webContents.executeJavaScript(
          '({ hop: window.__frogFrame && window.__frogFrame(), canvas: document.getElementById("frog").width, css: document.getElementById("frog").clientWidth })');
        const img = await petWin.webContents.capturePage();
        fs.writeFileSync('/tmp/frog-hop-mid.png', img.toPNG());
        console.log('[FrogPet] hop frame:', JSON.stringify(dbg));
      }, 3400);
      setTimeout(() => {
        const before = petWin.getPosition();
        doJump('roam');
        setTimeout(async () => {
          const after = petWin.getPosition();
          const dbg = await petWin.webContents.executeJavaScript(
            'window.__frogFrame && window.__frogFrame()');
          console.log('[FrogPet] roam delta:', after[0] - before[0],
            after[1] - before[1], 'facing:', JSON.stringify(dbg));
          const img = await petWin.webContents.capturePage();
          fs.writeFileSync('/tmp/frog-roam.png', img.toPNG());
        }, 1050);
      }, 4400);
      setTimeout(() => updateState({ color: '#F2A6C0' }), 6000);
      setTimeout(async () => {
        const img = await petWin.webContents.capturePage();
        fs.writeFileSync('/tmp/frog-recolor.png', img.toPNG());
        updateState({ color: '#B4D855' });   // 恢复默认，避免污染用户配置
        console.log('[FrogPet] recolor screenshot saved');
      }, 6400);
      setTimeout(async () => {
        // 模拟一次「向左跳」，校验头朝左（保持原图朝向，不镜像）
        petWin.webContents.send('pet:action', {
          type: 'roam', dirX: -60, duration: 900, at: Date.now()
        });
        await new Promise(r => setTimeout(r, 130));
        const dbg = await petWin.webContents.executeJavaScript(
          'window.__frogFrame && window.__frogFrame()');
        const img = await petWin.webContents.capturePage();
        fs.writeFileSync('/tmp/frog-flip.png', img.toPNG());
        console.log('[FrogPet] left-jump facing:', JSON.stringify(dbg));
      }, 7200);
    }
  });

  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
  app.on('before-quit', () => {
    clearTimeout(jumpTimer);
    clearInterval(roamTimer);
    if (petWin && !petWin.isDestroyed()) {
      const [x, y] = petWin.getPosition();
      state.pos = { x, y };
    }
    saveState();
  });
}
