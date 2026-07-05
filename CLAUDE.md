# 项目工作说明

## 项目概述

Tauri v2 桌面雷达航迹可视化应用。技术栈：Vue 3 + TypeScript + CesiumJS 1.140.0（前端）、Rust + rusqlite + rayon（后端）、SQLite WAL（持久化）、MBTiles（离线地图）。沿用现有架构，不引入新框架。

## 常用命令

```bash
# 均在项目根目录执行
pnpm install                # 安装前端依赖
pnpm tauri dev              # 启动开发模式（Vite + Tauri）
pnpm tauri build            # 生产打包（MSI + NSIS exe）

cd src-tauri && cargo check # Rust 编译校验
npx vue-tsc --noEmit        # TypeScript 类型校验（根目录执行）
```

## 目录结构

| 目录 | 用途 |
|------|------|
| `src/` | Vue 前端 — 组件(`components/`)、组合式函数(`composables/`)、类型(`types/`) |
| `src-tauri/src/` | Rust 后端 — `lib.rs`(命令注册)、`adsb.rs`(CSV解析)、`radar.rs`(MAT导入)、`track.rs`(数据模型)、`db.rs`(SQLite)、`settings.rs`(设置持久化)、`tile_server.rs`(瓦片服务) |
| `src-tauri/resources/` | 打包资源 — `natural_earth.mbtiles`(离线地图) |
| `scripts/` | Python 工具 — 地图数据下载脚本 |

## 编码规范

- **包管理器**：必须用 `pnpm`，禁止 npm / yarn。
- **前端状态**：跨组件共享状态必须抽到 `src/composables/`，用模块级 `ref()`/`reactive()` 实现单例模式；组件文件只负责渲染和事件转发。
- **前端类型**：Track 相关类型必须引用 `src/types/track.ts`，禁止在组件内重复定义。
- **后端命令**：Tauri 命令必须在 `lib.rs` 用 `#[tauri::command]` 注册，业务逻辑禁止写在命令函数内，必须放独立模块。
- **后端错误**：禁止 `unwrap()`、`expect()` 用于运行时操作。必须用 `?` 或 `.map_err(|e| format!(...))` 返回有意义错误消息。
- **数据库写入**：`save_batch()` 必须在 `BEGIN IMMEDIATE` 事务内完成；必须先用 `batch_exists()` 去重；完成后必须发射 `batch-saved` 事件。
- **数据库表职责**：`batches` 存批次元信息、`saved_tracks` 存航迹 JSON blob、`track_points` 存展开位置行。禁止在 `saved_tracks.track_json` 之外存储航迹位置数据。
- **Cesium 渲染**：必须设置 `requestRenderMode: true`；实体属性变更后必须调用 `viewer.scene.requestRender()`；批量创建/删除实体必须用 `suspendEvents()`/`resumeEvents()` 包裹。
- **Cesium 坐标转换**：批量航迹点的经纬度→笛卡尔坐标必须用 `fromDegreesArrayHeights()`，禁止逐个 `fromDegrees()`。
- **Git 提交**：格式 `type(scope): 描述`，type: feat/fix/refactor/docs/chore，scope: map/adsb/radar/track/replay/tiles/db/perf。
- **Git 分支**：`feature/xxx` 或 `fix/xxx`，从 dev 创建，PR 合回 dev。

## 禁止事项

- 禁止修改 `.claude/rules/` 下的规范文件
- 禁止升级 Cesium 版本（锁定 1.140.0）
- 禁止在 Rust 命令中使用无超时的同步阻塞调用（如 `Command::output()`）
- 禁止修改 `tauri.conf.json` 的 `bundle.resources` 配置
- 禁止删除 `natural_earth.mbtiles`
- 禁止引入新的前端框架或后端 ORM 库
- 禁止自行提交代码，必须等用户确认或明确要求后才能 `git commit`

## 验证要求

| 改动范围 | 必须执行的校验 |
|----------|-------------|
| `src/` 下 Vue/TS 文件 | `npx vue-tsc --noEmit`（项目根目录），exit code 必须为 0 |
| `src-tauri/src/` 下 Rust 文件 | `cargo check`（src-tauri 目录），exit code 必须为 0 |
| 前后端同时改 | 两项校验都必须通过 |
| `tauri.conf.json` 或 `src-tauri/resources/` | `pnpm tauri build` 验证安装包包含必需文件 |

## 启动页设计

`public/splash.html` — 全窗口内联 SVG 抽象艺术作品，非居中对称布局。品牌区定位左下角，底部状态栏。零 CSS 动画（仅 JS setInterval 轮播启动日志）。内联 base64 应用图标。设计参考 IntelliJ / Figma 静态启动页风格，禁止雷达动画/CSS 渐变伪背景/小卡片居中布局。

## 常见坑

