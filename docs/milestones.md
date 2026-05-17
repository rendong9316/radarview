# 里程碑 | Milestones

---

## M1 — 项目脚手架 + Cesium 地球 + 离线瓦片

### 环境搭建

- [ ] 安装 pnpm、Rust 工具链、Tauri CLI
- [ ] 确认 Node.js >= 18、Rust >= 1.70

### 前端初始化

- [ ] 使用 Vite 创建 Vue 3 + TypeScript 项目
- [ ] 安装 Cesium.js + vite-plugin-cesium
- [ ] 创建基础目录结构（components / composables / types）
- [ ] 创建 `CesiumMap.vue`，初始化 Cesium Viewer，全屏 3D 地球
- [ ] 创建骨架占位组件：`TrackPanel.vue`、`PlaybackBar.vue`、`LayerControl.vue`
- [ ] 创建 `src/types/track.ts` 航迹类型定义

### Tauri 后端初始化
- [ ] `pnpm tauri init` 初始化 src-tauri 目录
- [ ] 配置 `tauri.conf.json`（窗口标题、尺寸、安全策略）
- [ ] 添加 Cargo 依赖：rusqlite、serde、serde_json
- [ ] 创建骨架 Rust 模块：adsb.rs、radar.rs、track.rs、time_align.rs、replay.rs、db.rs
- [ ] 实现 `tile_server.rs`：从 MBTiles 读取瓦片，提供本地 HTTP 服务

### 验证
- [ ] `pnpm tauri dev` 启动桌面窗口
- [ ] Cesium 3D 地球正常渲染
- [ ] 离线瓦片（natural_earth.mbtiles）加载显示正常

---

## M2 — ADS-B 数据接入 + 航迹渲染

### Rust 解析层
- [ ] 实现 `adsb.rs`：解析 CSV 文件（19 列字段，参见 docs/adsb-format.md）
- [ ] 实现 `track.rs`：定义统一航迹结构体 `Track`（id, positions, metadata）
- [ ] 按 ICAO Address 聚合多行记录为单条航迹
- [ ] 通过 Tauri Command 暴露 `import_adsb_file` 接口给前端

### 前端渲染
- [ ] 实现 `useTrackLoader.ts`：调用 Tauri Command 导入文件，获取航迹数据
- [ ] 实现 `useTracks.ts`：管理航迹状态（增删、去重、老化清理）
- [ ] 在 `CesiumMap.vue` 中渲染航迹：Polyline（轨迹线）+ Billboard（当前位置图标）
- [ ] 实现 `useTrackStyle.ts`：ADS-B 数据源使用青色样式

### 验证
- [ ] 导入示例 CSV 文件，地图上显示航迹线和目标点
- [ ] 航迹信息（航班号、高度、速度）正确显示

---

## M3 — 雷达数据接入 + 多源分类标注

### Rust 解析层
- [ ] 实现 `radar.rs`：解析 .mat 文件，提取雷达航迹数据
- [ ] 极坐标（距离/方位/俯仰）→ WGS-84 经纬度转换
- [ ] 雷达站位置可配置（配置文件或启动参数）
- [ ] 转换为统一 `Track` 结构，通过 Tauri Command 暴露 `import_radar_file`

### 多源分类标注
- [ ] 为 `Track` 添加 `source` 字段（ADS-B / Radar / Simulation）
- [ ] 前端 `useTrackStyle.ts` 扩展：雷达绿色、仿真橙色
- [ ] 不同数据源使用不同图标（public/icons/ 下 SVG）

### 验证
- [ ] 导入 .mat 文件，地图上显示雷达航迹
- [ ] ADS-B 和雷达航迹同时显示，颜色/图标可区分

---

## M4 — 文件导入 + 时间对齐 + 回放功能

### 文件导入 UI
- [ ] 前端实现文件选择对话框（Tauri dialog API）
- [ ] 支持拖拽导入 .csv / .mat 文件
- [ ] 导入后自动识别文件类型，调用对应解析器
- [ ] 导入进度提示

### 时间对齐
- [ ] 实现 `time_align.rs`：多源数据时间戳自动对齐算法
- [ ] 支持手动偏移量微调（前端传入 offset_ms 参数）
- [ ] 对齐后的航迹按统一时间轴排序

### 回放引擎
- [ ] 实现 `replay.rs`：按时间戳顺序回放航迹点
- [ ] 支持播放 / 暂停 / 倍速（1x / 2x / 4x / 8x）
- [ ] 支持拖动进度条跳转到指定时间
- [ ] 通过 Tauri Event 向前端推送当前帧数据

### 验证
- [ ] 导入多个文件，时间对齐后统一回放
- [ ] 播放控制（暂停/倍速/跳转）响应正常
- [ ] 航迹点按时间顺序逐帧出现在地图上

---

## M5 — UI 完善

### 图层控制面板
- [ ] 实现 `LayerControl.vue`：按数据源分组的开关列表
- [ ] 支持独立显示/隐藏 ADS-B、雷达、仿真图层
- [ ] 图层状态与 Cesium 渲染联动

### 航迹面板
- [ ] 实现 `TrackPanel.vue`：目标列表（表格形式）
- [ ] 列表字段：航迹批号、航班号、高度、速度、数据源
- [ ] 点击列表项，地图飞行定位到该目标
- [ ] 展开详情：完整航迹信息（起降机场、机型、注册号等）

### 回放进度条
- [ ] 实现 `PlaybackBar.vue`：时间轴进度条
- [ ] 显示当前回放时间、总时长
- [ ] 播放/暂停按钮、倍速选择器
- [ ] 可拖动进度条跳转

### 整体布局
- [ ] App.vue 布局：地图全屏 + 侧边航迹面板 + 底部回放条 + 右上图层控制
- [ ] 响应式适配（面板可折叠/展开）

---

## M6 — 联调 + 集成测试 + 打包发布

### 联调
- [ ] 多源数据（ADS-B + 雷达）同时导入联调
- [ ] 时间对齐 + 回放 + UI 面板全链路走通
- [ ] 离线环境测试（断网后地图 + 数据回放正常）

### 测试
- [ ] Rust 单元测试：CSV 解析、MAT 解析、时间对齐、坐标转换
- [ ] 前端组件基础测试
- [ ] 边界情况：空文件、格式错误、超大文件

### 打包发布
- [ ] `pnpm tauri build` 生成安装包
- [ ] Windows .msi / .exe 安装包验证
- [ ] 编写发布说明，打 tag `v0.1.0`
- [ ] 离线瓦片分发方案确认（网盘 / 内部文件服务器）
