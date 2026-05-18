<template>
  <div class="track-panel" :class="{ collapsed }">
    <div class="panel-header" @click="collapsed = !collapsed">
      航迹面板
      <span v-if="tracks.length" class="count-badge">{{ tracks.length }}</span>
      <span class="collapse-icon">{{ collapsed ? '◀' : '▶' }}</span>
    </div>
    <div v-if="!collapsed" class="panel-body">
      <div class="search-bar">
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索 ICAO / 航班号 / 注册号 / 机型…"
        />
        <span v-if="searchQuery" class="search-clear" @click="searchQuery = ''">×</span>
      </div>
      <div v-if="isolatedId" class="isolate-banner">
        <span>🔍 单独查看: {{ isolatedLabel }}</span>
        <button class="isolate-back-btn" @click="$emit('clearIsolation')">返回全部</button>
      </div>
      <template v-if="filteredList.length === 0">
        <p class="placeholder-text">{{ searchQuery ? '无匹配结果' : '航迹数据加载后将在此显示目标列表' }}</p>
      </template>
      <template v-else>
        <div class="track-list">
          <div
            v-for="track in filteredList"
            :key="track.id"
            class="track-item"
            :class="{ selected: selectedId === track.id }"
          >
            <div class="track-item-main" @click="$emit('isolate', track.id)">
              <div class="track-item-top">
                <span class="track-color" :style="{ background: sourceColors[track.source] }"></span>
                <span class="track-id">{{ track.metadata.flightNumber || track.id }}</span>
                <span class="track-type">{{ track.metadata.aircraftType || '' }}</span>
              </div>
              <div class="track-item-bottom">
                <span>{{ lastAlt(track) }}</span>
                <span>{{ lastSpeed(track) }}</span>
                <span>{{ track.positions.length }} 点</span>
              </div>
            </div>
            <div
              v-if="expandedId === track.id"
              class="track-detail"
            >
              <div class="detail-row" v-if="track.id">
                <span class="detail-label">ICAO</span>
                <span class="detail-value mono">{{ track.id }}</span>
              </div>
              <div class="detail-row" v-if="track.metadata.registration">
                <span class="detail-label">注册号</span>
                <span class="detail-value">{{ track.metadata.registration }}</span>
              </div>
              <div class="detail-row" v-if="track.metadata.airline">
                <span class="detail-label">航司</span>
                <span class="detail-value">{{ track.metadata.airline }}</span>
              </div>
              <div class="detail-row" v-if="track.metadata.icaoFlightNumber">
                <span class="detail-label">ICAO 航班</span>
                <span class="detail-value mono">{{ track.metadata.icaoFlightNumber }}</span>
              </div>
              <div class="detail-row" v-if="track.metadata.origin || track.metadata.destination">
                <span class="detail-label">航线</span>
                <span class="detail-value">{{ track.metadata.origin || '???' }} → {{ track.metadata.destination || '???' }}</span>
              </div>
              <div class="detail-row" v-if="track.metadata.receiver">
                <span class="detail-label">接收站</span>
                <span class="detail-value mono">{{ track.metadata.receiver }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">数据源</span>
                <span class="detail-value">{{ sourceLabel(track.source) }}</span>
              </div>
            </div>
            <button
              class="expand-btn"
              @click="toggleExpand(track.id)"
            >
              {{ expandedId === track.id ? '收起' : '详情' }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Track, DataSource } from '../types/track'

const props = defineProps<{
  tracks: Track[]
  selectedId: string | null
  isolatedId: string | null
}>()

defineEmits<{
  isolate: [id: string]
  clearIsolation: []
}>()

const collapsed = ref(false)
const expandedId = ref<string | null>(null)
const searchQuery = ref('')

const isolatedLabel = computed(() => {
  if (!props.isolatedId) return ''
  const track = props.tracks.find(t => t.id === props.isolatedId)
  if (!track) return props.isolatedId
  return track.metadata.flightNumber || track.metadata.registration || track.id
})

const filteredList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.tracks

  return props.tracks.filter((t) => {
    if (t.id.toLowerCase().includes(q)) return true
    const m = t.metadata
    if (m.flightNumber?.toLowerCase().includes(q)) return true
    if (m.registration?.toLowerCase().includes(q)) return true
    if (m.aircraftType?.toLowerCase().includes(q)) return true
    if (m.airline?.toLowerCase().includes(q)) return true
    if (m.icaoFlightNumber?.toLowerCase().includes(q)) return true
    if (m.origin?.toLowerCase().includes(q)) return true
    if (m.destination?.toLowerCase().includes(q)) return true
    return false
  })
})

const sourceColors: Record<DataSource, string> = {
  adsb: '#00d4ff',
  radar: '#00ff88',
  radar_raw: '#ff8800',
  simulation: '#aa88ff',
}

function sourceLabel(source: DataSource): string {
  return { adsb: 'ADS-B', radar: '雷达', radar_raw: '雷达原始', simulation: '仿真' }[source]
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function lastAlt(track: Track): string {
  for (let i = track.positions.length - 1; i >= 0; i--) {
    const alt = track.positions[i].altitude
    if (alt > 0) {
      const ft = alt / 0.3048
      return ft >= 1000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft)}ft`
    }
  }
  return ''
}

function lastSpeed(track: Track): string {
  for (let i = track.positions.length - 1; i >= 0; i--) {
    const spd = track.positions[i].groundSpeed
    if (spd > 0) return `${spd}kt`
  }
  return ''
}
</script>

<style scoped>
.track-panel {
  width: 320px;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s;
}

.track-panel.collapsed {
  width: 36px;
}

.panel-header {
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-accent);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.collapse-icon {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-dim);
}

.count-badge {
  background: var(--color-accent);
  color: var(--color-bg);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.search-bar {
  position: relative;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

.search-input {
  width: 100%;
  padding: 7px 28px 7px 10px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--color-text-dim);
}

.search-input:focus {
  border-color: var(--color-accent);
}

.search-clear {
  position: absolute;
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-dim);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.search-clear:hover {
  color: var(--color-text);
}

.isolate-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(0,212,255,0.1);
  border-bottom: 1px solid rgba(0,212,255,0.2);
  font-size: 12px;
  color: var(--color-accent);
}

.isolate-back-btn {
  padding: 3px 8px;
  background: rgba(255,255,255,0.1);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 11px;
  cursor: pointer;
}

.isolate-back-btn:hover {
  background: rgba(255,255,255,0.18);
}

.placeholder-text {
  color: var(--color-text-dim);
  font-size: 13px;
  padding: 24px 16px;
  text-align: center;
}

.track-list {
  display: flex;
  flex-direction: column;
}

.track-item {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.track-item.selected {
  background: rgba(0, 212, 255, 0.08);
}

.track-item-main {
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.track-item-main:hover {
  background: rgba(255, 255, 255, 0.05);
}

.track-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 4px;
}

.track-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.track-id {
  font-weight: 600;
  color: var(--color-text);
}

.track-type {
  color: var(--color-text-dim);
  font-size: 12px;
}

.track-item-bottom {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-dim);
  padding-left: 16px;
}

.track-detail {
  padding: 8px 16px 12px 32px;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.detail-label {
  color: var(--color-text-dim);
  min-width: 56px;
  flex-shrink: 0;
}

.detail-value {
  color: var(--color-text);
}

.detail-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

.expand-btn {
  width: 100%;
  padding: 4px 0;
  background: transparent;
  border: none;
  color: var(--color-text-dim);
  font-size: 11px;
  cursor: pointer;
}

.expand-btn:hover {
  color: var(--color-accent);
}
</style>
