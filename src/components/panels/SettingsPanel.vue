<template>
  <div class="settings-panel">
    <!-- ═══ 线条颜色 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('lineColor')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('lineColor') }" />
        <Palette :size="13" class="group-icon" />
        <span>线条颜色</span><HelpTip text="设置各数据源航迹线的颜色。点击色块选择颜色，点击右侧重置按钮恢复为默认颜色。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('lineColor')">
        <template v-for="src in dataSources" :key="'lc-'+src">
          <div class="setting-row" :class="{ 'has-sub': getFilesForSrc(src).length > 1 }">
            <span v-if="getFilesForSrc(src).length > 1" class="expand-arrow" @click="toggleSrcExpanded(src)">
              <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(src) }" />
            </span>
            <span v-else class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
            <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
            <div class="color-control">
              <input type="color" class="color-input" :value="effectiveColor(src)"
                @input="onColorChange(src, ($event.target as HTMLInputElement).value)" />
              <span class="color-hex">{{ effectiveColor(src) }}</span>
            </div>
            <button class="reset-btn" :class="{ show: hasCustomColor(src) }"
              :title="`重置 ${sourceLabel(src)} 为默认颜色`" @click="onResetColor(src)">
              <RotateCcw :size="12" />
            </button>
          </div>
          <div v-if="getFilesForSrc(src).length > 1 && expandedSources.has(src)" class="file-rows">
            <div v-for="f in getFilesForSrc(src)" :key="'lc-'+src+'-'+f.fileName" class="setting-row file-row">
              <span class="row-label file-label" :style="{ color: `var(--source-${src})` }">{{ f.displayLabel }}</span>
              <div class="color-control">
                <input type="color" class="color-input" :value="fileEffectiveColor(src, f.fileName)"
                  @input="onFileColorChange(src, f.fileName, ($event.target as HTMLInputElement).value)" />
                <span class="color-hex">{{ fileEffectiveColor(src, f.fileName) }}</span>
              </div>
              <button class="reset-btn" :class="{ show: hasFileColor(src, f.fileName) }"
                :title="`重置 ${f.fileName} 跟随数据源颜色`" @click="onFileResetColor(src, f.fileName)">
                <RotateCcw :size="12" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ 线宽调节 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('lineWidth')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('lineWidth') }" />
        <GripHorizontal :size="13" class="group-icon" />
        <span>线宽调节</span><HelpTip text="设置各数据源航迹线的像素宽度，范围 0.5-8 px。拖动滑块即时生效。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('lineWidth')">
        <template v-for="src in dataSources" :key="'lw-'+src">
          <div class="setting-row" :class="{ 'has-sub': getFilesForSrc(src).length > 1 }">
            <span v-if="getFilesForSrc(src).length > 1" class="expand-arrow" @click="toggleSrcExpanded(src)">
              <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(src) }" />
            </span>
            <span v-else class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
            <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
            <input type="range" class="row-slider" min="0.5" max="8" step="0.5"
              :value="lineWidths[src]"
              @input="$emit('setLineWidth', src, Number(($event.target as HTMLInputElement).value))" title="调整航迹线宽" />
            <span class="row-value">{{ lineWidths[src] }}</span>
          </div>
          <div v-if="getFilesForSrc(src).length > 1 && expandedSources.has(src)" class="file-rows">
            <div v-for="f in getFilesForSrc(src)" :key="'lw-'+src+'-'+f.fileName" class="setting-row file-row">
              <span class="row-label file-label" :style="{ color: `var(--source-${src})` }">{{ f.displayLabel }}</span>
              <input type="range" class="row-slider" min="0.5" max="8" step="0.5"
                :value="fileEffectiveWidth(src, f.fileName)"
                @input="onFileWidthChange(src, f.fileName, Number(($event.target as HTMLInputElement).value))" title="调整文件级线宽" />
              <span class="row-value">{{ fileEffectiveWidth(src, f.fileName) }}</span>
              <button class="reset-btn" :class="{ show: hasFileWidth(src, f.fileName) }"
                :title="`重置 ${f.fileName} 跟随数据源线宽`" @click="onFileResetWidth(src, f.fileName)" style="margin-left:4px">
                <RotateCcw :size="12" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ 圆球直径 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('dotScale')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('dotScale') }" />
        <CircleDot :size="13" class="group-icon" />
        <span>圆球直径</span><HelpTip text="设置各数据源终点圆球的缩放比例，范围 0.2-3.0 倍。圆心位置表示航迹当前时刻的位置。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('dotScale')">
        <template v-for="src in dataSources" :key="'ds-'+src">
          <div class="setting-row" :class="{ 'has-sub': getFilesForSrc(src).length > 1 }">
            <span v-if="getFilesForSrc(src).length > 1" class="expand-arrow" @click="toggleSrcExpanded(src)">
              <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(src) }" />
            </span>
            <span v-else class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
            <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
            <input type="range" class="row-slider" min="0.2" max="3.0" step="0.1"
              :value="dotScale[src]"
              @input="$emit('setDotScale', src, Number(($event.target as HTMLInputElement).value))" title="调整终点圆球大小" />
            <span class="row-value">{{ dotScale[src].toFixed(1) }}</span>
          </div>
          <div v-if="getFilesForSrc(src).length > 1 && expandedSources.has(src)" class="file-rows">
            <div v-for="f in getFilesForSrc(src)" :key="'ds-'+src+'-'+f.fileName" class="setting-row file-row">
              <span class="row-label file-label" :style="{ color: `var(--source-${src})` }">{{ f.displayLabel }}</span>
              <input type="range" class="row-slider" min="0.2" max="3.0" step="0.1"
                :value="fileEffectiveScale(src, f.fileName, dotScale[src])"
                @input="onFileScaleChange(src, f.fileName, Number(($event.target as HTMLInputElement).value))" title="调整文件级圆球大小" />
              <span class="row-value">{{ fileEffectiveScale(src, f.fileName, dotScale[src]).toFixed(1) }}</span>
              <button class="reset-btn" :class="{ show: hasFileScale(src, f.fileName) }"
                :title="`重置 ${f.fileName} 跟随数据源大小`" @click="onFileResetScale(src, f.fileName)" style="margin-left:4px">
                <RotateCcw :size="12" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ 航迹高度偏移 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('sourceElevation')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('sourceElevation') }" />
        <ArrowUp :size="13" class="group-icon" />
        <span>航迹高度偏移</span><HelpTip text="按数据源批量设置航迹渲染高度偏移量。输入 0 表示使用默认高度（10km）。新导入的航迹会自动应用对应数据源的偏移量。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('sourceElevation')">
        <template v-for="src in dataSources" :key="'sel-'+src">
          <div class="setting-row" :class="{ 'has-sub': getFilesForSrc(src).length > 1 }">
            <span v-if="getFilesForSrc(src).length > 1" class="expand-arrow" @click="toggleSrcExpanded(src)">
              <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(src) }" />
            </span>
            <span v-else class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
            <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
            <div class="elevation-input-group">
              <input type="number" class="elevation-input" :value="sourceElevations[src] ?? 0"
                min="0" step="0.5" @change="onSourceElevationChange(src, ($event.target as HTMLInputElement).value)" />
              <span class="elevation-unit">km</span>
            </div>
            <button class="reset-btn" :class="{ show: (sourceElevations[src] ?? 0) > 0 }"
              :title="`重置 ${sourceLabel(src)} 为默认高度`" @click="emit('resetSourceElevation', src)">
              <RotateCcw :size="12" />
            </button>
          </div>
          <div v-if="getFilesForSrc(src).length > 1 && expandedSources.has(src)" class="file-rows">
            <div v-for="f in getFilesForSrc(src)" :key="'sel-'+src+'-'+f.fileName" class="setting-row file-row">
              <span class="row-label file-label" :style="{ color: `var(--source-${src})` }">{{ f.displayLabel }}</span>
              <div class="elevation-input-group">
                <input type="number" class="elevation-input" :value="getFileElevationKm(src, f.fileName)"
                  min="0" step="0.5" placeholder="0"
                  @change="onFileElevationChange(src, f.fileName, Number(($event.target as HTMLInputElement).value))" />
                <span class="elevation-unit">km</span>
              </div>
              <button class="reset-btn" :class="{ show: getFileElevationKm(src, f.fileName) > 0 }"
                :title="`重置 ${f.displayLabel} 为默认高度`" @click="onResetFileElevation(src, f.fileName)" style="margin-left:4px">
                <RotateCcw :size="12" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ═══ 时间偏移 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('time-offset')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('time-offset') }" />
        <Clock :size="13" class="group-icon" />
        <span>时间偏移</span><HelpTip text="按文件设置时间偏移量。修改起始或结束时间后，系统自动计算偏移并应用到该文件的所有航迹点。点击重置按钮恢复原始时间。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('time-offset')">
        <template v-for="src in dataSources" :key="'to-'+src">
          <!-- Single file: show directly, no expand needed -->
          <template v-if="getFilesForSrc(src).length === 1">
            <div v-for="f in getFilesForSrc(src)" :key="'to-'+src+'-'+f.fileName" class="setting-row time-offset-row">
              <span class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
              <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
              <div class="time-range-inputs">
                <input type="datetime-local" class="time-input"
                  :value="getFileStartDisplay(src, f.fileName)"
                  @change="onFileTimeStartChange(src, f.fileName, $event)" />
                <span class="time-sep">至</span>
                <input type="datetime-local" class="time-input"
                  :value="getFileEndDisplay(src, f.fileName)"
                  @change="onFileTimeEndChange(src, f.fileName, $event)" />
              </div>
              <button class="reset-btn" :class="{ show: hasFileTimeOffset(src, f.fileName) }"
                :title="`重置 ${f.displayLabel} 时间偏移`" @click="onResetFileTimeOffset(src, f.fileName)">
                <RotateCcw :size="12" />
              </button>
            </div>
          </template>
          <!-- Multiple files: source label row + expandable file rows -->
          <template v-else-if="getFilesForSrc(src).length > 1">
            <div class="setting-row has-sub">
              <span class="expand-arrow" @click="toggleSrcExpanded(src)">
                <ChevronDown :size="10" class="source-chevron" :class="{ collapsed: !expandedSources.has(src) }" />
              </span>
              <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
            </div>
            <div v-if="expandedSources.has(src)" class="file-rows">
              <div v-for="f in getFilesForSrc(src)" :key="'to-'+src+'-'+f.fileName" class="setting-row time-offset-row">
                <span class="expand-arrow" style="visibility:hidden"><ChevronDown :size="10" /></span>
                <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ f.displayLabel }}</span>
                <div class="time-range-inputs">
                  <input type="datetime-local" class="time-input"
                    :value="getFileStartDisplay(src, f.fileName)"
                    @change="onFileTimeStartChange(src, f.fileName, $event)" />
                  <span class="time-sep">至</span>
                  <input type="datetime-local" class="time-input"
                    :value="getFileEndDisplay(src, f.fileName)"
                    @change="onFileTimeEndChange(src, f.fileName, $event)" />
                </div>
                <button class="reset-btn" :class="{ show: hasFileTimeOffset(src, f.fileName) }"
                  :title="`重置 ${f.displayLabel} 时间偏移`" @click="onResetFileTimeOffset(src, f.fileName)">
                  <RotateCcw :size="12" />
                </button>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- ═══ 旗标大小 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('flagScale')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('flagScale') }" />
        <Flag :size="13" class="group-icon" />
        <span>旗标大小</span><HelpTip text="设置旗标图标和文字标签的整体缩放比例，范围 0.5-3.0 倍。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('flagScale')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">图标&amp;文字</span>
          <input type="range" class="row-slider" min="0.5" max="3.0" step="0.1"
            :value="flagScaleVal"
            @input="setFlagScale(Number(($event.target as HTMLInputElement).value))" title="调整旗标图标和文字大小" />
          <span class="row-value">{{ flagScaleVal.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <!-- ═══ 字号大小 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('fontSize')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('fontSize') }" />
        <Type :size="13" class="group-icon" />
        <span>字号大小</span><HelpTip text="设置应用界面文字的基础字号，范围 10-20 px。影响侧栏、面板等所有文本。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('fontSize')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--text-primary)">应用字号</span>
          <input type="range" class="row-slider" min="10" max="20" step="1"
            :value="fontSizeVal"
            @input="setFontSize(Number(($event.target as HTMLInputElement).value))" title="调整应用界面字号" />
          <span class="row-value">{{ fontSizeVal }}px</span>
        </div>
      </div>
    </div>

    <!-- ═══ 点迹显示 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('pointDots')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('pointDots') }" />
        <Dot :size="13" class="group-icon" />
        <span>点迹显示</span><HelpTip text="控制航迹点迹的全局显示。开启后每条航迹的每个采样位置绘制为小圆球，可直观查看数据密度。可调节圆球大小或一键清除。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('pointDots')">
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">全局显示</span>
          <label class="toggle-switch" title="切换全局航迹点迹显示">
            <input type="checkbox" :checked="showAllPointDots" @change="toggleAllPointDots()" />
            <span class="toggle-slider"></span>
          </label>
          <span class="switch-label">{{ showAllPointDots ? '开' : '关' }}</span>
        </div>
        <div class="setting-row">
          <span class="row-label" style="color: var(--accent-primary)">圆球大小</span>
          <input type="range" class="row-slider" min="0.2" max="5.0" step="0.1"
            :value="trackPointDotScaleVal"
            @input="setTrackPointDotScale(Number(($event.target as HTMLInputElement).value))" title="调整航迹点迹圆球大小" />
          <span class="row-value">{{ trackPointDotScaleVal.toFixed(1) }}</span>
        </div>
        <button class="action-btn" @click="requestClearAll()" title="清除所有点迹显示">
          <Eraser :size="13" />
          <span>清空所有点迹</span>
        </button>
      </div>
    </div>

    <!-- ═══ 点迹颜色 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('pointDotColors')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('pointDotColors') }" />
        <PaintBucket :size="13" class="group-icon" />
        <span>点迹颜色</span><HelpTip text="设置各数据源航迹点迹的颜色。默认使用与对应线条颜色互补的自动对比色，便于区分轨迹线和采样点。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('pointDotColors')">
        <div v-for="src in dataSources" :key="'pdc-'+src" class="setting-row">
          <span class="row-label" :style="{ color: `var(--source-${src})` }">{{ sourceLabel(src) }}</span>
          <div class="color-control">
            <input type="color" class="color-input"
              :value="effectivePointDotColor(src)"
              @input="onPointDotColorChange(src, ($event.target as HTMLInputElement).value)" />
            <span class="color-hex">{{ effectivePointDotColor(src) }}</span>
          </div>
          <button
            class="reset-btn"
            :class="{ show: hasCustomPointDotColor(src) }"
            :title="`重置 ${sourceLabel(src)} 点迹为自动对比色`"
            @click="onResetPointDotColor(src)"
          >
            <RotateCcw :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ 工具 ═══ -->
    <div class="settings-group">
      <div class="group-header" @click="toggleSection('tools')">
        <ChevronDown :size="12" class="group-chevron" :class="{ collapsed: isCollapsed('tools') }" />
        <Wrench :size="13" class="group-icon" />
        <span>工具</span><HelpTip text="常用功能的快捷入口。数据管理：打开批量数据管理面板。标签显示：切换航迹标签。重置视角：恢复地图默认视角。清除显示：清除地图上所有航迹。" />
      </div>
      <div class="group-body" v-show="!isCollapsed('tools')">
        <div class="tools-grid">
          <button class="action-btn" @click="$emit('toggleBatchPanel')">
            <Database :size="13" />
            <span>数据管理</span>
            <span v-if="batchCount" class="badge">{{ batchCount }}</span>
          </button>
          <button class="action-btn" @click="$emit('toggleLabels')">
            <Eye :size="13" />
            <span>标签显示</span>
          </button>
          <button class="action-btn" @click="$emit('resetView')">
            <Maximize2 :size="13" />
            <span>重置视角</span>
          </button>
          <button v-if="trackCount" class="action-btn danger" @click="$emit('clearAll')">
            <Trash2 :size="13" />
            <span>清除显示</span>
          </button>
          <button v-if="trackCount" class="action-btn full-width" @click="$emit('resetAllElevations')">
            <RotateCcw :size="13" />
            <span>恢复所有航迹高度</span>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import HelpTip from '../HelpTip.vue'
