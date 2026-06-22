import { reactive, ref, watch } from 'vue'

export type PanelId = 'tracks' | 'layers' | 'flags' | 'timeFilter' | 'manage' | 'settings'

const DEFAULT_WIDTH = 280

const activePanel = ref<PanelId | null>(null)
const sidebarVisible = ref(false)
const sidebarWidth = ref(DEFAULT_WIDTH)

// Per-panel width memory
const panelWidths = reactive<Record<PanelId, number>>({
  tracks: DEFAULT_WIDTH,
  manage: DEFAULT_WIDTH,
  layers: DEFAULT_WIDTH,
  flags: DEFAULT_WIDTH,
  timeFilter: DEFAULT_WIDTH,
  settings: DEFAULT_WIDTH,
})

let _watchersSetup = false

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

  /** Called by useSettingsPersistence to seed per-panel widths on startup. */
  function setPanelWidth(panelId: PanelId, width: number): void {
    panelWidths[panelId] = width
  }

  // ── Register watchers once (useActivityBar is called multiple times) ──
  if (!_watchersSetup) {
    _watchersSetup = true

    // Persist sidebar visibility
    watch(sidebarVisible, (v) => {
      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        scheduleSave('sidebar.visible', JSON.stringify(v))
      })
    }, { immediate: false })

    // Persist active panel + restore per-panel width
    watch(activePanel, (v, old) => {
      // Save old panel's width before switching
      if (old && panelWidths[old] !== undefined) {
        panelWidths[old] = sidebarWidth.value
      }
      // Restore new panel's width
      if (v) {
        sidebarWidth.value = panelWidths[v]
      }

      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        scheduleSave('sidebar.active_panel', JSON.stringify(v))
      })
    }, { immediate: false })

    // Persist per-panel sidebar width.
    // 不依赖 _restoringWidth flag（有竞态隐患），直接用值比较：
    // 切换面板时 sidebarWidth 被设为 panelWidths[v]，此时 v === panelWidths[v]
    // → 提前返回不保存；用户拖拽时 v !== panelWidths[panel] → 正常保存。
    watch(sidebarWidth, (v) => {
      const panel = activePanel.value
      if (!panel) return

      // 刚完成面板切换恢复宽度 → 值与缓存一致 → 跳过保存
      if (v === panelWidths[panel]) return

      // 用户拖拽改变了宽度 → 值与缓存不一致 → 同步内存 + 持久化
      panelWidths[panel] = v

      import('./useSettingsPersistence').then(({ scheduleSave }) => {
        scheduleSave(`sidebar.width.${panel}`, JSON.stringify(v))
      })
    }, { immediate: false })
  }

  return {
    activePanel,
    sidebarVisible,
    sidebarWidth,
    activate,
    close,
    isActive,
    setPanelWidth,
  }
}
