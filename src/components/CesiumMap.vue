<template>
  <div class="cesium-container" ref="containerRef">
    <!-- 右键上下文菜单 -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="contextMenu.type === 'flag'">
        <div class="context-menu-item" @click="handleContextRename"><Pencil :size="13" /> 重命名</div>
        <div class="context-menu-item context-menu-has-sub" @click.stop>
          <FlagIcon :size="13" /> 切换样式 <span class="submenu-arrow">▸</span>
          <div class="submenu-dropdown">
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-pin' }" @click="handleChangeFlagStyle('flag-pin')">图钉</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-standard' }" @click="handleChangeFlagStyle('flag-standard')">标准旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'flag-triangle-right' }" @click="handleChangeFlagStyle('flag-triangle-right')">三角旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'square-flag' }" @click="handleChangeFlagStyle('square-flag')">方旗</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'diamond' }" @click="handleChangeFlagStyle('diamond')">菱形</div>
            <div class="submenu-item" :class="{ active: getFlagStyle(contextMenu.flagId) === 'circle' }" @click="handleChangeFlagStyle('circle')">圆形</div>
          </div>
        </div>
        <div class="context-menu-item context-menu-danger" @click="handleContextDelete"><Trash2 :size="13" /> 删除</div>
      </template>
      <template v-else-if="contextMenu.type === 'track'">
        <div
          v-if="!isTrackShowingDots(contextMenu.trackId)"
          class="context-menu-item"
          @click="handleContextShowPointDots"
        ><Dot :size="13" /> 显示所有对应点迹</div>
        <div
          v-else
          class="context-menu-item"
          @click="handleContextHidePointDots"
        ><Circle :size="13" /> 隐藏所有对应点迹</div>
        <div
          class="context-menu-item"
          @click="handleContextShowDetail"
        ><FileText :size="13" /> 详细信息</div>
        <div
          class="context-menu-item"
          @click="handleContextViewPoints"
        ><ClipboardList :size="13" /> 查看点迹数据</div>
        <div
          class="context-menu-item context-menu-danger"
          @click="handleContextDeleteTrack"
        ><Trash2 :size="13" /> 删除该航迹</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { invoke } from '@tauri-apps/api/core'
import type { Track, TrackPoint, DataSource } from '../types/track'
import { useLineColor } from '../composables/useLineColor'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
import { useTrackHighlight } from '../composables/useTrackHighlight'
import { useTrackPointDots } from '../composables/useTrackPointDots'
import { useTheme } from '../composables/useTheme'
import { useBoundaryLayers, type BoundaryLayerKey } from '../composables/useBoundaryLayers'
import { useCityLayer, type CityLevel } from '../composables/useCityLayer'
import { trackKey } from '../composables/useTracks'
import { scheduleSave, getRawSetting, whenSettingsLoaded } from '../composables/useSettingsPersistence'
import { Pencil, Trash2, Dot, Circle, FileText, ClipboardList, Flag as FlagIcon } from '@lucide/vue'
import type { Flag } from '../composables/useFlags'

// ============================================================
// 1. Props：父组件 → 本组件（数据流入）
// ============================================================
const props = defineProps<{
  /** 航迹数据列表（核心数据源） */
  tracks: Track[]
  /** 
   * 回放时间戳（毫秒）
   * - null：退出回放模式，显示完整航迹
   * - number：进入回放模式，显示该时刻之前的轨迹
   */
  replayTime: number | null
  /** 
   * 当前选中的航迹 ID（格式："icao::source"）
   * - 非 null 时该航迹会高亮显示（加粗、透明度提升）
   */
  selectedId: string | null
  /** 每种数据源的航迹线宽度（用户通过滑块调节） */
  lineWidths: Record<DataSource, number>
  /** 每种数据源的端点圆点缩放系数（用户通过滑块调节） */
  dotScale: Record<DataSource, number>
}>()

// ============================================================
// 2. Emits：本组件 → 父组件（事件流出）
// ============================================================
const emit = defineEmits<{
  /** 
   * 用户单击航迹时触发
   * - 传入 trackId：选中该航迹
   * - 传入 null：取消选中（点击空白区域）
   */
  'track-pick': [trackId: string | null]
  /** 
   * 右键菜单 → "详细信息" 触发
   * 父组件应打开航迹详情面板
   */
  'show-track-detail': [payload: { icao: string; source: string }]
  /** 
   * 右键菜单 → "删除该航迹" 触发
   * 父组件应移除该航迹数据
   */
  'delete-track': [payload: { icao: string; source: string }]
  /** 
   * 右键菜单 → "查看点迹数据" 触发
   * 父组件应打开点迹数据表格
   */
  'view-track-points': [track: Track]
  /** 
   * 鼠标移动时持续触发（用于状态栏显示）
   * 包含相机高度、鼠标指向的经纬度、实时 FPS
   */
  'view-status': [payload: { 
    cameraHeightKm: number   // 相机高度（公里）
    longitude: number        // 鼠标指向位置的经度
    latitude: number         // 鼠标指向位置的纬度
    fps: number              // 当前平滑帧率
  }]
}>()

// ============================================================
// 3. 模板引用（Template Ref）
// ============================================================
/** 
 * 容器 DOM 元素引用
 * - 在模板中通过 ref="containerRef" 绑定到 <div>
 * - onMounted 时用于挂载 Cesium Viewer
 */
const containerRef = ref<HTMLDivElement>()

// ============================================================
// 4. 回放与控制变量
// ============================================================

/** 
 * 回放帧计数器（用于隔帧更新几何体）
 * - 每帧 +1，取模 2 后判断是否为 0
 * - 偶数帧更新几何体，奇数帧仅更新位置（减少 CPU 开销）
 */
let replayCounter = 0

// ============================================================
// 5. Cesium 核心渲染对象
// ============================================================

/** 
 * Cesium 主引擎实例
 * - 在 onMounted 中初始化
 * - 在 onUnmounted 中销毁
 */
let viewer: Cesium.Viewer | null = null

/** 
 * P2 级别：回放轨迹线集合
 * - 使用 PolylineCollection（非 Entity）
 * - 优势：单次 Draw Call 渲染所有轨迹线，性能远优于 Entity
 * - 仅在回放模式（replayTime !== null）下使用
 */
let trackLines: Cesium.PolylineCollection | null = null

/** 
 * P2 级别：悬停高亮专用集合
 * - 独立于 trackLines，渲染在 FLAT_ALTITUDE + 1500 高度
 * - 深度测试优先，确保不被其他航迹遮挡
 */
let hoverOverlayLines: Cesium.PolylineCollection | null = null

/** 
 * 悬停高亮复用线段
 * - 只创建一次，后续复用
 * - 每次悬停仅更新 positions 和 uniforms.color
 * - 避免频繁创建/销毁材质，极高性能
 */
let activeOverlayLine: Cesium.Polyline | null = null

/** 
 * P1 级别：端点圆点集合
 * - 使用 PointPrimitiveCollection（GPU 实例化）
 * - 每个航迹最新位置显示一个圆点
 * - 单次 Draw Call 渲染所有端点
 */
let pointPrimitives: Cesium.PointPrimitiveCollection | null = null

/** 
 * P1 级别：航迹标签集合
 * - 使用 LabelCollection（GPU 实例化）
 * - 每个航迹显示航班号/机型
 * - 单次 Draw Call 渲染所有标签
 */
let trackLabels: Cesium.LabelCollection | null = null

/** 
 * P3 级别：航迹点迹集合
 * - 使用 PointPrimitiveCollection（GPU 实例化）
 * - 显示航迹历史上所有点迹（可逐点渐进显示）
 * - 支持轮廓描边（outlineColor/outlineWidth）
 */
let pointDotsCollection: Cesium.PointPrimitiveCollection | null = null

/** 
 * 当前地图瓦片图层
 * - 由本地 Tauri 后端提供瓦片服务
 * - 支持动态切换最大缩放级别
 */
let currentImageryLayer: Cesium.ImageryLayer | null = null

/** 
 * 本地瓦片服务器端口
 * - 通过 Tauri IPC 调用 get_tile_server_port 获取
 * - 用于构建瓦片 URL：http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png
 */
let tileServerPort = 0

// ============================================================
// 6. 鼠标事件处理器
// ============================================================

/** 左键单击处理器（用于选中航迹） */
let clickHandler: Cesium.ScreenSpaceEventHandler | null = null

/** 左键双击处理器（用于放置/删除旗标） */
let dblClickHandler: Cesium.ScreenSpaceEventHandler | null = null

/** 右键单击处理器（用于上下文菜单） */
let rightClickHandler: Cesium.ScreenSpaceEventHandler | null = null

/** 鼠标移动处理器（用于悬停高亮 + 状态栏更新） */
let moveHandler: Cesium.ScreenSpaceEventHandler | null = null

/** 
 * 清除选中状态的防抖定时器
 * - 点击空白区域后延迟 300ms 清除选中
 * - 如果期间点击了航迹，取消清除
 */
let pendingClearTimeout: ReturnType<typeof setTimeout> | null = null

// ============================================================
// 7. FPS 帧率追踪
// ============================================================

/** 帧计数器（每帧 +1） */
let fpsFrameCount = 0

/** 
 * 上次采样时间戳（毫秒）
 * - 0 表示未初始化
 * - 在第一次 scene.postRender 时设置
 */
let fpsLastSampleTime = 0

/** 
 * 平滑后的帧率
 * - 使用 EMA（指数移动平均）平滑，α=0.5
 * - 每 500ms 更新一次
 * - 用于状态栏显示
 */
let fpsSmoothed = 0

// ============================================================
// 8. 边界层（行政区划边界）
// ============================================================

/** 
 * 边界绘制高度（米）
 * - 略高于椭球面（50m），防止 Z-fighting（深度冲突）
 */
const BOUNDARY_ALTITUDE = 50

/** 
 * Douglas-Peucker 简化容差（度）
 * - 0.01° ≈ 1km
 * - 在保持形状的同时大幅减少顶点数
 */
const SIMPLIFY_TOLERANCE = 0.01

/** 
 * 每层边界的 Primitive 引用
 * - Key: 'coastline' | 'admin1' | 'admin0'
 * - Value: Cesium.Primitive（直接操作几何实例，性能最优）
 */
const boundaryPrimitives = new Map<BoundaryLayerKey, Cesium.Primitive>()

/** 
 * 每层边界的几何环缓存 [lon, lat][][]
 * - 在首次加载时解析 GeoJSON 并缓存简化后的环
 * - 颜色/线宽变化时直接重建 Primitive，无需重新解析 GeoJSON
 */
const boundaryRingCache = new Map<BoundaryLayerKey, number[][][]>()

// ============================================================
// 9. 城市图层
// ============================================================

/** 城市点集合（PointPrimitiveCollection，GPU 实例化） */
let cityPointCollection: Cesium.PointPrimitiveCollection | undefined

/** 城市标签集合（LabelCollection，GPU 实例化） */
let cityLabelCollection: Cesium.LabelCollection | undefined

/** 城市特征数据列表（从 GeoJSON 解析） */
let cityFeatures: CityFeature[] = []

/** 
 * 城市拾取映射表
 * - Key: 'city::{cityId}'（用于 scene.pick 识别）
 * - Value: CityFeature（城市数据）
 */
let cityPickMap = new Map<string, CityFeature>()

/** 鼠标悬停时显示的城市名标签（Entity 方式） */
let cityHoverEntity: Cesium.Entity | undefined

/** 鼠标悬停时显示的点迹信息标签（Entity 方式） */
let pointDotHoverEntity: Cesium.Entity | undefined

/** 当前悬停的点迹 ID（格式：'pointdot::{trackId}::{index}'） */
let hoveredPointDotId: string | null = null

/** 
 * 城市图层延迟清理函数
 * - 用于双缓冲机制：在新集合创建后延迟一帧删除旧集合
 * - 避免纹理上传期间的闪屏
 */
let pendingCityCleanup: (() => void) | null = null

/** 待删除的旧城市点集合（延迟清理用） */
let pendingOldCityPoints: Cesium.PointPrimitiveCollection | null = null

/** 待删除的旧城市标签集合（延迟清理用） */
let pendingOldCityLabels: Cesium.LabelCollection | null = null

/** 相机变化事件取消函数（由 camera.changed.addEventListener 返回） */
let removeCityCameraChanged: (() => void) | null = null

// ============================================================
// 10. 右键上下文菜单 - 原生事件监听器
// ============================================================

/** 
 * 阻止浏览器默认右键菜单的函数
 * - 在 canvas 上监听 'contextmenu' 事件
 * - 调用 e.preventDefault()
 */
let ctxMenuFn: ((e: MouseEvent) => void) | null = null

/** 点击菜单外部关闭菜单的函数 */
let ctxClickOutsideFn: (() => void) | null = null

/** 按 ESC 键关闭菜单的函数 */
let ctxKeyFn: ((e: KeyboardEvent) => void) | null = null

/** Cesium Canvas 元素引用（用于绑定/解绑原生事件） */
let ctxCanvasEl: HTMLCanvasElement | null = null

/** 
 * 鼠标离开 canvas 时清除状态栏信息的函数
 * - 监听 'mouseleave' 事件
 * - 调用 emit('view-status', null)
 */
let statusMouseLeaveFn: (() => void) | null = null

/** 
 * 自定义滚轮缩放函数
 * - 替代 Cesium 默认步进缩放
 * - 实现无极缩放（Stepless Zoom）
 */
let onWheel: ((event: WheelEvent) => void) | null = null

/** 
 * 标签集合重建计数器
 * - 每 50 次 syncEntities 重建一次 LabelCollection
 * - 解决 Cesium 字形纹理泄漏问题
 */
let labelRebuildCounter = 0

// ============================================================
// 11. Composables 引用
// ============================================================

const { getEffectiveHex, lineColors } = useLineColor()

// ============================================================
// 12. 地图就绪 Promise
// ============================================================

/** 
 * 延迟 Promise 的 resolve 函数
 * - 在 onMounted 中调用，通知外部地图已初始化完成
 * - 父组件可通过 whenMapReady() 等待
 */
let resolveMapReady!: () => void

/** 
 * 地图就绪 Promise
 * - 外部调用 whenMapReady() 可等待 Cesium 完全加载
 * - 包括 Viewer、边界层、城市层初始化完成
 */
const mapReadyPromise = new Promise<void>(r => { resolveMapReady = r })

// ============================================================
// 13. 右键上下文菜单响应式状态
// ============================================================

/** 
 * 右键菜单显示状态
 * - visible: 是否显示
 * - x, y: 屏幕位置（像素）
 * - type: 'flag' | 'track'（旗标菜单 or 航迹菜单）
 * - flagId / flagLabel: 旗标信息（type='flag' 时使用）
 * - trackId: 航迹 ID（type='track' 时使用）
 */
const contextMenu = ref<{
  visible: boolean
  x: number
  y: number
  type: 'flag' | 'track'
  flagId: string
  flagLabel: string
  trackId: string
}>({ 
  visible: false, 
  x: 0, 
  y: 0, 
  type: 'flag', 
  flagId: '', 
  flagLabel: '', 
  trackId: '' 
})

// ============================================================
// 14. 颜色解析与主题更新
// ============================================================

/** 
 * 解析航迹颜色：自定义覆盖 > 主题默认
 * @param source - 数据源类型（'radar_raw' | 'radar_fusion' | ...）
 * @returns Cesium.Color 对象
 */
function getLineColor(source: DataSource): Cesium.Color {
  return Cesium.Color.fromCssColorString(getEffectiveHex(source))
}

/** 
 * 更新 Cesium 场景背景和地球基色以匹配当前主题
 * - 从 CSS 变量中读取颜色值
 * - 同步更新 scene.backgroundColor 和 globe.baseColor
 */
