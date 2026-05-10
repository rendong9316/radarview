import { ref, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type { Track } from '../types/track'
import { fromBackendTrack } from './convertTrack'

export function useTrackLoader() {
  const loading = ref(false)
  const progress = ref(0)

  let unlisten: UnlistenFn | null = null

  async function startProgressListener() {
    if (unlisten) return
    unlisten = await listen<{ stage: string; percent: number }>('convert-progress', (event) => {
      progress.value = event.payload.percent
    })
  }

  function stopProgressListener() {
    unlisten?.()
    unlisten = null
  }

  /** Convert backend tracks in chunks, yielding to keep UI responsive */
  async function convertInChunks(raw: any[]): Promise<Track[]> {
    const result: Track[] = new Array(raw.length)
    const CHUNK = 300
    for (let i = 0; i < raw.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, raw.length)
      for (let j = i; j < end; j++) {
        result[j] = fromBackendTrack(raw[j])
      }
      progress.value = Math.round((end / raw.length) * 100)
      await nextTick()
    }
    return result
  }

  async function loadAdsbFile(): Promise<Track[]> {
    const selected = await open({
      title: 'Select ADS-B CSV File',
      filters: [{ name: 'ADS-B CSV', extensions: ['csv'] }],
      multiple: false,
    })
    if (!selected) return []

    loading.value = true
    progress.value = 0
    try {
      const raw = await invoke('import_adsb_file', { filePath: selected as string }) as any[]
      return await convertInChunks(raw)
    } finally {
      loading.value = false
    }
  }

  async function loadRadarFile(): Promise<Track[]> {
    const selected = await open({
      title: 'Select Radar MAT File',
      filters: [{ name: 'Radar MAT', extensions: ['mat'] }],
      multiple: false,
    })
    if (!selected) return []

    loading.value = true
    progress.value = 0
    await startProgressListener()
    try {
      const raw = await invoke('import_radar_file', { filePath: selected as string }) as any[]
      progress.value = 90
      return await convertInChunks(raw)
    } finally {
      loading.value = false
      stopProgressListener()
    }
  }

  return { loading, progress, loadAdsbFile, loadRadarFile }
}
