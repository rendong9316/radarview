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
import type { Track, DataSource } from '../types/track'
import { useLineColor } from '../composables/useLineColor'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useLabelVisibility } from '../composables/useLabelVisibility'
import { useFlags } from '../composables/useFlags'
import { useFlagScale } from '../composables/useFlagScale'
import { useTrackHighlight } from '../composables/useTrackHighlight'
import { useTrackPointDots } from '../composables/useTrackPointDots'
import { useTheme } from '../composables/useTheme'
import { useBoundaryLayers } from '../composables/useBoundaryLayers'
import { useCityLayer } from '../composables/useCityLayer'
import { trackKey } from '../composables/useTracks'
import { whenSettingsLoaded } from '../composables/useSettingsPersistence'
import { Pencil, Trash2, Dot, Circle, FileText, ClipboardList, Flag as FlagIcon } from '@lucide/vue'
import type { Flag } from '../composables/useFlags'

// ── Cesium 渲染模块 ──
import { type CesiumContext, LABEL_FONT_BASE, LABEL_FONT_LARGE } from '../cesium/types'
import * as ViewerCore from '../cesium/viewerCore'
import * as BoundaryR from '../cesium/boundaryRenderer'
import * as CityR from '../cesium/cityRenderer'
import * as FlagR from '../cesium/flagRenderer'
import * as DotR from '../cesium/pointDotRenderer'
import * as TrackR from '../cesium/trackRenderer'
import * as Interaction from '../cesium/interactionHandler'

// ═══════════════════════════════════════════
// Props & Emits
// ═══════════════════════════════════════════

const props = defineProps<{
  tracks: Track[]
  replayTime: number | null
  selectedId: string | null
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
}>()

const emit = defineEmits<{
  'track-pick': [trackId: string | null]
  'show-track-detail': [payload: { icao: string; source: string }]
  'delete-track': [payload: { icao: string; source: string }]
  'view-track-points': [track: Track]
  'view-status': [payload: { cameraHeightKm: number; longitude: number; latitude: number; fps: number }]
}>()

// ═══════════════════════════════════════════
// 状态 composables
// ═══════════════════════════════════════════

const containerRef = ref<HTMLDivElement>()
const { getEffectiveHex, lineColors } = useLineColor()
const { visibility } = useLayerVisibility()
const { showLabels } = useLabelVisibility()
const { flags, addFlag, removeFlag, renameFlag, setFlagStyle, selectedPair } = useFlags()
const { flagScale } = useFlagScale()
const { addHighlight } = useTrackHighlight()
const { trackPointDotScale, showAllPointDots, clearAllCounter, pointDotColors } = useTrackPointDots()
const { activeTheme, getThemeVar } = useTheme()
const { boundaryVisible, boundaryWidths, boundaryColors } = useBoundaryLayers()
const { cityLayer } = useCityLayer()

// ═══════════════════════════════════════════
// 本地响应式状态
// ═══════════════════════════════════════════

/** 用户手动显示点迹的航迹 ID 集合 */
const manualPointDotsTrackIds = ref(new Set<string>())
/** 全局模式下用户显式隐藏的航迹 ID 集合 */
const globalHiddenTrackKeys = ref(new Set<string>())
/** 点迹像素大小 */
let pointDotPixelSize = 7.0
/** 先前选中的航迹 ID */
let previousSelectedId: string | null = null

// 右键上下文菜单
const contextMenu = ref<{
  visible: boolean
  x: number
  y: number
  type: 'flag' | 'track'
  flagId: string
  flagLabel: string
  trackId: string
}>({ visible: false, x: 0, y: 0, type: 'flag', flagId: '', flagLabel: '', trackId: '' })

// mapReady promise
let resolveMapReady!: () => void
const mapReadyPromise = new Promise<void>(r => { resolveMapReady = r })

// ═══════════════════════════════════════════
// CesiumContext 引用
// ═══════════════════════════════════════════

