# RadarView

> 基于 Cesium 的雷达对空飞机实时监视与回放系统 | Radar Air Surveillance & Replay System based on Cesium

RadarView 是一款支持离线使用的桌面端雷达态势显示软件，能够导入 ADS-B 数据和自采雷达数据文件，在 3D 地球上展示空中目标航迹，并支持多源数据融合回放。


---

## 核心功能 | Features

- **多源数据导入** — 支持 ADS-B（CSV）、自采雷达数据（MAT）文件导入
- **时间戳对齐** — 多源数据自动/手动时间对齐，支持用户微调偏移量
- **分类标注** — 不同数据源使用不同颜色和图标区分（ADS-B 青色、雷达绿色、仿真橙色）
- **历史回放** — 导入历史数据文件，按时间轴回放航迹
- **离线地图** — 基于天地图离线瓦片，断网环境下完整可用
- **图层控制** — 可独立开关各数据源图层的显示/隐藏

---

## 技术栈 | Tech Stack

| 模块   | 技术                     | 说明                         |
| ---- | ---------------------- | -------------------------- |
| 桌面框架 | **Tauri 2.x**          | Rust 后端 + 系统 WebView，轻量高性能 |
| 前端框架 | **Vue 3 + TypeScript** | 组合式 API，类型安全               |
| 地图引擎 | **Cesium.js**          | 3D 地球，航空领域事实标准             |
| 数据解析 | **Rust**               | ADS-B / 雷达数据文件解析          |
| 离线瓦片 | **MBTiles (SQLite)**   | 天地图影像 + 标注，zoom 0-8        |
| 本地存储 | **SQLite**             | 航迹历史记录持久化                  |

---

## 系统架构 | Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                      │
├────────────────────────┬─────────────────────────────────┤
│     Vue 3 Frontend     │         Rust Backend            │
│                        │                                 │
│  ┌──────────────────┐  │  ┌───────────────────────────┐  │
│  │   Cesium 3D Map  │  │  │   File Importer           │  │
│  │   ├─ 影像底图     │  │  │   ├─ ADS-B (CSV)         │  │
│  │   ├─ 航迹渲染     │◄─┼──┤   └─ Radar (MAT)        │  │
│  │   └─ 图层控制     │  │  ├───────────────────────────┤  │
│  ├──────────────────┤  │  │   Time Aligner            │  │
│  │  Track Panel     │  │  │   └─ 多源时间戳对齐        │  │
│  │  └─ 目标列表/详情 │  │  ├───────────────────────────┤  │
│  ├──────────────────┤  │  │   Replay Engine           │  │
│  │  Playback Bar    │  │  │   └─ 按时间轴回放航迹      │  │
│  │  └─ 回放控制     │  │  ├───────────────────────────┤  │
│  └──────────────────┘  │  │   Tile Server             │  │
│                        │  │   └─ MBTiles → HTTP       │  │
│          Tauri IPC     │  ├───────────────────────────┤  │
│        ◄───────────────┼──┤   SQLite                  │  │
│                        │  │   └─ 航迹历史存储          │  │
│                        │  └───────────────────────────┘  │
└────────────────────────┴─────────────────────────────────┘

数据流 Data Flow:
═══════════════

