import { ref, computed } from 'vue'
import type { TrackMetaInfo } from '../types/manage'

// ── Types ──

export interface UndoItem {
  icao: string
  batchId: number
  dbSource: string // "ADS-B" | "Radar" | "RadarRaw"
  frontendSource: string // "adsb" | "radar" | "radar_raw"
  /** Whether this track was visible on the map before hiding */
  wasVisible: boolean
  /** ICAO+batchId key for visibleTrackKeys restore */
  dbKey: string
  /** icao+frontendSource key for useTracks visible set restore */
  trKey: string
  /** Row metadata for table display */
  row: TrackMetaInfo
}

export interface UndoEntry {
  id: number
  label: string
  items: UndoItem[]
}

// ── Module-level singleton state ──

const stack = ref<UndoEntry[]>([])

let _nextId = 0

// ── Exported composable ──

export function useUndoStack() {
  const top = computed<UndoEntry | null>(() => stack.value[stack.value.length - 1] ?? null)
  const count = computed(() => stack.value.length)

  /** Push a deletion onto the undo stack. Returns the entry id. */
  function push(label: string, items: UndoItem[]): number {
    const id = _nextId++
    stack.value = [...stack.value, { id, label, items }]
    return id
  }

  /** Undo the most recent deletion (top of stack).
   *  Returns the popped entry, or null if stack is empty. */
  function pop(): UndoEntry | null {
    const entry = top.value
    if (!entry) return null
    stack.value = stack.value.slice(0, -1)
    return entry
  }

  return { stack, top, count, push, pop }
}