let cesiumCtx: CesiumContext | null = null
let handlersCleanup: (() => void) | null = null
let fpsCleanup: (() => void) | null = null
let zoomCleanup: (() => void) | null = null
let cityDebounce: ReturnType<typeof setTimeout> | null = null
let boundaryWidthDebounce: ReturnType<typeof setTimeout> | null = null
let boundaryColorDebounce: ReturnType<typeof setTimeout> | null = null
let removeCityCameraChanged: (() => void) | null = null

// ═══════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════

function getLineColor(source: DataSource): Cesium.Color {
  return Cesium.Color.fromCssColorString(getEffectiveHex(source))
}

function getPointDotColor(source: DataSource): string {
  const custom = pointDotColors[source]
  if (custom) return custom
  return contrastColor(getEffectiveHex(source))
}

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

// ═══════════════════════════════════════════
// TrackState 构建
// ═══════════════════════════════════════════

function buildTrackState(): TrackR.TrackState {
  return {
    selectedId: props.selectedId,
    replayTime: props.replayTime,
    lineWidths: props.lineWidths,
    dotScale: props.dotScale,
    getLineColor,
    visibility: { ...visibility.value },
    showLabels: showLabels.value,
  }
}

// ═══════════════════════════════════════════
// InteractionCallbacks 构建
// ═══════════════════════════════════════════

function buildInteractionCallbacks(): Interaction.InteractionCallbacks {
  return {
    onTrackPick: (id) => emit('track-pick', id),
    onShowTrackDetail: (icao, source) => emit('show-track-detail', { icao, source }),
    onDeleteTrack: (icao, source) => emit('delete-track', { icao, source }),
    onViewTrackPoints: (track) => emit('view-track-points', track),
    onViewStatus: (status) => emit('view-status', status ?? { cameraHeightKm: 0, longitude: 0, latitude: 0, fps: 0 }),
    addFlag, removeFlag,
    showCityHover: (city) => CityR.showCityHover(city, cityLayer as any),
    hideCityHover: () => CityR.hideCityHover(),
    showPointDotHover: (trackId, index) => DotR.showPointDotHover(trackId, index, props.tracks, pointDotPixelSize),
    hidePointDotHover: () => DotR.hidePointDotHover(),
    getHoveredPointDotId: () => DotR.getHoveredId(),
    setHoveredPointDotId: (id) => DotR.setHoveredPointDotId(id),
    checkPointDotHit: (trackId, pos) => DotR.checkPointDotHit(trackId, pos, pointDotPixelSize),
    applyHoverHighlight: (id) => TrackR.applyHoverHighlight(id, { dotScale: props.dotScale, lineWidths: props.lineWidths }),
    removeHoverHighlight: () => TrackR.removeHoverHighlight(previousSelectedId, getLineColor, { dotScale: props.dotScale }),
    getHoveredTrackId: () => TrackR.getHoveredTrackId(),
    setHoveredTrackId: (id) => TrackR.setHoveredTrackId(id),
    hasEntity: (key) => TrackR.getEntityMap().has(key),
    extractTrackKeyFromPolylineId: (id) => TrackR.extractTrackKeyFromPolylineId(id),
    showManualPointDots: (id) => DotR.showManualPointDots(id, props.tracks, getPointDotColor, pointDotPixelSize, manualPointDotsTrackIds, globalHiddenTrackKeys),
    hidePointDotsForTrack: (id) => DotR.hidePointDotsForTrack(id, manualPointDotsTrackIds, globalHiddenTrackKeys, showAllPointDots),
    getFlagById: (id) => flags.value.find(f => f.id === id),
    findTrackByKey: (key) => props.tracks.find(t => trackKey(t.id, t.source) === key),
    addHighlight,
    openContextMenu: (menu) => { contextMenu.value = menu },
    closeContextMenu: () => { contextMenu.value.visible = false },
    getViewStatus: (pos) => CityR.getViewStatus(pos),
    pickedCity: (picked) => CityR.pickedCity(picked),
  }
}

// ═══════════════════════════════════════════
// 右键菜单动作
// ═══════════════════════════════════════════

function isTrackShowingDots(trackKey: string): boolean {
  return DotR.isTrackShowingDots(trackKey)
}

function handleContextRename() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  const newLabel = prompt('请输入新名称：', flag.label)
  if (newLabel && newLabel.trim()) {
    renameFlag(flag.id, newLabel.trim())
  }
  contextMenu.value.visible = false
}

