/* 由 GIF 原始帧（透明 PNG）生成 macOS / Windows 应用图标，不重新绘制形象 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const frame = path.join(root, 'src', 'frames', 'f49.png');   // 原 GIF 静止帧

async function main() {
  // 帧素材现在是 240 原图的 3 倍高清重建；裁剪坐标按实际分辨率等比换算
  const meta = await sharp(frame).metadata();
  const k = meta.width / 240;
  const box = {
    left: Math.round(58 * k), top: Math.round(70 * k),
    width: Math.round(124 * k), height: Math.round(102 * k)
  };
  // 裁出青蛙并放大居中，保留原图形状与白/绿/黑三色块（素材已去噪，无需中值滤波）
  const frog = await sharp(frame)
    .extract(box)
    .resize(960, 790, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: frog, gravity: 'center' }])
    .png()
    .toFile(path.join(build, 'icon.png'));
  const master = path.join(build, 'icon.png');

  for (const [name, size] of [['tray@1x.png', 16], ['tray@2x.png', 32], ['tray.png', 32]]) {
    await sharp(master).resize(size, size).png().toFile(path.join(build, name));
  }

  // Windows ICO：目录 + PNG 图像（Vista 及以上支持 PNG 压缩图标）
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(s => sharp(master).resize(s, s).png().toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s === 256 ? 0 : s, 0);
    e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));

  // macOS iconset
  if (process.platform === 'darwin') {
    const iconset = path.join(build, 'icon.iconset');
    if (!iconsetExists(iconset)) fs.mkdirSync(iconset, { recursive: true });
    for (const px of [16, 32, 128, 256, 512]) {
      await sharp(master).resize(px, px).png().toFile(path.join(iconset, `icon_${px}x${px}.png`));
      await sharp(master).resize(px * 2, px * 2).png().toFile(path.join(iconset, `icon_${px}x${px}@2x.png`));
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')]);
  }
  console.log('Icon assets generated from GIF frame f49.png');
}

function iconsetExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

main().catch(err => { console.error(err); process.exit(1); });
