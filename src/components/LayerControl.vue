<template>
  <div class="layer-section">
    <div class="section-body">
      <label
        v-for="item in layerItems"
        :key="item.source"
        class="layer-row"
      >
        <span class="layer-dot" :style="{ background: item.color }"></span>
        <span class="layer-label">{{ item.label }}</span>
        <span class="layer-count">{{ item.count }}</span>
        <input
          type="checkbox"
          class="toggle-input"
          :checked="visibility[item.source]"
          @change="toggle(item.source)"
        />
        <span class="toggle-switch" :class="{ on: visibility[item.source] }">
          <span class="toggle-knob"></span>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DataSource } from '../types/track'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useTracks } from '../composables/useTracks'

const { visibility, toggle } = useLayerVisibility()
const { tracksBySource } = useTracks()

const layerItems = computed(() => [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: '#00d4ff', count: tracksBySource.value.adsb?.length ?? 0 },
  { source: 'radar' as DataSource, label: '雷达 Radar', color: '#00ff88', count: tracksBySource.value.radar?.length ?? 0 },
  { source: 'radar_raw' as DataSource, label: '雷达原始', color: '#ff8800', count: tracksBySource.value.radar_raw?.length ?? 0 },
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

.toggle-input {
  display: none;
}

.toggle-switch {
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  position: relative;
  transition: background 0.15s;
  flex-shrink: 0;
}

.toggle-switch.on {
  background: var(--accent-primary);
}

.toggle-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}

.toggle-switch.on .toggle-knob {
  left: 13px;
}
</style>