import { computed, ref, watch, onMounted } from 'vue'
import type { DataSource } from '../../types/track'
import { useFlagScale } from '../../composables/useFlagScale'
import { useFontSize } from '../../composables/useFontSize'
import { useLineColor } from '../../composables/useLineColor'
import { useTrackPointDots } from '../../composables/useTrackPointDots'
import { getRawSetting, scheduleSave } from '../../composables/useSettingsPersistence'
import {
  Palette, GripHorizontal, CircleDot, Flag,
  Type, Eraser, PaintBucket, Wrench, Database, Eye,
  Maximize2, Trash2, RotateCcw, Dot, ChevronDown, ArrowUp, Clock,
} from '@lucide/vue'

defineProps<{
  lineWidths: Record<DataSource, number>
  dotScale: Record<DataSource, number>
  batchCount: number
  trackCount: number
  sourceElevations: Record<string, number>
}>()

const emit = defineEmits<{
  setLineWidth: [src: DataSource, v: number]
  setDotScale: [src: DataSource, v: number]
  toggleBatchPanel: []
  toggleLabels: []
  resetView: []
  clearAll: []
  resetAllElevations: []
  setSourceElevation: [src: DataSource, km: number]
  resetSourceElevation: [src: DataSource]
}>()

const dataSources: DataSource[] = ['adsb', 'radar', 'radar_raw']

