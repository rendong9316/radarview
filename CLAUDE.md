# 项目工作说明

## 项目概述

Tauri v2 桌面雷达航迹可视化应用。技术栈：Vue 3 + TypeScript + CesiumJS（前端）、Rust（后端）、SQLite（持久化）、MBTiles（离线瓦片地图）。沿用现有架构，不引入新框架。

## 常用命令

```bash
# 所有命令在项目根目录执行

pnpm install              # 安装前端依赖
pnpm tauri dev             # 启动开发模式（Vite + Tauri 窗口）
pnpm tauri build           # 生产打包（输出 MSI + NSIS exe）

# 前端单独校验
npx vue-tsc --noEmit      # TypeScript 类型检查（--noEmit 只检查不产出）

# Rust 后端单独校验
cd src-tauri && cargo check

# 打包 MATLAB 转换器 exe
pnpm build-converter       # 需先创建 Python venv
```

## 目录结构

| 目录 | 用途 |
|------|------|
| `src/` | Vue 前端：组件(`components/`)、组合式函数(`composables/`)、类型定义(`types/`) |
| `src-tauri/src/` | Rust 后端：`lib.rs`(命令注册)、`adsb.rs`、`radar.rs`、`track.rs`、`db.rs`、`tile_server.rs` |
| `src-tauri/resources/` | 打包资源：`convert_mat.exe`(MAT转换器)、`natural_earth.mbtiles`(离线地图) |
| `scripts/` | Python 工具：`convert_mat.py`(MAT→JSON转换源码) |
| `public/` | Vite 静态资源，构建时复制到 `dist/` |
| `docs/` | 项目文档、格式规范 |
| `.claude/rules/` | 提交/分支/代码审查规范 |

## 编码规范

- **包管理器**：必须用 pnpm，禁止 npm/yarn。
- **前端**：状态逻辑抽到 `src/composables/`，组件只负责渲染和事件转发。Track 类型引用 `src/types/track.ts`。
- **后端**：Tauri 命令用 `#[tauri::command]` 注册在 `lib.rs`，业务逻辑放独立模块。禁止 `unwrap()` 用于运行时操作，改用 `?` 或 `map_err`。
- **数据库**：`batches` 表存批次元信息，`saved_tracks` 存航迹 JSON。文件名唯一去重。
- **Cesium**：必须用 `requestRenderMode: true`，实体变更后必须调用 `viewer.scene.requestRender()`。批量创建实体用 `suspendEvents()/resumeEvents()`。
- **提交**：`type(scope): 描述`，type: feat/fix/refactor/docs/style/test/chore，scope: map/adsb/radar/track/replay/tiles/db。
- **分支**：`feature/xxx` 或 `fix/xxx`，从 dev 创建，PR 合回 dev。

## 禁止事项

- 禁止修改 `.claude/rules/` 下的规范文件
- 禁止升级 Cesium 版本（锁定 1.140.0）
- 禁止 Rust 命令中做无超时的同步阻塞（如 `Command::output()`）
- 禁止修改 `tauri.conf.json` 的 `bundle.resources` 配置
- 禁止删除 `natural_earth.mbtiles` 或 `convert_mat.exe`
- 禁止自行提交，每次修改后必须等用户确认或用户要求提交后才可以git commit

## 验证要求

| 改了什么 | 必须执行 |
|----------|---------|
| `src/` 下 Vue/TS 文件 | `npx vue-tsc --noEmit` 通过 |
| `src-tauri/src/` 下 Rust | `cargo check`（在 src-tauri 目录）通过 |
| 前后端同时改 | 两项都通过后才能提交 |
| 涉及打包资源 | `pnpm tauri build` 验证 安装包包含所需文件 |

## 常见坑

- **MAT 导入卡死**：74MB PyInstaller exe 启动耗时 10-30s，进度条停滞属正常，超时 120s 自动杀进程。
- **打包后 MAT 找不到**：`find_converter()` 必须用 `AppHandle.path().resource_dir()`，禁止用 `current_exe()` 拼路径。
- **Cesium 实体不刷新**：`requestRenderMode` 开启后，每次改实体属性后必须调 `scene.requestRender()`。
- **航迹显示 0ft/0kt**：雷达数据不含高度速度。`lastAlt/lastSpeed` 从末尾向前找第一个 >0 的值。