- **Cesium 实体修改后不刷新**：开启 `requestRenderMode` 后 Cesium 不会自动重绘，必须在修改实体属性后显式调用 `viewer.scene.requestRender()`。
- **首次导入后时间过滤不生效**：`track_points` 表在后台线程异步填充，可能在过滤查询时尚未完成。下次启动 `init_db` 的 backfill 会自动补齐。
- **导入按钮长时间显示"保存中"不复原**：后台线程写 DB 时遇到锁竞争会等待 `busy_timeout(30s)`。检查终端 `eprintln!` 日志中的 `background save failed` 定位原因。
- **航迹数据二次导入时正确合并**：前端 `addTracks()` 按 `icao_address::source` 组合键去重，同键航迹只合并新时间点的 position，不覆盖已有数据。
- **时间显示差 8 小时**：数据源（MAT/CSV）时间戳均为北京时间 (UTC+8) 的 naive 字符串。`track.rs:ts_to_ms` 必须用 `FixedOffset::east_opt(8*3600)` 解析，`db.rs:ms_to_ts` 必须用 `with_timezone(&china_tz)` 格式化，禁止 `and_utc()` / 纯 UTC 格式化，否则全链路时区不一致。
- **行政区划线宽调节性能**：`admin1.geojson` 被 Cesium 拆为 ~45K 个 Entity，任何全量遍历都极重。**禁止**用 `CallbackProperty` 替代静态 width（`clampToGround: true` 时 GPU shader 崩溃，`false` 时 45K×60fps 回调拖垮帧率）；**禁止**用 `PolylineCollection` 替代 GeoJsonDataSource 跑边界图层（丢失 Cesium 自带的 LOD/裁剪/clampToGround，且 batch add 内部仍触发 `_createVertexArray`，rAF 递归分帧与正常渲染抢帧预算，实测比 Entity API 更卡）。当前方案：GeoJsonDataSource 加载 + 实体缓存 + 防抖遍历，切换可见性 O(1)（`dataSource.show`），线宽更新在 `@change` 松手时执行一次 ~200-1500ms。`src/components/CesiumMap.vue:loadBoundaryLayers`、`applyBoundaryVisibility`、`applyAllBoundaryWidths`。
- **瓦片纹理缓存不能压太低**：`ImageryLayer.maximumMemoryUsage` 默认约 256MB，设为 64 会导致地图平移/缩放时纹理频繁驱逐→重新解码→上传 GPU，表现为持续卡顿。**禁止**设置低于 128 的值；如无特殊需求不要手动设置此项。
- **Hover overlay 独立 PolylineCollection 导致点击/右键不稳定**：悬停高亮使用独立 `hoverOverlayLines` 集合（叠加在 `trackLines` 上方），其 id 为 `hover::trackKey`。`scene.pick()` 返回最上层物体，因此会优先捡到 hover overlay。`doPick()`、LEFT_CLICK handler、RIGHT_CLICK handler 都必须识别 `hover::` 前缀并剥离出真实 trackKey，否则 hover overlay 被误判为未知物体 → `removeHoverHighlight()` 删除 → 下一帧又添加 → 无限闪烁，且点击穿透失效。`src/components/CesiumMap.vue:doPick`、LEFT_CLICK `setInputAction`、RIGHT_CLICK `setInputAction`。
- **WebGL 上下文获取禁止用 canvas.getContext() 与 Cesium 抢**：Cesium 1.140.0 持有 `webgl2` 上下文，同一个 `<canvas>` 只能返回同类型上下文。**禁止**用 `canvas.getContext('webgl')`（类型不匹配，永远返回 null），**禁止**用 `canvas.getContext('webgl2')`（二次调用会干扰 Cesium 对上下文的所有权，导致 3D 场景崩溃只剩底图）。正确做法：直接取 Cesium 内部引用 `(viewer.scene as any).context._gl`，且 postRender 钩子中绘制前保存、绘制后恢复 `CURRENT_PROGRAM` / `ARRAY_BUFFER_BINDING`，`disableVertexAttribArray` 解绑，避免污染 Cesium 的 WebGL 状态机。`src/components/CesiumMap.vue:initDotCloudRenderer`。

## Loop Engineering 框架

本项目采用 Loop Engineering 模式进行自动化开发循环管理。详见：
- `LOOP.md` — 循环配置（调度、gate、预算）
- `STATE.md` — 循环状态记忆脊柱
- `loop-budget.md` — token 预算上限
- `loop-run-log.md` — 运行历史日志
- `.claude/skills/` — triage / verifier / budget / minimal-fix skills
- `.claude/agents/loop-verifier.md` — maker/checker 分离的验证者

### Loop 成熟度目标
- 当前阶段: **L1 report-only**（triage → state，无自动修复）
- 下一步: **L2 assisted**（小修复 + verifier + worktree）

## 用户设置持久化

- **存储**：SQLite 表 `app_settings(key TEXT PK, value TEXT NOT NULL)`，value 由前端 JSON.stringify。
- **后端**：`settings.rs`（建表/读写），`lib.rs` 注册 `save_setting` / `load_all_settings` 两个 command。
- **前端**：`useSettingsPersistence.ts` — `scheduleSave(key, json)` 300ms 防抖批量写；`loadAllSettings()` 启动时调用，按 key 解析 JSON 分发到各 composable ref；内置 `_loaded` 守卫，load 完成前丢弃所有 save。
- **新增设置**：① composable 内 `watch(ref, v => import('./useSettingsPersistence').then(m => m.scheduleSave('ns.key', JSON.stringify(v))), { immediate: false })` ② `applySettings()` 内加 `JSON.parse(raw[key])` 写入对应 ref。
- **面板折叠**：必须用 `usePanelStates.ts` 模块级 ref，禁止组件本地 `ref(false)`。
- **回放速度**：`useReplay(tracks, initialSpeed?)`，`App.vue` 通过 `getRawSetting('replay.speed')` 传入。



回复风格：每次回复都要说一声：“哥们”。
