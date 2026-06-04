import { ref, watch } from 'vue'

/**
 * Module-level singleton refs for all collapsible panel states.
 * Extracted from component-local refs so they can be persisted
 * and restored across app restarts.
 */

const importCollapsed = ref(false)       // App.vue: sections.import
const toolsCollapsed = ref(true)         // App.vue: sections.tools
const batchPanelOpen = ref(false)        // App.vue: showBatchPanel
const flagCollapsed = ref(false)         // FlagPanel.vue: collapsed
const layerCollapsed = ref(false)        // LayerControl.vue: collapsed
const pointFilterOpen = ref(false)       // LayerControl.vue: showPointFilter
const timeFilterCollapsed = ref(false)   // TimeFilterPanel.vue: collapsed
const trackPanelCollapsed = ref(false)   // TrackPanel.vue: collapsed

// ── Persist panel states ──

const panelKeys: Record<string, ReturnType<typeof ref<boolean>>> = {
  'panel.import_collapsed': importCollapsed,
  'panel.tools_collapsed': toolsCollapsed,
  'panel.batch_open': batchPanelOpen,
  'panel.flag_collapsed': flagCollapsed,
  'panel.layer_collapsed': layerCollapsed,
  'panel.point_filter_open': pointFilterOpen,
  'panel.time_filter_collapsed': timeFilterCollapsed,
  'panel.track_collapsed': trackPanelCollapsed,
}

// One watcher per panel key
for (const [key, r] of Object.entries(panelKeys)) {
  watch(r, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave(key, JSON.stringify(v))
    })
  }, { immediate: false })
}

export function usePanelStates() {
  return {
    importCollapsed,
    toolsCollapsed,
    batchPanelOpen,
    flagCollapsed,
    layerCollapsed,
    pointFilterOpen,
    timeFilterCollapsed,
    trackPanelCollapsed,
  }
}
