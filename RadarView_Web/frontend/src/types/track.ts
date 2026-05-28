/** 数据来源类型 */
export type DataSource = 'adsb' | 'radar' | 'radar_raw' | 'simulation'

/** 单个航迹点（某一时刻的位置和状态） */
export interface TrackPoint {
  /** UTC 时间戳（毫秒） */
  timestamp: number
  /** 纬度（WGS-84） */
  latitude: number
  /** 经度（WGS-84） */
  longitude: number
  /** 高度（米） */
  altitude: number
  /** 航向（度，0-360） */
  heading: number
  /** 地速（节） */
  groundSpeed: number
  /** 垂直速率（ft/min，正=爬升） */
  verticalRate: number
}

/** 统一航迹结构 */
export interface Track {
  /** 唯一标识（ADS-B 用 ICAO Address，雷达用 Target ID） */
  id: string
  /** 数据来源 */
  source: DataSource
  /** 航迹点列表（按时间排序） */
  positions: TrackPoint[]
  /** 元数据 */
  metadata: TrackMetadata
}

/** 航迹元数据（ADS-B 和雷达共用字段） */
export interface TrackMetadata {
  /** 航班号（IATA，如 TG659） */
  flightNumber?: string
  /** ICAO 航班号（如 THA659） */
  icaoFlightNumber?: string
  /** 飞机注册号 */
  registration?: string
  /** ICAO 机型代码（如 A359） */
  aircraftType?: string
  /** 航司 ICAO 代码（如 THA） */
  airline?: string
  /** 起飞机场 IATA 代码 */
  origin?: string
  /** 目的机场 IATA 代码 */
  destination?: string
  /** 接收站 ID */
  receiver?: string
}

/** 图层可见性状态 */
export interface LayerVisibility {
  adsb: boolean
  radar: boolean
  radar_raw: boolean
  simulation: boolean
}
