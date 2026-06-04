import { ref, watch } from 'vue'

const showLabels = ref(true)

export function useLabelVisibility() {
  function toggle() {
    showLabels.value = !showLabels.value
  }

  // Persist label visibility
  watch(showLabels, (v) => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      scheduleSave('display.show_labels', JSON.stringify(v))
    })
  }, { immediate: false })

  return { showLabels, toggle }
}
