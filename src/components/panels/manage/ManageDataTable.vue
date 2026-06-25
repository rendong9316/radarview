<template>
  <div class="table-container">
    <div v-if="loading" class="table-loading">
      <div v-for="i in 5" :key="i" class="skeleton-row" />
    </div>

    <div v-else-if="rows.length === 0" class="table-empty">
      <template v-if="totalCount === 0">暂无航迹数据，请先导入文件</template>
      <template v-else>未找到匹配的航迹，请调整筛选条件</template>
    </div>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th class="col-eye"><Eye :size="12" /></th>
          <th class="col-src">来源</th>
          <th class="col-icao sortable" title="按 ICAO 地址排序" @click="$emit('setSort', 'icao_address')">ICAO {{ sortIndicator('icao_address') }}</th>
          <th class="col-flt sortable" title="按航班号排序" @click="$emit('setSort', 'flight_no')">航班号 {{ sortIndicator('flight_no') }}</th>
          <th class="col-reg sortable" title="按注册号排序" @click="$emit('setSort', 'registration')">注册号 {{ sortIndicator('registration') }}</th>
          <th class="col-type sortable" title="按机型排序" @click="$emit('setSort', 'aircraft_type')">机型 {{ sortIndicator('aircraft_type') }}</th>
          <th class="col-aln sortable" title="按航空公司排序" @click="$emit('setSort', 'airline')">航司 {{ sortIndicator('airline') }}</th>
          <th class="col-route">起降地</th>
          <th class="col-pts sortable" title="按航迹点数排序" @click="$emit('setSort', 'point_count')">点数 {{ sortIndicator('point_count') }}</th>
          <th class="col-time sortable" title="按时间排序" @click="$emit('setSort', 'min_timestamp')">时间 {{ sortIndicator('min_timestamp') }}</th>
          <th class="col-act">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="`${row.icao_address}::${row.batch_id}`"
          class="data-row"
          :class="{ visible: isVisible(row.icao_address, row.batch_id), highlighted: isHighlighted(row.icao_address) }"
          :data-icao="row.icao_address"
          @contextmenu.prevent="onCtx($event, row)"
        >
          <td class="col-eye" @click.stop="$emit('toggleVisible', row)">
            <span class="eye-icon" title="切换地图可见性" :class="{ on: isVisible(row.icao_address, row.batch_id) }">
              <Eye v-if="isVisible(row.icao_address, row.batch_id)" :size="13" />
              <Circle v-else :size="13" />
            </span>
          </td>
          <td class="col-src"><span class="src-dot" :class="srcClass(row.source)"></span>{{ srcLabel(row.source) }}</td>
          <td class="col-icao">{{ row.icao_address }}</td>
          <td class="col-flt">{{ row.flight_number || '—' }}</td>
          <td class="col-reg">{{ row.registration || '—' }}</td>
          <td class="col-type">{{ row.aircraft_type || '—' }}</td>
          <td class="col-aln">{{ row.airline || '—' }}</td>
          <td class="col-route">
            <template v-if="row.origin || row.destination">{{ row.origin || '???' }} → {{ row.destination || '???' }}</template>
            <template v-else>—</template>
          </td>
          <td class="col-pts">{{ row.point_count.toLocaleString() }}</td>
          <td class="col-time">{{ fmtTime(row) }}</td>
          <td class="col-act">
            <button class="act-btn" title="删除此航迹" @click.stop="$emit('deleteTrack', row)"><Trash2 :size="12" /></button>
          </td>
        </tr>
      </tbody>
    </table>

    <Teleport to="body">
      <div v-if="ctx.visible" class="context-menu" :style="{ position: 'fixed', top: ctx.y + 'px', left: ctx.x + 'px', zIndex: 100 }" @click.stop>
        <button class="ctx-item" @click="ctxAct('view-points')" title="查看此航迹的详细点数据"><ClipboardList :size="13" /> 查看点迹数据</button>
        <button class="ctx-item danger" @click="ctxAct('delete')" title="删除此航迹"><Trash2 :size="13" /> 删除该航迹</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { TrackMetaInfo } from '../../../types/manage'
import { useTrackHighlight } from '../../../composables/useTrackHighlight'
import { Eye, Circle, Trash2, ClipboardList } from '@lucide/vue'

const { isHighlighted, highlightedIcaos } = useTrackHighlight()

defineProps<{
  rows: TrackMetaInfo[]
  loading: boolean
  totalCount: number
  sortIndicator: (_: string) => string
  isVisible: (_icao: string, _bid: number) => boolean
}>()

const emit = defineEmits<{
  setSort: [col: string]
  toggleVisible: [row: TrackMetaInfo]
  deleteTrack: [row: TrackMetaInfo]
  viewPointData: [row: TrackMetaInfo]
}>()

function srcLabel(s: string): string {
  if (s === 'ADS-B') return 'ADS-B'
  if (s === 'Radar') return '雷达'
  if (s === 'RadarRaw') return '原始'
  return s
}
function srcClass(s: string): string {
  if (s === 'ADS-B') return 'dot-adsb'
  if (s === 'Radar') return 'dot-radar'
  if (s === 'RadarRaw') return 'dot-raw'
  return ''
}
function fmtTime(r: TrackMetaInfo): string {
  if (!r.min_timestamp && !r.max_timestamp) return '—'
  const f = (t: string) => t.length >= 16 ? t.substring(5, 16) : t
  return `${f(r.min_timestamp)} ~ ${f(r.max_timestamp)}`
}

