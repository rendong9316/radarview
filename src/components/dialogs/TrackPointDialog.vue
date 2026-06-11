<template>
  <Teleport to="body">
    <div class="tpd-overlay" @click.self="emit('close')">
      <div class="tpd-dialog">
        <!-- Header -->
        <div class="tpd-header">
          <div class="tpd-header-info">
            <span class="tpd-icao">{{ track.metadata?.flightNumber || track.id }}</span>
            <span v-if="track.metadata?.flightNumber" class="tpd-icao-sub">ICAO: {{ track.id }}</span>
            <span class="tpd-src-dot" :class="srcClass(track.source)"></span>
            <span class="tpd-src-label">{{ srcLabel(track.source) }}</span>
            <span class="tpd-count">{{ track.positions.length.toLocaleString() }} 个点迹</span>
          </div>
          <div class="tpd-header-actions">
            <button class="tpd-btn-export" @click="exportCSV">📥 导出 CSV</button>
            <button class="tpd-btn-close" @click="emit('close')">✕</button>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="tpd-loading">正在加载点迹数据…</div>

        <!-- Table -->
        <template v-else>
          <div class="tpd-table-wrap">
            <table class="tpd-table">
              <thead>
                <tr>
                  <th class="col-seq">序号</th>
                  <th class="col-ts sortable" @click="toggleSort('timestamp')">
                    时间戳 {{ sortIndicator('timestamp') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('latitude')">
                    纬度 {{ sortIndicator('latitude') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('longitude')">
                    经度 {{ sortIndicator('longitude') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('altitude')">
                    高度(ft) {{ sortIndicator('altitude') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('heading')">
                    航向(°) {{ sortIndicator('heading') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('groundSpeed')">
                    地速(kn) {{ sortIndicator('groundSpeed') }}
                  </th>
                  <th class="col-num sortable" @click="toggleSort('verticalRate')">
                    垂直率(ft/min) {{ sortIndicator('verticalRate') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in pageItems" :key="pageStart + i">
                  <td class="col-seq">{{ pageStart + i + 1 }}</td>
                  <td class="col-ts">{{ fmtTimestamp(p.timestamp) }}</td>
                  <td class="col-num">{{ p.latitude.toFixed(6) }}</td>
                  <td class="col-num">{{ p.longitude.toFixed(6) }}</td>
                  <td class="col-num">{{ altToFt(p.altitude).toFixed(0) }}</td>
                  <td class="col-num">{{ p.heading.toFixed(1) }}</td>
                  <td class="col-num">{{ p.groundSpeed.toFixed(0) }}</td>
                  <td class="col-num">{{ p.verticalRate.toFixed(1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="tpd-pagination">
            <button :disabled="sortPage <= 1" @click="sortPage = 1">⟪</button>
            <button :disabled="sortPage <= 1" @click="sortPage--">⟨</button>
            <span class="tpd-page-info">{{ sortPage }} / {{ totalPages }}</span>
            <button :disabled="sortPage >= totalPages" @click="sortPage++">⟩</button>
            <button :disabled="sortPage >= totalPages" @click="sortPage = totalPages">⟫</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Track, TrackPoint } from '../../types/track'

const props = defineProps<{
  track: Track
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// ── Display helpers ──
function srcLabel(s: string): string {
  if (s === 'adsb') return 'ADS-B'
  if (s === 'radar') return '雷达'
  if (s === 'radar_raw') return '原始'
  return s
}
function srcClass(s: string): string {
  if (s === 'adsb') return 'dot-adsb'
  if (s === 'radar') return 'dot-radar'
  if (s === 'radar_raw') return 'dot-raw'
  return ''
}
function altToFt(m: number): number {
  return m / 0.3048
}
function fmtTimestamp(ms: number): string {
  // epoch ms (UTC) → Beijing time "YYYY-MM-DD HH:MM:SS"
  const d = new Date(ms + 8 * 3600 * 1000) // shift to UTC+8
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

// ── Sorting ──
type SortField = keyof TrackPoint
const sortField = ref<SortField>('timestamp')
const sortDesc = ref(false)

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDesc.value = !sortDesc.value
  } else {
    sortField.value = field
    sortDesc.value = false
  }
  sortPage.value = 1
}

function sortIndicator(field: SortField): string {
  if (sortField.value !== field) return ''
  return sortDesc.value ? '▼' : '▲'
}

const sortedPoints = computed(() => {
  const arr = [...props.track.positions]
  const f = sortField.value
  const mul = sortDesc.value ? -1 : 1
  arr.sort((a, b) => {
    const va = a[f]
    const vb = b[f]
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * mul
    }
    return 0
  })
  return arr
})

// ── Pagination ──
const PAGE_SIZE = 100
const sortPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(sortedPoints.value.length / PAGE_SIZE)))
const pageStart = computed(() => (sortPage.value - 1) * PAGE_SIZE)
const pageItems = computed(() => sortedPoints.value.slice(pageStart.value, pageStart.value + PAGE_SIZE))

// ── Export CSV ──
function exportCSV() {
  const header = '序号,时间戳,纬度,经度,高度(ft),航向(°),地速(kn),垂直率(ft/min)'
  const rows = sortedPoints.value.map((p, i) =>
    [
      i + 1,
      fmtTimestamp(p.timestamp),
      p.latitude.toFixed(6),
      p.longitude.toFixed(6),
      altToFt(p.altitude).toFixed(0),
      p.heading.toFixed(1),
      p.groundSpeed.toFixed(0),
      p.verticalRate.toFixed(1),
    ].join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const name = props.track.metadata?.flightNumber || props.track.id
  a.download = `${name}_points.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.tpd-overlay {
  position: fixed; inset: 0; z-index: 250;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.tpd-dialog {
  width: 92vw; max-width: 1400px; height: 88vh;
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-secondary, #333);
  border-radius: 8px;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

/* Header */
.tpd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-secondary, #333);
  flex-shrink: 0;
}
.tpd-header-info {
  display: flex; align-items: center; gap: 10px;
}
.tpd-icao {
  font-size: 0.929rem; font-weight: 700; color: var(--text-primary);
  font-family: 'Consolas', monospace;
}
.tpd-icao-sub {
  font-size: 0.714rem; color: var(--text-tertiary);
}
.tpd-src-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
}
.dot-adsb { background: #00d4ff; }
.dot-radar { background: #00ff88; }
.dot-raw { background: #ff8800; }
.tpd-src-label {
  font-size: 0.786rem; color: var(--text-secondary);
}
.tpd-count {
  font-size: 0.786rem; color: var(--text-tertiary);
}
.tpd-header-actions {
  display: flex; align-items: center; gap: 8px;
}
.tpd-btn-export {
  padding: 4px 12px; font-size: 0.786rem;
  background: var(--button-bg, #2d5f8b); color: #fff;
  border: none; border-radius: 4px; cursor: pointer;
}
.tpd-btn-export:hover { filter: brightness(1.15); }
.tpd-btn-close {
  width: 28px; height: 28px; font-size: 1rem;
  background: transparent; color: var(--text-tertiary);
  border: none; border-radius: 4px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.tpd-btn-close:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }

/* Loading */
.tpd-loading {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 1rem; color: var(--text-tertiary);
}

/* Table wrapper */
.tpd-table-wrap {
  flex: 1; overflow: auto; padding: 0;
}

/* Table */
.tpd-table {
  width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums;
}
.tpd-table thead {
  position: sticky; top: 0; z-index: 2; background: var(--bg-secondary, #252526);
}
.tpd-table th {
  padding: 6px 8px; font-size: 0.714rem; font-weight: 600;
  color: var(--text-tertiary); text-align: right; white-space: nowrap;
  user-select: none; border-bottom: 2px solid var(--border-secondary, #333);
}
.tpd-table th.col-seq { text-align: center; width: 48px; }
.tpd-table th.col-ts { text-align: left; min-width: 155px; }
.tpd-table th.sortable { cursor: pointer; }
.tpd-table th.sortable:hover { color: var(--text-primary); }

.tpd-table td {
  padding: 3px 8px; font-size: 0.786rem; color: var(--text-primary);
  border-bottom: 1px solid var(--border-tertiary, #2a2a2a);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tpd-table tbody tr:hover { background: rgba(255,255,255,0.03); }

.col-seq { text-align: center; color: var(--text-tertiary); width: 48px; }
.col-ts { text-align: left; font-family: 'Consolas', monospace; }
.col-num { text-align: right; }

/* Pagination */
.tpd-pagination {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 16px; border-top: 1px solid var(--border-secondary, #333);
  flex-shrink: 0;
}
.tpd-pagination button {
  padding: 2px 10px; font-size: 0.786rem;
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-secondary, #333); border-radius: 3px; cursor: pointer;
}
.tpd-pagination button:hover:not(:disabled) { background: var(--button-hover); color: var(--text-primary); }
.tpd-pagination button:disabled { opacity: 0.3; cursor: default; }
.tpd-page-info { font-size: 0.786rem; color: var(--text-secondary); min-width: 60px; text-align: center; }
</style>