const { flagScale, setFlagScale } = useFlagScale()
const { fontSize, setFontSize } = useFontSize()
const { getEffectiveHex, setLineColor, hasCustomColor } = useLineColor()
const { trackPointDotScale, setTrackPointDotScale, showAllPointDots, toggleAllPointDots, requestClearAll, pointDotColors, setPointDotColor, hasCustomPointDotColor } = useTrackPointDots()

// File-level overrides
import { useFileLineColor } from '../../composables/useFileLineColor'
import { useFileLineWidth } from '../../composables/useFileLineWidth'
import { useFileDotScale } from '../../composables/useFileDotScale'
import { setFileElevation, resetFileElevation, getFileElevationKm } from '../../composables/useTrackElevation'
import { getFileEffectiveTimeRange, setFileTimeStart, setFileTimeEnd, resetFileTimeOffset, hasFileTimeOffset } from '../../composables/useTrackTimeOffset'
import { useTracks } from '../../composables/useTracks'
import { getFileLabel } from '../../composables/useFileLabels'

const { getEffectiveFileColor, setFileColor, resetFileColor, hasFileColor } = useFileLineColor()
const { getEffectiveFileWidth, setFileWidth, resetFileWidth, hasFileWidth } = useFileLineWidth()
const { getEffectiveFileScale, setFileScale, resetFileScale, hasFileScale } = useFileDotScale()
const { tracks } = useTracks()