文件导入 ──► Rust 解析 ──► Time Aligner 对齐 ──► Replay Engine 回放 ──► Cesium 渲染
```

---

## 项目结构 | Project Structure

```
RadarView/
├── src-tauri/                  # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── main.rs             # 入口
│   │   ├── adsb.rs             # ADS-B CSV 文件解析
│   │   ├── radar.rs            # 自采雷达 MAT 文件解析
│   │   ├── track.rs            # 统一航迹数据结构
│   │   ├── time_align.rs       # 多源时间戳对齐
│   │   ├── replay.rs           # 文件回放引擎
│   │   ├── tile_server.rs      # 离线瓦片 HTTP 服务
│   │   └── db.rs               # SQLite 航迹存储
│   └── Cargo.toml
├── src/                        # Vue 3 前端
│   ├── components/
│   │   ├── CesiumMap.vue       # 地图主视图
│   │   ├── TrackPanel.vue      # 航迹列表与详情
│   │   ├── RadarOverlay.vue    # 雷达覆盖扇区
│   │   ├── PlaybackBar.vue     # 回放进度控制
│   │   └── LayerControl.vue    # 图层开关面板
│   ├── composables/
│   │   ├── useTrackLoader.ts    # 文件导入与数据加载
│   │   ├── useTracks.ts        # 航迹管理 (融合/去重/老化)
│   │   └── useTrackStyle.ts    # 数据源样式映射
│   ├── types/
│   │   └── track.ts            # TypeScript 类型定义
│   ├── App.vue
│   └── main.ts
├── tiles/                      # 离线瓦片数据
│   └── tianditu.mbtiles        # 天地图离线瓦片包
├── public/
│   └── icons/                  # 目标图标 (SVG)
├── scripts/
│   └── download_tiles.py       # 瓦片下载脚本
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 快速开始 | Quick Start

### 环境准备 Prerequisites

| 工具      | 版本要求    | 说明       |
| ------- | ------- | -------- |
| Node.js | >= 18   | 前端构建     |
| Rust    | >= 1.70 | Tauri 后端 |
| pnpm    | >= 8    | 包管理器（推荐） |

```bash
# 1. 克隆仓库 Clone
git clone https://github.com/yeccp/RadarView.git
cd RadarView

# 2. 安装前端依赖 Install dependencies
pnpm install

# 3. 开发模式启动 Dev mode
pnpm tauri dev

# 4. 构建发布包 Build release
pnpm tauri build
```

### 离线瓦片准备 Offline Tiles

```bash
# 申请天地图 Key: https://console.tianditu.gov.cn/
# 下载 zoom 0-8 瓦片到 MBTiles
python scripts/download_tiles.py --key YOUR_TIANDITU_KEY --max-zoom 8
```

---

## 数据源说明 | Data Sources

### ADS-B（文件导入）

通过导入 `.csv` 格式的 ADS-B 历史数据文件获取航迹信息，按 ICAO Address 聚合航迹后送入回放引擎。

> 详细报文字段定义见 [docs/adsb-format.md](docs/adsb-format.md)

### 自采雷达数据

通过导入 `.mat` 格式的雷达数据文件，Rust 后端解析后转为统一航迹格式。

| 字段 | 说明 |
|------|------|
| Target ID | 雷达分配的目标批号 |
| Range | 目标斜距（km） |
| Azimuth | 方位角（°） |
| Elevation | 俯仰角（°） |
| Position | 经纬度（由距离/方位/雷达站位置解算） |
| Altitude | 高度（m，由斜距+俯仰解算或报文直接给出） |

雷达站位置在配置文件中设定，用于极坐标→经纬度转换。

### 文件导入

支持导入以下格式的历史数据进行回放：

| 格式 | 说明 |
|------|------|
| `.csv` | ADS-B 数据文件，文件名格式 `YYYY-MM-DD HH-MM-SS.csv`，详见 [报文格式](docs/adsb-format.md) |
| `.mat` | MATLAB 数据文件，包含航迹矩阵 |

---

## 离线地图 | Offline Map

使用天地图（TianDiTu）作为离线影像数据源：

- **影像底图** `img_w` — 卫星影像
- **影像标注** `cia_w` — 地名、道路、边界线
- **瓦片级别** zoom 0-8（km 级精度）
- **存储格式** MBTiles（SQLite 单文件）
- **预估体积** 约 200-500MB

在线时优先使用天地图在线服务，离线时自动回退到本地瓦片。

---

## Git 协作规范 | Git Workflow

> 详细规范见 `.claude/rules/` 目录：
> - [分支策略](.claude/rules/git-branch.md)
> - [Commit 规范](.claude/rules/commit-convention.md)
> - [Code Review 规范](.claude/rules/code-review.md)

---

## 里程碑 | Milestones

> 详见 [docs/milestones.md](docs/milestones.md)

---

## License

MIT