function handleContextDelete() {
  const flag = flags.value.find((f) => f.id === contextMenu.value.flagId)
  if (!flag) return
  if (confirm(`确定要删除旗标「${flag.label}」吗？`)) {
    removeFlag(flag.id)
  }
  contextMenu.value.visible = false
}

function handleChangeFlagStyle(style: string) {
  const flagId = contextMenu.value.flagId
  if (!flagId) return
  setFlagStyle(flagId, style)
  contextMenu.value.visible = false
}

function getFlagStyle(flagId: string): string {
  const flag = flags.value.find((f) => f.id === flagId)
  return flag?.style || 'flag-pin'
}

function handleContextShowPointDots() {
  DotR.showManualPointDots(contextMenu.value.trackId, props.tracks, getPointDotColor, pointDotPixelSize, manualPointDotsTrackIds, globalHiddenTrackKeys)
  contextMenu.value.visible = false
}

function handleContextHidePointDots() {
  DotR.hidePointDotsForTrack(contextMenu.value.trackId, manualPointDotsTrackIds, globalHiddenTrackKeys, showAllPointDots)
  contextMenu.value.visible = false
}

function handleContextShowDetail() {
  const trackId = contextMenu.value.trackId
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  addHighlight(icao)
  emit('show-track-detail', { icao, source })
  contextMenu.value.visible = false
}

function handleContextViewPoints() {
  const trackId = contextMenu.value.trackId
  const track = props.tracks.find(t => trackKey(t.id, t.source) === trackId)
  if (track) {
    emit('view-track-points', track)
  }
  contextMenu.value.visible = false
}

function handleContextDeleteTrack() {
  const trackId = contextMenu.value.trackId
  const sepIdx = trackId.lastIndexOf('::')
  const icao = sepIdx > 0 ? trackId.substring(0, sepIdx) : trackId
  const source = sepIdx > 0 ? trackId.substring(sepIdx + 2) : ''
  emit('delete-track', { icao, source })
  contextMenu.value.visible = false
}

// ═══════════════════════════════════════════
// exposed 方法
// ═══════════════════════════════════════════

function resetView() {
  if (cesiumCtx) ViewerCore.resetView(cesiumCtx)
}

function flyToTrack(track: Track) {
  if (cesiumCtx) ViewerCore.flyToTrack(cesiumCtx, track)
}

function flyToFlag(flag: Flag) {
  if (cesiumCtx) ViewerCore.flyToFlag(cesiumCtx, flag)
}

function switchTileLayer(maxZoom?: number) {
  if (cesiumCtx) ViewerCore.switchTileLayer(cesiumCtx, maxZoom)
}

defineExpose({
  getViewer: () => cesiumCtx?.viewer ?? null,
  flyToTrack,
  flyToFlag,
  resetView,
  switchTileLayer,
  whenMapReady: () => mapReadyPromise,
})

// ═══════════════════════════════════════════
// onMounted — 初始化一切
// ═══════════════════════════════════════════

