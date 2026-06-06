import { ref, watch } from 'vue'

export type PanelId = 'tracks' | 'layers' | 'flags' | 'timeFilter' | 'manage' | 'settings'

const activePanel = ref<PanelId | null>(null)
const sidebarVisible = ref(false)
const sidebarWidth = ref(280)

export function useActivityBar() {
  function activate(panel: PanelId): void {
    if (activePanel.value === panel && sidebarVisible.value) {
      // Toggle off
      sidebarVisible.value = false
      activePanel.value = null
    } else {
      activePanel.value = panel
      sidebarVisible.value = true
    }
  }

  function close(): void {
    sidebarVisible.value = false
    activePanel.value = null
  }

  function isActive(panel: PanelId): boolean {
    return activePanel.value === panel && sidebarVisible.value
  }

  // ── Persist sidebar state ──
  watch(sidebarVisible, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('sidebar.visible', JSON.stringify(v))
    })
  }, { immediate: false })

  watch(activePanel, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('sidebar.active_panel', JSON.stringify(v))
    })
  }, { immediate: false })

  watch(sidebarWidth, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('sidebar.width', JSON.stringify(v))
    })
  }, { immediate: false })

  return {
    activePanel,
    sidebarVisible,
    sidebarWidth,
    activate,
    close,
    isActive,
  }
}
