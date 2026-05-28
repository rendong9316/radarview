<template>
  <div class="playback-bar">
    <button class="ctrl-btn play-btn" @click="$emit('toggle')" :disabled="!hasData">
      {{ isPlaying ? '⏸' : '▶' }}
    </button>

    <span class="time-display">{{ currentTimeFormatted }}</span>

    <div class="progress-track" @mousedown="onMouseDown" ref="trackRef">
      <div class="progress-fill" :style="{ width: (progress * 100) + '%' }"></div>
      <div class="progress-thumb" :style="{ left: (progress * 100) + '%' }"></div>
    </div>

    <span class="time-display">{{ durationFormatted }}</span>

    <div class="speed-group">
      <button
        v-for="s in speedOptions"
        :key="s"
        class="speed-btn"
        :class="{ active: speed === s }"
        @click="$emit('speed', s)"
      >
        {{ s }}x
      </button>
      <input
        class="custom-speed-input"
        type="number"
        min="1"
        :value="speed"
        @keydown.enter="onCustomSpeed"
        @blur="onCustomSpeed"
        title="自定义倍速，回车生效"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  isPlaying: boolean
  hasData: boolean
  progress: number
  speed: number
  speedOptions: readonly number[]
  currentTimeFormatted: string
  durationFormatted: string
}>()

const emit = defineEmits<{
  toggle: []
  seek: [progress: number]
  speed: [speed: number]
}>()

const trackRef = ref<HTMLDivElement>()

function onMouseDown(e: MouseEvent) {
  if (!trackRef.value) return
  const rect = trackRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  emit('seek', x)

  function onMove(ev: MouseEvent) {
    const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
    emit('seek', nx)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onCustomSpeed(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  if (val >= 1) emit('speed', val)
}
</script>

<style scoped>
.playback-bar {
  height: 48px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 10px;
  flex-shrink: 0;
  user-select: none;
}

.ctrl-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ctrl-btn:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-bg);
}

.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.time-display {
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--color-text-dim);
  min-width: 64px;
  text-align: center;
  flex-shrink: 0;
}

.progress-track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  position: relative;
  cursor: pointer;
  min-width: 80px;
}

.progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 3px;
  transition: width 0.05s linear;
}

.progress-thumb {
  position: absolute;
  top: -4px;
  width: 14px;
  height: 14px;
  background: var(--color-accent);
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: 0 0 6px rgba(0, 212, 255, 0.5);
}

.speed-group {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.speed-btn {
  padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-dim);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.speed-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text);
}

.speed-btn.active {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.custom-speed-input {
  width: 52px;
  padding: 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text);
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
}

.custom-speed-input::-webkit-outer-spin-button,
.custom-speed-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.custom-speed-input:focus {
  border-color: var(--color-accent);
}
</style>