function updateCesiumBackground() {
  if (!viewer) return
  const bgHex = getThemeVar('--cesium-bg') || '#1a1a2e'
  const globeHex = getThemeVar('--cesium-globe-base') || '#1a1a2e'
  const bgColor = Cesium.Color.fromCssColorString(bgHex)
  const globeColor = Cesium.Color.fromCssColorString(globeHex)
  viewer.scene.backgroundColor = bgColor
  viewer.scene.globe.baseColor = globeColor
  viewer.scene.requestRender()
}

// ============================================================
// 15. Composables 初始化（功能模块注入）
// ============================================================

/** 图层可见性控制（原始/融合数据切换） */
const { visibility } = useLayerVisibility()

/** 航迹标签显示开关 */
const { showLabels } = useLabelVisibility()

/** 旗标管理（增删改查、样式切换、两旗标连线） */
const { flags, addFlag, removeFlag, renameFlag, setFlagStyle, selectedPair } = useFlags()

/** 旗标缩放系数 */
const { flagScale } = useFlagScale()

/** 航迹高亮（用于右键菜单"详细信息"跳转） */
const { addHighlight } = useTrackHighlight()

/** 点迹管理（缩放、全局显示、颜色自定义） */
const { trackPointDotScale, showAllPointDots, clearAllCounter, pointDotColors } = useTrackPointDots()

/** 主题管理（深色/浅色切换） */
const { activeTheme, getThemeVar } = useTheme()

/** 边界层管理（可见性、线宽、颜色） */
const { boundaryVisible, boundaryWidths, boundaryColors } = useBoundaryLayers()

/** 城市图层管理（可见性、LOD 参数） */
const { cityLayer } = useCityLayer()

// ============================================================
// 16. 点迹状态管理（P3 级别）
// ============================================================

/** 
 * 用户手动选择显示点迹的航迹 ID 集合
 * - 通过右键菜单 "显示所有对应点迹" 添加
 * - 优先级高于全局模式
 */
const manualPointDotsTrackIds = ref(new Set<string>())

/** 
 * 全局模式下用户明确隐藏的航迹 ID 集合
 * - 仅当 showAllPointDots = true 时生效
 * - 用于排除某些航迹的点迹
 */
const globalHiddenTrackKeys = ref(new Set<string>())

/** 
 * 已渲染点迹的分组映射
 * - Key: trackKey（航迹唯一标识）
 * - Value: PointPrimitive 对象数组
 */
const pointDotEntityMap = new Map<string, Cesium.PointPrimitive[]>()

/** 
 * 点迹像素大小（基础值 7.0 × trackPointDotScale）
 * - 用户通过滑块调节缩放系数
 */
let pointDotPixelSize = 7.0

/** 
 * 回放中点迹的渐进显示状态
 * - Key: trackKey
 * - Value: 上次显示的最后一个点索引（lo）
 * - 仅当 lo 变化时才更新点迹 show 状态，避免重复操作
 */
const pointDotLastLo = new Map<string, number>()

/** 
 * 检查某个航迹是否正在显示点迹
 * @param trackKey - 航迹唯一标识
 * @returns true 表示该航迹的点迹已渲染
 */
function isTrackShowingDots(trackKey: string): boolean {
  return pointDotEntityMap.has(trackKey)
}

// ============================================================
// 17. 点迹渲染核心逻辑（P3 - PointPrimitiveCollection）
// ============================================================

/**
 * ═══════════════════════════════════════════
 * P3: 点迹渲染 — 通过 Cesium PointPrimitiveCollection
 * GPU 实例化、描边圆点、无需私有 WebGL API
 * ═══════════════════════════════════════════
 */

/** 
 * 预分配的临时 Cartesian3 对象（复用避免 GC 压力）
 * - 在循环中反复使用，减少对象创建
 */
const _scratchCartesian = new Cesium.Cartesian3()

/** 
 * 预分配的点迹描边颜色（所有点迹共用）
 * - 黑色，透明度 0.85
 */
const _pointDotOutline = Cesium.Color.BLACK.withAlpha(0.85)

/** 
 * 为单个航迹重建所有点迹
 * @param trackId - 航迹唯一标识
 * 
 * 流程：
 * 1. 移除该航迹的旧点迹
 * 2. 遍历航迹所有位置点
 * 3. 为每个点创建 PointPrimitive（带描边）
 * 4. 存入 pointDotEntityMap
 * 5. 请求重新渲染
 */
function rebuildPointDotsForTrack(trackId: string) {
  if (!pointDotsCollection || !viewer) return

  // 移除现有点迹
  removePointDotsForTrack(trackId)

  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (!track || track.positions.length === 0) return

  const color = Cesium.Color.fromCssColorString(getPointDotColor(track.source))
  const primitives: Cesium.PointPrimitive[] = []

  for (let i = 0; i < track.positions.length; i++) {
    const pos = track.positions[i]
    const lon = Number(pos.longitude)
    const lat = Number(pos.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    Cesium.Cartesian3.fromDegrees(lon, lat, FLAT_ALTITUDE, undefined, _scratchCartesian)
    const prim = pointDotsCollection.add({
      id: `pointdot::${trackId}::${i}`,      // 唯一 ID，用于拾取
      position: _scratchCartesian,
      pixelSize: pointDotPixelSize,
      color,
      outlineColor: _pointDotOutline,
      outlineWidth: 1,
    })
    primitives.push(prim)
  }

  if (primitives.length > 0) {
    pointDotEntityMap.set(trackId, primitives)
  }
  viewer.scene.requestRender()
}

/** 
 * 移除单个航迹的所有点迹
 * @param trackId - 航迹唯一标识
 */
function removePointDotsForTrack(trackId: string) {
  if (!pointDotsCollection) return
  const primitives = pointDotEntityMap.get(trackId)
  if (primitives) {
    for (const prim of primitives) {
      pointDotsCollection.remove(prim)
    }
    pointDotEntityMap.delete(trackId)
  }
}

/** 
 * 手动显示某个航迹的点迹（右键菜单操作）
 * @param trackId - 航迹唯一标识
 * 
 * 操作：
 * 1. 将该航迹加入 manualPointDotsTrackIds
 * 2. 从 globalHiddenTrackKeys 中移除（如果在其中）
 * 3. 重建点迹
 */
function showManualPointDots(trackId: string) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.add(trackId)
  manualPointDotsTrackIds.value = nextManual

  const nextHidden = new Set(globalHiddenTrackKeys.value)
  nextHidden.delete(trackId)
  globalHiddenTrackKeys.value = nextHidden

  rebuildPointDotsForTrack(trackId)
}

/** 
 * 隐藏某个航迹的点迹（右键菜单操作）
 * @param trackId - 航迹唯一标识
 * 
 * 操作：
 * 1. 从 manualPointDotsTrackIds 中移除
 * 2. 如果处于全局模式，加入 globalHiddenTrackKeys
 * 3. 移除点迹
 */
function hidePointDotsForTrack(trackId: string) {
  const nextManual = new Set(manualPointDotsTrackIds.value)
  nextManual.delete(trackId)
  manualPointDotsTrackIds.value = nextManual

  if (showAllPointDots.value) {
    const nextHidden = new Set(globalHiddenTrackKeys.value)
    nextHidden.add(trackId)
    globalHiddenTrackKeys.value = nextHidden
  }

  removePointDotsForTrack(trackId)
  viewer?.scene.requestRender()
}



/** Sync global point dots: apply showAllPointDots + manual overrides + hidden list */
function syncGlobalPointDots() {
  if (!viewer || !pointDotsCollection) return

  const activeTracks = new Map(props.tracks.map(t => [trackKey(t.id, t.source), t]))
  const currentKeys = new Set(pointDotEntityMap.keys())

  // Remove dots for tracks that no longer exist or should be hidden
  for (const tKey of currentKeys) {
    if (!activeTracks.has(tKey)) {
      removePointDotsForTrack(tKey)
      continue
    }
    const manual = manualPointDotsTrackIds.value.has(tKey)
    const global = showAllPointDots.value && !globalHiddenTrackKeys.value.has(tKey)
    if (!manual && !global) {
      removePointDotsForTrack(tKey)
    }
  }

  // Add dots for tracks that should be showing but aren't yet
  if (showAllPointDots.value) {
    for (const track of props.tracks) {
      const tKey = trackKey(track.id, track.source)
      if (globalHiddenTrackKeys.value.has(tKey)) continue
      if (pointDotEntityMap.has(tKey)) continue
      rebuildPointDotsForTrack(tKey)
    }
  }

  viewer.scene.requestRender()
}

/** Remove all rendered point dots */
function clearAllPointDots() {
  if (pointDotsCollection) {
    pointDotsCollection.removeAll()
  }
  pointDotEntityMap.clear()
  manualPointDotsTrackIds.value = new Set()
  globalHiddenTrackKeys.value = new Set()
  viewer?.scene.requestRender()
}

/** Update color of all rendered point dots (e.g., after theme/color change) */
function refreshPointDotColors() {
  for (const [tKey, primitives] of pointDotEntityMap) {
    const track = props.tracks.find(t => trackKey(t.id, t.source) === tKey)
    if (!track) continue
    const color = Cesium.Color.fromCssColorString(getPointDotColor(track.source))
    for (const prim of primitives) {
      prim.color = color
    }
  }
  viewer?.scene.requestRender()
}

/** Update pixel size of all rendered point dots */
function refreshPointDotSizes() {
  for (const primitives of pointDotEntityMap.values()) {
    for (const prim of primitives) {
      prim.pixelSize = pointDotPixelSize
    }
  }
  viewer?.scene.requestRender()
}

let arcEntity: Cesium.Entity | undefined

const LABEL_FONT_BASE = '12px sans-serif'
const LABEL_FONT_LARGE = '18px sans-serif'
const BOUNDARY_LAYERS = [
  {
    key: 'coastline',
    url: '/boundaries/coastline.geojson',
    stroke: '#000000',
    alpha: 0.7,
  },
  {
    key: 'admin1',
    url: '/boundaries/admin1.geojson',
    stroke: '#77808f',
    alpha: 0.55,
  },
  {
    key: 'admin0',
    url: '/boundaries/admin0.geojson',
    stroke: '#d8dee9',
    alpha: 0.85,
  },
] as const satisfies ReadonlyArray<{
  key: BoundaryLayerKey
  url: string
  stroke: string
  alpha: number
}>

interface TrackEntities {
  /** Entity API polyline — stored in viewer.entities for full picking/interaction support */
  entity: Cesium.Entity | undefined
  /** P2: PolylineCollection polyline for replay trail ONLY */
  trailLine: Cesium.Polyline | undefined
  /** P1: Label in LabelCollection — GPU-instanced, one draw call for all labels */
  label: Cesium.Label | undefined
  /** P1: PointPrimitive for endpoint dot */
  pointPrimitive: Cesium.PointPrimitive | undefined
  source: string
  labelText: string
  /** Mutable holder for replay trail positions — updated each replay frame */
  trailRef: { positions: Cesium.Cartesian3[] }
  /** Last lo index from binary search — replay trail only updated when this advances */
  lastTrailLo: number

  // ---- 新增缓存字段 ----
  cachedPositions: Cesium.Cartesian3[]   // 预转换的完整航迹笛卡尔坐标
  lastInterpPos?: Cesium.Cartesian3      // 上次插值位置（用于增量更新判断）
  trailMaterial?: Cesium.Material        // 缓存的 Material，避免重复创建
}

const entityMap = new Map<string, TrackEntities>()
const flagEntityMap = new Map<string, Cesium.Entity>()

interface CityFeature {
  id: string
  nameZh: string
  nameEn: string
  country: string
  population: number
  rank: number
  level: CityLevel
  featureCode: string
  capital: boolean
  longitude: number
  latitude: number
}

/** Extract all line coordinate rings from a GeoJSON geometry object */
function extractPolygonRings(geometry: any): number[][][] {
  const type = geometry?.type
  const coords = geometry?.coordinates
  if (!type || !coords) return []

  switch (type) {
    case 'LineString':
      return [coords]
    case 'MultiLineString':
      return coords
    case 'Polygon':
      return [coords[0]] // 只取外环，忽略岛洞
    case 'MultiPolygon':
      return coords.map((p: any) => p[0])
    default:
      return []
  }
}

/** Douglas-Peucker 折线简化算法（基于索引，零临时数组分配） */
function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 2) return ring
  const result: number[][] = []
  result.push(ring[0])
  simplifyDp(ring, 0, ring.length - 1, tolerance, result)
  result.push(ring[ring.length - 1])
  return result
}

