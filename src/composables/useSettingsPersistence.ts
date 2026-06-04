import { invoke } from '@tauri-apps/api/core'
import type { Ref } from 'vue'
import type { DataSource } from '../types/track'

// ── Debounced save infrastructure ──

const pending = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
let _loaded = false

const DEBOUNCE_MS = 300

/**
 * Schedule a setting key→value pair for persistence.
 * Accumulates changes and flushes after 300ms of inactivity.
 * Silently drops saves until markSettingsLoaded() is called.
 */
export function scheduleSave(key: string, value: string) {
  if (!_loaded) return
  pending.set(key, value)
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flushSaves, DEBOUNCE_MS)
}

/** Immediately flush all pending saves via Tauri invoke. */
export async function flushSaves() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (pending.size === 0) return

  const entries = Array.from(pending.entries())
  pending.clear()

  for (const [key, value] of entries) {
    try {
      await invoke('save_setting', { key, value })
    } catch (e) {
      console.error(`[settings] save '${key}' failed:`, e)
    }
  }
}

// ── Load & apply ──

/** Cached raw settings from the last load. */
let _raw: Record<string, string> = {}

/**
 * Load all persisted settings from the backend and apply them
 * to the corresponding composable state refs.
 *
 * Must be called early in App.vue onMounted(), before any
 * state-dependent operations.
 */
export async function loadAllSettings() {
  try {
    _raw = (await invoke('load_all_settings')) as Record<string, string>
    if (typeof _raw !== 'object' || _raw === null) {
      _raw = {}
      return
    }
  } catch (e) {
    console.error('[settings] load_all_settings failed:', e)
    _raw = {}
    return
  }

  await applySettings(_raw)

  // Enable auto-save watchers now that initial values are set
  _loaded = true
}

/** Get a raw setting value by key (for one-off reads like replay speed). */
export function getRawSetting(key: string): string | undefined {
  return _raw[key]
}

async function applySettings(raw: Record<string, string>) {
  // ── Display settings ──
  const { useLineWidth } = await import('./useLineWidth')
  const { useDotScale } = await import('./useDotScale')
  const { useLayerVisibility } = await import('./useLayerVisibility')
  const { useLabelVisibility } = await import('./useLabelVisibility')

  const lw = useLineWidth()
  const ds = useDotScale()
  const lv = useLayerVisibility()
  const lbl = useLabelVisibility()

  for (const src of ['adsb', 'radar', 'radar_raw', 'simulation'] as DataSource[]) {
    const lwKey = `display.line_width.${src}`
    if (raw[lwKey] !== undefined) {
      try { lw.lineWidths[src] = JSON.parse(raw[lwKey]) } catch { /* keep default */ }
    }
    const dsKey = `display.dot_scale.${src}`
    if (raw[dsKey] !== undefined) {
      try { ds.dotScale[src] = JSON.parse(raw[dsKey]) } catch { /* keep default */ }
    }
    const visKey = `display.layer_visible.${src}`
    if (raw[visKey] !== undefined) {
      try { lv.visibility.value[src] = JSON.parse(raw[visKey]) } catch { /* keep default */ }
    }
  }

  if (raw['display.show_labels'] !== undefined) {
    try { lbl.showLabels.value = JSON.parse(raw['display.show_labels']) } catch { /* keep default */ }
  }

  // ── Flags ──
  const { useFlags } = await import('./useFlags')
  const fl = useFlags()
  if (raw['flags.data'] !== undefined) {
    try {
      const data = JSON.parse(raw['flags.data'])
      if (Array.isArray(data.flags)) fl.flags.value = data.flags
      if (Array.isArray(data.selectedFlagIds)) fl.selectedFlagIds.value = data.selectedFlagIds
    } catch { /* keep default */ }
  }

  // ── Track selection ──
  const { useTracks } = await import('./useTracks')
  const tr = useTracks()
  if (raw['track.selected_id'] !== undefined) {
    try { tr.selectedId.value = JSON.parse(raw['track.selected_id']) } catch { /* keep default */ }
  }
  if (raw['track.isolated_id'] !== undefined) {
    try { tr.isolatedTrackId.value = JSON.parse(raw['track.isolated_id']) } catch { /* keep default */ }
  }

  // ── Filter settings ──
  const { useTrackFilter } = await import('./useTrackFilter')
  const tf = useTrackFilter()
  if (raw['filter.active_min'] !== undefined) {
    try { tf.activeMin.value = JSON.parse(raw['filter.active_min']) } catch { /* keep default */ }
  }
  if (raw['filter.active_max'] !== undefined) {
    try { tf.activeMax.value = JSON.parse(raw['filter.active_max']) } catch { /* keep default */ }
  }
  tf.hasActiveFilter.value = tf.activeMin.value != null && tf.activeMax.value != null

  for (const src of ['adsb', 'radar', 'radar_raw', 'simulation'] as DataSource[]) {
    const key = `filter.point_count.${src}`
    if (raw[key] !== undefined) {
      try {
        const parsed = JSON.parse(raw[key])
        if (parsed && typeof parsed === 'object') {
          tf.pointCountFilters.value[src] = {
            enabled: parsed.enabled ?? false,
            min: parsed.min ?? null,
            max: parsed.max ?? null,
          }
        }
      } catch { /* keep default */ }
    }
  }

  // ── Panel states ──
  const { usePanelStates } = await import('./usePanelStates')
  const ps = usePanelStates()

  const panelKeys: Record<string, Ref<boolean>> = {
    'panel.import_collapsed': ps.importCollapsed,
    'panel.tools_collapsed': ps.toolsCollapsed,
    'panel.batch_open': ps.batchPanelOpen,
    'panel.flag_collapsed': ps.flagCollapsed,
    'panel.layer_collapsed': ps.layerCollapsed,
    'panel.point_filter_open': ps.pointFilterOpen,
    'panel.time_filter_collapsed': ps.timeFilterCollapsed,
    'panel.track_collapsed': ps.trackPanelCollapsed,
  }
  for (const [key, ref] of Object.entries(panelKeys)) {
    if (raw[key] !== undefined) {
      try { ref.value = JSON.parse(raw[key]) } catch { /* keep default */ }
    }
  }
}
