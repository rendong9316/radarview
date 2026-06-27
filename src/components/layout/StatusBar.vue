<template>
  <footer class="statusbar">
    <!-- Left: Playback controls -->
    <div class="statusbar-left">
      <!-- Play/Pause -->
      <button
        class="status-btn"
        :disabled="!hasData"
        :title="isPlaying ? '暂停' : '播放'"
        :aria-label="isPlaying ? '暂停' : '播放'"
        @click="$emit('togglePlayback')"
      >
        <Pause v-if="isPlaying" :size="14" />
        <Play v-else :size="14" />
      </button>

      <!-- Progress bar with draggable thumb -->
      <div
        ref="progressRef"
        class="status-progress"
        :class="{ disabled: !hasData, dragging: isDragging }"
        @click="onSeek($event)" title="拖动或点击跳转回放位置"
      >
        <div class="status-progress-fill" :style="{ width: `${progress * 100}%` }" />
        <div
          class="status-progress-thumb"
          :style="{ left: `${progress * 100}%` }"
          @mousedown.prevent="onThumbMouseDown"
        />
      </div>

      <!-- Time display -->
      <span class="status-time" v-if="hasData">
        {{ currentTimeFormatted }} / {{ durationFormatted }}
      </span>

      <!-- Speed selector -->
      <div class="status-speed" v-if="hasData">
        <select
          class="status-speed-select"
          :value="showCustomInput || !speedOptions.includes(speed) ? 'custom' : speed"
          @change="onSpeedSelect(($event.target as HTMLSelectElement).value)" title="选择回放倍速"
        >
          <option v-for="opt in speedOptions" :key="opt" :value="opt">{{ opt }}x</option>
          <option value="custom">自定义...</option>
        </select>
        <input
          v-if="showCustomInput || !speedOptions.includes(speed)"
          class="status-speed-input"
          type="number"
          :value="speed"
          min="1"
          @keydown.enter="onCustomSpeed(($event.target as HTMLInputElement).value)"
          title="输入自定义倍速，按回车键确认生效"
        />
      </div>
    </div>

    <!-- Right: Info -->
    <div class="statusbar-right">
      <!-- Import progress indicator -->
      <span v-if="loading || persisting" class="status-loading">
        <span class="load-spinner"></span>
        {{ loading ? `${loadingProgress}%` : '保存中' }}
      </span>

      <!-- Error indicator -->
      <span v-if="errorMsg" class="status-error" :title="errorMsg" role="alert">
        <AlertTriangle :size="12" class="error-icon" />
        {{ errorMsg }}
      </span>

      <span class="status-view" :title="`相机高度 ${formatHeightKm(cameraHeightKm)} km`">
        高: {{ formatHeightKm(cameraHeightKm) }} km
      </span>
      <span class="status-view" :title="`鼠标经纬度 ${formatCoordinate(mouseLongitude)}, ${formatCoordinate(mouseLatitude)}`">
        经纬: {{ formatCoordinate(mouseLongitude) }}, {{ formatCoordinate(mouseLatitude) }}
      </span>
      <span class="status-view" :title="`渲染帧率 ${fps > 0 ? fps : '--'} FPS`">
        FPS: {{ fps > 0 ? fps : '--' }}
      </span>

      <!-- Source indicators -->
      <button
        v-for="s in sources"
        :key="s.key"
        class="status-source"
        :title="(s as any).fileCount > 1 ? `${s.label}: ${s.count} 条航迹 (${(s as any).fileCount} 个文件) — 点击切换` : `点击切换 ${s.label} 可见性`"
        :aria-label="`切换 ${s.label} 可见性`"
        @click="$emit('toggleSource', s.key)"
      >
        <span class="source-dot" :style="{ background: `var(--source-${s.key})` }" :class="{ off: !s.visible }" />
        {{ s.label }}:{{ s.count }}<span v-if="(s as any).fileCount > 1" class="file-count-hint">/{{ (s as any).fileCount }}f</span>
      </button>

      <!-- Track count -->
      <span class="status-count">航迹: {{ trackCount }}</span>

      <!-- Theme cycle -->
      <button class="status-btn status-theme" title="切换主题" aria-label="切换主题" @click="$emit('cycleTheme')">
        <Moon v-if="activeTheme === 'dark'" :size="14" />
        <Sun v-else-if="activeTheme === 'light'" :size="14" />
        <Contrast v-else :size="14" />
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useTheme } from '../../composables/useTheme'
import type { DataSource } from '../../types/track'
import { Play, Pause, AlertTriangle, Moon, Sun, Contrast } from '@lucide/vue'

const props = defineProps<{
  isPlaying: boolean
  hasData: boolean
  progress: number
  speed: number
  speedOptions: number[]
  currentTimeFormatted: string
  durationFormatted: string
  trackCount: number
  errorMsg: string
  sources: Array<{ key: DataSource; label: string; count: number; visible: boolean }>
  loading: boolean
  loadingProgress: number
  persisting: boolean
  cameraHeightKm: number
  mouseLongitude: number
  mouseLatitude: number
  fps: number
}>()