onMounted(async () => {
  if (!containerRef.value) return

  const port: number = await invoke('get_tile_server_port')

  // 1. 创建 Viewer + 所有 Collection
  cesiumCtx = ViewerCore.createViewer(containerRef.value, port)

  // 2. 初始化所有渲染模块
  DotR.init(cesiumCtx)
  FlagR.init(cesiumCtx)
  BoundaryR.init(cesiumCtx)
  CityR.init(cesiumCtx)
  TrackR.init(cesiumCtx)
  Interaction.init(cesiumCtx)

  // 3. FPS 追踪
  fpsCleanup = ViewerCore.setupFpsTracking(cesiumCtx)

  // 4. 相机变更监听
  cesiumCtx.viewer.camera.percentageChanged = 0.03
  removeCityCameraChanged = cesiumCtx.viewer.camera.changed.addEventListener(() => {
    const status = CityR.getViewStatus(Interaction.getLastMousePosition())
    if (status) emit('view-status', status)
  })

  // 5. 等待设置加载
  await whenSettingsLoaded()

  // 6. 边界层
  BoundaryR.applyBoundaryVisibility(boundaryVisible, boundaryColors, boundaryWidths)

  // 7. 城市层
  if (cityLayer.visible) {
    await CityR.loadCityLayer()
    CityR.renderCityLayer(cityLayer as any)
  }

  // 8. 相机恢复
  if (!ViewerCore.restoreCameraState(cesiumCtx)) {
    cesiumCtx.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(110, 25, 12000000),
    })
  }

  // 9. 主题背景
  ViewerCore.updateCesiumBackground(cesiumCtx, getThemeVar)

  // 10. 无极缩放
  zoomCleanup = ViewerCore.setupSteplessZoom(cesiumCtx)

  // 11. 相机 moveEnd — 增量渲染极轻量，每次 moveEnd 直接触发
  cesiumCtx.viewer.camera.moveEnd.addEventListener(() => {
    ViewerCore.scheduleCameraSave(cesiumCtx!)
    if (cityLayer.visible) {
      CityR.scheduleCityLayerRender(0, cityLayer as any)
    }
  })

  // 12. 初始同步航迹与旗标
  TrackR.syncEntities(props.tracks, buildTrackState())
  FlagR.syncFlagEntities(flags.value, flagScale.value)

  // 13. 注册事件处理器
  handlersCleanup = Interaction.setupHandlers(buildInteractionCallbacks())

  // 14. 初始状态
  emit('view-status', { cameraHeightKm: 0, longitude: 0, latitude: 0, fps: 0 })

  // 15. 标记就绪
  resolveMapReady()
})

// ═══════════════════════════════════════════
// onUnmounted — 完整清理
// ═══════════════════════════════════════════

onUnmounted(() => {
  // 保存相机状态
  if (cesiumCtx) ViewerCore.flushCameraSave(cesiumCtx)

  // 清理渲染数据
  DotR.clearAllPointDots(manualPointDotsTrackIds, globalHiddenTrackKeys)
  TrackR.clearAllEntities()
  FlagR.clearAllFlagEntities()
  BoundaryR.clearAllBoundaryLayers()
  CityR.clearCityLayer()
  CityR.removeCityHover()
  DotR.removePointDotHover()

  // 移除大圆弧
  if (arcEntity && cesiumCtx?.viewer) {
    cesiumCtx.viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }

  // 清理计时器
  if (cityDebounce) { clearTimeout(cityDebounce); cityDebounce = null }
  CityR.cancelCityLayerDebounce()
  if (boundaryWidthDebounce) { clearTimeout(boundaryWidthDebounce); boundaryWidthDebounce = null }
  if (boundaryColorDebounce) { clearTimeout(boundaryColorDebounce); boundaryColorDebounce = null }

  // 移除监听器
  if (removeCityCameraChanged) { removeCityCameraChanged(); removeCityCameraChanged = null }
  if (fpsCleanup) { fpsCleanup(); fpsCleanup = null }
  if (zoomCleanup) { zoomCleanup(); zoomCleanup = null }

  // 清理事件处理器
  if (handlersCleanup) { handlersCleanup(); handlersCleanup = null }

  // 重置渲染模块
  DotR.reset()
  FlagR.reset()
  BoundaryR.reset()
  CityR.reset()
  TrackR.reset()
  Interaction.reset()

  // 销毁 Viewer（含所有 Collection）
  if (cesiumCtx) {
    ViewerCore.destroyViewer(cesiumCtx)
    cesiumCtx = null
  }
})

// ═══════════════════════════════════════════
// Watchers
// ═══════════════════════════════════════════

// ── 航迹同步 ──
watch(
  () => props.tracks,
  (newTracks) => {
    if (cesiumCtx) TrackR.syncEntities(newTracks, buildTrackState())
  },
  { deep: false },
)