function simplifyDp(
  ring: number[][], lo: number, hi: number, tolerance: number, out: number[][],
) {
  if (hi - lo <= 1) return

  const first = ring[lo]
  const last = ring[hi]
  const dx = last[0] - first[0]
  const dy = last[1] - first[1]
  const lenSq = dx * dx + dy * dy

  let maxDist = 0
  let maxIdx = lo + 1

  for (let i = lo + 1; i < hi; i++) {
    let dist: number
    if (lenSq === 0) {
      const ddx = ring[i][0] - first[0]
      const ddy = ring[i][1] - first[1]
      dist = Math.sqrt(ddx * ddx + ddy * ddy)
    } else {
      const cross = Math.abs((ring[i][0] - first[0]) * dy - (ring[i][1] - first[1]) * dx)
      dist = cross / Math.sqrt(lenSq)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist <= tolerance) return // 中间所有点都可丢弃

  simplifyDp(ring, lo, maxIdx, tolerance, out)
  out.push(ring[maxIdx])
  simplifyDp(ring, maxIdx, hi, tolerance, out)
}

/** 合并端点相接的环，大幅减少 Polyline 对象数量 */
function mergeConnectedRings(rings: number[][][]): number[][][] {
  if (rings.length <= 1) return rings

  const key = (pt: number[]) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`
  const startMap = new Map<string, number[]>()
  const endMap = new Map<string, number[]>()
  const used = new Set<number>()
  const closed: number[][][] = [] // 闭合环（首尾相接），单独保留

  for (let i = 0; i < rings.length; i++) {
    if (rings[i].length < 2) { used.add(i); continue }
    const sk = key(rings[i][0])
    const ek = key(rings[i][rings[i].length - 1])
    if (!startMap.has(sk)) startMap.set(sk, [])
    startMap.get(sk)!.push(i)
    if (!endMap.has(ek)) endMap.set(ek, [])
    endMap.get(ek)!.push(i)
    // 闭合环单独保留
    if (sk === ek) { used.add(i); closed.push(rings[i].slice()) }
  }

  const merged: number[][][] = [...closed]

  for (let i = 0; i < rings.length; i++) {
    if (used.has(i)) continue

    let chain = rings[i].slice()
    used.add(i)

    // 向前扩展
    let growing = true
    while (growing) {
      growing = false
      const headKey = key(chain[0])
      // 其他环尾 == 当前头
      for (const ci of endMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      // 其他环头 == 当前头（需反转）
      for (const ci of startMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice().reverse().slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
    }

    // 向后扩展
    growing = true
    while (growing) {
      growing = false
      const tailKey = key(chain[chain.length - 1])
      // 其他环头 == 当前尾
      for (const ci of startMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice(1)]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      // 其他环尾 == 当前尾（需反转）
      for (const ci of endMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice().reverse().slice(1)]; used.add(ci); growing = true; break }
      }
    }

    merged.push(chain)
  }

  return merged
}

function clearBoundaryLayers() {
  for (const [key] of boundaryPrimitives) {
    clearSingleBoundaryLayer(key)
  }
  boundaryRingCache.clear()
}

/** Build a Cesium Primitive from cached rings for one boundary layer */
function buildBoundaryPrimitive(layerKey: BoundaryLayerKey): Cesium.Primitive | null {
  const rings = boundaryRingCache.get(layerKey)
  if (!rings || rings.length === 0) return null

  const layerConfig = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  const alpha = layerConfig?.alpha ?? 0.55
  const color = Cesium.Color.fromCssColorString(boundaryColors[layerKey]).withAlpha(alpha)
  const width = boundaryWidths[layerKey]

  const instances: Cesium.GeometryInstance[] = []
  for (let i = 0; i < rings.length; i++) {
    const positions = rings[i].map(pt =>
      Cesium.Cartesian3.fromDegrees(pt[0], pt[1], BOUNDARY_ALTITUDE),
    )
    instances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions,
        width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
      }),
    }))
  }

  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType('Color', { color }),
    }),
    asynchronous: false,
  })
}

/** Toggle boundary layers — load on first show, unload on hide */
function applyBoundaryVisibility() {
  for (const layer of BOUNDARY_LAYERS) {
    if (boundaryVisible[layer.key]) {
      if (boundaryPrimitives.has(layer.key)) continue
      loadSingleBoundaryLayer(layer.key)
    } else {
      clearSingleBoundaryLayer(layer.key)
    }
  }
}

async function loadSingleBoundaryLayer(layerKey: BoundaryLayerKey) {
  if (!viewer) return
  if (boundaryPrimitives.has(layerKey)) return

  const layer = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  if (!layer) return

  try {
    const response = await fetch(layer.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []

    // 1. 收集 + 简化 + 合并
    const allRings: number[][][] = []
    for (const feature of features) {
      const rings = extractPolygonRings(feature.geometry)
      for (const ring of rings) {
        if (Array.isArray(ring) && ring.length >= 2) allRings.push(ring as number[][])
      }
    }
    const simplified = allRings.map(r => simplifyRing(r, SIMPLIFY_TOLERANCE))
    const merged = mergeConnectedRings(simplified)

    const totalRawVerts = allRings.reduce((s, r) => s + r.length, 0)
    const totalSimpleVerts = simplified.reduce((s, r) => s + r.length, 0)

    // 2. 缓存合并后的环（用于后续颜色/线宽变更重建）
    boundaryRingCache.set(layerKey, merged)

    // 3. 构建 Primitive 并加入场景
    const primitive = buildBoundaryPrimitive(layerKey)
    if (!primitive) return

    // fetch 期间用户可能关掉了可见性
    if (!boundaryVisible[layerKey]) return

    viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)

    const ratio = totalRawVerts > 0 ? ((1 - totalSimpleVerts / totalRawVerts) * 100).toFixed(0) : '0'
    console.log(`[boundary] ${layerKey}: ${allRings.length}→${merged.length} rings, ${totalRawVerts}→${totalSimpleVerts} verts (-${ratio}%)`)
    viewer.scene.requestRender()
  } catch (e) {
    console.warn(`[boundary] failed to load ${layerKey}:`, e)
  }
}

function clearSingleBoundaryLayer(layerKey: BoundaryLayerKey) {
  const primitive = boundaryPrimitives.get(layerKey)
  if (primitive && viewer) {
    viewer.scene.primitives.remove(primitive)
    if (!primitive.isDestroyed()) primitive.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  boundaryRingCache.delete(layerKey)
  viewer?.scene.requestRender()
}

/** Rebuild a boundary primitive with new width/color */
function rebuildBoundaryPrimitive(layerKey: BoundaryLayerKey) {
  if (!boundaryPrimitives.has(layerKey)) return // 未加载，无需重建
  // 销毁旧 Primitive
  const old = boundaryPrimitives.get(layerKey)!
  if (viewer) {
    viewer.scene.primitives.remove(old)
    if (!old.isDestroyed()) old.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  // 重建
  const primitive = buildBoundaryPrimitive(layerKey)
  if (primitive && viewer) {
    viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)
    viewer.scene.requestRender()
  }
}

/** Update stroke width for a single boundary layer */
function applyBoundaryWidth(layerKey: BoundaryLayerKey) {
  rebuildBoundaryPrimitive(layerKey)
}

/** Update stroke width for all boundary layers */
function applyAllBoundaryWidths() {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryWidth(layer.key)
  }
}

/** Update stroke color for a single boundary layer */
function applyBoundaryColor(layerKey: BoundaryLayerKey) {
  rebuildBoundaryPrimitive(layerKey)
}

/** Update stroke color for all boundary layers */
function applyAllBoundaryColors() {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryColor(layer.key)
  }
}

async function loadCityLayer() {
  if (!viewer) return
  try {
    const response = await fetch('/cities/cities.geojson')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []
    cityFeatures = features
      .map((feature: any): CityFeature | null => {
        const coords = feature?.geometry?.coordinates
        const props = feature?.properties ?? {}
        if (!Array.isArray(coords) || coords.length < 2) return null
        const longitude = Number(coords[0])
        const latitude = Number(coords[1])
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
        return {
          id: String(props.id || props.geoname_id || `${longitude},${latitude},${props.name_en || props.name_zh || ''}`),
          nameZh: String(props.name_zh || props.name_en || ''),
          nameEn: String(props.name_en || props.name_zh || ''),
          country: String(props.country || ''),
          population: Number(props.population || 0),
          rank: Number(props.rank || 99),
          level: normalizeCityLevel(props.level, props.feature_code, Boolean(props.capital)),
          featureCode: String(props.feature_code || ''),
          capital: Boolean(props.capital),
          longitude,
          latitude,
        }
      })
      .filter((city: CityFeature | null): city is CityFeature => city !== null && city.nameZh.length > 0)

    renderCityLayer()
  } catch (e) {
    console.warn('[cities] failed to load city layer:', e)
  }
}

function normalizeCityLevel(level: unknown, featureCode: unknown, capital: boolean): CityLevel {
  if (level === 'capital' || level === 'regional' || level === 'prefecture' || level === 'major') {
    return level
  }
  if (capital || featureCode === 'PPLC') return 'capital'
  if (featureCode === 'PPLA') return 'regional'
  if (featureCode === 'PPLA2') return 'prefecture'
  return 'major'
}

function clearCityLayer() {
  // Cancel any pending deferred cleanup (old collections may already be gone)
  if (pendingCityCleanup && viewer) {
    viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
  }
  if (!viewer) {
    cityPointCollection = undefined
    cityLabelCollection = undefined
    cityPickMap.clear()
    return
  }
  if (cityPointCollection) {
    viewer.scene.primitives.remove(cityPointCollection)
    if (!cityPointCollection.isDestroyed()) cityPointCollection.destroy()
    cityPointCollection = undefined
  }
  if (cityLabelCollection) {
    viewer.scene.primitives.remove(cityLabelCollection)
    if (!cityLabelCollection.isDestroyed()) cityLabelCollection.destroy()
    cityLabelCollection = undefined
  }
  cityPickMap.clear()
}

function enabledCities() {
  return cityFeatures.filter(city => {
    if (!cityLayer.levels[city.level]) return false
    return city.level !== 'major' || city.population >= cityLayer.minPopulation
  })
}

function cityLevelRank(level: CityLevel) {
  switch (level) {
    case 'capital': return 0
    case 'regional': return 1
    case 'prefecture': return 2
    case 'major': return 3
    default: return 9
  }
}

function currentCameraHeight() {
  if (!viewer) return Number.POSITIVE_INFINITY
  return viewer.camera.positionCartographic.height
}

function emitViewStatus(screenPosition?: Cesium.Cartesian2 | null) {
  if (!viewer || viewer.isDestroyed()) return

  const cameraHeightKm = Math.max(0, viewer.camera.positionCartographic.height / 1000)
  let longitude = 0
  let latitude = 0

  if (screenPosition) {
    const cartesian = viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid)
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      longitude = Cesium.Math.toDegrees(cartographic.longitude)
      latitude = Cesium.Math.toDegrees(cartographic.latitude)
    }
  }

  emit('view-status', { cameraHeightKm, longitude, latitude, fps: Math.round(fpsSmoothed) })
}

function cityPointMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.pointMaxHeight.regional
    case 'prefecture': return cityLayer.lod.pointMaxHeight.prefecture
    case 'major': return cityLayer.lod.pointMaxHeight.major
  }
}

function cityLabelMaxHeight(level: CityLevel) {
  switch (level) {
    case 'capital': return Number.POSITIVE_INFINITY
    case 'regional': return cityLayer.lod.labelMaxHeight.regional
    case 'prefecture': return cityLayer.lod.labelMaxHeight.prefecture
    case 'major': return cityLayer.lod.labelMaxHeight.major
  }
}

function maxCityLabelsForHeight(height: number) {
  if (height > 12_000_000) return 80
  if (height > 6_000_000) return 140
  if (height > 2_000_000) return 220
  if (height > 800_000) return 340
  return 520
}

function cityLabelGridSize(height: number) {
  if (height > 12_000_000) return { width: 120, height: 54 }
  if (height > 6_000_000) return { width: 104, height: 48 }
  if (height > 2_000_000) return { width: 92, height: 42 }
  if (height > 800_000) return { width: 82, height: 36 }
  return { width: 72, height: 32 }
}

function shouldAvoidCityLabels(height: number) {
  return height > 800_000
}

function isFrontSidePosition(position: Cesium.Cartesian3) {
  if (!viewer) return true
  const pointNormal = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3())
  const cameraNormal = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3())
  return Cesium.Cartesian3.dot(pointNormal, cameraNormal) > -0.04
}

function cityPickId(city: CityFeature) {
  return `city::${city.id}`
}

function cityPointSize(city: CityFeature) {
  return city.level === 'capital'
    ? cityLayer.pointSize + 2
    : city.level === 'regional'
      ? cityLayer.pointSize + 1
      : cityLayer.pointSize
}

function isAdministrativeCity(city: CityFeature) {
  return city.level === 'capital' || city.level === 'regional' || city.level === 'prefecture'
}

function showCityHover(city: CityFeature) {
  if (!viewer || !cityLayer.visible) return
  const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1800)
  if (!cityHoverEntity) {
    cityHoverEntity = viewer.entities.add({
      id: 'city-hover-label',
      position,
      label: {
        text: city.nameZh,
        font: `${cityLayer.fontSize + 2}px sans-serif`,
        fillColor: Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(1),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(cityLayer.pointSize + 10, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.58),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    })
  } else {
    cityHoverEntity.show = true
    cityHoverEntity.position = position as any
    if (cityHoverEntity.label) {
      cityHoverEntity.label.text = new Cesium.ConstantProperty(city.nameZh)
      cityHoverEntity.label.font = new Cesium.ConstantProperty(`${cityLayer.fontSize + 2}px sans-serif`)
      cityHoverEntity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(1))
      cityHoverEntity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(cityLayer.pointSize + 10, 0))
    }
  }
}

function hideCityHover() {
  if (cityHoverEntity) cityHoverEntity.show = false
}

function showPointDotHover(trackId: string, pointIndex: number) {
  if (!viewer) return
  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (!track || pointIndex >= track.positions.length) return

  const pt = track.positions[pointIndex]
  const alt = Number(pt.altitude)
  const gs = Number(pt.groundSpeed)
  const hdg = Number(pt.heading)

  // Line 1: 标识 + 高度 + 地速 + 航向
  const label = track.metadata.flightNumber || track.metadata.registration || track.id
  const line1 = `${label}  ·  ${alt.toFixed(0)}m  ·  ${gs.toFixed(0)}kt  ·  ${hdg.toFixed(0)}°`

  // Line 2: 北京时间
  const d = new Date(pt.timestamp + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const line2 = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

  const text = `${line1}\n${line2}`
  const position = Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, FLAT_ALTITUDE)

  if (!pointDotHoverEntity) {
    pointDotHoverEntity = viewer.entities.add({
      id: 'pointdot-hover-label',
      position,
      label: {
        text,
        font: '14px -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK,
        backgroundPadding: new Cesium.Cartesian2(8, 6),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(pointDotPixelSize + 10, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  } else {
    pointDotHoverEntity.show = true
    pointDotHoverEntity.position = position as any
    if (pointDotHoverEntity.label) {
      pointDotHoverEntity.label.text = new Cesium.ConstantProperty(text)
    }
  }
}

function hidePointDotHover() {
  if (pointDotHoverEntity) pointDotHoverEntity.show = false
  hoveredPointDotId = null
}

function removeCityHover() {
  if (viewer && cityHoverEntity) {
    viewer.entities.remove(cityHoverEntity)
  }
  cityHoverEntity = undefined
}

function removePointDotHover() {
  if (viewer && pointDotHoverEntity) {
    viewer.entities.remove(pointDotHoverEntity)
  }
  pointDotHoverEntity = undefined
  hoveredPointDotId = null
}

function pickedCity(picked: any): CityFeature | null {
  const id = typeof picked?.id === 'string'
    ? picked.id
    : picked?.id instanceof Cesium.Entity
      ? picked.id.id
      : undefined
  if (typeof id !== 'string' || !id.startsWith('city::')) return null
  return cityPickMap.get(id) ?? null
}

function scheduleCityLayerRender(delay = 120, _force = false) {
  if (cityLayerDebounce) clearTimeout(cityLayerDebounce)
  cityLayerDebounce = setTimeout(() => {
    cityLayerDebounce = null
    renderCityLayer()
  }, delay)
}

function renderCityLayer() {
  if (!viewer) return
  if (!cityLayer.visible || cityFeatures.length === 0) {
    clearCityLayer()
    hideCityHover()
    viewer.scene.requestRender()
    return
  }

  const pointColor = Cesium.Color.fromCssColorString(cityLayer.color).withAlpha(0.95)
  const labelColor = Cesium.Color.fromCssColorString(cityLayer.labelColor).withAlpha(0.95)
  const height = currentCameraHeight()
  const cities = enabledCities()
  const canvas = viewer.scene.canvas

  // Double-buffer: build new collections first, then swap in atomically
  // to avoid a "gap frame" that causes visible flickering during zoom
  const newPoints = new Cesium.PointPrimitiveCollection()
  const newLabels = new Cesium.LabelCollection()

  const labelCandidates: Array<{
    city: CityFeature
    position: Cesium.Cartesian3
    window: Cesium.Cartesian2
    pointSize: number
  }> = []

  for (const city of cities) {
    const showPoint = height <= cityPointMaxHeight(city.level)
    const showLabel = cityLayer.labels && height <= cityLabelMaxHeight(city.level)
    if (!showPoint && !showLabel) continue

    const position = Cesium.Cartesian3.fromDegrees(city.longitude, city.latitude, 1200)
    if (!isFrontSidePosition(position)) continue

    const pointSize = cityPointSize(city)
    const id = cityPickId(city)
    cityPickMap.set(id, city)

    if (showPoint) {
      newPoints.add({
        id,
        position,
        pixelSize: pointSize,
        color: pointColor,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 1,
      })
    }

    if (showLabel) {
      const window = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position)
      if (
        window &&
        window.x >= -120 &&
        window.y >= -80 &&
        window.x <= canvas.clientWidth + 120 &&
        window.y <= canvas.clientHeight + 80
      ) {
        labelCandidates.push({ city, position, window, pointSize })
      }
    }
  }

  labelCandidates.sort((a, b) =>
    cityLevelRank(a.city.level) - cityLevelRank(b.city.level) ||
    b.city.population - a.city.population ||
    a.city.nameEn.localeCompare(b.city.nameEn),
  )

  const avoidLabels = shouldAvoidCityLabels(height)
  const grid = cityLabelGridSize(height)
  const occupied = new Set<string>()
  const maxLabels = avoidLabels ? maxCityLabelsForHeight(height) : Number.POSITIVE_INFINITY
  let labelCount = 0

  for (const item of labelCandidates) {
    if (labelCount >= maxLabels) break
    if (avoidLabels) {
      const key = `${Math.floor(item.window.x / grid.width)}:${Math.floor(item.window.y / grid.height)}`
      if (occupied.has(key)) continue
      occupied.add(key)
    }
    labelCount++

    const id = cityPickId(item.city)
    cityPickMap.set(id, item.city)
    newLabels.add({
      id,
      position: item.position,
      text: item.city.nameZh,
      font: `${isAdministrativeCity(item.city) ? cityLayer.fontSize + 1 : cityLayer.fontSize}px sans-serif`,
      fillColor: labelColor,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(item.pointSize + 4, 0),
    })
  }

  // Atomically swap: add new collections first
  const oldPoints = cityPointCollection
  const oldLabels = cityLabelCollection
  viewer.scene.primitives.add(newPoints)
  viewer.scene.primitives.add(newLabels)
  cityPointCollection = newPoints
  cityLabelCollection = newLabels

  // Cancel any pending cleanup from a previous swap
  if (pendingCityCleanup) {
    viewer.scene.preRender.removeEventListener(pendingCityCleanup)
    pendingCityCleanup = null
    // Destroy the intermediate collections skipped by rapid swaps
    if (pendingOldCityPoints) {
      viewer.scene.primitives.remove(pendingOldCityPoints)
      if (!pendingOldCityPoints.isDestroyed()) pendingOldCityPoints.destroy()
      pendingOldCityPoints = null
    }
    if (pendingOldCityLabels) {
      viewer.scene.primitives.remove(pendingOldCityLabels)
      if (!pendingOldCityLabels.isDestroyed()) pendingOldCityLabels.destroy()
      pendingOldCityLabels = null
    }
  }

  // Delay removal of old collections by one preRender frame.
  // New LabelCollection needs one frame to upload glyph textures to the GPU
  // before the old labels disappear — otherwise we get a visible blank flicker.
  if (oldPoints || oldLabels) {
    pendingOldCityPoints = oldPoints ?? null
    pendingOldCityLabels = oldLabels ?? null
    const cleanup = () => {
      viewer!.scene.preRender.removeEventListener(cleanup)
      pendingCityCleanup = null
      if (oldPoints) {
        viewer!.scene.primitives.remove(oldPoints)
        if (!oldPoints.isDestroyed()) oldPoints.destroy()
      }
      if (oldLabels) {
        viewer!.scene.primitives.remove(oldLabels)
        if (!oldLabels.isDestroyed()) oldLabels.destroy()
      }
      pendingOldCityPoints = null
      pendingOldCityLabels = null
      viewer!.scene.requestRender()
    }
    pendingCityCleanup = cleanup
    viewer.scene.preRender.addEventListener(cleanup)
  }

  viewer.scene.requestRender()
}

// Generate flag icons in Lucide style via canvas
function createFlagIcons(): Map<string, string> {
  const map = new Map<string, string>()
  const size = 32

  function makeIcon(style: string, draw: (ctx: CanvasRenderingContext2D) => void): string {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    draw(ctx)
    const url = canvas.toDataURL()
    map.set(style, url)
    return url
  }

  // ── flag-standard: Lucide-style rectangular flag with notch ──
  makeIcon('flag-standard', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // flag body
    ctx.beginPath()
    ctx.moveTo(10, 5)
    ctx.lineTo(26, 7)
    ctx.lineTo(26, 15)
    ctx.lineTo(18, 11)
    ctx.lineTo(10, 13)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  // ── flag-triangle-right: triangular pennant ──
  makeIcon('flag-triangle-right', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // triangular flag
    ctx.beginPath()
    ctx.moveTo(10, 6)
    ctx.lineTo(26, 12)
    ctx.lineTo(10, 18)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  // ── flag-pin: classic pin (preserved) ──
  makeIcon('flag-pin', (ctx) => {
    // pin body
    ctx.beginPath()
    ctx.arc(size / 2, size / 2 - 4, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    // pin point
    ctx.beginPath()
    ctx.moveTo(size / 2 - 5, size / 2 + 2)
    ctx.lineTo(size / 2, size - 4)
    ctx.lineTo(size / 2 + 5, size / 2 + 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // white dot center
    ctx.beginPath()
    ctx.arc(size / 2, size / 2 - 4, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── diamond: diamond marker ──
  makeIcon('diamond', (ctx) => {
    ctx.beginPath()
    ctx.moveTo(16, 4)
    ctx.lineTo(27, 15)
    ctx.lineTo(16, 26)
    ctx.lineTo(5, 15)
    ctx.closePath()
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // inner highlight
    ctx.beginPath()
    ctx.arc(16, 15, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── circle: filled circle marker ──
  makeIcon('circle', (ctx) => {
    ctx.beginPath()
    ctx.arc(16, 16, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    // inner ring
    ctx.beginPath()
    ctx.arc(16, 16, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  })

  // ── square-flag: simple rectangular flag without notch ──
  makeIcon('square-flag', (ctx) => {
    // pole
    ctx.fillStyle = '#555555'
    ctx.fillRect(8, 4, 2, 22)
    // rectangular flag body
    ctx.beginPath()
    ctx.rect(10, 5, 16, 11)
    ctx.fillStyle = '#ff4444'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  return map
}

const flagIconDataUrls = createFlagIcons()

function getFlagIconUrl(style?: string): string {
  if (style && flagIconDataUrls.has(style)) return flagIconDataUrls.get(style)!
  return flagIconDataUrls.get('flag-pin')!
}

function createFlagEntity(flag: Flag) {
  if (!viewer) return
  const s = flagScale.value
  const entity = viewer.entities.add({
    id: `flag-${flag.id}`,
    position: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude),
    billboard: {
      image: getFlagIconUrl(flag.style),
      scale: 0.8 * s,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    },
    label: {
      text: flag.label,
      font: `${Math.round(12 * s)}px sans-serif`,
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, Math.round(8 * s)),
    },
  })
  flagEntityMap.set(flag.id, entity)
}

function removeFlagEntity(id: string) {
  const entity = flagEntityMap.get(id)
  if (entity && viewer) {
    viewer.entities.remove(entity)
    flagEntityMap.delete(id)
  }
}

function clearAllFlagEntities() {
  if (!viewer) return
  for (const entity of flagEntityMap.values()) {
    viewer.entities.remove(entity)
  }
  flagEntityMap.clear()
}

function syncFlagEntities() {
  if (!viewer) return
  const newIds = new Set(flags.value.map((f) => f.id))
  const oldIds = new Set(flagEntityMap.keys())
  const s = flagScale.value

  viewer.entities.suspendEvents()

  for (const id of oldIds) {
    if (!newIds.has(id)) removeFlagEntity(id)
  }

  for (const flag of flags.value) {
    if (!flagEntityMap.has(flag.id)) {
      createFlagEntity(flag)
    } else {
      const entity = flagEntityMap.get(flag.id)!
      if (entity.label) {
        entity.label.text = new Cesium.ConstantProperty(flag.label)
        entity.label.font = new Cesium.ConstantProperty(`${Math.round(12 * s)}px sans-serif`)
        entity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(0, Math.round(8 * s)))
      }
      if (entity.billboard) {
        entity.billboard.image = new Cesium.ConstantProperty(getFlagIconUrl(flag.style))
        entity.billboard.scale = new Cesium.ConstantProperty(0.8 * s)
      }
    }
  }

  viewer.entities.resumeEvents()
  viewer.scene.requestRender()
}

/** Batch-convert TrackPoint[] → Cartesian3[] using Cesium's SIMD-optimized API.
 *  Eliminates ~N individual fromDegrees() calls with one vectorized operation. */
function isFinitePoint(p: TrackPoint): boolean {
  return Number.isFinite(p.longitude) &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.altitude) &&
    p.longitude >= -180 && p.longitude <= 180 &&
    p.latitude >= -90 && p.latitude <= 90
}

/** Convert track positions to a flat Cartesian3 array for polyline rendering */
function toCartesianArray(positions: TrackPoint[]): Cesium.Cartesian3[] {
  const flat: number[] = []
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (!isFinitePoint(p)) continue
    flat.push(p.longitude, p.latitude, FLAT_ALTITUDE)
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(flat)
}



/** Remove a trail polyline and destroy its Material to free the GPU shader program.
 *  PolylineCollection.remove() does NOT destroy the Material, so we must do it manually.
 *  IMPORTANT: remove first, THEN destroy — otherwise render may access destroyed Material. */
function removeTrailLine(trailLine: Cesium.Polyline | undefined) {
  if (!trailLine || !trackLines) return
  const mat = (trailLine as any).material as Cesium.Material | undefined
  trackLines.remove(trailLine)
  // Now safe to destroy — polyline is no longer in the collection, won't be rendered
  if (mat && !mat.isDestroyed()) {
    mat.destroy()
  }
}

function createTrackEntities(track: Track) {
  if (!viewer || track.positions.length === 0) return
  if (!trackLabels) return

// 在函数开头，预转换整条航迹（若已有缓存则复用，但创建时一定没有）
  const cachedPositions = toCartesianArray(track.positions)
  const color = getLineColor(track.source)

  const tKey = trackKey(track.id, track.source)
  const isSelected = tKey === props.selectedId
  const isRaw = track.source === 'radar_raw'
  const replaying = props.replayTime !== null

  // Mutable holder for polyline positions — during active replay, starts empty;
  // updateReplayPositions will fill the correct partial trail.
  const trailRef = { positions: replaying ? [] : toCartesianArray(track.positions) }

  // Entity API: main polyline in viewer.entities — full picking/interaction support
  let entity: Cesium.Entity | undefined
  if (track.positions.length >= 2) {
    const width = isSelected ? SELECTED_WIDTH : baseWidth(track.source)
    const alpha = isSelected ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA
    entity = viewer.entities.add({
      id: tKey,
      show: !replaying && visibility.value[track.source as keyof typeof visibility.value] !== false,
      polyline: {
        positions: replaying ? [] : toCartesianArray(track.positions),
        width,
        material: color.withAlpha(alpha),
        clampToGround: false,
      },
    })
  }

  const label = [track.metadata.flightNumber, track.metadata.aircraftType]
    .filter(Boolean)
    .join(' | ')

  const last = track.positions[track.positions.length - 1]
  const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)

  // P1: PointPrimitive for endpoint dot
  let pointPrimitive: Cesium.PointPrimitive | undefined
  if (pointPrimitives) {
    const base = isSelected ? DOT_SELECTED : isRaw ? DOT_RAW : DOT_BASE
    pointPrimitive = pointPrimitives.add({
      id: tKey,
      position: lastPos,
      color: color,
      pixelSize: pointPrimSize(base, track.source),
    })
  }

  // Label in LabelCollection — GPU-instanced
  const lbl = trackLabels.add({
    id: `${tKey}::dot`,
    show: visibility.value[track.source as keyof typeof visibility.value] !== false,
    position: lastPos,
    text: showLabels.value ? (label || track.id) : '',
    font: showLabels.value ? LABEL_FONT_LARGE : LABEL_FONT_BASE,
    fillColor: color,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, -20),
  })

  entityMap.set(tKey, {
    entity, trailLine: undefined, label: lbl, pointPrimitive,
    source: track.source, labelText: label || track.id, trailRef,
    lastTrailLo: track.positions.length - 1,
    cachedPositions,                      // <-- 新增
    lastInterpPos: undefined,             // <-- 新增
    trailMaterial: undefined,             // <-- 新增
  })
}

function removeTrackEntities(id: string) {
  const entry = entityMap.get(id)
  if (entry && viewer) {
    if (entry.entity) viewer.entities.remove(entry.entity)
    if (entry.trailLine) removeTrailLine(entry.trailLine)
    if (entry.label && trackLabels) trackLabels.remove(entry.label)
    if (entry.pointPrimitive) pointPrimitives?.remove(entry.pointPrimitive)
    entityMap.delete(id)
  }
}

/** If the picked ID is not a direct entityMap key, try to resolve it */
function extractTrackKeyFromPolylineId(polylineId: string): string | null {
  if (entityMap.has(polylineId)) return polylineId
  if (polylineId.endsWith('::dot')) return polylineId.slice(0, polylineId.lastIndexOf('::'))
  if (polylineId.startsWith('trail::')) return polylineId.slice('trail::'.length)
  if (polylineId.startsWith('pointdot::')) {
    const parts = polylineId.split('::')
    return parts.length === 3 ? parts[1] : null
  }
  return null
}

function clearAllEntities() {
  if (!viewer) return
  for (const [id] of entityMap) {
    removeTrackEntities(id)
  }
  // Remove any leftover hover overlay
  if (activeOverlayLine && hoverOverlayLines) {
    hoverOverlayLines.remove(activeOverlayLine)
    activeOverlayLine = null
  }
}

/** Re-apply per-source layer visibility to all Cesium entities.
 *  Must be called after syncEntities / replay restore / any operation
 *  that may have overwritten entity.show without consulting visibility state. */
function reapplyVisibility() {
  for (const [, entities] of entityMap) {
    const vis = visibility.value[entities.source as keyof typeof visibility.value]
    if (entities.entity) entities.entity.show = vis
    if (entities.label) entities.label.show = vis
    if (entities.pointPrimitive) entities.pointPrimitive.show = vis
  }
}

function syncEntities(newTracks: Track[]) {
  if (!viewer) return

  const t0 = performance.now()
  try {
    viewer.entities.suspendEvents()

    const keepIds = new Set(newTracks.map((t) => trackKey(t.id, t.source)))
    const oldIds = Array.from(entityMap.keys())

    // Remove entities for tracks no longer in display list
    for (const id of oldIds) {
      if (!keepIds.has(id)) {
        removeTrackEntities(id)
      }
    }

    // Add or update entities
    for (const track of newTracks) {
      const existing = entityMap.get(trackKey(track.id, track.source))
      if (!existing) {
        createTrackEntities(track)
        continue
      }

      // Update polyline for existing track when positions changed (e.g. time filter)
      const hasEnoughPoints = track.positions.length >= 2
      const isRaw = track.source === 'radar_raw'
      const tSel = trackKey(track.id, track.source) === props.selectedId
      const replaying = props.replayTime !== null
      existing.lastTrailLo = track.positions.length - 1
      const vis = visibility.value[track.source as keyof typeof visibility.value] !== false

      if (existing.entity) {
        if (hasEnoughPoints) {
          // During replay, let updateReplayPositions own the trail — avoid ghost full-track polyline
          if (!replaying) {
            const newPositions = toCartesianArray(track.positions)
            existing.trailRef.positions = newPositions
            // Update Entity polyline positions directly
            //existing.cachedPositions = newPositions
            if (existing.entity.polyline) {
              ;(existing.entity.polyline as any).positions = newPositions
            }
            existing.entity.show = vis
          }
          if (existing.entity.polyline) {
            (existing.entity.polyline as any).width = tSel ? SELECTED_WIDTH : baseWidth(track.source)
            // Material reuse: directly assign Color — Cesium shares Material internally
            const color = getLineColor(track.source)
            existing.entity.polyline.material = color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA) as any
          }
        } else {
          existing.entity.show = false
        }
      } else if (hasEnoughPoints) {
        // Entity didn't exist before but now has enough points (e.g. filter cleared)
        const color = getLineColor(track.source)
        const tKey = trackKey(track.id, track.source)
        if (!replaying) {
          existing.trailRef.positions = toCartesianArray(track.positions)
        }
        existing.entity = viewer.entities.add({
          id: tKey,
          show: vis,
          polyline: {
            positions: existing.trailRef.positions,
            width: tSel ? SELECTED_WIDTH : baseWidth(track.source),
            material: color.withAlpha(tSel ? SELECTED_ALPHA : isRaw ? RAW_ALPHA : NORMAL_ALPHA),
            clampToGround: false,
          },
        })
      }

      // Update label & PointPrimitive to last position
      const last = track.positions[track.positions.length - 1]
      const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
      if (existing.label) existing.label.position = lastPos
      if (existing.pointPrimitive) existing.pointPrimitive.position = lastPos
    }
  } finally {
    viewer.entities.resumeEvents()
    reapplyVisibility()
    viewer.scene.requestRender()
  }
  const t1 = performance.now()
  console.log(`[perf] Cesium syncEntities: ${(t1 - t0).toFixed(0)}ms  |  tracks=${newTracks.length}`)

  // Periodic LabelCollection rebuild to prevent glyph atlas bloat (Cesium known issue)
  labelRebuildCounter = (labelRebuildCounter || 0) + 1
  if (labelRebuildCounter > 50 && trackLabels && viewer) {
    labelRebuildCounter = 0
    viewer.scene.primitives.remove(trackLabels)
    if (!trackLabels.isDestroyed()) trackLabels.destroy()
    const newLabels = viewer.scene.primitives.add(new Cesium.LabelCollection())
    trackLabels = newLabels
    for (const [tKey, entry] of entityMap) {
      if (!entry.label) continue
      entry.label = newLabels.add({
        id: `${tKey}::dot`,
        show: entry.label.show,
        position: entry.label.position,
        text: entry.label.text,
        font: entry.label.font,
        fillColor: entry.label.fillColor,
        outlineColor: entry.label.outlineColor,
        outlineWidth: entry.label.outlineWidth,
        style: entry.label.style,
        verticalOrigin: entry.label.verticalOrigin,
        pixelOffset: entry.label.pixelOffset,
      })
    }
    console.log('[perf] LabelCollection rebuilt to shrink glyph atlas')
  }
}

// Sync Cesium entities when props.tracks changes — handles initial load, filter, isolation, clear
watch(
  () => props.tracks,
  (newTracks) => {
    syncEntities(newTracks)
  },
  { deep: false },
)

// ============================================================
// 35. 回放位置更新函数（核心性能优化模块）
// ============================================================

/**
 * 更新回放模式下所有航迹的位置和轨迹线
 * 
 * 这是一个高性能函数，采用多种优化策略：
 * 1. 二分查找快速定位时间点
 * 2. 线性插值计算平滑位置
 * 3. 隔帧更新几何体（减少 CPU 开销）
 * 4. 增量更新（仅当 lo 或位置变化时才更新）
 * 5. 点迹渐进显示（随回放进度逐步显示）
 * 
 * 调用频率：每秒 60 次（与浏览器刷新率同步）
 * 
 * @param time - 当前回放时间戳（毫秒）
 */
function updateReplayPositions(time: number) {
  // ── 前置检查 ──
  if (!viewer || !trackLines) return
  
  // 性能调试日志（仅用于开发阶段）
  console.log('[perf] 隔振计数器启动')

  // ============================================================
  // 优化策略 1：隔帧更新（Frame-skipping）
  // ============================================================
  /**
   * 隔帧计数器（0/1 交替）
   * 
   * 原理：每帧都更新位置（标签/端点），但几何体（轨迹线）隔帧更新
   * - 偶数帧（counter=0）：更新几何体（轨迹线 positions）
   * - 奇数帧（counter=1）：只更新位置（不更新几何体）
   * 
   * 效果：CPU 开销降低 50%，肉眼几乎无感知（60fps → 30fps 几何更新）
   */
  replayCounter = (replayCounter + 1) % 3
  const shouldUpdateGeometry = replayCounter === 0  // 只有偶数帧才更新几何
  let geometryUpdated = false                        // 标记是否有几何变化

  // ============================================================
  // 遍历所有航迹
  // ============================================================
  for (const track of props.tracks) {
    const tKey = trackKey(track.id, track.source)
    const entities = entityMap.get(tKey)
    if (!entities || track.positions.length === 0) continue

    // ── 检查图层可见性 ──
    const vis = visibility.value[entities.source as keyof typeof visibility.value] !== false
    if (!vis) {
      // 不可见：隐藏轨迹线（但不移除，保留资源）
      if (entities.trailLine) entities.trailLine.show = false
      continue
    }

    const pts = track.positions  // 航迹点数组（按时间升序）

    // ============================================================
    // 优化策略 2：二分查找（O(log n)）
    // ============================================================
    /**
     * 在当前航迹点数组中查找 time 所在的区间 [lo, hi]
     * 
     * 目标：找到两个相邻点 pts[lo] 和 pts[hi]，使得：
     *   pts[lo].timestamp <= time <= pts[hi].timestamp
     * 
     * 特殊情况：
     * - time <= 第一个点：lo=0, hi=1（从起点开始）
     * - time >= 最后一个点：lo=hi=last（停在终点）
     */
    let lo: number, hi: number
    if (time <= pts[0].timestamp) {
      // 回放时间早于或等于第一个点：从起点开始
      lo = 0; hi = 1
    } else if (time >= pts[pts.length - 1].timestamp) {
      // 回放时间晚于或等于最后一个点：停在终点
      lo = pts.length - 1; hi = pts.length - 1
    } else {
      // 正常情况：二分查找
      lo = 0; hi = pts.length - 1
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1  // 位运算：等同于 Math.floor((lo+hi)/2)
        if (pts[mid].timestamp <= time) {
          lo = mid   // 目标在右半区
        } else {
          hi = mid   // 目标在左半区
        }
      }
      // 循环结束后：lo 和 hi 是相邻的两个索引
    }

    // ── 特殊情况：回放时间早于第一个点 ──
    if (time < pts[0].timestamp) {
      // 时间还没到：隐藏该航迹的所有元素
      if (entities.entity) entities.entity.show = false
      if (entities.trailLine) {
        removeTrailLine(entities.trailLine)  // 销毁轨迹线释放资源
        entities.trailLine = undefined
        entities.trailMaterial = undefined
      }
      continue  // 跳过后续处理
    }

    // ============================================================
    // 优化策略 3：线性插值（平滑位置）
    // ============================================================
    /**
     * 在 pts[lo] 和 pts[hi] 之间线性插值，计算当前位置
     * 
     * 公式：
     *   t = (time - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp)
     *   position = pts[lo] + (pts[hi] - pts[lo]) * t
     * 
     * 结果：连续的平滑运动，而不是点之间的跳跃
     */
    const dt = pts[hi].timestamp - pts[lo].timestamp
    const t = dt > 0 ? (time - pts[lo].timestamp) / dt : 0  // 插值因子 [0, 1]
    
    // 插值计算经纬度
    const cpLat = pts[lo].latitude + (pts[hi].latitude - pts[lo].latitude) * t
    const cpLng = pts[lo].longitude + (pts[hi].longitude - pts[lo].longitude) * t
    
    // 转换为 Cesium 笛卡尔坐标（固定高度 FLAT_ALTITUDE）
    const cpPos = Cesium.Cartesian3.fromDegrees(cpLng, cpLat, FLAT_ALTITUDE)

    // ── 每帧更新标签和端点位置（轻量级操作） ──
    if (entities.label) entities.label.position = cpPos
    if (entities.pointPrimitive) entities.pointPrimitive.position = cpPos

    // ============================================================
    // 优化策略 4：增量几何更新（隔帧执行）
    // ============================================================
    /**
     * 以下代码只在偶数帧执行（shouldUpdateGeometry === true）
     * 奇数帧跳过，节省 CPU
     */
    if (shouldUpdateGeometry) {
      /**
       * 判断是否需要更新几何体
       * 
       * 条件 1：lo 发生了变化（从一段移动到下一段）
       *   例如：之前 lo=5，现在 lo=6 → 需要增加新点
       * 
       * 条件 2：插值位置发生了明显变化
       *   防止浮点数精度问题导致的不必要更新
       */
      const loChanged = lo !== entities.lastTrailLo
      const posChanged = !entities.lastInterpPos ||
        !Cesium.Cartesian3.equals(cpPos, entities.lastInterpPos)

      // ── 只有真正变化时才更新几何体 ──
      if (loChanged || posChanged) {
        geometryUpdated = true  // 标记需要重新渲染

        /**
         * 构建轨迹线点数组
         * 
         * 结构：[pts[0], pts[1], ..., pts[lo], cpPos]
         * 
         * 解释：
         * - 前 lo+1 个点：来自原始航迹数据（已缓存）
         * - 最后一个点：插值位置（当前帧位置）
         * - 这样轨迹线就显示了"从起点到当前位置"的完整路径
         * 
         * 优化：使用 cachedPositions 避免重复转换
         */
        const prefix = entities.cachedPositions.slice(0, lo + 1)  // 取前 lo+1 个点
        let trailPositions: Cesium.Cartesian3[]
        
        if (lo === pts.length - 1) {
          // 已到终点：只有原始点，不追加插值点
          trailPositions = prefix
        } else {
          // 未到终点：追加插值点
          const lastCached = prefix[prefix.length - 1]
          // 防抖：如果插值点与最后一个缓存点距离太近，不追加（避免闪烁）
          if (Cesium.Cartesian3.distance(lastCached, cpPos) > 1e-6) {
            trailPositions = prefix.concat(cpPos)
          } else {
            trailPositions = prefix
          }
        }

        // ── 回放模式下隐藏主 Entity（避免重叠） ──
        if (entities.entity) entities.entity.show = false

        // ── 确定航迹样式 ──
        const isSel = tKey === props.selectedId
        const isRaw = track.source === 'radar_raw'
        const color = getLineColor(track.source)
        const alpha = isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)

        // ── 更新或创建 trailLine ──
        if (entities.trailLine) {
          /**
           * 已有轨迹线：更新属性（复用对象，避免创建销毁）
           * 
           * 优势：不产生新的 GPU 对象，性能最优
           */
          entities.trailLine.positions = trailPositions
          entities.trailLine.show = trailPositions.length >= 2
          entities.trailLine.width = isSel ? SELECTED_WIDTH : baseWidth(track.source)
          // 更新材质颜色（复用 Material 对象）
          if (entities.trailMaterial) {
            (entities.trailMaterial as any).uniforms.color = color.withAlpha(alpha)
          }
        } else if (trailPositions.length >= 2) {
          /**
           * 没有轨迹线且点数足够：创建新的
           * 
           * 注意：首次创建时分配 Material，后续复用
           */
          const material = Cesium.Material.fromType('Color', {
            color: color.withAlpha(alpha),
          })
          entities.trailLine = trackLines.add({
            id: `trail::${tKey}`,           // 用于拾取识别
            show: true,
            positions: trailPositions,
            width: isSel ? SELECTED_WIDTH : baseWidth(track.source),
            material: material,
          })
          entities.trailMaterial = material
        }

        // ── 更新状态（用于下次增量判断） ──
        entities.lastTrailLo = lo
        entities.lastInterpPos = cpPos.clone()  // 克隆保存，避免引用污染
      }

      // ============================================================
      // 优化策略 5：点迹渐进显示
      // ============================================================
      /**
       * 随着回放进度，逐步显示点迹
       * 
       * 原理：
       * - 每个点迹都有 show 属性（true/false）
       * - 当 lo 增加时，将索引 <= lo 的点迹设为可见
       * - 效果：点迹像"画线"一样逐个出现
       * 
       * 优化：使用 pointDotLastLo 记录上次显示的 lo
       * 只有 lo 变化时才更新，避免重复操作
       */
      const dotPrimitives = pointDotEntityMap.get(tKey)
      if (dotPrimitives && dotPrimitives.length > 0) {
        const prevLo = pointDotLastLo.get(tKey) ?? -1
        if (lo !== prevLo) {
          pointDotLastLo.set(tKey, lo)  // 更新状态
          // 遍历所有点迹：索引 <= lo 的显示，> lo 的隐藏
          for (let i = 0; i < dotPrimitives.length; i++) {
            dotPrimitives[i].show = i <= lo
          }
        }
      }
    }
    // ── 结束 shouldUpdateGeometry ──
  }

  // ============================================================
  // 优化策略 6：按需渲染（RequestRender）
  // ============================================================
  /**
   * 只有几何体发生变化时才请求重新渲染
   * 
   * Cesium 的 requestRenderMode 模式下：
   * - 不调用 requestRender() 则不会渲染新帧
   * - 这样可以大幅节省 GPU 资源
   * 
   * 位置更新（标签/端点）不需要重新渲染几何体，
   * Cesium 会自动处理这些属性的更新
   */
  if (geometryUpdated) {
    viewer.scene.requestRender()
  }
}



// ============================================================
// 在 CesiumMap.vue 中，找到以下位置：
// 1. 状态声明区域（约第 100-200 行）
// 2. watch(replayTime) 区域（约第 800-900 行）
// ============================================================

// ──────────────────────────────────────────────────────────────
// 第一部分：状态声明（替换原有的 let wasReplaying = false）
// ──────────────────────────────────────────────────────────────

let wasReplaying = false

// 🆕 新增：Worker 相关状态
let replayWorker: Worker | null = null
let isWorkerReady = false
let pendingResults: Map<string, { lat: number; lng: number; lo: number; altitude?: number }> | null = null
let lastRequestedTime = -1
let isProcessingResults = false
let processScheduled = false
let workerInitPromise: Promise<void> | null = null


// ──────────────────────────────────────────────────────────────
// 第二部分：Worker 相关函数（新增，放在 watch 之前）
// ──────────────────────────────────────────────────────────────

/**
 * 初始化 Replay Worker
 */
function initReplayWorker(): Promise<void> {
  if (replayWorker && isWorkerReady) return Promise.resolve()
  if (workerInitPromise) return workerInitPromise

  workerInitPromise = new Promise((resolve, reject) => {
    try {
      // 使用 Vite 的 Worker 导入
      replayWorker = new Worker(
        new URL('../workers/replay.worker.ts', import.meta.url),
        { type: 'module' }
      )

      replayWorker.onmessage = (e) => {
        const data = e.data
        if (data.type === 'result') {
          // 只处理最新的请求（丢弃过期数据）
          if (data.timestamp >= lastRequestedTime) {
            pendingResults = new Map()
            for (const item of data.results) {
              pendingResults.set(item.key, {
                lat: item.lat,
                lng: item.lng,
                lo: item.lo,
                altitude: item.altitude
              })
            }
            // 在主线程空闲时处理结果
            scheduleProcessResults()
          }
        }
      }

      replayWorker.onerror = (e) => {
        console.warn('[Replay Worker] 错误，降级到同步模式:', e)
        isWorkerReady = false
        workerInitPromise = null
        reject(e)
      }

      // 发送初始化数据
      const serializedTracks = props.tracks.map(track => ({
        timestamps: new Float64Array(track.positions.map(p => p.timestamp)),
        lats: new Float64Array(track.positions.map(p => p.latitude)),
        lngs: new Float64Array(track.positions.map(p => p.longitude)),
        altitudes: new Float64Array(track.positions.map(p => p.altitude || 0))
      }))

      replayWorker.postMessage({
        type: 'init',
        tracks: serializedTracks,
        trackKeys: props.tracks.map(t => trackKey(t.id, t.source)),
        flatAltitude: FLAT_ALTITUDE
      })

      isWorkerReady = true
      resolve()
    } catch (err) {
      console.warn('[Replay Worker] 初始化失败，降级到同步模式:', err)
      isWorkerReady = false
      workerInitPromise = null
      reject(err)
    }
  })

  return workerInitPromise
}

/**
 * 调度处理 Worker 结果（使用 requestIdleCallback）
 */
function scheduleProcessResults() {
  if (processScheduled) return
  processScheduled = true

  const doProcess = () => {
    processScheduled = false
    if (pendingResults) {
      processWorkerResults(pendingResults)
      pendingResults = null
    }
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(doProcess, { timeout: 16 })
  } else {
    requestAnimationFrame(doProcess)
  }
}

/**
 * 处理 Worker 计算结果（批量更新 Cesium）
 */
function processWorkerResults(results: Map<string, { lat: number; lng: number; lo: number; altitude?: number }>) {
  console.log('[Main] processWorkerResults 被调用，结果数量:', results.size)
  if (isProcessingResults) return
  isProcessingResults = true

  try {
    const tempPos = new Cesium.Cartesian3()
    let geometryUpdated = false
    let trailCount = 0  // ← 添加

    for (const [tKey, data] of results) {
      const entities = entityMap.get(tKey)
      if (!entities) 
      {
        console.warn('[Main] 未找到实体:', tKey)  // 可选
        continue
      }

      // 更新位置
      Cesium.Cartesian3.fromDegrees(data.lng, data.lat, FLAT_ALTITUDE, undefined, tempPos)

      // 批量更新标签和端点
      if (entities.label) {
        entities.label.position = tempPos
      }
      if (entities.pointPrimitive) {
        entities.pointPrimitive.position = tempPos
      }

      // 更新轨迹线（仅当 lo 变化时）
      if (data.lo !== entities.lastTrailLo) {
        updateTrailLineFromWorker(entities, data.lo, tempPos)
        entities.lastTrailLo = data.lo
        geometryUpdated = true
        trailCount++  // ← 添加
      }

      // 更新点迹渐进显示
      updatePointDotsFromWorker(tKey, data.lo)
    }

    console.log('[Main] 更新了', trailCount, '条轨迹线')  // ← 添加

    // 仅在更新了轨迹线时才请求渲染
    if (geometryUpdated) {
      viewer?.scene.requestRender()
    }
  } finally {
    isProcessingResults = false
  }
}

/**
 * 从 Worker 结果更新轨迹线
 *
 * 
 */
function updateTrailLineFromWorker(
  entities: TrackEntities,
  lo: number,
  pos: Cesium.Cartesian3
) {
  if (!trackLines) return

  const cache = (entities as any).cachedPositions
  if (!cache || lo >= cache.length) return

  if (!entities.trailLine) {
    // ── 创建新的 trailLine ──
    const tKey = entities.entity?.id as string
    const isSel = tKey === props.selectedId
    const isRaw = entities.source === 'radar_raw'
    const color = getLineColor(entities.source as DataSource)
    const alpha = isSel ? SELECTED_ALPHA : (isRaw ? RAW_ALPHA : NORMAL_ALPHA)

    const trailPositions = cache.slice(0, lo + 1)
    trailPositions.push(pos)

    const material = Cesium.Material.fromType('Color', {
      color: color.withAlpha(alpha),
    })

    entities.trailLine = trackLines.add({
      id: `trail::${tKey}`,
      show: true,
      positions: trailPositions,
      width: isSel ? SELECTED_WIDTH : baseWidth(entities.source as DataSource),
      material: material,
    })
    entities.trailMaterial = material
    return
  }

  // ── 更新已有 trailLine（复用数组，避免重新分配） ──
  const positions = entities.trailLine.positions as Cesium.Cartesian3[]
  const targetLen = lo + 2

  if (positions.length !== targetLen) {
    positions.length = targetLen
  }

  for (let i = 0; i <= lo; i++) {
    positions[i] = cache[i]
  }
  positions[lo + 1] = pos

  entities.trailLine.show = true

  // 更新宽度（选中状态变化时）
  const tKey = entities.entity?.id as string
  const isSel = tKey === props.selectedId
  entities.trailLine.width = isSel ? SELECTED_WIDTH : baseWidth(entities.source as DataSource)
}

/**
 * 从 Worker 结果更新点迹
 */
function updatePointDotsFromWorker(tKey: string, lo: number) {
  const primitives = pointDotEntityMap.get(tKey)
  if (!primitives || primitives.length === 0) return

  const prevLo = pointDotLastLo.get(tKey) ?? -1
  if (lo !== prevLo) {
    pointDotLastLo.set(tKey, lo)
    for (let i = 0; i < primitives.length; i++) {
      primitives[i].show = i <= lo
    }
  }
}

/**
 * 同步计算（降级方案）- 保留原始逻辑
 */
function updateReplayPositionsSync(time: number) {
  // ⚠️ 这里放原始的 updateReplayPositions 函数代码
  // 为了简洁，省略，但实际使用时需要复制原始函数内容
  // 或者直接调用原始函数（如果保留的话）
  // 建议：将原始 updateReplayPositions 重命名为 updateReplayPositionsSync
}

/**
 * 销毁 Worker
 */
function destroyReplayWorker() {
  if (replayWorker) {
    replayWorker.terminate()
    replayWorker = null
  }
  isWorkerReady = false
  workerInitPromise = null
  pendingResults = null
  processScheduled = false
  isProcessingResults = false
  lastRequestedTime = -1
}

// ──────────────────────────────────────────────────────────────
// 第三部分：替换原有的 watch(replayTime)
// ──────────────────────────────────────────────────────────────

watch(
  () => props.replayTime,
  (time) => {
    if (time !== null) {
      // ── 进入回放模式 ──
      if (!wasReplaying) {
        // 初始化 Worker
        if (!replayWorker) {
          initReplayWorker().catch(() => {
            // Worker 初始化失败，使用同步模式
            isWorkerReady = false
          })
        }

        // 隐藏所有 Entity polylines
        for (const [, entities] of entityMap) {
          if (entities.entity) entities.entity.show = false
          if (entities.trailLine) {
            removeTrailLine(entities.trailLine)
            entities.trailLine = undefined
          }
        }

        // 隐藏所有点迹
        if (pointDotEntityMap.size > 0) {
          pointDotLastLo.clear()
          for (const primitives of pointDotEntityMap.values()) {
            for (const p of primitives) p.show = false
          }
        }

        wasReplaying = true
      }

      // ── 每帧更新位置 ──
      if (isWorkerReady && replayWorker) {
        // 🚀 使用 Worker 异步计算（不阻塞主线程）
        lastRequestedTime = time
        replayWorker.postMessage({
          type: 'compute',
          time: time
        })
      } else {
        // ⬇️ 降级：使用同步计算
        updateReplayPositionsSync(time)
      }

    } else if (wasReplaying) {
      // ── 退出回放模式 ──
      wasReplaying = false

      // 1. 移除 trail 线并恢复实体可见性
      for (const track of props.tracks) {
        const entities = entityMap.get(trackKey(track.id, track.source))
        if (!entities || track.positions.length === 0) continue

        if (entities.trailLine) {
          removeTrailLine(entities.trailLine)
          entities.trailLine = undefined
          entities.trailMaterial = undefined
        }

        if (entities.entity) {
          entities.entity.show = visibility.value[entities.source as keyof typeof visibility.value] !== false
        }

        const last = track.positions[track.positions.length - 1]
        const lastPos = Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE)
        if (entities.label) entities.label.position = lastPos
        if (entities.pointPrimitive) entities.pointPrimitive.position = lastPos
      }

      // 2. 清空点迹缓存
      pointDotLastLo.clear()

      // 3. 重建 trackLines
      if (trackLines && viewer) {
        const old = trackLines
        trackLines = viewer.scene.primitives.add(new Cesium.PolylineCollection())
        viewer.scene.primitives.remove(old)
        if (!old.isDestroyed()) old.destroy()
        if (hoverOverlayLines) {
          viewer.scene.primitives.raiseToTop(hoverOverlayLines as any)
        }
        for (const [, ent] of entityMap) {
          ent.trailLine = undefined
          ent.trailMaterial = undefined
        }
      }

      // 4. 清除点迹集合
      if (pointDotsCollection) {
        pointDotsCollection.removeAll()
      }
      pointDotEntityMap.clear()
      pointDotLastLo.clear()
      manualPointDotsTrackIds.value = new Set()
      globalHiddenTrackKeys.value = new Set()
      syncGlobalPointDots()

      // 5. 销毁所有主实体并重建
      for (const [id] of entityMap) {
        removeTrackEntities(id)
      }
      entityMap.clear()

      console.log('[CesiumMap] ⭐ 销毁所有主实体（核心修复）')

      // 6. 重新创建所有实体
      syncEntities(props.tracks)
      reapplyVisibility()
      if (previousSelectedId) applyHighlight(previousSelectedId)

      // 7. 重置计数器
      replayCounter = 0

      // 8. 清理 Worker 结果缓存
      pendingResults = null
      lastRequestedTime = -1

      viewer?.scene.requestRender()
    }
  }
)





watch(
  visibility,
  () => {
    for (const [, entities] of entityMap) {
      const vis = visibility.value[entities.source as keyof typeof visibility.value]
      if (entities.entity) entities.entity.show = vis
      if (entities.label) entities.label.show = vis
      if (entities.pointPrimitive) entities.pointPrimitive.show = vis
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Boundary visibility toggle — fast path: only flips dataSource.show
watch(boundaryVisible, () => {
  applyBoundaryVisibility()
  viewer?.scene.requestRender()
})

// Boundary width change — debounced: during rapid slider drag the reactive value
// updates instantly (UI stays responsive), but the heavy per-entity width loop only
// runs once after the user pauses for 60ms, avoiding 9K+ entity updates at 60 Hz.
let boundaryWidthDebounce: ReturnType<typeof setTimeout> | null = null
watch(boundaryWidths, () => {
  if (boundaryWidthDebounce) clearTimeout(boundaryWidthDebounce)
  boundaryWidthDebounce = setTimeout(() => {
    boundaryWidthDebounce = null
    applyAllBoundaryWidths()
    viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

// Boundary color change — same debounced pattern as widths
let boundaryColorDebounce: ReturnType<typeof setTimeout> | null = null
watch(boundaryColors, () => {
  if (boundaryColorDebounce) clearTimeout(boundaryColorDebounce)
  boundaryColorDebounce = setTimeout(() => {
    boundaryColorDebounce = null
    applyAllBoundaryColors()
    viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

let cityLayerDebounce: ReturnType<typeof setTimeout> | null = null
let lastCityRenderHeight = 0 // LOD threshold tracking

// City visible toggle → load/unload
watch(() => cityLayer.visible, (vis) => {
  if (vis) {
    if (cityFeatures.length === 0) loadCityLayer()
    else { renderCityLayer(); viewer?.scene.requestRender() }
  } else {
    clearCityLayer()
  }
})

watch(cityLayer, () => {
  if (!cityLayer.visible) return // 不可见时跳过重建
  scheduleCityLayerRender(80, true)
}, { deep: true })

// Reactive line width: update existing polylines when slider changes
watch(
  () => props.lineWidths,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (tKey !== previousSelectedId && !hoveredTrackId) {
        if (entry.entity?.polyline) {
          (entry.entity.polyline as any).width = baseWidth(entry.source as DataSource)
        }
      }
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive dot scale: update PointPrimitives when slider changes (P1)
watch(
  () => props.dotScale,
  () => {
    for (const [tKey, entry] of entityMap) {
      if (!entry.pointPrimitive) continue
      const isSelected = tKey === previousSelectedId
      const isHovered = hoveredTrackId === tKey
      const isRaw = entry.source === 'radar_raw'
      const base = isHovered ? DOT_HOVER
        : isSelected ? DOT_SELECTED
        : isRaw ? DOT_RAW
        : DOT_BASE
      entry.pointPrimitive.pixelSize = pointPrimSize(base, entry.source)
    }
    viewer?.scene.requestRender()
  },
  { deep: true },
)

// Reactive line color: update polylines & PointPrimitives when color changes (P1)
watch(lineColors, () => {
  for (const [tKey, entry] of entityMap) {
    const isSelected = tKey === previousSelectedId
    const isHovered = hoveredTrackId === tKey
    if (isSelected || isHovered) continue

    const color = getLineColor(entry.source as DataSource)
    const isRaw = entry.source === 'radar_raw'
    if (entry.entity?.polyline) {
      entry.entity.polyline.material = color.withAlpha(isRaw ? RAW_ALPHA : NORMAL_ALPHA) as any
    }
    if (entry.pointPrimitive) {
      entry.pointPrimitive.color = color
    }
  }
  viewer?.scene.requestRender()
}, { deep: true })

// Highlight selected track
let previousSelectedId: string | null = null

function applyHighlight(trackId: string | null) {
 return
}

// Hover highlight — bright red + thick, unmistakable
let hoveredTrackId: string | null = null
// rAF batched pick：避免每个 MOUSE_MOVE 都做 scene.pick()，每帧只 pick 一次
let pendingPickPos: Cesium.Cartesian2 | null = null
let lastMousePosition: Cesium.Cartesian2 | null = null
let pickScheduled = false
const HOVER_COLOR = Cesium.Color.fromCssColorString('#ff3333')
const HOVER_WIDTH = 5.0
const NORMAL_ALPHA = 0.88
const RAW_ALPHA = 0.75
const SELECTED_WIDTH = 4.0
const SELECTED_ALPHA = 1.0



/** All tracks render at this exact WGS84 altitude (meters).  Real altitude from
 *  the data is ignored for rendering — only used in labels / hover tooltips. */
const FLAT_ALTITUDE = 10000
/** Hover overlay altitude — 1500m above all tracks so depth test always wins */
const HOVER_OVERLAY_ALTITUDE = FLAT_ALTITUDE + 1500

// Dot (billboard) base scale values, multiplied by props.dotScale
const DOT_BASE = 0.7
const DOT_RAW = 0.4
const DOT_SELECTED = 1.2
const DOT_HOVER = 1.3

/** P1: PointPrimitive pixelSize from dot scale (billboard canvas 24px, circle r≈10) */
const POINT_PRIMITIVE_BASE = 12
function pointPrimSize(dotBase: number, source: string): number {
  return POINT_PRIMITIVE_BASE * (dotBase / DOT_BASE) * (props.dotScale[source as DataSource] ?? 1.0)
}

function baseWidth(source: DataSource): number {
  return props.lineWidths[source] ?? 2.0
}

function baseAlpha(source: string): number {
  return source === 'radar_raw' ? 0.6 : NORMAL_ALPHA
}

function applyHoverHighlight(trackId: string) {
  const entry = entityMap.get(trackId)
  if (!entry || !entry.entity?.polyline) return

  // If this track is already click-selected, don't override with red
  //if (previousSelectedId === trackId) return

  // Get the main polyline's positions, clone them to elevated altitude
  const srcPositions = (entry.entity.polyline as any).positions?.getValue?.()
    ?? (entry.entity.polyline as any).positions
  if (!srcPositions || !Array.isArray(srcPositions) || srcPositions.length < 2) return

  // Clone positions to HOVER_OVERLAY_ALTITUDE so depth test always wins
  const elevatedPositions = srcPositions.map((p: Cesium.Cartesian3) => {
    const cartographic = Cesium.Cartographic.fromCartesian(p)
    return Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(cartographic.longitude),
      Cesium.Math.toDegrees(cartographic.latitude),
      HOVER_OVERLAY_ALTITUDE,
    )
  })

  if (!activeOverlayLine) {
    // First hover: create the reusable overlay polyline (Material created ONCE)
    activeOverlayLine = hoverOverlayLines!.add({
      id: 'hover-overlay',
      positions: elevatedPositions,
      width: HOVER_WIDTH,
      material: Cesium.Material.fromType('Color', { color: HOVER_COLOR }),
    })
  } else {
    // Subsequent hovers: update positions + uniform color (NO new Material / Shader!)
    activeOverlayLine.positions = elevatedPositions
    activeOverlayLine.show = true
    if ((activeOverlayLine.material as any)?.uniforms) {
      ;(activeOverlayLine.material as any).uniforms.color = HOVER_COLOR
    }
  }

  if (entry.pointPrimitive) {
    entry.pointPrimitive.pixelSize = pointPrimSize(DOT_HOVER, entry.source)
    entry.pointPrimitive.color = HOVER_COLOR
  }
}

function removeHoverHighlight() {
  // Hide the reusable overlay — do NOT remove it (preserves Material for reuse)
  if (activeOverlayLine) {
    activeOverlayLine.show = false
  }
  if (!hoveredTrackId) return
  const entry = entityMap.get(hoveredTrackId)
  if (entry?.pointPrimitive) {
    const isSelected = hoveredTrackId === previousSelectedId
    entry.pointPrimitive.pixelSize = pointPrimSize(
      isSelected ? DOT_SELECTED : entry.source === 'radar_raw' ? DOT_RAW : DOT_BASE,
      entry.source,
    )
    entry.pointPrimitive.color = getLineColor(entry.source as DataSource)
  }
  hoveredTrackId = null
}

function onMouseMove(movement: Cesium.ScreenSpaceEventHandler.MotionEvent) {
  // rAF 合并：只记录鼠标位置，每帧最多执行一次 pick
  pendingPickPos = movement.endPosition.clone()
  lastMousePosition = pendingPickPos.clone()
  emitViewStatus(lastMousePosition)
  if (!pickScheduled) {
    pickScheduled = true
    requestAnimationFrame(() => {
      pickScheduled = false
      if (pendingPickPos && viewer && !viewer.isDestroyed()) {
        doPick(pendingPickPos)
        pendingPickPos = null
      }
    })
  }
}

function doPick(endPosition: Cesium.Cartesian2) {
  const picked = viewer!.scene.pick(endPosition)
  if (!Cesium.defined(picked) || !picked.id) {
    hideCityHover()
    hidePointDotHover()
    removeHoverHighlight()
    viewer!.scene.requestRender()
    return
  }

  // ── 点迹穿透：命中点迹时钻取找下方航迹 ──
  if (typeof picked.id === 'string' && picked.id.startsWith('pointdot::')) {
    const drill = viewer!.scene.drillPick(endPosition, 5)
    
    for (let i = 1; i < drill.length; i++) {
      const hit = drill[i]
      if (!Cesium.defined(hit.id)) continue
      if (typeof hit.id === 'string' && hit.id.startsWith('pointdot::')) continue
      if (typeof hit.id === 'string' && hit.id === 'hover-overlay') continue
      
      let trackId: string | null = null
      if (typeof hit.id === 'string') {
        if (hit.id.startsWith('trail::')) {
          trackId = hit.id.slice('trail::'.length)
        } else if (entityMap.has(hit.id)) {
          trackId = hit.id
        }
      } else if (hit.id instanceof Cesium.Entity) {
        const entityId = (hit.id as Cesium.Entity).id
        if (typeof entityId === 'string' && entityMap.has(entityId)) {
          trackId = entityId
        }
      }
      
      if (trackId && entityMap.has(trackId)) {
        doPickWithPicked({ id: trackId }, endPosition)
        return
      }
    }
    
    // 没有下方航迹：仅显示点迹信息（不触发航迹高亮）
    const parts = (picked.id as string).split('::')
    if (parts.length === 3) {
      const trackId = parts[1]
      const index = parseInt(parts[2], 10)
      if (!isNaN(index) && entityMap.has(trackId)) {
        // 先清除之前的航迹高亮
        removeHoverHighlight()
        hideCityHover()
        // 显示点迹信息
        showPointDotHover(trackId, index)
        viewer!.scene.requestRender()
      }
    }
    return
  }

  // ── hover-overlay 穿透 ──
  if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
    const drill = viewer!.scene.drillPick(endPosition, 3)
    const realHit = drill.length > 1 ? drill[1] : null
    if (!realHit || !Cesium.defined(realHit.id)) {
      viewer!.scene.requestRender()
      return
    }
    doPickWithPicked(realHit, endPosition)
    return
  }

  // ── 正常处理 ──
  doPickWithPicked(picked, endPosition)
}

/** Process a pick result that has already been resolved (or was never an overlay) */
function doPickWithPicked(picked: any, endPosition: Cesium.Cartesian2) {
  const city = pickedCity(picked)
  if (city) {
    removeHoverHighlight()
    hidePointDotHover()
    showCityHover(city)
    viewer!.scene.requestRender()
    return
  }
  hideCityHover()

  let trackId: string | null = null

  if (typeof picked.id === 'string') {
    // L1: Label pick — id is "{trackKey}::dot"
    if (picked.id.endsWith('::dot')) {
      const baseId = picked.id.slice(0, picked.id.lastIndexOf('::'))
      if (entityMap.has(baseId)) trackId = baseId
    }
    // L2: PointPrimitive / Entity ID (string) — direct trackKey match
    else if (entityMap.has(picked.id)) {
      trackId = picked.id
    }
    // L3: Trail line pick during replay (id is "trail::{trackKey}")
    else if (picked.id.startsWith('trail::')) {
      const baseId = picked.id.slice('trail::'.length)
      if (entityMap.has(baseId)) trackId = baseId
    }
    // L4: Point dot pick
    else if (picked.id.startsWith('pointdot::')) {
      const parts = picked.id.split('::')
      if (parts.length === 3 && entityMap.has(parts[1])) trackId = parts[1]
    }
  } else if (picked.id instanceof Cesium.Entity) {
    // Entity API pick: entity.id is the trackKey
    const entityId = (picked.id as Cesium.Entity).id
    if (typeof entityId === 'string' && !entityId.startsWith('flag-') && !entityId.startsWith('pointdot::')) {
      if (entityMap.has(entityId)) trackId = entityId
    }
  }

  if (!trackId || !entityMap.has(trackId)) {
    removeHoverHighlight()
    hidePointDotHover()
    viewer!.scene.requestRender()
    return
  }

  if (hoveredTrackId === trackId) {
    // Same track — check point dot proximity
    const dotHit = checkPointDotHit(trackId, endPosition)
    if (dotHit !== null) {
      if (hoveredPointDotId === dotHit.id) return
      hidePointDotHover()
      hoveredPointDotId = dotHit.id
      showPointDotHover(trackId, dotHit.index)
      viewer!.scene.requestRender()
    } else {
      hidePointDotHover()
    }
    return
  }

  removeHoverHighlight()
  hoveredTrackId = trackId
  applyHoverHighlight(trackId)

  const dotHit = checkPointDotHit(trackId, endPosition)
  if (dotHit !== null) {
    hoveredPointDotId = dotHit.id
    showPointDotHover(trackId, dotHit.index)
  } else {
    hidePointDotHover()
  }

  viewer!.scene.requestRender()
}

/** Screen-space proximity check: find the closest visible point dot to the mouse cursor */
function checkPointDotHit(trackId: string, mousePos: Cesium.Cartesian2): { id: string; index: number } | null {
  if (!viewer || !pointDotsCollection) return null
  const primitives = pointDotEntityMap.get(trackId)
  if (!primitives || primitives.length === 0) return null

  const threshold = Math.max(pointDotPixelSize + 30, 60) // px radius
  const thresholdSq = threshold * threshold
  let bestIdx = -1
  let bestDistSq = Infinity
  const _scratch = new Cesium.Cartesian2()

  for (let i = 0; i < primitives.length; i++) {
    const prim = primitives[i]
    if (!prim.show) continue
    const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      (prim as any).position as Cesium.Cartesian3,
      _scratch,
    )
    if (!Cesium.defined(screenPos)) continue
    const dx = screenPos.x - mousePos.x
    const dy = screenPos.y - mousePos.y
    const distSq = dx * dx + dy * dy
    if (distSq < thresholdSq && distSq < bestDistSq) {
      bestDistSq = distSq
      bestIdx = i
    }
  }

  if (bestIdx < 0) return null
  return { id: `pointdot::${trackId}::${bestIdx}`, index: bestIdx }
}

watch(() => props.selectedId, (newId) => {
  applyHighlight(newId ?? null)
})

// Sync flag entities reactively
watch(flags, () => {
  syncFlagEntities()
}, { deep: false })

// Re-sync flag entities when flag scale changes
watch(flagScale, () => {
  syncFlagEntities()
})

// Draw great-circle arc between selected flags
watch(selectedPair, (pair) => {
  if (arcEntity && viewer) {
    viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (pair && viewer) {
    const [a, b] = pair
    const positions: Cesium.Cartesian3[] = []
    const start = Cesium.Cartographic.fromDegrees(a.longitude, a.latitude)
    const end = Cesium.Cartographic.fromDegrees(b.longitude, b.latitude)
    const geodesic = new Cesium.EllipsoidGeodesic(start, end)
    const segments = 64
    for (let i = 0; i <= segments; i++) {
      const p = geodesic.interpolateUsingFraction(i / segments)
      positions.push(Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, 0))
    }
    arcEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.YELLOW.withAlpha(0.8),
        clampToGround: false,
      },
    })
  }
})

watch(showLabels, (val) => {
  for (const [, entities] of entityMap) {
    if (entities.label) {
      entities.label.text = val ? entities.labelText : ''
      entities.label.font = val ? LABEL_FONT_LARGE : LABEL_FONT_BASE
    }
  }
  viewer?.scene.requestRender()
})

// ── Track point dots watchers ──

// Update point dot pixel size when slider changes
watch(trackPointDotScale, (newScale) => {
  pointDotPixelSize = Math.max(2.0, 7.0 * newScale)
  refreshPointDotSizes()
})

// Update point dot colors when custom color or line color changes
watch([pointDotColors, lineColors], () => {
  refreshPointDotColors()
}, { deep: true })

// Sync global point dots when toggle changes
watch(showAllPointDots, (val) => {
  if (!val) {
    // Global turned off: clear the hidden list (only meaningful in global mode)
    globalHiddenTrackKeys.value = new Set()
  }
  syncGlobalPointDots()
})

// Clear all point dots when requested from settings
watch(clearAllCounter, () => {
  clearAllPointDots()
})

// Clean up point dots when tracks change (filtered out / removed)
watch(
  () => props.tracks,
  () => {
    syncGlobalPointDots()
  },
  { deep: false },
)

function resetView() {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

function flyToTrack(track: Track) {
  if (!viewer || track.positions.length === 0) return
  const last = track.positions[track.positions.length - 1]
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(last.longitude, last.latitude, FLAT_ALTITUDE + 8000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: 1.5,
  })
}

// ── 航迹点迹渲染 ──

/** Generate a high-contrast color from a hex line color.
 *  Uses HSL complementary (hue +180°) with boosted saturation and mid lightness
 *  so dots stand out against the track line and the dark map background. */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6
  }
  // Rotate hue 180°, boost saturation, fix mid-bright lightness
  h = (h + 0.5) % 1
  s = Math.max(s, 0.75)
  const nl = 0.55
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s
  const p = 2 * nl - q
  const nr = Math.round(hue2rgb(p, q, h + 1 / 3) * 255)
  const ng = Math.round(hue2rgb(p, q, h) * 255)
  const nb = Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

/** Resolve the color for a track's point dots: custom override > auto contrast of line color */
function getPointDotColor(source: DataSource): string {
  const custom = pointDotColors[source]
  if (custom) return custom
  return contrastColor(getEffectiveHex(source))
}

// ── 右键上下文菜单动作 ──
function closeContextMenu() {
  contextMenu.value.visible = false
}

function handleContextRename() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  const newLabel = prompt('请输入新名称：', flag.label)
  if (newLabel && newLabel.trim()) {
    renameFlag(flag.id, newLabel.trim())
  }
  closeContextMenu()
}

function handleContextDelete() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  if (confirm(`确定要删除旗标「${flag.label}」吗？`)) {
    removeFlag(flag.id)
  }
  closeContextMenu()
}

function handleChangeFlagStyle(style: string) {
  const flagId = contextMenu.value.flagId
  if (!flagId) return
  setFlagStyle(flagId, style)
  closeContextMenu()
}

function getFlagStyle(flagId: string): string {
  const flag = flags.value.find((f) => f.id === flagId)
  return flag?.style || 'flag-pin'
}

function handleContextShowPointDots() {
  showManualPointDots(contextMenu.value.trackId)
  closeContextMenu()
}

function handleContextHidePointDots() {
  hidePointDotsForTrack(contextMenu.value.trackId)
  closeContextMenu()
}

function handleContextShowDetail() {
  const trackId = contextMenu.value.trackId
  // Extract ICAO and source from trackKey (format: "icao::source")
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  addHighlight(icao)
  emit('show-track-detail', { icao, source })
  closeContextMenu()
}

function handleContextViewPoints() {
  const trackId = contextMenu.value.trackId
  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (track) {
    emit('view-track-points', track)
  }
  closeContextMenu()
}

function handleContextDeleteTrack() {
  const trackId = contextMenu.value.trackId
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  emit('delete-track', { icao, source })
  closeContextMenu()
}

// Watch theme changes to update Cesium background color
watch(activeTheme, () => {
  updateCesiumBackground()
})

// ── Camera state persistence ──

interface CameraState {
  longitude: number
  latitude: number
  height: number
  heading: number
  pitch: number
  roll: number
}

let _cameraSaveTimer: ReturnType<typeof setTimeout> | null = null

function persistCameraState() {
  if (!viewer) return
  const cam = viewer.camera
  const cartographic = Cesium.Cartographic.fromCartesian(cam.position)
  const state: CameraState = {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
    heading: cam.heading,
    pitch: cam.pitch,
    roll: cam.roll,
  }
  scheduleSave('camera.state', JSON.stringify(state))
}

function restoreCameraState() {
  if (!viewer) return
  const raw = getRawSetting('camera.state')
  if (!raw) return false
  try {
    const s: CameraState = JSON.parse(raw)
    if (
      typeof s.longitude !== 'number' || typeof s.latitude !== 'number' ||
      typeof s.height !== 'number' || typeof s.heading !== 'number' ||
      typeof s.pitch !== 'number' || typeof s.roll !== 'number'
    ) return false
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, s.height),
      orientation: {
        heading: s.heading,
        pitch: s.pitch,
        roll: s.roll,
      },
    })
    return true
  } catch {
    return false
  }
}

onMounted(async () => {
  if (!containerRef.value) return

  const port: number = await invoke('get_tile_server_port')
  tileServerPort = port

  viewer = new Cesium.Viewer(containerRef.value, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    skyBox: false,
    skyAtmosphere: false,
    baseLayer: false,
  })
  // Keep globe-facing occlusion correct: back-side tracks, points, and labels
  // must not draw through the earth when the camera moves.
  viewer.scene.globe.depthTestAgainstTerrain = true
  // Track actual scene render FPS via postRender — fires only when requestRenderMode triggers a real draw
  viewer.scene.postRender.addEventListener(() => {
    const now = performance.now()
    // Start measurement window on first render, not at script load time
    if (fpsLastSampleTime === 0) {
      fpsLastSampleTime = now
      fpsFrameCount = 1
      return
    }
    fpsFrameCount++
    const elapsed = now - fpsLastSampleTime
    // Update FPS every ~500ms for faster response; require ≥5 frames to avoid idle-spike noise
    if (elapsed >= 500 && fpsFrameCount >= 5) {
      const instantFps = fpsFrameCount / (elapsed / 1000)
      // EMA α=0.5 — faster convergence than 0.3, still smooth
      fpsSmoothed = fpsSmoothed === 0 ? instantFps : fpsSmoothed * 0.5 + instantFps * 0.5
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
    // If no render for >1.5s, reset to 0 (will display as "--" in status bar)
    if (elapsed > 1500) {
      fpsSmoothed = 0
      fpsFrameCount = 0
      fpsLastSampleTime = now
    }
  })
  viewer.camera.percentageChanged = 0.03
  removeCityCameraChanged = viewer.camera.changed.addEventListener(() => {
    // City layer is NOT rebuilt on every camera change — that causes flicker.
    // Instead, we rebuild once on moveEnd after the camera settles.
    emitViewStatus(lastMousePosition)
  })

  currentImageryLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${port}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: 8,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )
  // P1: PointPrimitiveCollection for fast endpoint dots (one draw call for all tracks)
  pointPrimitives = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection
  // P2: PolylineCollection for replay trail lines ONLY
  trackLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  // Lower endpoint dots and trail lines to the bottom
  viewer.scene.primitives.lowerToBottom(pointPrimitives as any)
  viewer.scene.primitives.lowerToBottom(trackLines as any)
  // P2: Separate PolylineCollection for hover overlay at elevated altitude (11500m)
  hoverOverlayLines = viewer.scene.primitives.add(new Cesium.PolylineCollection()) as unknown as Cesium.PolylineCollection
  // P1: LabelCollection for track labels — GPU-instanced, one draw call
  trackLabels = viewer.scene.primitives.add(new Cesium.LabelCollection())
  // P3: PointPrimitiveCollection for track point dots — GPU-instanced, outlined circles
  pointDotsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
  // ── 边界层延迟加载：等设置恢复后按可见性加载 ──
  await whenSettingsLoaded()
  applyBoundaryVisibility()
  // 城市图层懒加载：只在可见时才加载
  if (cityLayer.visible) await loadCityLayer()

  // Restore saved camera state, or use default view
  if (!restoreCameraState()) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    })
  }

  // Apply theme-aware background color
  updateCesiumBackground()

  // ===== 无极缩放（Stepless Zoom）=====
  // 禁用 Cesium 内置的步进式滚轮缩放
  viewer.scene.screenSpaceCameraController.zoomEventTypes = []

  // 注册原生 wheel 事件，按 deltaY 比例调整相机距离
  const zoomCanvas = viewer.scene.canvas
  onWheel = (event: WheelEvent) => {
    event.preventDefault()

    // 归一化 delta：deltaMode 0=像素 1=行 2=页
    // 鼠标滚轮一档 ≈ 100px，触摸板连续产生小数值
    let deltaPx = event.deltaY
    if (event.deltaMode === 1) {
      deltaPx = event.deltaY * 33 // 行模式 → 像素
    } else if (event.deltaMode === 2) {
      deltaPx = event.deltaY * 800 // 页模式 → 像素
    }

    // 缩放系数：每 100px 滚轮 ≈ 5% 距离变化（deltaY>0=缩小 deltaY<0=放大）
    const sensitivity = 0.0005
    const zoomFactor = 1 + deltaPx * sensitivity

    const cam = viewer!.camera
    const { globe } = viewer!.scene
    const { width, height } = zoomCanvas

    // 取屏幕中心点，计算到椭球面的投影
    const center = cam.pickEllipsoid(
      new Cesium.Cartesian2(width / 2, height / 2),
      globe.ellipsoid,
    )

    if (Cesium.defined(center)) {
      const direction = Cesium.Cartesian3.subtract(
        cam.position,
        center!,
        new Cesium.Cartesian3(),
      )
      const distance = Cesium.Cartesian3.magnitude(direction)
      const newDistance = Cesium.Math.clamp(
        distance * zoomFactor,
        100,        // 最低 ≈ 100m
        20000000,   // 最高 ≈ 20000km
      )

      const normalized = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3())
      const offset = Cesium.Cartesian3.multiplyByScalar(normalized, newDistance, new Cesium.Cartesian3())
      const newPosition = Cesium.Cartesian3.add(center!, offset, new Cesium.Cartesian3())

      cam.position = newPosition
      viewer!.scene.requestRender()
    }
  }
  zoomCanvas.addEventListener('wheel', onWheel, { passive: false })

  // Persist camera state on move end (debounced 500ms)
  // City layer LOD: only rebuild when camera crosses a threshold
  const CITY_LOD_THRESHOLDS = [1_000_000, 1_300_000, 1_500_000, 2_400_000]
  viewer.camera.moveEnd.addEventListener(() => {
    if (_cameraSaveTimer) clearTimeout(_cameraSaveTimer)
    _cameraSaveTimer = setTimeout(persistCameraState, 500)
    if (cityLayer.visible) {
      const h = currentCameraHeight()
      // Rebuild only if camera height crossed a LOD boundary
      let crossed = false
      for (const t of CITY_LOD_THRESHOLDS) {
        if ((lastCityRenderHeight < t && h >= t) || (lastCityRenderHeight >= t && h < t)) {
          crossed = true
          break
        }
      }
      if (crossed || lastCityRenderHeight === 0) {
        lastCityRenderHeight = h
        scheduleCityLayerRender(100, true)
      }
    }
  })

  syncEntities(props.tracks)
  syncFlagEntities()

  // LEFT_CLICK handler for track picking (skip flags)
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  clickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer!.scene.pick(movement.position)
    if (!Cesium.defined(picked) || !picked.id) {
      if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
      pendingClearTimeout = setTimeout(() => {
        pendingClearTimeout = null
        emit('track-pick', null)
      }, 300)
      return
    }

    // Penetrate hover overlay
    let effectivePicked = picked
    if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
      const drill = viewer!.scene.drillPick(movement.position, 3)
      if (drill.length > 1) effectivePicked = drill[1]
      else { emit('track-pick', null); return }
    }

    // P2: PolylineCollection pick (trail line) — picked.id is string like "trail::{trackKey}"
    let polyTrackId: string | null = null
    if (typeof effectivePicked.id === 'string') {
      if (effectivePicked.id.startsWith('trail::')) {
        polyTrackId = effectivePicked.id.slice('trail::'.length)
      } else if (entityMap.has(effectivePicked.id)) {
        polyTrackId = effectivePicked.id
      } else {
        const resolved = extractTrackKeyFromPolylineId(effectivePicked.id)
        if (resolved && entityMap.has(resolved)) polyTrackId = resolved
      }
    }
    if (polyTrackId && entityMap.has(polyTrackId)) {
      emit('track-pick', polyTrackId)
      return
    }

    // Entity API pick — entity.id is the trackKey
    if (effectivePicked.id instanceof Cesium.Entity) {
      const entityId = (effectivePicked.id as Cesium.Entity).id
      if (typeof entityId === 'string' && !entityId.startsWith('flag-') && !entityId.startsWith('pointdot::')) {
        if (entityMap.has(entityId)) {
          emit('track-pick', entityId)
          return
        }
      }
    }

    if (pendingClearTimeout) clearTimeout(pendingClearTimeout)
    pendingClearTimeout = setTimeout(() => {
      pendingClearTimeout = null
      emit('track-pick', null)
    }, 300)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

  // MOUSE_MOVE handler for hover highlight
  moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  moveHandler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

  // Disable default double-click zoom and use for flag placement/removal
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
  dblClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  dblClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    // Cancel any pending clear-isolation from the clicks of this double-click
    if (pendingClearTimeout) {
      clearTimeout(pendingClearTimeout)
      pendingClearTimeout = null
    }
    const picked = viewer!.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
      const entityId = picked.id.id
      if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
        const flagId = entityId.slice(5) // remove 'flag-' prefix
        removeFlag(flagId)
        return
      }
    }
    // Place new flag at clicked location
    const cartesian = viewer!.camera.pickEllipsoid(
      movement.position,
      viewer!.scene.globe.ellipsoid,
    )
    if (!Cesium.defined(cartesian)) return
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
    const lat = Cesium.Math.toDegrees(cartographic.latitude)
    const lng = Cesium.Math.toDegrees(cartographic.longitude)
    addFlag(lat, lng)
  }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  // ── 右键旗标上下文菜单 ──
  ctxCanvasEl = viewer.scene.canvas
  statusMouseLeaveFn = () => {
    lastMousePosition = null
    emitViewStatus(null)
  }
  ctxCanvasEl.addEventListener('mouseleave', statusMouseLeaveFn)

  // 方案：用 Cesium 自己的 ScreenSpaceEventHandler（RIGHT_CLICK 必定触发）
  rightClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  rightClickHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const picked = viewer!.scene.pick(movement.position)
    if (Cesium.defined(picked) && picked.id) {
      // Penetrate hover overlay
      let effectivePicked = picked
      if (typeof picked.id === 'string' && picked.id === 'hover-overlay') {
        const drill = viewer!.scene.drillPick(movement.position, 3)
        if (drill.length > 1) effectivePicked = drill[1]
        else { closeContextMenu(); return }
      }

      // P2: PolylineCollection pick (trail line) — id is "trail::{trackKey}"
      if (typeof effectivePicked.id === 'string') {
        let resolvedId: string | null = null
        if (effectivePicked.id.startsWith('trail::')) {
          resolvedId = effectivePicked.id.slice('trail::'.length)
        } else if (entityMap.has(effectivePicked.id)) {
          resolvedId = effectivePicked.id
        } else {
          const resolved = extractTrackKeyFromPolylineId(effectivePicked.id)
          if (resolved && entityMap.has(resolved)) resolvedId = resolved
        }
        if (resolvedId && entityMap.has(resolvedId) && hoveredTrackId === resolvedId) {
          contextMenu.value = {
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId: resolvedId,
          }
          return
        }
      }
      // P1: Label pick — label id is "{trackKey}::dot"
      if (typeof effectivePicked.id === 'string' && effectivePicked.id.endsWith('::dot')) {
        const trackId = effectivePicked.id.slice(0, effectivePicked.id.lastIndexOf('::'))
        if (entityMap.has(trackId) && hoveredTrackId === trackId) {
          contextMenu.value = {
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId,
          }
          return
        }
      }

      if (effectivePicked.id instanceof Cesium.Entity) {
        const entityId = effectivePicked.id.id
        if (typeof entityId === 'string' && entityId.startsWith('flag-')) {
          const flagId = entityId.slice(5)
          const flag = flags.value.find((f) => f.id === flagId)
          if (flag) {
            contextMenu.value = {
              visible: true, x: movement.position.x, y: movement.position.y,
              type: 'flag', flagId: flag.id, flagLabel: flag.label, trackId: '',
            }
            return
          }
        }
        // Track entity pick — entity.id is the trackKey directly
        if (typeof entityId === 'string' && entityMap.has(entityId) && hoveredTrackId === entityId) {
          contextMenu.value = {
            visible: true, x: movement.position.x, y: movement.position.y,
            type: 'track', flagId: '', flagLabel: '', trackId: entityId,
          }
          return
        }
      }

      // P0: point dot pick
      if (typeof effectivePicked.id === 'string' && effectivePicked.id.startsWith('pointdot::')) {
        const lastSep = (effectivePicked.id as string).lastIndexOf('::')
        if (lastSep > 'pointdot::'.length) {
          const trackId = (effectivePicked.id as string).slice('pointdot::'.length, lastSep)
          if (entityMap.has(trackId)) {
            contextMenu.value = {
              visible: true, x: movement.position.x, y: movement.position.y,
              type: 'track', flagId: '', flagLabel: '', trackId,
            }
            return
          }
        }
      }
    }
    closeContextMenu()
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

  // 阻止浏览器默认右键菜单
  ctxMenuFn = (e: MouseEvent) => e.preventDefault()
  ctxCanvasEl.addEventListener('contextmenu', ctxMenuFn)

  // 点击菜单外部关闭
  ctxClickOutsideFn = () => closeContextMenu()
  document.addEventListener('click', ctxClickOutsideFn)

  // Esc 关闭菜单
  ctxKeyFn = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeContextMenu()
  }
  document.addEventListener('keydown', ctxKeyFn)

  emitViewStatus(null)

  // Signal that Cesium map is fully initialized
  resolveMapReady()
})

onUnmounted(() => {
  // Final camera state save + cleanup
  if (_cameraSaveTimer) {
    clearTimeout(_cameraSaveTimer)
    _cameraSaveTimer = null
  }
  persistCameraState()

  clearAllPointDots()
  clearAllEntities()
  clearAllFlagEntities()
  clearBoundaryLayers()
  clearCityLayer()
  removeCityHover()
  removePointDotHover()

  destroyReplayWorker()


  if (cityLayerDebounce) {
    clearTimeout(cityLayerDebounce)
    cityLayerDebounce = null
  }
  if (removeCityCameraChanged) {
    removeCityCameraChanged()
    removeCityCameraChanged = null
  }
  if (arcEntity && viewer) {
    viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (dblClickHandler) {
    dblClickHandler.destroy()
    dblClickHandler = null
  }
  if (rightClickHandler) {
    rightClickHandler.destroy()
    rightClickHandler = null
  }
  if (clickHandler) {
    clickHandler.destroy()
    clickHandler = null
  }
  if (moveHandler) {
    moveHandler.destroy()
    moveHandler = null
  }
  // rAF 合并 pick 状态清理
  pendingPickPos = null
  lastMousePosition = null
  pickScheduled = false
  // 清理右键上下文菜单事件监听
  if (ctxCanvasEl && ctxMenuFn) {
    ctxCanvasEl.removeEventListener('contextmenu', ctxMenuFn)
  }
  if (ctxCanvasEl && statusMouseLeaveFn) {
    ctxCanvasEl.removeEventListener('mouseleave', statusMouseLeaveFn)
  }
  if (ctxClickOutsideFn) {
    document.removeEventListener('click', ctxClickOutsideFn)
  }
  if (ctxKeyFn) {
    document.removeEventListener('keydown', ctxKeyFn)
  }
  ctxMenuFn = null
  ctxClickOutsideFn = null
  ctxKeyFn = null
  statusMouseLeaveFn = null
  ctxCanvasEl = null
  if (onWheel) {
    viewer?.scene?.canvas?.removeEventListener('wheel', onWheel)
    onWheel = null
  }
  if (viewer) {
    pointPrimitives = null
    trackLines = null
    if (hoverOverlayLines) {
      viewer.scene.primitives.remove(hoverOverlayLines)
      if (!hoverOverlayLines.isDestroyed()) hoverOverlayLines.destroy()
      hoverOverlayLines = null
    }
    activeOverlayLine = null
    if (trackLabels) {
      viewer.scene.primitives.remove(trackLabels)
      if (!trackLabels.isDestroyed()) trackLabels.destroy()
      trackLabels = null
    }
    pointDotEntityMap.clear()
    if (pointDotsCollection) {
      pointDotsCollection.removeAll()
    }
    pointDotsCollection = null
    viewer.destroy()
    viewer = null
  }
})

function switchTileLayer(maxZoom?: number) {
  if (!viewer || tileServerPort === 0) return
  const maxLevel = maxZoom ?? 8
  if (currentImageryLayer) {
    viewer.imageryLayers.remove(currentImageryLayer, true)
    currentImageryLayer = null
  }
  currentImageryLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: `http://127.0.0.1:${tileServerPort}/tiles/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      maximumLevel: maxLevel,
      tileWidth: 256,
      tileHeight: 256,
    }),
  )
  viewer.scene.requestRender()
}

