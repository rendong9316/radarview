<template>
  <div class="layer-control" :class="{ collapsed }">
    <div class="panel-header" @click="collapsed = !collapsed">
      图层控制
      <span class="collapse-icon">{{ collapsed ? '+' : '−' }}</span>
    </div>
    <div v-if="!collapsed" class="panel-body">
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
import { ref, computed } from 'vue'
import type { DataSource } from '../types/track'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useTracks } from '../composables/useTracks'

const { visibility, toggle } = useLayerVisibility()
const { tracksBySource } = useTracks()

const collapsed = ref(false)

const layerItems = computed(() => [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: '#00d4ff', count: tracksBySource.value.adsb?.length ?? 0 },
  { source: 'radar' as DataSource, label: '雷达 Radar', color: '#00ff88', count: tracksBySource.value.radar?.length ?? 0 },
  { source: 'radar_raw' as DataSource, label: '雷达原始', color: '#ff8800', count: tracksBySource.value.radar_raw?.length ?? 0 },
])
</script>

<style scoped>
.layer-control {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 200px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  z-index: 10;
}

.panel-header {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-accent);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collapse-icon {
  font-size: 16px;
  color: var(--color-text-dim);
}

.panel-body {
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
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
  color: var(--color-text);
}

.layer-count {
  color: var(--color-text-dim);
  font-size: 11px;
  min-width: 24px;
  text-align: right;
}

.toggle-input {
  display: none;
}

.toggle-switch {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.15);
  position: relative;
  transition: background 0.15s;
  flex-shrink: 0;
}

.toggle-switch.on {
  background: var(--color-accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}

.toggle-switch.on .toggle-knob {
  left: 16px;
}
</style>
