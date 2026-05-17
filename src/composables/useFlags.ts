import { ref, computed } from 'vue'

export interface Flag {
  id: string
  latitude: number
  longitude: number
  label: string
  createdAt: number
}

const flags = ref<Flag[]>([])
const selectedFlagIds = ref<string[]>([])

export function useFlags() {
  let counter = 0

  function addFlag(lat: number, lng: number, label?: string) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    counter++
    const id = crypto.randomUUID()
    flags.value = [
      ...flags.value,
      { id, latitude: lat, longitude: lng, label: label || `旗标 ${counter}`, createdAt: Date.now() },
    ]
  }

  function removeFlag(id: string) {
    flags.value = flags.value.filter((f) => f.id !== id)
    selectedFlagIds.value = selectedFlagIds.value.filter((fid) => fid !== id)
  }

  function toggleSelectFlag(id: string) {
    const idx = selectedFlagIds.value.indexOf(id)
    if (idx >= 0) {
      selectedFlagIds.value = selectedFlagIds.value.filter((fid) => fid !== id)
    } else {
      if (selectedFlagIds.value.length >= 2) {
        selectedFlagIds.value = [selectedFlagIds.value[1], id]
      } else {
        selectedFlagIds.value = [...selectedFlagIds.value, id]
      }
    }
  }

  function clearSelection() {
    selectedFlagIds.value = []
  }

  const selectedPair = computed(() => {
    if (selectedFlagIds.value.length !== 2) return null
    const f1 = flags.value.find((f) => f.id === selectedFlagIds.value[0])
    const f2 = flags.value.find((f) => f.id === selectedFlagIds.value[1])
    if (!f1 || !f2) return null
    return [f1, f2] as const
  })

  return {
    flags,
    selectedFlagIds,
    selectedPair,
    addFlag,
    removeFlag,
    toggleSelectFlag,
    clearSelection,
  }
}