const emit = defineEmits<{
  togglePlayback: []
  seek: [ratio: number]
  setSpeed: [speed: number]
  toggleSource: [src: DataSource]
  cycleTheme: []
}>()

const { activeTheme } = useTheme()

const progressRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const showCustomInput = ref(!props.speedOptions.includes(props.speed))

// When speed changes externally (e.g. settings loaded), sync custom input state
watch(() => props.speed, (v) => {
  if (props.speedOptions.includes(v)) showCustomInput.value = false
})

function formatHeightKm(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1000) return value.toFixed(0)
  if (value >= 100) return value.toFixed(1)
  return value.toFixed(2)
}

function formatCoordinate(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : '0.0000'
}

function seekFromClientX(clientX: number) {
  if (!props.hasData || !progressRef.value) return
  const rect = progressRef.value.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  emit('seek', ratio)
}

function onCustomSpeed(raw: string) {
  const v = Number(raw)
  if (!isFinite(v) || v <= 0) return
  emit('setSpeed', v)
}

function onSpeedSelect(value: string) {
  if (value === 'custom') {
    showCustomInput.value = true
    return
  }
  showCustomInput.value = false
  emit('setSpeed', Number(value))
}

function onSeek(e: MouseEvent) {
  seekFromClientX(e.clientX)
}

function onThumbMouseDown(_e: MouseEvent) {
  if (!props.hasData) return
  isDragging.value = true
  document.addEventListener('mousemove', onThumbMouseMove)
  document.addEventListener('mouseup', onThumbMouseUp)
}

function onThumbMouseMove(e: MouseEvent) {
  seekFromClientX(e.clientX)
}

function onThumbMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onThumbMouseMove)
  document.removeEventListener('mouseup', onThumbMouseUp)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onThumbMouseMove)
  document.removeEventListener('mouseup', onThumbMouseUp)
})
</script>

<style scoped>
.statusbar {
  height: 22px;
  background: var(--statusbar-bg);
  color: var(--statusbar-fg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  flex-shrink: 0;
  font-size: 0.786rem;
  border-top: 1px solid var(--statusbar-border);
  user-select: none;
  z-index: 5;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.statusbar-left {
  flex: 1;
  min-width: 0;
}

.statusbar-right {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  justify-content: flex-end;
}

.status-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
}
.status-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.15);
}
.status-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Progress bar */
.status-progress {
  flex: 1;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  cursor: pointer;
  min-width: 60px;
  max-width: 300px;
  position: relative;
}
.status-progress.disabled {
  cursor: default;
  opacity: 0.5;
}
.status-progress.dragging {
  cursor: grabbing;
}
.status-progress-fill {
  height: 100%;
  background: var(--statusbar-fg);
  border-radius: 2px;
  transition: width 0.1s linear;
}
.status-progress.dragging .status-progress-fill {
  transition: none;
}

/* Draggable thumb */
.status-progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: var(--statusbar-fg);
  border: 2px solid rgba(255,255,255,0.9);
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(0,0,0,0.4);
  cursor: grab;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.15s;
}
.status-progress:hover .status-progress-thumb,
.status-progress.dragging .status-progress-thumb {
  opacity: 1;
}
.status-progress-thumb:active {
  cursor: grabbing;
}
.status-progress.disabled .status-progress-thumb {
  opacity: 0;
  pointer-events: none;
}

.status-time {
  font-size: 0.786rem;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Speed */
.status-speed {
  display: flex;
  align-items: center;
  gap: 2px;
}
.status-speed-select {
  height: 16px;
  font-size: 0.714rem;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  padding: 0 2px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  color: inherit;
  border-radius: 2px;
  cursor: pointer;
  max-width: 72px;
}
.status-speed-select option {
  background: var(--statusbar-bg);
  color: var(--statusbar-fg);
}
.status-speed-input {
  width: 64px;
  height: 16px;
  font-size: 0.714rem;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  padding: 0 4px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  color: inherit;
  border-radius: 2px;
}

/* Source indicators */
.status-source {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.786rem;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
}
.status-source:hover {
  background: rgba(255,255,255,0.1);
}

.source-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.source-dot.off {
  opacity: 0.3;
}

.file-count-hint {
  font-size: 0.643rem;
  color: var(--text-tertiary);
  margin-left: 1px;
}

.status-view {
  font-size: 0.786rem;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0.85;
  flex: 0 0 auto;
}

.status-count {
  font-size: 0.786rem;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0.8;
}

.status-error {
  color: var(--error);
  font-size: 0.786rem;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 3px;
}

.error-icon {
  flex-shrink: 0;
}

.status-theme {
  width: auto;
  padding: 0 4px;
}

/* Import loading indicator */
.status-loading {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.786rem;
  color: var(--accent-primary);
  white-space: nowrap;
}

.load-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: load-spin 0.6s linear infinite;
}

@keyframes load-spin {
  to { transform: rotate(360deg); }
}
</style>
