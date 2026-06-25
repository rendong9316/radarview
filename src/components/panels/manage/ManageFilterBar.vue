<template>
  <div class="filter-bar">
    <!-- Row 1: Search + Source -->
    <div class="filter-row">
      <input
        class="search-input"
        type="text"
        placeholder="搜索 ICAO / 航班号 / 注册号 / 机型 / 航司 / 起降地..." title="输入关键字模糊搜索航迹"
        :value="filter.searchText ?? ''"
        @input="onSearchInput"
      />
      <button v-if="filter.searchText" class="clear-search-btn" @click="clearSearch" title="清除搜索内容"><X :size="13" /></button>
      <select class="filter-select source-select" title="按数据来源或文件筛选" :value="sourceSelectValue" @change="onSourceChange">
        <option value="">全部来源</option>
        <template v-for="opt in sourceOptions" :key="opt.value">
          <option :value="opt.value" :style="opt.indent ? 'padding-left: 14px' : ''">{{ opt.label }}</option>
        </template>
      </select>
    </div>

    <!-- Row 2: Dropdown filters -->
    <div class="filter-row">
      <select class="filter-select" :value="filter.airline ?? ''" @change="setFilter({ airline: v($event) })">
        <option value="">全部航司</option>
        <option v-for="a in distinctOptions?.airlines ?? []" :key="a" :value="a">{{ a }}</option>
      </select>
      <select class="filter-select" :value="filter.aircraftType ?? ''" @change="setFilter({ aircraftType: v($event) })">
        <option value="">全部机型</option>
        <option v-for="t in distinctOptions?.aircraft_types ?? []" :key="t" :value="t">{{ t }}</option>
      </select>
      <select class="filter-select" :value="filter.batchId ?? ''" @change="setFilter({ batchId: vNum($event) })">
        <option value="">全部批次</option>
        <option v-for="[id, name] in distinctOptions?.batch_names ?? []" :key="id" :value="id">{{ name }}</option>
      </select>
    </div>

    <!-- Row 3: Point count + presets -->
    <div class="filter-row">
      <label class="flabel">点数:</label>
      <input class="fnum" type="number" placeholder="≥" title="最小航迹点数" min="0" :value="filter.minPoints ?? ''"
        @change="setFilter({ minPoints: vNum($event) })" />
      <span class="fsep">~</span>
      <input class="fnum" type="number" placeholder="≤" title="最大航迹点数" min="0" :value="filter.maxPoints ?? ''"
        @change="setFilter({ maxPoints: vNum($event) })" />
      <span class="fgap" />
      <button class="pbtn" @click="preset24h" title="筛选最近24小时内的航迹"><Clock :size="11" /> 24h内</button>
      <button class="pbtn" @click="presetHighData" title="筛选点数不少于100的航迹"><BarChart3 :size="11" /> ≥100点</button>
      <button class="pbtn reset" @click="clearFilters" title="清除所有筛选条件"><RotateCcw :size="11" /> 重置全部</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useTrackManagement } from '../../../composables/useTrackManagement'
import { getFileLabel, setBatchOrder } from '../../../composables/useFileLabels'
import { X, Clock, BarChart3, RotateCcw } from '@lucide/vue'

const {
  filter, distinctOptions, setFilter, setSearchText, applySearch, clearFilters,
} = useTrackManagement()

interface BatchInfo { id: number; file_name: string; source: string; track_count: number; imported_at: string }
const batches = ref<BatchInfo[]>([])

onMounted(async () => {
  try {
    batches.value = await invoke<BatchInfo[]>('get_batches_cmd')
    setBatchOrder(batches.value)
  } catch { /* ignore */ }
})

/** DB source value → display label */
const DB_SOURCE_LABELS: Record<string, string> = { 'ADS-B': 'ADS-B', 'Radar': 'Radar', 'RadarRaw': 'Raw' }
/** DB source value → frontend filter key */
const DB_SOURCE_TO_FLT: Record<string, string> = { 'ADS-B': 'adsb', 'Radar': 'radar', 'RadarRaw': 'radar_raw' }

interface SourceOption { value: string; label: string; indent?: boolean }

