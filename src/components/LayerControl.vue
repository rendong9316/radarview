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
.layer-dot.small { width: 6px; height: 6px; }

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

.filter-divider {
  height: 1px;
  background: var(--border-primary);
  margin: 1px 0;
}

.filter-toggle {
  font-size: 0.786rem;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
  user-select: none;
}
.filter-toggle:hover { color: var(--accent-primary); }
.collapse-icon { font-size: 0.857rem; }
.collapse-icon.small { font-size: 0.714rem; }

.point-filter-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.point-filter-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.786rem;
}

.pf-check-label {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  min-width: 42px;
  font-size: 0.786rem;
}

.pf-input {
  width: 42px;
  padding: 2px 4px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  color: var(--input-fg);
  font-size: 0.786rem;
  outline: none;
}

.pf-input:focus {
  border-color: var(--accent-primary);
}

.pf-input:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pf-sep {
  color: var(--text-tertiary);
  font-size: 0.786rem;
}
</style>
