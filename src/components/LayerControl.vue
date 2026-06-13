<template>
  <div class="layer-section">
    <div class="section-body">
      <div
        v-for="item in layerItems"
        :key="item.source"
        class="layer-row"
      >
        <span class="layer-dot" :style="{ background: item.color }"></span>
        <span class="layer-label">{{ item.label }}</span>
        <span class="layer-count">{{ item.count }}</span>
        <label class="toggle-switch" @click.stop>
          <input
            type="checkbox"
            :checked="visibility[item.source]"
            @change="toggle(item.source)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="section-body overlay-body">
      <div class="layer-row">
        <span class="layer-dot city-dot"></span>
        <span class="layer-label">城市标注</span>
        <span class="layer-count">{{ cityLayer.visible ? '开' : '关' }}</span>
        <label class="toggle-switch" @click.stop>
          <input
            type="checkbox"
            :checked="cityLayer.visible"
            @change="setCityVisible(($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DataSource } from '../types/track'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useTracks } from '../composables/useTracks'
import { useCityLayer } from '../composables/useCityLayer'

const { visibility, toggle } = useLayerVisibility()
const { tracksBySource } = useTracks()
const { cityLayer, setCityVisible } = useCityLayer()

const layerItems = computed(() => [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: 'var(--source-adsb)', count: tracksBySource.value.adsb?.length ?? 0 },
  { source: 'radar' as DataSource, label: '雷达 Radar', color: 'var(--source-radar)', count: tracksBySource.value.radar?.length ?? 0 },
  { source: 'radar_raw' as DataSource, label: '雷达原始', color: 'var(--source-radar_raw)', count: tracksBySource.value.radar_raw?.length ?? 0 },
])
</script>

<style scoped>
.layer-section {
  display: flex;
  flex-direction: column;
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overlay-body {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border-secondary);
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.857rem;
  cursor: pointer;
}

.layer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.city-dot {
  background: #f5c542;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.layer-label {
  flex: 1;
  color: var(--text-primary);
}

.layer-count {
  color: var(--text-tertiary);
  font-size: 0.786rem;
  min-width: 24px;
  text-align: right;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
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
</style>
