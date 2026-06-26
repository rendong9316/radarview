import { ref, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type { Track } from '../types/track'
import { fromTrackDto } from './convertTrack'

export function useTrackLoader() {
  const loading = ref(false)
  const persisting = ref(false) // true while background DB write is in progress
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

  function onPersistComplete() {
    persisting.value = false
  }

  /** Convert backend tracks in chunks, yielding to keep UI responsive */
  async function convertInChunks(raw: any[]): Promise<Track[]> {
    const result: Track[] = new Array(raw.length)
    const CHUNK = 300
    for (let i = 0; i < raw.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, raw.length)
      for (let j = i; j < end; j++) {
        result[j] = fromTrackDto(raw[j])
      }
      progress.value = Math.round((end / raw.length) * 100)
      await nextTick()
    }
    return result
  }

  async function loadAdsbFile(): Promise<Track[]> {
    let selected: string | string[] | null = null
    try {
      selected = await open({
        title: 'Select ADS-B CSV File',
        filters: [{ name: 'ADS-B CSV', extensions: ['csv'] }],
        multiple: false,
      })
    } catch (e) {
      console.error('[loadAdsbFile] open dialog failed:', e)
      throw new Error(`Dialog error: ${e}`)
    }

    if (!selected) {
      console.log('[loadAdsbFile] no file selected (user cancelled)')
      return []
    }

    console.log('[loadAdsbFile] selected file:', selected)

    loading.value = true
    persisting.value = true // set before IPC — batch-saved may fire before we return
    progress.value = 0
    await startProgressListener()
    const t0 = performance.now()
    try {
      const raw = await invoke('import_adsb_file', { filePath: selected as string }) as any[]
      const t1 = performance.now()
      console.log(`[perf] IPC call (parse+DTO+transfer): ${(t1 - t0).toFixed(0)}ms  |  tracks=${raw.length}`)
      // Tracks parsed — loading done, persisting stays true until batch-saved fires
      const tracks = await convertInChunks(raw)
      loading.value = false
      const t2 = performance.now()
      console.log(`[perf] convertInChunks: ${(t2 - t1).toFixed(0)}ms`)
      return tracks
    } catch (e) {
      loading.value = false
      persisting.value = false
      console.error('[loadAdsbFile] import failed:', e)
      throw e
    } finally {
      stopProgressListener()
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
    persisting.value = true // set before IPC — batch-saved may fire before we return
    progress.value = 0
    await startProgressListener()
    try {
      const raw = await invoke('import_radar_file', { filePath: selected as string }) as any[]
      progress.value = 90
      const tracks = await convertInChunks(raw)
      loading.value = false
      return tracks
    } catch (e) {
      loading.value = false
      persisting.value = false
      throw e
    } finally {
      stopProgressListener()
    }
  }

  async function loadRadarRawFile(): Promise<Track[]> {
    const selected = await open({
      title: 'Select Raw Radar MAT File',
      filters: [{ name: 'Radar MAT', extensions: ['mat'] }],
      multiple: false,
    })
    if (!selected) return []

    loading.value = true
    persisting.value = true // set before IPC — batch-saved may fire before we return
    progress.value = 0
    await startProgressListener()
    try {
      const raw = await invoke('import_radar_raw_file', { filePath: selected as string }) as any[]
      progress.value = 90
      const tracks = await convertInChunks(raw)
      loading.value = false
      return tracks
    } catch (e) {
      loading.value = false
      persisting.value = false
      throw e
    } finally {
      stopProgressListener()
    }
  }

  return { loading, persisting, progress, loadAdsbFile, loadRadarFile, loadRadarRawFile, onPersistComplete }
}