const sourceOptions = computed<SourceOption[]>(() => {
  const opts: SourceOption[] = []
  const bySource = new Map<string, BatchInfo[]>()
  for (const b of batches.value) {
    // b.source is the DB value (e.g. "ADS-B", "Radar", "RadarRaw")
    const filterKey = DB_SOURCE_TO_FLT[b.source] || b.source
    if (!bySource.has(filterKey)) bySource.set(filterKey, [])
    bySource.get(filterKey)!.push(b)
  }
  for (const [filterKey, srcBatches] of bySource) {
    const label = DB_SOURCE_LABELS[srcBatches[0].source] || filterKey
    if (srcBatches.length === 1) {
      opts.push({ value: filterKey, label })
    } else {
      opts.push({ value: filterKey, label: `${label}（全部）` })
      for (const b of srcBatches) {
        opts.push({ value: `${filterKey}::${b.id}`, label: `· ${getFileLabel(filterKey as any, b.file_name)}`, indent: true })
      }
    }
  }
  return opts
})

/** Current composite value shown in the source select */
const sourceSelectValue = computed(() => {
  const s = filter.value.source ?? ''
  const bid = filter.value.batchId
  if (s && bid != null) return `${s}::${bid}`
  return s
})

function v(e: Event): string | undefined {
  const val = (e.target as HTMLSelectElement).value
  return val || undefined
}
function vNum(e: Event): number | undefined {
  const val = (e.target as HTMLInputElement).value
  return val ? Number(val) : undefined
}

function onSourceChange(e: Event) {
  const raw = (e.target as HTMLSelectElement).value
  if (!raw) { setFilter({ source: undefined, batchId: undefined }); return }
  const sepIdx = raw.indexOf('::')
  if (sepIdx > 0) {
    const src = raw.substring(0, sepIdx)
    const bid = parseInt(raw.substring(sepIdx + 2), 10)
    setFilter({ source: src as any, batchId: isNaN(bid) ? undefined : bid })
  } else {
    setFilter({ source: raw as any, batchId: undefined })
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
function onSearchInput(e: Event) {
  setSearchText((e.target as HTMLInputElement).value)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => applySearch(), 300)
}
function clearSearch() { setSearchText(''); applySearch() }

function preset24h() {
  setFilter({ minTimeMs: Date.now() - 24 * 3600 * 1000, maxTimeMs: Date.now() })
}
function presetHighData() { setFilter({ minPoints: 100 }) }
</script>

<style scoped>
.filter-bar { padding: 4px 8px; border-bottom: 1px solid var(--border-secondary); display: flex; flex-direction: column; gap: 3px; flex-shrink: 0; }
.filter-row { display: flex; align-items: center; gap: 4px; }
.search-input {
  flex: 1; padding: 3px 6px; font-size: 0.714rem;
  background: var(--bg-secondary); border: 1px solid var(--border-secondary);
  border-radius: 3px; color: var(--text-primary); outline: none;
}
.search-input:focus { border-color: var(--accent-primary); }
.search-input::placeholder { color: var(--text-tertiary); }
.clear-search-btn { padding: 1px 4px; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; display: flex; align-items: center; }

.filter-select {
  flex: 1; min-width: 0; padding: 2px 3px; font-size: 0.643rem;
  background: var(--bg-secondary); border: 1px solid var(--border-secondary);
  border-radius: 3px; color: var(--text-primary); outline: none;
}
.source-select { flex: 0 0 90px; }

.flabel { font-size: 0.643rem; color: var(--text-tertiary); white-space: nowrap; }
.fnum { width: 52px; padding: 2px 3px; font-size: 0.643rem; background: var(--bg-secondary); border: 1px solid var(--border-secondary); border-radius: 3px; color: var(--text-primary); outline: none; }
.fsep { font-size: 0.643rem; color: var(--text-tertiary); }
.fgap { flex: 1; }

.pbtn {
  display: flex; align-items: center; gap: 3px;
  font-size: 0.571rem; padding: 1px 5px;
  border: 1px solid var(--border-secondary); border-radius: 3px;
  background: var(--button-secondary); color: var(--text-secondary); cursor: pointer;
}
.pbtn:hover { background: var(--button-hover); color: var(--text-primary); }
.pbtn.reset { color: var(--semantic-warning, #e8a040); }
</style>