interface FileInfo { fileName: string; displayLabel: string; count: number }

function getFilesForSrc(src: DataSource): FileInfo[] {
  const map = new Map<string, number>()
  for (const t of tracks.value) {
    if (t.source === src) {
      const fn = t.fileName || ''
      map.set(fn, (map.get(fn) || 0) + 1)
    }
  }
  return Array.from(map.entries()).map(([fileName, count]) => ({ fileName, displayLabel: getFileLabel(src, fileName), count }))
}

/** Which sources have file sub-items expanded */
const EXPANDED_SOURCES_KEY = 'settings.expanded_sources'
const expandedSources = ref<Set<string>>(new Set())

function loadExpandedSourcesState() {
  const raw = getRawSetting(EXPANDED_SOURCES_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        expandedSources.value = new Set(arr)
      }
    } catch { /* keep default (all collapsed) */ }
  }
}

function toggleSrcExpanded(src: string) {
  const n = new Set(expandedSources.value)
  if (n.has(src)) { n.delete(src) } else { n.add(src) }
  expandedSources.value = n
}

// Persist expanded sources on change
watch(expandedSources, (val) => {
  scheduleSave(EXPANDED_SOURCES_KEY, JSON.stringify([...val]))
}, { deep: true })

// File-level handlers
function fileEffectiveColor(src: DataSource, fn: string): string {
  return getEffectiveFileColor(src, fn)
}
function onFileColorChange(src: DataSource, fn: string, hex: string) {
  setFileColor(src, fn, hex)
}
function onFileResetColor(src: DataSource, fn: string) {
  resetFileColor(src, fn)
}

