import { ref } from 'vue'

/** Module-level singleton: ICAO addresses of tracks highlighted from the map. */
const highlightedIcaos = ref(new Set<string>())

export function useTrackHighlight() {
  function addHighlight(icao: string) {
    const next = new Set(highlightedIcaos.value)
    next.add(icao)
    highlightedIcaos.value = next
  }

  function clearAllHighlights() {
    highlightedIcaos.value = new Set()
  }

  function isHighlighted(icao: string): boolean {
    return highlightedIcaos.value.has(icao)
  }

  return {
    highlightedIcaos,
    addHighlight,
    clearAllHighlights,
    isHighlighted,
  }
}
