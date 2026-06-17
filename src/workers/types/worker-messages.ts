// ============================================================
// Worker 消息类型定义
// ============================================================

/** 序列化后的航迹数据（使用 TypedArray 高效传输） */
export interface SerializedTrack {
  timestamps: Float64Array
  lats: Float64Array
  lngs: Float64Array
  altitudes?: Float64Array  // 可选
}

/** 初始化消息：主线程 → Worker */
export interface InitMessage {
  type: 'init'
  tracks: SerializedTrack[]
  trackKeys: string[]
  flatAltitude: number
}

/** 计算请求消息：主线程 → Worker */
export interface ComputeMessage {
  type: 'compute'
  time: number
}

/** 计算响应消息：Worker → 主线程 */
export interface ResultMessage {
  type: 'result'
  results: TrackResult[]
  timestamp: number  // 请求时间戳，用于丢弃过期结果
}

/** 单条航迹的计算结果 */
export interface TrackResult {
  key: string
  lo: number
  lat: number
  lng: number
  altitude?: number
  progress: number  // 0-1
}

/** Worker 消息联合类型 */
export type WorkerMessage = InitMessage | ComputeMessage | ResultMessage