function fileEffectiveWidth(src: DataSource, fn: string): number {
  return getEffectiveFileWidth(src, fn)
}
function onFileWidthChange(src: DataSource, fn: string, v: number) {
  setFileWidth(src, fn, v)
}
function onFileResetWidth(src: DataSource, fn: string) {
  resetFileWidth(src, fn)
}

function fileEffectiveScale(src: DataSource, fn: string, srcScale: number): number {
  return getEffectiveFileScale(src, fn, srcScale)
}
function onFileScaleChange(src: DataSource, fn: string, v: number) {
  setFileScale(src, fn, v)
}
function onFileResetScale(src: DataSource, fn: string) {
  resetFileScale(src, fn)
}

function onFileElevationChange(src: DataSource, fn: string, km: number) {
  setFileElevation(src, fn, km, tracks.value)
}
function onResetFileElevation(src: DataSource, fn: string) {
  resetFileElevation(src, fn, tracks.value)
}

// ── Time offset helpers ──

function msToDatetimeLocal(ms: number): string {
  const d = new Date(ms + 8 * 3600 * 1000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function getFileStartDisplay(src: DataSource, fn: string): string {
  const range = getFileEffectiveTimeRange(src, fn, tracks.value)
  return range ? msToDatetimeLocal(range.min) : ''
}

function getFileEndDisplay(src: DataSource, fn: string): string {
  const range = getFileEffectiveTimeRange(src, fn, tracks.value)
  return range ? msToDatetimeLocal(range.max) : ''
}

function onFileTimeStartChange(src: DataSource, fn: string, event: Event) {
  const input = (event.target as HTMLInputElement).value
  if (!input) return
  const ms = new Date(input + '+08:00').getTime()
  if (isNaN(ms)) return
  setFileTimeStart(src, fn, ms, tracks.value)
}

function onFileTimeEndChange(src: DataSource, fn: string, event: Event) {
  const input = (event.target as HTMLInputElement).value
  if (!input) return
  const ms = new Date(input + '+08:00').getTime()
  if (isNaN(ms)) return
  setFileTimeEnd(src, fn, ms, tracks.value)
}

function onResetFileTimeOffset(src: DataSource, fn: string) {
  resetFileTimeOffset(src, fn, tracks.value)
}

const flagScaleVal = computed(() => flagScale.value)
const fontSizeVal = computed(() => fontSize.value)

const trackPointDotScaleVal = computed(() => trackPointDotScale.value)

// ── Collapsible sections (persisted) ──

const SETTINGS_COLLAPSE_KEY = 'settings.collapsed_sections'
const collapsedSections = ref<Set<string>>(new Set(['pointDots', 'pointDotColors', 'fontSize', 'flagScale', 'dotScale', 'sourceElevation', 'time-offset']))

function loadCollapsedState() {
  const raw = getRawSetting(SETTINGS_COLLAPSE_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        collapsedSections.value = new Set(arr)
      }
    } catch { /* keep default (all expanded) */ }
  }
}

