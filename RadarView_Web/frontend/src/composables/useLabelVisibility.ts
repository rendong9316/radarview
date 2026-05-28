import { ref } from 'vue'

const showLabels = ref(true)

export function useLabelVisibility() {
  function toggle() {
    showLabels.value = !showLabels.value
  }

  return { showLabels, toggle }
}