function flyToFlag(flag: Flag) {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude, 50000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.0,
  })
}

defineExpose({ getViewer: () => viewer, flyToTrack, flyToFlag, resetView, switchTileLayer, whenMapReady: () => mapReadyPromise })
</script>

<style scoped>
.cesium-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 隐藏 Cesium ion logo */
.cesium-container :deep(.cesium-widget-credits) {
  display: none !important;
}

/* ── 右键上下文菜单 ── */
.context-menu {
  position: absolute;
  z-index: 1000;
  min-width: 120px;
  background: var(--bg-panel, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a5c);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  font-size: 13px;
  user-select: none;
}

.context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  color: var(--text-primary, #cdd6f4);
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--accent-primary, #3b82f6);
  color: #fff;
}

.context-menu-danger:hover {
  background: #ef4444;
  color: #fff;
}

.context-menu-has-sub {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}

.submenu-arrow {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
}

.submenu-dropdown {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 100px;
  background: var(--bg-panel, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a5c);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
}

.context-menu-has-sub:hover .submenu-dropdown {
  display: block;
}

.submenu-item {
  padding: 8px 16px;
  cursor: pointer;
  color: var(--text-primary, #cdd6f4);
  transition: background 0.15s;
  white-space: nowrap;
}

.submenu-item:hover {
  background: var(--accent-primary, #3b82f6);
  color: #fff;
}

.submenu-item.active {
  color: var(--accent-primary, #3b82f6);
  font-weight: 600;
}

.submenu-item.active::before {
  content: '✓ ';
}
</style>
