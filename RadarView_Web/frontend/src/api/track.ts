import api from './index'

export interface BatchInfo {
  id: number
  fileName: string
  source: string
  trackCount: number
  fileHash: string
  fileSize: number
  importedBy: number
  status: string
  importedAt: string
}

export interface TrackPoint {
  timestamp: number
  latitude: number
  longitude: number
  altitude: number
  heading: number
  groundSpeed: number
  verticalRate: number
}

export interface TrackDetail {
  id: number
  batchId: number
  icaoAddress: string
  flightNo: string
  icaoFlightNo: string
  aircraftType: string
  registration: string
  airline: string
  origin: string
  destination: string
  source: string
  positionCount: number
  minTimestamp: number
  maxTimestamp: number
  positions: TrackPoint[]
}

export interface ImportTaskResult {
  taskId: string
  batchId: number
  success: boolean
  trackCount: number
  errorMsg: string | null
}

export interface ImportProgress {
  taskId: string
  batchId: number
  stage: string
  percent: number
  userId: number
}

export const trackApi = {
  importAdsb(file: File, onProgress?: (percent: number) => void) {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ code: number; data: ImportTaskResult }>(
      '/tracks/import/adsb',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 50))
          }
        },
      }
    )
  },

  importRadar(file: File, onProgress?: (percent: number) => void) {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ code: number; data: ImportTaskResult }>(
      '/tracks/import/radar',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 50))
          }
        },
      }
    )
  },

  importRadarRaw(file: File, onProgress?: (percent: number) => void) {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ code: number; data: ImportTaskResult }>(
      '/tracks/import/radar-raw',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 50))
          }
        },
      }
    )
  },

  getAllTracks() {
    return api.get<{ code: number; data: TrackDetail[] }>('/tracks')
  },

  getTracksByBatch(batchId: number) {
    return api.get<{ code: number; data: TrackDetail[] }>(`/tracks/batch/${batchId}`)
  },

  getAllBatches() {
    return api.get<{ code: number; data: BatchInfo[] }>('/batches')
  },

  deleteBatch(batchId: number) {
    return api.delete<{ code: number; data: null }>(`/batches/${batchId}`)
  },
}