// ── 回放时间 ──
watch(
  () => props.replayTime,
  (time) => {
    if (!cesiumCtx) return
    if (time !== null) {
      if (!TrackR.getWasReplaying()) {
        TrackR.onReplayStart(props.tracks, DotR.getEntityMap_mutable(), DotR.getLastLo() as Map<string, number>)
      }
      TrackR.updateReplayPositions(
        time, props.tracks,
        { selectedId: props.selectedId, lineWidths: props.lineWidths, visibility: { ...visibility.value }, getLineColor },
        DotR.getEntityMap_mutable(),
        DotR.getLastLo() as Map<string, number>,
      )
      TrackR.setWasReplaying(true)
    } else if (TrackR.getWasReplaying()) {
      TrackR.setWasReplaying(false)

      // 1. 移除 trailLine、unhide entity、复位 label/dot
      TrackR.onReplayStop(
        props.tracks,
        { visibility: { ...visibility.value }, selectedId: props.selectedId },
        DotR.getEntityMap_mutable(),
        DotR.getLastLo() as Map<string, number>,
      )

      // 2. 重建 PolylineCollection — 释放回放期间膨胀的共享 VBO
      ViewerCore.rebuildTrackLines(cesiumCtx)
      TrackR.clearTrailLineRefs()

      // 3. 复现"筛选→切回全量"的完整重建 —— 两次 syncEntities
      //    先同步空列表（清空所有 entity/label/pointPrimitive）
      //    再同步全量（重建所有 entity/label/pointPrimitive，全新 GPU 资源）
      TrackR.forceRebuildAll(props.tracks, buildTrackState())

      // 4. 同步点迹、收缩影图集
      DotR.syncGlobalPointDots(props.tracks, getPointDotColor, pointDotPixelSize, showAllPointDots.value, manualPointDotsTrackIds.value, globalHiddenTrackKeys.value)
      TrackR.rebuildLabelAndPointCollections()
      previousSelectedId = props.selectedId
      cesiumCtx.viewer.scene.requestRender()
    }
  },
)

// ── 可见性 ──
watch(visibility, () => {
  TrackR.reapplyVisibility({ ...visibility.value }, props.replayTime)
  cesiumCtx?.viewer?.scene.requestRender()
}, { deep: true })

// ── 边界可见性 ──
watch(boundaryVisible, () => {
  BoundaryR.applyBoundaryVisibility(boundaryVisible, boundaryColors, boundaryWidths)
  cesiumCtx?.viewer?.scene.requestRender()
})