const ctx = reactive({ visible: false, x: 0, y: 0, row: null as TrackMetaInfo | null })
function onCtx(e: MouseEvent, row: TrackMetaInfo) {
  ctx.visible = true; ctx.x = e.clientX; ctx.y = e.clientY; ctx.row = row
}
function closeCtx() { ctx.visible = false; ctx.row = null }
function ctxAct(action: string) {
  if (!ctx.row) { closeCtx(); return }
  if (action === 'delete') {
    emit('deleteTrack', ctx.row)
  } else if (action === 'view-points') {
    emit('viewPointData', ctx.row)
  }
  closeCtx()
}

// Scroll to first highlighted row when highlights change, with flash animation
watch(highlightedIcaos, async (newVal, oldVal) => {
  await nextTick()
  const highlightedRow = document.querySelector<HTMLElement>('.data-row.highlighted')
  if (highlightedRow) {
    highlightedRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const prev = oldVal ?? new Set<string>()
  const added = [...newVal].filter(icao => !prev.has(icao))
  if (added.length > 0) {
    const rows = document.querySelectorAll<HTMLElement>('.data-row.highlighted')
    rows.forEach(row => {
      const icao = row.dataset.icao
      if (icao && added.includes(icao)) {
        row.classList.add('just-highlighted')
        setTimeout(() => row.classList.remove('just-highlighted'), 800)
      }
    })
  }
}, { deep: true })

onMounted(() => window.addEventListener('click', closeCtx))
onUnmounted(() => window.removeEventListener('click', closeCtx))
</script>

<style scoped>
.table-container { flex: 1; overflow-y: auto; min-height: 0; }
.table-loading { padding: 8px; }
.skeleton-row { height: 22px; margin-bottom: 4px; background: var(--bg-tertiary); border-radius: 3px; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
.table-empty { padding: 24px 8px; text-align: center; color: var(--text-tertiary); font-size: 0.786rem; }

.data-table { width: 100%; border-collapse: collapse; }
.data-table thead { position: sticky; top: 0; z-index: 2; background: var(--bg-secondary); }
.data-table th {
  padding: 3px 4px; font-size: 0.643rem; font-weight: 600;
  color: var(--text-tertiary); text-align: left; white-space: nowrap;
  user-select: none; border-bottom: 1px solid var(--border-secondary);
}
.data-table th.sortable { cursor: pointer; }
.data-table th.sortable:hover { color: var(--text-primary); }

.col-eye { width: 28px; min-width: 28px; text-align: center; color: var(--text-tertiary); }
.col-src { width: 52px; min-width: 52px; }
.col-icao { width: 74px; min-width: 74px; }
.col-flt { min-width: 68px; }
.col-reg { min-width: 64px; }
.col-type { min-width: 52px; }
.col-aln { min-width: 48px; }
.col-route { min-width: 100px; }
.col-pts { width: 56px; min-width: 56px; text-align: right; }
.col-time { min-width: 150px; }
.col-act { width: 28px; min-width: 28px; text-align: center; }

.data-row { cursor: default; }
.data-row:nth-child(even) { background: var(--bg-tertiary); }
.data-row:hover { background: var(--button-hover); }
.data-row.visible { background: rgba(0,122,204,0.12); }
.data-row.visible:nth-child(even) { background: rgba(0,122,204,0.16); }
.data-row.highlighted { background: rgba(255,200,0,0.15); outline: 1px solid rgba(255,200,0,0.4); }
.data-row.just-highlighted {
  animation: highlight-flash 0.8s ease-out;
}
@keyframes highlight-flash {
  0%   { background: rgba(255,220,60,0.5); }
  100% { background: rgba(255,200,0,0.15); }
}
.data-row td {
  padding: 2px 4px; font-size: 0.714rem; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-bottom: none;
}
.col-icao { font-family: 'Consolas', monospace; }
.col-flt { font-weight: 600; }
.col-pts { font-variant-numeric: tabular-nums; }
.col-time { white-space: nowrap; }

.src-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot-adsb { background: var(--source-adsb); }
.dot-radar { background: var(--source-radar); }
.dot-raw { background: var(--source-radar_raw); }

.eye-icon { cursor: pointer; opacity: 0.4; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); }
.eye-icon.on { opacity: 1; color: var(--accent-primary); }
.eye-icon:hover { opacity: 1; }

.act-btn {
  padding: 0 2px; background: transparent;
  border: none; color: var(--text-tertiary); cursor: pointer; opacity: 0;
}
.data-row:hover .act-btn { opacity: 1; }
.act-btn:hover { color: var(--error); }

.context-menu {
  background: var(--bg-primary); border: 1px solid var(--border-secondary);
  border-radius: 4px; padding: 2px 0; min-width: 130px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
}
.ctx-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 10px; font-size: 0.714rem; text-align: left; background: transparent; border: none; color: var(--text-primary); cursor: pointer; }
.ctx-item:hover { background: var(--button-hover); }
.ctx-item.danger { color: var(--error); }
</style>
