/* 跨平台启动器：清除宿主环境可能注入的 ELECTRON_RUN_AS_NODE，
   否则 Electron 会以纯 Node 模式运行，app 模块不可用。 */
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.'];
// 受限容器/沙箱环境中 Chromium 子进程无法初始化沙箱时，可用 FROG_NO_SANDBOX=1 启动
if (process.env.FROG_NO_SANDBOX) {
  args.push('--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox');
}

const child = spawn(electron, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env
});
child.on('close', code => process.exit(code === null ? 1 : code));
