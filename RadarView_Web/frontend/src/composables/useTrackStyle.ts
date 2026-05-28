import * as Cesium from 'cesium'
import type { DataSource } from '../types/track'

interface TrackStyle {
  color: Cesium.Color
  icon: string
}

function createCircleIcon(hexColor: string): string {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = hexColor
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1.5
  ctx.stroke()
  return canvas.toDataURL('image/png')
}

const styles: Record<DataSource, TrackStyle> = {
  adsb: {
    color: Cesium.Color.fromCssColorString('#00d4ff'),
    icon: createCircleIcon('#00d4ff'),
  },
  radar: {
    color: Cesium.Color.fromCssColorString('#00ff88'),
    icon: createCircleIcon('#00ff88'),
  },
  radar_raw: {
    color: Cesium.Color.fromCssColorString('#ff8800'),
    icon: createCircleIcon('#ff8800'),
  },
  simulation: {
    color: Cesium.Color.fromCssColorString('#aa88ff'),
    icon: createCircleIcon('#aa88ff'),
  },
}

export function useTrackStyle() {
  function getStyle(source: DataSource): TrackStyle {
    return styles[source]
  }

  function getColor(source: DataSource): Cesium.Color {
    return styles[source].color
  }

  function getIcon(source: DataSource): string {
    return styles[source].icon
  }

  return { getStyle, getColor, getIcon }
}
