# RadarView 环境搭建指南

## 概述

RadarView 是一个基于 Tauri 2 + Vue 3 + CesiumJS 的离线 3D 航迹查看器。仓库仅包含源码，编译产物和大型数据文件需要单独获取或生成。

---

## 1. 环境准备

### 1.1 安装 Node.js 与 pnpm

- Node.js >= 18（推荐 20 LTS）
- pnpm（安装 Node.js 后执行）：

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### 1.2 安装 Rust 工具链

访问 https://rustup.rs 安装 Rust，或命令行：

```bash
# Windows (PowerShell)
winget install Rustlang.Rustup
```

安装后确认版本：

```bash
rustc --version   # 应 >= 1.75
cargo --version
```

### 1.3 安装 Tauri 2 系统依赖（Windows）

Tauri 2 在 Windows 上需要以下组件：

| 依赖 | 说明 | 安装方式 |
|------|------|----------|
| Microsoft Visual Studio Build Tools 2022 | 提供 MSVC 链接器 | 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)，安装时勾选 "Desktop development with C++" |
| WebView2 | 运行时自带 | Windows 10 1803+ 已内置，无需额外安装 |

> **注意**：安装 VS Build Tools 时，务必选中 **"C++ 桌面开发"** 工作负载，否则 Rust 链接阶段会报 `link.exe` 找不到的错误。

### 1.4 安装 Tauri 2 系统依赖（macOS）

```bash
xcode-select --install
```

### 1.5 安装 Tauri 2 系统依赖（Linux）

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

---

## 2. 拉取仓库

```bash
git clone <仓库地址> radarview
cd radarview
```

---

## 3. 安装前端依赖

```bash
pnpm install
```

此步骤安装 Vue 3、CesiumJS、Vite 等前端依赖，约 200 MB。

---

## 4. 获取离线地图瓦片文件

### 4.1 为什么需要

RadarView 是完全离线运行的，地图使用本地 `.mbtiles` 瓦片数据库。程序启动时会在 `src-tauri/` 目录下查找 `.mbtiles` 文件，找不到则会**直接崩溃退出**。

### 4.2 获取方式

**方式 A：从项目作者获取现成文件**

将作者提供的 `natural_earth.mbtiles`（约 1.14 GB）放入 `src-tauri/` 目录：

```bash
# 假设从网盘下载后
mv ~/Downloads/natural_earth.mbtiles src-tauri/
```

**方式 B：自行生成（需要原始地图数据源）**

使用 `tile-join`（MapLibre 生态工具）或 `mb-util` 等工具，将 TMS 瓦片目录打包为 `.mbtiles`：

```bash
# 示例：将 z=0~8 的 tiles 目录打包
npm install -g @mapbox/mbtiles
mb-util ./tiles ./natural_earth.mbtiles
```

生成后放置到 `src-tauri/natural_earth.mbtiles`。

### 4.3 验证

```bash
# 确认文件存在且大小正确
ls -lh src-tauri/natural_earth.mbtiles
# 应输出约 1.1G
```

---

## 5. 获取 MAT 文件转换工具（可选）

### 5.1 用途

`convert_mat.exe` 用于将雷达 MAT 格式文件转换为 RadraView 可导入的 JSON。仅当需要导入 **Radar 数据** 时才需要。

### 5.2 放置位置

```powershell
# 将 convert_mat.exe 复制到
src-tauri/resources/convert_mat.exe
```

### 5.3 如果不需要

可以跳过此步骤。ADS-B CSV 导入功能不依赖此工具。如果放置了但程序仍报错，检查文件路径是否正确。

---

## 6. 启动开发环境

```bash
pnpm tauri dev
```

首次运行会：

1. Vite 启动前端开发服务器（`http://localhost:1420`）
2. Cargo 编译 Rust 后端（首次需下载并编译依赖，耗时约 3~10 分钟）
3. Tauri 启动应用窗口

### 6.1 首次编译注意事项

- Rust 依赖 `rusqlite` 带有 `bundled` feature，会在编译时从源码构建 SQLite，需要 C 编译器（VS Build Tools 已提供）
- `tiny_http`、`chrono` 等 crate 首次会被 Cargo 下载缓存
- 编译产物在 `src-tauri/target/` 下，约 15 GB，已在 `.gitignore` 排除

### 6.2 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `error: linker 'link.exe' not found` | 未安装 VS Build Tools | 安装 VS 2022 Build Tools，勾选 C++ 桌面开发 |
| `No .mbtiles file found` | 瓦片文件缺失或路径不对 | 确认 `src-tauri/natural_earth.mbtiles` 存在 |
| `pnpm: command not found` | pnpm 未安装 | 重新执行 `corepack enable` |
| `failed to run `rustc` | Rust 未安装 | 访问 https://rustup.rs 安装 |
| Vite 启动后白屏 | CesiumJS 资源加载问题 | 检查控制台是否有 CORS 错误 |

---

## 7. 数据导入

程序启动后，界面右侧会显示操作面板：

| 按钮 | 功能 | 需要额外文件 |
|------|------|-------------|
| **Import ADS-B** | 导入 ADS-B CSV 文件 | 无 |
| **Import Radar** | 导入 Radar MAT 文件 | `convert_mat.exe` |

导入后的数据会自动存入 SQLite 数据库（位于系统应用数据目录），下次启动自动加载。

---

## 8. 构建生产包

```bash
pnpm tauri build
```

构建完成后，安装包在：

- Windows: `src-tauri/target/release/bundle/msi/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/deb/`

---

## 附录：文件清单（从仓库 clone 后缺失的文件）

以下文件不在 git 仓库中，需单独获取：

| 文件 | 大小 | 必需 | 放置位置 | 说明 |
|------|------|------|----------|------|
| `natural_earth.mbtiles` | 1.14 GB | **是** | `src-tauri/` | 离线地图瓦片数据库 |
| `convert_mat.exe` | 71 MB | 否 | `src-tauri/resources/` | Radar MAT 格式转换工具 |
