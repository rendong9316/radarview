<template>
  <div class="filter-bar">
    <!-- Row 1: Search + Source -->
    <div class="filter-row">
      <input
        class="search-input"
        type="text"
        placeholder="搜索 ICAO / 航班号 / 注册号 / 机型 / 航司 / 起降地..."
        :value="filter.searchText ?? ''"
        @input="onSearchInput"
      />
      <button v-if="filter.searchText" class="clear-search-btn" @click="clearSearch">✕</button>
      <select class="filter-select source-select" :value="filter.source ?? ''" @change="onSourceChange">
        <option value="">全部来源</option>
        <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
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
      <input class="fnum" type="number" placeholder="≥" min="0" :value="filter.minPoints ?? ''"
        @change="setFilter({ minPoints: vNum($event) })" />
      <span class="fsep">~</span>
      <input class="fnum" type="number" placeholder="≤" min="0" :value="filter.maxPoints ?? ''"
        @change="setFilter({ maxPoints: vNum($event) })" />
      <span class="fgap" />
      <button class="pbtn" @click="preset24h">🕐 24h内</button>
      <button class="pbtn" @click="presetHighData">📋 ≥100点</button>
      <button class="pbtn reset" @click="clearFilters">🔄 重置全部</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTrackManagement } from '../../../composables/useTrackManagement'
import { SOURCE_OPTIONS } from '../../../types/manage'

const {
  filter, distinctOptions, setFilter, setSearchText, applySearch, clearFilters,
} = useTrackManagement()

function v(e: Event): string | undefined {
  const val = (e.target as HTMLSelectElement).value
  return val || undefined
}
function vNum(e: Event): number | undefined {
  const val = (e.target as HTMLInputElement).value
  return val ? Number(val) : undefined
}

function onSourceChange(e: Event) {
  setFilter({ source: ((e.target as HTMLSelectElement).value || undefined) as any })
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
.clear-search-btn { padding: 1px 5px; font-size: 0.714rem; background: transparent; border: none; color: var(--text-tertiary); cursor: pointer; }

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
  font-size: 0.571rem; padding: 1px 5px;
  border: 1px solid var(--border-secondary); border-radius: 3px;
  background: var(--button-secondary); color: var(--text-secondary); cursor: pointer;
}
.pbtn:hover { background: var(--button-hover); color: var(--text-primary); }
.pbtn.reset { color: var(--semantic-warning, #e8a040); }
</style>
