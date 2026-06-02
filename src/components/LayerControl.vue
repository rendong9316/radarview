<template>
  <div class="layer-section" :class="{ collapsed }">
    <div class="section-header" @click="collapsed = !collapsed">
      图层控制
      <span class="collapse-icon">{{ collapsed ? '+' : '−' }}</span>
    </div>
    <div v-if="!collapsed" class="section-body">
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

      <!-- Per-source point count filter -->
      <div class="filter-divider"></div>
      <div class="filter-toggle" @click="showPointFilter = !showPointFilter">
        航迹点长度筛选
        <span class="collapse-icon small">{{ showPointFilter ? '−' : '+' }}</span>
      </div>
      <div v-if="showPointFilter" class="point-filter-list">
        <div v-for="item in layerItems" :key="'pf-'+item.source" class="point-filter-row">
          <span class="layer-dot small" :style="{ background: item.color }"></span>
          <label class="pf-check-label">
            <input
              type="checkbox"
              :checked="pointCountFilters[item.source].enabled"
              @change="onPfToggle(item.source, ($event.target as HTMLInputElement).checked)"
            />
            {{ item.source === 'adsb' ? 'ADSB' : item.source === 'radar' ? 'Radar' : 'Raw' }}
          </label>
          <input
            type="number"
            class="pf-input"
            placeholder="最小"
            min="0"
            :disabled="!pointCountFilters[item.source].enabled"
            :value="pointCountFilters[item.source].min"
            @change="onPfMin(item.source, ($event.target as HTMLInputElement).value)"
          />
          <span class="pf-sep">-</span>
          <input
            type="number"
            class="pf-input"
            placeholder="最大"
            min="0"
            :disabled="!pointCountFilters[item.source].enabled"
            :value="pointCountFilters[item.source].max"
            @change="onPfMax(item.source, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DataSource } from '../types/track'
import { useLayerVisibility } from '../composables/useLayerVisibility'
import { useTracks } from '../composables/useTracks'
import { useTrackFilter } from '../composables/useTrackFilter'

const { visibility, toggle } = useLayerVisibility()
const { tracksBySource } = useTracks()
const { pointCountFilters, setPointCountFilter } = useTrackFilter()

const collapsed = ref(false)
const showPointFilter = ref(false)

const layerItems = computed(() => [
  { source: 'adsb' as DataSource, label: 'ADS-B', color: '#00d4ff', count: tracksBySource.value.adsb?.length ?? 0 },
  { source: 'radar' as DataSource, label: '雷达 Radar', color: '#00ff88', count: tracksBySource.value.radar?.length ?? 0 },
  { source: 'radar_raw' as DataSource, label: '雷达原始', color: '#ff8800', count: tracksBySource.value.radar_raw?.length ?? 0 },
])

function onPfToggle(source: DataSource, enabled: boolean) {
  setPointCountFilter(source, { enabled })
}

function onPfMin(source: DataSource, val: string) {
  const n = val === '' ? null : parseInt(val, 10)
  setPointCountFilter(source, { min: n != null && !isNaN(n) ? n : null })
}

function onPfMax(source: DataSource, val: string) {
  const n = val === '' ? null : parseInt(val, 10)
  setPointCountFilter(source, { max: n != null && !isNaN(n) ? n : null })
}
</script>

<style scoped>
.layer-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.section-header {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-accent);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
}

.collapse-icon { font-size: 14px; color: var(--color-text-dim); }
.collapse-icon.small { font-size: 11px; }

.section-body {
  padding: 5px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
}

.layer-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.layer-dot.small { width: 5px; height: 5px; }

.layer-label {
  flex: 1;
  color: var(--color-text);
}

.layer-count {
  color: var(--color-text-dim);
  font-size: 10px;
  min-width: 20px;
  text-align: right;
}

.toggle-input {
  display: none;
}

.toggle-switch {
  width: 28px;
  height: 16px;
  border-radius: 8px;
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

.filter-divider {
  height: 1px;
  background: var(--color-border);
  margin: 1px 0;
}

.filter-toggle {
  font-size: 10px;
  color: var(--color-text-dim);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
  user-select: none;
}
.filter-toggle:hover { color: var(--color-accent); }

.point-filter-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.point-filter-row {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
}

.pf-check-label {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--color-text-dim);
  cursor: pointer;
  white-space: nowrap;
  min-width: 38px;
  font-size: 10px;
}

.pf-input {
  width: 38px;
  padding: 1px 3px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text);
  font-size: 10px;
  outline: none;
}

.pf-input:focus {
  border-color: var(--color-accent);
}

.pf-input:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pf-sep {
  color: var(--color-text-dim);
  font-size: 10px;
}
</style>
