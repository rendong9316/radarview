import { invoke } from '@tauri-apps/api/core'
import type { Ref } from 'vue'
import type { DataSource } from '../types/track'

// ── Debounced save infrastructure ──

const pending = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
let _loaded = false
let _loadedResolve: (() => void) | null = null
const _loadedPromise = new Promise<void>((resolve) => { _loadedResolve = resolve })

/** Resolves when settings have been loaded and applied. Safe to call any time. */
export function whenSettingsLoaded(): Promise<void> {
  return _loadedPromise
}

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
  _loadedResolve?.()
}

/** Get a raw setting value by key (for one-off reads like replay speed). */
export function getRawSetting(key: string): string | undefined {
  return _raw[key]
}

async function applySettings(raw: Record<string, string>) {
  // ── Theme (must be applied BEFORE any UI renders) ──
  const { initTheme } = await import('./useTheme')
  const themeIdRaw = raw['theme.id']
  let savedThemeId: string | undefined
  if (themeIdRaw !== undefined) {
    try { savedThemeId = JSON.parse(themeIdRaw) } catch { /* keep default */ }
  }
  initTheme(savedThemeId)

  // ── Display settings ──
  const { useLineWidth } = await import('./useLineWidth')
  const { useDotScale } = await import('./useDotScale')
  const { useLayerVisibility } = await import('./useLayerVisibility')
  const { useLabelVisibility } = await import('./useLabelVisibility')
  const { useBoundaryLayers } = await import('./useBoundaryLayers')

  const lw = useLineWidth()
  const ds = useDotScale()
  const lv = useLayerVisibility()
  const lbl = useLabelVisibility()
  const bl = useBoundaryLayers()

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
  // Per-layer boundary visibility (migrated from single boolean in v1)
  if (raw['display.boundary_visible'] !== undefined) {
    // Old single-boolean format — apply to all three layers as migration
    try {
      const v = JSON.parse(raw['display.boundary_visible'])
      if (typeof v === 'boolean') {
        bl.boundaryVisible.coastline = v
        bl.boundaryVisible.admin0 = v
        bl.boundaryVisible.admin1 = v
      }
    } catch { /* keep default */ }
  }
  for (const layer of ['coastline', 'admin0', 'admin1'] as const) {
    const key = `display.boundary_visible.${layer}`
    if (raw[key] !== undefined) {
      try { bl.boundaryVisible[layer] = JSON.parse(raw[key]) } catch { /* keep default */ }
    }
  }
  for (const layer of ['coastline', 'admin0', 'admin1'] as const) {
    const key = `display.boundary_width.${layer}`
    if (raw[key] !== undefined) {
      try { bl.boundaryWidths[layer] = JSON.parse(raw[key]) } catch { /* keep default */ }
    }
  }
  for (const layer of ['coastline', 'admin0', 'admin1'] as const) {
    const key = `display.boundary_color.${layer}`
    if (raw[key] !== undefined) {
      try { bl.boundaryColors[layer] = JSON.parse(raw[key]) } catch { /* keep default */ }
    }
  }

  // ── Flag scale ──
  const { useFlagScale } = await import('./useFlagScale')
  const fs = useFlagScale()
  if (raw['display.flag_scale'] !== undefined) {
    try { fs.flagScale.value = JSON.parse(raw['display.flag_scale']) } catch { /* keep default */ }
  }

  // ── Track point dot settings ──
  const { useTrackPointDots } = await import('./useTrackPointDots')
  const tpds = useTrackPointDots()
  if (raw['display.track_point_dot_scale'] !== undefined) {
    try { tpds.trackPointDotScale.value = JSON.parse(raw['display.track_point_dot_scale']) } catch { /* keep default */ }
  }
  if (raw['display.show_all_point_dots'] !== undefined) {
    try { tpds.showAllPointDots.value = JSON.parse(raw['display.show_all_point_dots']) } catch { /* keep default */ }
  }
  for (const src of ['adsb', 'radar', 'radar_raw', 'simulation'] as DataSource[]) {
    const key = `display.point_dot_color.${src}`
    if (raw[key] !== undefined) {
      try { tpds.pointDotColors[src] = JSON.parse(raw[key]) } catch { /* keep default */ }
    }
  }

  // ── Font size ──
  const { useFontSize } = await import('./useFontSize')
  const fns = useFontSize()
  if (raw['display.font_size'] !== undefined) {
    try { fns.fontSize.value = JSON.parse(raw['display.font_size']) } catch { /* keep default */ }
  }

  // ── Line colors ──
  const { useLineColor } = await import('./useLineColor')
  const lc = useLineColor()
  for (const src of ['adsb', 'radar', 'radar_raw', 'simulation'] as DataSource[]) {
    const lcKey = `display.line_color.${src}`
    if (raw[lcKey] !== undefined) {
      try { lc.lineColors[src] = JSON.parse(raw[lcKey]) } catch { /* keep default */ }
    }
  }

  // ── Tile source ──
  const tsModule = await import('./useTileSource')
  const ts = tsModule.useTileSource()
  if (raw['tile.source'] !== undefined) {
    try { ts.activeSource.value = JSON.parse(raw['tile.source']) } catch { /* keep default */ }
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

  // Sidebar: load per-panel widths FIRST (so panelWidths is populated
  // before activePanel watcher reads from it)
  const { useActivityBar } = await import('./useActivityBar')
  const ab = useActivityBar()
  const panelIds = ['tracks', 'manage', 'layers', 'flags', 'timeFilter', 'settings'] as const
  for (const pid of panelIds) {
    const key = `sidebar.width.${pid}`
    if (raw[key] !== undefined) {
      try { ab.setPanelWidth(pid, JSON.parse(raw[key])) } catch { /* keep default */ }
    }
  }

  // Sidebar visibility (harmless, no width dependency)
  if (raw['sidebar.visible'] !== undefined) {
    try { ab.sidebarVisible.value = JSON.parse(raw['sidebar.visible']) } catch { /* keep default */ }
  }

  // Sidebar active panel -- MUST be last so panelWidths is already seeded
  if (raw['sidebar.active_panel'] !== undefined) {
    try { ab.activePanel.value = JSON.parse(raw['sidebar.active_panel']) } catch { /* keep default */ }
  }

  // ── Manage panel: filter, sort, pageSize ──
  try {
    const manageModule = await import('./useTrackManagement')
    // Load filter
    if (raw['manage.filter'] !== undefined) {
      try {
        const parsed = JSON.parse(raw['manage.filter'])
        if (parsed && typeof parsed === 'object') {
          manageModule.filter.value = { ...manageModule.filter.value, ...parsed }
        }
      } catch { /* keep default */ }
    }
    // Load sort
    if (raw['manage.sort'] !== undefined) {
      try {
        const parsed = JSON.parse(raw['manage.sort'])
        if (parsed && typeof parsed === 'object' && parsed.column) {
          manageModule.sortConfig.value = parsed
        }
      } catch { /* keep default */ }
    }
    // Load page size
    if (raw['manage.page_size'] !== undefined) {
      try {
        const v = JSON.parse(raw['manage.page_size'])
        if (typeof v === 'number' && v > 0) manageModule.pageSize.value = v
      } catch { /* keep default */ }
    }
    // Enable persistence watchers after loading
    manageModule.enableManagePersistence()

    // Stage visible keys for restoration after track data is loaded
    if (raw['manage.visible_keys'] !== undefined) {
      try {
        const parsed = JSON.parse(raw['manage.visible_keys'])
        if (Array.isArray(parsed) && parsed.length > 0) {
          manageModule.setPendingRestoreKeys(parsed)
        }
      } catch { /* keep default */ }
    }

    // Stage deleted (soft-deleted) keys for filtering after track data is loaded
    if (raw['manage.deleted_keys'] !== undefined) {
      try {
        const parsed = JSON.parse(raw['manage.deleted_keys'])
        if (Array.isArray(parsed)) {
          manageModule.setPendingDeletedKeys(parsed)
        }
      } catch { /* keep default */ }
    }
  } catch { /* manage module not loaded yet, fine */ }
}
