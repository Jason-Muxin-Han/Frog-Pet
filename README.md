# FrogPet · 青蛙动态桌宠

一款基于 GIF 原帧的跨平台桌面宠物：透明、置顶、无边框窗口，青蛙可以直接在桌面上跳跃、被拖动、换色。支持 macOS（Apple Silicon / Intel）与 Windows x64。

![青蛙桌宠](https://raw.githubusercontent.com/Jason-Muxin-Han/Frog-Pet/main/build/icon.png)

## 功能

- **原汁原味的形象**：逐帧使用原始 GIF 导出的 53 张透明 PNG，保留白／绿／黑三色块、白色下半身、两只绿色小脚与网点质感；外轮廓做了平滑处理并加了一条细深色描边。
- **三种动作**：静止（呼吸＋随机眨眼）、原地上下跳（蓄力压扁 → 拉伸起跳 → 腾空 → 落地压扁 → 回弹）、随机方向跳。
- **三种模式**：
  1. 静止不动，仅在鼠标单击时原地跳一次；
  2. 持续原地上下跳；
  3. 持续向随机方向跳。
  
  后两种模式可通过托盘菜单、右键菜单或设置面板中的「停止跳跃」随时停下。
- **斜抛式位移**：步长 480–620 px（速率基本恒定），随机方向角 θ 分解出横纵分量 `dx = L·cosθ`、`dy = L·sinθ`，横纵分速度随方向此消彼长；垂直轨迹为二次抛物线。向哪个方向跳，头就朝向哪个方向。
- **跳跃间隔**：硬下限 1 秒，上限 2–12 秒可调，每次在区间内随机取值；手动点击同样受冷却约束。
- **换色**：10 色预设 + 自定义取色 + 随机色，只替换绿色块并自动派生亮面／暗面；灰白下半身与黑色眼睛保持不变。
- **其它**：按住拖动、开机自启、置顶、鼠标穿透、大小调节、配置自动持久化。

## 下载安装

到 [Releases](https://github.com/Jason-Muxin-Han/Frog-Pet/releases) 下载对应平台的安装包：

| 平台 | 文件 | 说明 |
|---|---|---|
| macOS (Apple Silicon) | `FrogPet-1.0.0-arm64.dmg` / `FrogPet-1.0.0-arm64-mac.zip` | M1/M2/M3 等 |
| macOS (Intel) | `FrogPet-1.0.0-x64.dmg` / `FrogPet-1.0.0-x64-mac.zip` | Intel 芯片 |
| Windows x64 | `FrogPet-1.0.0-win-x64.zip` | 解压后运行 `FrogPet-win-x64/FrogPet.exe` |

> 应用未签名：macOS 首次请右键 → 打开；Windows SmartScreen 提示时选择「仍要运行」。
> macOS 版隐藏 Dock 图标，所有操作通过**菜单栏托盘图标**进行；Windows 托盘图标在任务栏通知区。

## 快捷键 / 交互

- **单击青蛙**：原地跳一次（受间隔下限约束）
- **按住拖动**：移动桌宠位置
- **右键青蛙 / 菜单栏托盘图标**：快速切换模式、换色、打开设置、退出

## 从源码运行

```bash
npm install
npm start
```

需要 Node.js 18+。`scripts/start.js` 会清除宿主可能注入的 `ELECTRON_RUN_AS_NODE` 环境变量；受限容器中可加 `FROG_NO_SANDBOX=1`。

## 构建

```bash
npm run build:mac     # macOS dmg + zip（arm64 / x64）
npm run build:win     # Windows nsis 安装版
npm run build:win:zip # Windows 便携 zip
```

- Windows 本机也可直接运行 `scripts/build-windows.bat`；`.github/workflows/build.yml` 支持 CI 双平台构建。
- 受限沙箱环境中，electron-builder 清空旧输出目录可能被阻，建议用全新输出目录，例如：
  `npx electron-builder --mac --arm64 --dir -c.directories.output=dist-new`

## 项目结构

```
src/
  main.js            Electron 主进程：窗口、托盘、调度、斜抛位移
  preload.js         IPC 桥接
  pet.html/.css/.js  桌宠窗口与交互
  settings.*         设置面板
  frog-render.js     帧加载与原帧换色
  frames/            53 张 GIF 原帧 PNG（240×240）+ manifest
scripts/
  extract_frames.py  从 GIF 导出透明帧
  smooth_edges.py    外轮廓平滑与描边（处理前请先恢复基准帧）
  make-icons.js      由原帧生成 mac/Windows 图标
  start.js           开发启动器
```

## 已知限制

- Windows NSIS 安装版未随 Release 提供，便携 zip 可直接运行。
- 应用未签名，首次运行需手动放行。
- `scripts/smooth_edges.py` 为就地处理，重复运行前请从上一版产物恢复基准帧。