// ── 边界线宽（防抖） ──
watch(boundaryWidths, () => {
  if (boundaryWidthDebounce) clearTimeout(boundaryWidthDebounce)
  boundaryWidthDebounce = setTimeout(() => {
    boundaryWidthDebounce = null
    BoundaryR.applyAllBoundaryWidths(boundaryColors, boundaryWidths)
    cesiumCtx?.viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

// ── 边界颜色（防抖） ──
watch(boundaryColors, () => {
  if (boundaryColorDebounce) clearTimeout(boundaryColorDebounce)
  boundaryColorDebounce = setTimeout(() => {
    boundaryColorDebounce = null
    BoundaryR.applyAllBoundaryColors(boundaryColors, boundaryWidths)
    cesiumCtx?.viewer?.scene.requestRender()
  }, 60)
}, { deep: true })

// ── 城市层可见性 ──
watch(() => cityLayer.visible, (vis) => {
  if (vis) {
    if (CityR.getCityFeatures().length === 0) CityR.loadCityLayer()
    else { CityR.renderCityLayer(cityLayer as any); cesiumCtx?.viewer?.scene.requestRender() }
  } else {
    CityR.clearCityLayer()
  }
})

// ── 城市层设置变更 ──
watch(cityLayer, () => {
  if (!cityLayer.visible) return
  CityR.scheduleCityLayerRender(80, cityLayer as any)
}, { deep: true })

// ── 线宽 ──
watch(
  () => props.lineWidths,
  () => {
    const entityMap = TrackR.getEntityMap_mutable()
    for (const [tKey, entry] of entityMap) {
      if (tKey !== previousSelectedId && !TrackR.getHoveredTrackId()) {
        if (entry.entity?.polyline) {
          (entry.entity.polyline as any).width = TrackR.baseWidth(entry.source as DataSource, props.lineWidths)
        }
      }
    }
    cesiumCtx?.viewer?.scene.requestRender()
  },
  { deep: true },
)

// ── 端点圆点缩放 ──
watch(
  () => props.dotScale,
  () => {
    const entityMap = TrackR.getEntityMap_mutable()
    for (const [tKey, entry] of entityMap) {
      if (!entry.pointPrimitive) continue
      const isSelected = tKey === previousSelectedId
      const isHovered = TrackR.getHoveredTrackId() === tKey
      const isRaw = entry.source === 'radar_raw'
      const base = isHovered ? 1.3 : isSelected ? 1.2 : isRaw ? 0.4 : 0.7
      entry.pointPrimitive.pixelSize = TrackR.pointPrimSize(base, entry.source, props.dotScale)
    }
    cesiumCtx?.viewer?.scene.requestRender()
  },
  { deep: true },
)

// ── 线颜色 ──
watch(lineColors, () => {
  const entityMap = TrackR.getEntityMap_mutable()
  for (const [tKey, entry] of entityMap) {
    const isSelected = tKey === previousSelectedId
    const isHovered = TrackR.getHoveredTrackId() === tKey
    if (isSelected || isHovered) continue
    const color = getLineColor(entry.source as DataSource)
    const isRaw = entry.source === 'radar_raw'
    if (entry.entity?.polyline) {
      entry.entity.polyline.material = color.withAlpha(isRaw ? 0.75 : 0.88) as any
    }
    if (entry.pointPrimitive) {
      entry.pointPrimitive.color = color
    }
  }
  cesiumCtx?.viewer?.scene.requestRender()
}, { deep: true })

// ── 选中高亮 ──
watch(() => props.selectedId, (newId) => {
  previousSelectedId = newId ?? null
})

// ── 旗标同步 ──
watch(flags, () => {
  FlagR.syncFlagEntities(flags.value, flagScale.value)
}, { deep: false })

watch(flagScale, () => {
  FlagR.syncFlagEntities(flags.value, flagScale.value)
})

// ── 大圆弧（旗标配对） ──
let arcEntity: Cesium.Entity | undefined
watch(selectedPair, (pair) => {
  if (arcEntity && cesiumCtx?.viewer) {
    cesiumCtx.viewer.entities.remove(arcEntity)
    arcEntity = undefined
  }
  if (pair && cesiumCtx?.viewer) {
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
    arcEntity = cesiumCtx.viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.YELLOW.withAlpha(0.8),
        clampToGround: false,
      },
    })
  }
})

// ── 标签显示 ──
watch(showLabels, (val) => {
  const entityMap = TrackR.getEntityMap_mutable()
  for (const [, entities] of entityMap) {
    if (entities.label) {
      entities.label.text = val ? entities.labelText : ''
      entities.label.font = val ? LABEL_FONT_LARGE : LABEL_FONT_BASE
    }
  }
  cesiumCtx?.viewer?.scene.requestRender()
})

// ── 点迹 watchers ──
watch(trackPointDotScale, (newScale) => {
  pointDotPixelSize = Math.max(2.0, 7.0 * newScale)
  DotR.refreshPointDotSizes(pointDotPixelSize)
})

watch([pointDotColors, lineColors], () => {
  DotR.refreshPointDotColors(props.tracks, getPointDotColor)
}, { deep: true })

watch(showAllPointDots, (val) => {
  if (!val) {
    globalHiddenTrackKeys.value = new Set()
  }
  DotR.syncGlobalPointDots(props.tracks, getPointDotColor, pointDotPixelSize, val, manualPointDotsTrackIds.value, globalHiddenTrackKeys.value)
})

watch(clearAllCounter, () => {
  DotR.clearAllPointDots(manualPointDotsTrackIds, globalHiddenTrackKeys)
})

watch(
  () => props.tracks,
  () => {
    DotR.syncGlobalPointDots(props.tracks, getPointDotColor, pointDotPixelSize, showAllPointDots.value, manualPointDotsTrackIds.value, globalHiddenTrackKeys.value)
  },
  { deep: false },
)

// ── 主题 ──
watch(activeTheme, () => {
  if (cesiumCtx) ViewerCore.updateCesiumBackground(cesiumCtx, getThemeVar)
})
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
