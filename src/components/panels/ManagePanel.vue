<template>
  <div class="manage-panel">
    <!-- Stats bar -->
    <div class="manage-stats-bar">
      <span v-if="statsLoading"><Loader :size="12" class="spin" /> 加载中...</span>
      <template v-else-if="stats">
        <span class="stat-item"><BarChart3 :size="12" /> 总计 <strong>{{ stats.total_tracks }}</strong> 条</span>
        <span class="stat-sep">|</span>
        <span class="stat-item" v-for="(c, s) in stats.by_source" :key="s">{{ sourceLabel(s) }} <strong>{{ c }}</strong></span>
        <span class="stat-sep">|</span>
        <span class="stat-item"><Hash :size="11" /> {{ stats.unique_icao }} ICAO</span>
        <span class="stat-sep">|</span>
        <span class="stat-item"><Clock :size="11" /> {{ formatTimeRange }}</span>
        <span class="stat-sep">|</span>
        <span class="stat-item"><Package :size="11" /> {{ stats.total_batches }} 批次</span>
      </template>
      <span v-else class="stat-item">暂无数据，请先导入航迹</span>
      <div class="stat-right">
        <span>地图可见 <strong>{{ totalVisibleCount }}</strong> 条</span>
        <button v-if="totalVisibleCount > 0" class="btn-mini" @click="clearVisibleSet">清空</button>
      </div>
    </div>

    <!-- Filters -->
    <ManageFilterBar />

    <!-- Toolbar -->
    <div class="toolbar">
      <span class="toolbar-info">匹配 {{ totalCount }} 条 · 本页 {{ rows.length }} 条 · 地图可见 {{ visibleOnPage }} 条</span>
      <div class="toolbar-actions">
        <button v-if="highlightedIcaos.size > 0" class="tb-btn highlight-clear" @click="clearAllHighlights">
          <Sparkles :size="11" /> 取消高亮
        </button>
        <button class="tb-btn" @click="showAllOnPage"><Eye :size="11" /> 本页全显</button>
        <button class="tb-btn" @click="clearVisibleSet">清空地图</button>
        <button class="tb-btn danger" @click="deleteVisibleTracks"><Trash2 :size="11" /> 删可见</button>
        <button class="tb-btn" @click="exportVisibleTracks"><Download :size="11" /> 导出</button>
        <button class="tb-btn" @click="refresh"><RefreshCw :size="11" /> 刷新</button>
      </div>
    </div>

    <!-- Confirm dialog for delete -->
    <ConfirmDialog />

    <!-- Undo toast for soft-delete -->
    <UndoToast
      :top="undoStackTop"
      :count="undoStackCount"
      @undo="handleUndo"
    />

    <!-- Table -->
    <ManageDataTable
      :rows="rows"
      :loading="loading"
      :total-count="totalCount"
      :sort-indicator="sortIndicator"
      :is-visible="isVisible"
      @set-sort="setSort"
      @toggle-visible="toggleVisible"
      @delete-track="deleteTrack"
      @view-point-data="onViewPointData"
    />

    <!-- Pagination -->
    <ManagePagination
      :page="currentPage"
      :page-size="pageSize"
      :total="totalCount"
      @set-page="setPage"
      @set-page-size="setPageSize"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useTrackManagement } from '../../composables/useTrackManagement'
import { useTrackHighlight } from '../../composables/useTrackHighlight'
import ManageFilterBar from './manage/ManageFilterBar.vue'
import ManageDataTable from './manage/ManageDataTable.vue'
import ManagePagination from './manage/ManagePagination.vue'
import ConfirmDialog from '../dialogs/ConfirmDialog.vue'
import UndoToast from './manage/UndoToast.vue'
import { useUndoStack } from '../../composables/useUndoStack'
import { loadAndOpenViewer } from '../../composables/useTrackPointViewer'
import type { TrackMetaInfo } from '../../types/manage'
import { BarChart3, Hash, Clock, Package, Eye, Trash2, Download, RefreshCw, Sparkles, Loader } from '@lucide/vue'

const undoStack = useUndoStack()

const {
  stats, statsLoading, totalCount,
  rows, loading, currentPage, pageSize,
  totalVisibleCount, visibleOnPage,
  sortIndicator, isVisible,
  loadAll, fetchStats, fetchMetadata,
  setSort, setPage, setPageSize,
  toggleVisible, showAllOnPage, clearVisibleSet,
  deleteTrack, deleteVisibleTracks, undoDelete, exportVisibleTracks,
} = useTrackManagement()

const { highlightedIcaos, clearAllHighlights } = useTrackHighlight()

const undoStackTop = computed(() => undoStack.top.value)
const undoStackCount = computed(() => undoStack.count.value)

function sourceLabel(s: string): string {
  if (s === 'ADS-B') return 'ADS-B'
  if (s === 'Radar') return '雷达'
  if (s === 'RadarRaw') return '原始'
  return s
}

const formatTimeRange = computed(() => {
  const s = stats.value; if (!s) return '—'
  if (s.time_min_ms == null || s.time_max_ms == null) return '—'
  const f = (ms: number) => new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  return `${f(s.time_min_ms)} ~ ${f(s.time_max_ms)}`
})

function refresh() { fetchStats(); fetchMetadata() }

async function handleUndo() {
  await undoDelete()
}

function onViewPointData(row: TrackMetaInfo) {
  loadAndOpenViewer(row.icao_address, row.batch_id)
}

onMounted(() => { loadAll() })
</script>

<style scoped>
.manage-panel { display: flex; flex-direction: column; height: 100%; font-size: 0.786rem; }

.manage-stats-bar {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-secondary);
  font-size: 0.643rem;
  color: var(--text-secondary);
  display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
  flex-shrink: 0;
}
.stat-item { white-space: nowrap; display: flex; align-items: center; gap: 3px; }
.stat-item strong { color: var(--text-primary); }
.stat-sep { color: var(--text-tertiary); margin: 0 3px; }
.stat-right { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.btn-mini { font-size: 0.571rem; padding: 0 4px; border: 1px solid var(--border-secondary); border-radius: 2px;
  background: var(--button-secondary); color: var(--text-secondary); cursor: pointer; }
.btn-mini:hover { background: var(--button-hover); color: var(--text-primary); }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 8px; font-size: 0.643rem; color: var(--text-secondary);
  border-bottom: 1px solid var(--border-secondary); flex-shrink: 0;
}
.toolbar-info { white-space: nowrap; }
.toolbar-actions { display: flex; gap: 3px; }
.tb-btn {
  display: flex; align-items: center; gap: 3px;
  font-size: 0.643rem; padding: 1px 5px;
  border: 1px solid var(--border-secondary); border-radius: 3px;
  background: var(--button-secondary); color: var(--text-secondary); cursor: pointer;
}
.tb-btn:hover { background: var(--button-hover); color: var(--text-primary); }
.tb-btn.danger { color: var(--error); }
.tb-btn.danger:hover { background: rgba(220, 50, 50, 0.15); }
.tb-btn.highlight-clear { color: #e8a020; border-color: rgba(232,160,32,0.4); }
.tb-btn.highlight-clear:hover { background: rgba(232,160,32,0.1); color: #f0c040; }
</style>