function toggleSection(id: string) {
  if (collapsedSections.value.has(id)) {
    collapsedSections.value.delete(id)
  } else {
    collapsedSections.value.add(id)
  }
  collapsedSections.value = new Set(collapsedSections.value)
}

function isCollapsed(id: string): boolean {
  return collapsedSections.value.has(id)
}

// Persist on change
watch(collapsedSections, (val) => {
  scheduleSave(SETTINGS_COLLAPSE_KEY, JSON.stringify([...val]))
}, { deep: true })

onMounted(() => {
  loadCollapsedState()
  loadExpandedSourcesState()
})

function effectiveColor(src: DataSource): string {
  return getEffectiveHex(src)
}

function onColorChange(src: DataSource, hex: string) {
  setLineColor(src, hex)
}

function onResetColor(src: DataSource) {
  setLineColor(src, null)
}

function sourceLabel(src: DataSource): string {
  const map: Record<DataSource, string> = { adsb: 'ADS-B', radar: 'Radar', radar_raw: 'Raw', simulation: 'Sim' }
  return map[src] ?? src
}

function effectivePointDotColor(src: DataSource): string {
  return pointDotColors[src] ?? '#00ffcc'
}
function onPointDotColorChange(src: DataSource, hex: string) {
  setPointDotColor(src, hex)
}
function onResetPointDotColor(src: DataSource) {
  setPointDotColor(src, null)
}

function onSourceElevationChange(src: DataSource, raw: string) {
  const km = parseFloat(raw)
  if (!isNaN(km)) {
    emit('setSourceElevation', src, Math.max(0, km))
  }
}
</script>

