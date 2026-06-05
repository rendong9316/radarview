<template>
  <footer class="statusbar">
    <!-- Left: Playback controls -->
    <div class="statusbar-left">
      <!-- Play/Pause -->
      <button
        class="status-btn"
        :disabled="!hasData"
        :title="isPlaying ? '暂停' : '播放'"
        @click="$emit('togglePlayback')"
      >
        {{ isPlaying ? '⏸' : '▶' }}
      </button>

      <!-- Progress bar (compact) -->
      <div
        class="status-progress"
        :class="{ disabled: !hasData }"
        @click="onSeek($event)"
      >
        <div class="status-progress-fill" :style="{ width: `${progress * 100}%` }" />
      </div>

      <!-- Time display -->
      <span class="status-time" v-if="hasData">
        {{ currentTimeFormatted }} / {{ durationFormatted }}
      </span>

      <!-- Speed selector -->
      <div class="status-speed" v-if="hasData">
        <button
          v-for="opt in speedOptions"
          :key="opt"
          class="status-speed-btn"
          :class="{ active: speed === opt }"
          @click="$emit('setSpeed', opt)"
        >
          {{ opt }}x
        </button>
        <input
          class="status-speed-input"
          type="number"
          :value="speed"
          min="1"
          @keydown.enter="$emit('setSpeed', Number(($event.target as HTMLInputElement).value))"
          @blur="$emit('setSpeed', Number(($event.target as HTMLInputElement).value))"
          title="自定义倍速 (回车生效)"
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
      <span v-if="errorMsg" class="status-error" :title="errorMsg">⚠ {{ errorMsg }}</span>

      <!-- Source indicators -->
      <button
        v-for="s in sources"
        :key="s.key"
        class="status-source"
        :title="`点击切换 ${s.label} 可见性`"
        @click="$emit('toggleSource', s.key)"
      >
        <span class="source-dot" :style="{ background: `var(--source-${s.key})` }" :class="{ off: !s.visible }" />
        {{ s.label }}:{{ s.count }}
      </button>

      <!-- Track count -->
      <span class="status-count">航迹: {{ trackCount }}</span>

      <!-- Theme cycle -->
      <button class="status-btn status-theme" title="切换主题" @click="$emit('cycleTheme')">
        {{ themeIcon }}
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../../composables/useTheme'
import type { DataSource } from '../../types/track'

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
}>()

const emit = defineEmits<{
  togglePlayback: []
  seek: [ratio: number]
  setSpeed: [speed: number]
  toggleSource: [src: DataSource]
  cycleTheme: []
}>()

const { activeTheme, themes } = useTheme()
const themeIcon = computed(() => themes[activeTheme.value]?.icon ?? '🌙')

function onSeek(e: MouseEvent) {
  if (!props.hasData) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  emit('seek', ratio)
}
</script>

<style scoped>
.statusbar {
  height: 24px;
  background: var(--statusbar-bg);
  color: var(--statusbar-fg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  flex-shrink: 0;
  font-size: 12px;
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
  flex-shrink: 0;
}

.status-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
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
  background: rgba(255,255,255,0.2);
  border-radius: 2px;
  cursor: pointer;
  min-width: 60px;
  max-width: 300px;
}
.status-progress.disabled {
  cursor: default;
  opacity: 0.5;
}
.status-progress-fill {
  height: 100%;
  background: var(--statusbar-fg);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.status-time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Speed */
.status-speed {
  display: flex;
  align-items: center;
  gap: 2px;
}
.status-speed-btn {
  padding: 0 4px;
  height: 18px;
  font-size: 10px;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.7;
}
.status-speed-btn:hover {
  opacity: 1;
  background: rgba(255,255,255,0.1);
}
.status-speed-btn.active {
  opacity: 1;
  border-color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.1);
}
.status-speed-input {
  width: 40px;
  height: 18px;
  font-size: 10px;
  padding: 0 4px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: inherit;
  border-radius: 3px;
}

/* Source indicators */
.status-source {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
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

.status-count {
  font-size: 11px;
  white-space: nowrap;
  opacity: 0.8;
}

.status-error {
  color: var(--error);
  font-size: 11px;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-theme {
  width: auto;
  padding: 0 4px;
  font-size: 14px;
}

/* Import loading indicator */
.status-loading {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
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
