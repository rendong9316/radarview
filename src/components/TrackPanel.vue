<template>
  <div class="track-panel">
    <div class="panel-body">
      <div class="search-bar"><HelpTip text="支持按 ICAO 地址、航班号、注册号、机型、航司、起降地等关键字模糊搜索航迹。点击航迹行可在地图上单独查看。" position="bottom" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索 ICAO / 航班号 / 注册号 / 机型..." title="输入关键字搜索航迹"
        />
        <span v-if="searchQuery" class="search-clear" @click="searchQuery = ''" title="清除搜索内容"><X :size="14" /></span>
      </div>
      <div v-if="isolatedId" class="isolate-banner">
        <span>单独查看: {{ isolatedLabel }}</span>
        <button class="isolate-back-btn" @click="$emit('clearIsolation')" title="返回查看全部航迹">返回全部</button>
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
            :class="{ selected: selectedId === trackKey(track.id, track.source) }"
          >
            <div class="track-item-main" @click="$emit('isolate', trackKey(track.id, track.source))" title="点击单独查看此航迹">
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
            <button class="expand-btn" @click="toggleExpand(track.id)" title="展开或收起航迹详细信息">
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
import { trackKey } from '../composables/useTracks'
import HelpTip from './HelpTip.vue'
import { X } from '@lucide/vue'

const props = defineProps<{
  tracks: Track[]
  selectedId: string | null
  isolatedId: string | null
}>()

defineEmits<{
  isolate: [id: string]
  clearIsolation: []
}>()

const expandedId = ref<string | null>(null)
const searchQuery = ref('')

const isolatedLabel = computed(() => {
  if (!props.isolatedId) return ''
  const track = props.tracks.find(t => trackKey(t.id, t.source) === props.isolatedId)
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
  adsb: 'var(--source-adsb)',
  radar: 'var(--source-radar)',
  radar_raw: 'var(--source-radar_raw)',
  simulation: 'var(--source-simulation)',
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
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.search-bar {
  position: relative;
  padding: 0 0 8px 0;
}

.search-input {
  width: 100%;
  padding: 6px 28px 6px 8px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  color: var(--text-primary);
  font-size: 0.857rem;
  outline: none;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.search-input:focus {
  border-color: var(--accent-primary);
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1.143rem;
  line-height: 1;
}

.search-clear:hover {
  color: var(--text-primary);
}

.isolate-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--accent-primary);
  color: #fff;
  border-radius: 2px;
  font-size: 0.786rem;
  margin-bottom: 4px;
}

.isolate-back-btn {
  padding: 2px 8px;
  background: rgba(255,255,255,0.2);
  border: none;
  border-radius: 2px;
  color: #fff;
  font-size: 0.786rem;
  cursor: pointer;
}

.isolate-back-btn:hover {
  background: rgba(255,255,255,0.35);
}

.placeholder-text {
  color: var(--text-tertiary);
  font-size: 0.857rem;
  padding: 16px 0;
  text-align: center;
}

.track-list {
  display: flex;
  flex-direction: column;
}

.track-item {
  border-bottom: none;
}

.track-item:nth-child(even) {
  background: var(--bg-tertiary);
}

.track-item.selected {
  background: rgba(0, 122, 204, 0.12);
}

.track-item-main {
  padding: 6px 8px;
  cursor: pointer;
  transition: background 0.1s;
}

.track-item-main:hover {
  background: var(--button-hover);
}

.track-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.857rem;
  margin-bottom: 2px;
}

.track-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.track-id {
  font-weight: 600;
  color: var(--text-primary);
}

.track-type {
  color: var(--text-tertiary);
  font-size: 0.786rem;
}

.track-item-bottom {
  display: flex;
  gap: 8px;
  font-size: 0.786rem;
  color: var(--text-tertiary);
  padding-left: 14px;
}

.track-detail {
  padding: 6px 8px 8px 22px;
  background: var(--bg-tertiary);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-row {
  display: flex;
  gap: 6px;
  font-size: 0.786rem;
}

.detail-label {
  color: var(--text-tertiary);
  min-width: 50px;
  flex-shrink: 0;
}

.detail-value {
  color: var(--text-primary);
}

.detail-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.786rem;
}

.expand-btn {
  width: 100%;
  padding: 3px 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.786rem;
  cursor: pointer;
}

.expand-btn:hover {
  color: var(--accent-primary);
}
</style>