<style scoped>
/* ── Panel root ── */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
}

/* ── Settings group (VS Code flat section) ── */
.settings-group {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-secondary);
  border-radius: 0;
  overflow: visible;
}
.settings-group:last-child {
  border-bottom: none;
}

/* ── Group header ── */
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 6px;
  font-size: 0.786rem;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border-bottom: none;
  user-select: none;
  cursor: pointer;
  transition: color 0.15s;
}
.group-header:hover {
  color: var(--text-primary);
}

.group-chevron {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.group-chevron.collapsed {
  transform: rotate(-90deg);
}

.group-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── Group body ── */
.group-body {
  padding: 2px 12px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ── Setting row ── */
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.row-label {
  font-size: 0.786rem;
  font-weight: 400;
  width: 52px;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--text-primary);
}

.row-value {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  min-width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  flex-shrink: 0;
}

.switch-label {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  min-width: 18px;
  flex-shrink: 0;
}

/* ── Elevation input ── */
.elevation-input-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.elevation-input {
  width: 64px;
  height: 24px;
  padding: 2px 6px;
  font-size: 0.786rem;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  outline: none;
  text-align: right;
}

.elevation-input:focus {
  border-color: var(--accent-primary);
}

.elevation-unit {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── Slider ── */
.row-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-tertiary);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  border: none;
  padding: 0;
}
.row-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
  border: 2px solid var(--bg-primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.row-slider:hover::-webkit-slider-thumb {
  filter: brightness(1.2);
}

/* ── Color picker ── */
.color-control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.color-input {
  width: 26px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
  flex-shrink: 0;
}
.color-input::-webkit-color-swatch-wrapper { padding: 1px; }
.color-input::-webkit-color-swatch { border: none; border-radius: 1px; }

.color-hex {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.714rem;
  color: var(--text-secondary);
  text-transform: uppercase;
}

/* ── Reset button ── */
.reset-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.setting-row:hover .reset-btn,
.reset-btn.show {
  opacity: 1;
}
.reset-btn:hover {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
  background: rgba(0, 122, 204, 0.1);
}

/* Spacer for rows without reset button */
.reset-slot {
  width: 20px;
  flex-shrink: 0;
}

/* ── File-level expand ── */
.expand-arrow { width: 10px; flex-shrink: 0; cursor: pointer; display: flex; align-items: center; }
.source-chevron { transition: transform 0.15s ease; color: var(--text-tertiary); }
.source-chevron.collapsed { transform: rotate(-90deg); }
.file-rows { padding-left: 0; }

/* ── Time offset row ── */
.time-offset-row {
  flex-wrap: nowrap;
  gap: 2px;
}

.time-range-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.time-range-inputs .time-input {
  flex: 1;
  padding: 2px 6px;
  font-size: 0.714rem;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  outline: none;
  min-width: 0;
}

.time-range-inputs .time-input:focus {
  border-color: var(--accent-primary);
}

.time-range-inputs .time-sep {
  font-size: 0.714rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.file-row { padding-left: 4px; }
.file-label { font-size: 0.714rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.row-label.file-label { width: auto; flex: 0 0 120px; }

/* ── Toggle switch ── */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  border: 1px solid var(--border-secondary);
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 1px;
  top: 1px;
  background: var(--text-primary);
  border-radius: 50%;
  transition: transform 0.15s ease, background 0.15s ease;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(14px);
  background: #fff;
}

/* ── Action button ── */
.action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: var(--button-bg);
  color: var(--button-fg);
  border: 1px solid transparent;
  border-radius: 2px;
  font-size: 0.786rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.action-btn:hover {
  background: var(--button-hover);
}
.action-btn.danger {
  color: var(--error);
  border-color: transparent;
  background: transparent;
}
.action-btn.danger:hover {
  background: rgba(220, 38, 38, 0.12);
}

.badge {
  font-size: 0.643rem;
  background: var(--accent-primary);
  color: #fff;
  border-radius: 8px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
  font-weight: 600;
  line-height: 16px;
}

/* ── Tools grid ── */
.tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 2px 0;
}

.tools-grid .action-btn {
  justify-content: center;
}

.tools-grid .action-btn.full-width {
  grid-column: 1 / -1;
}
</style>
