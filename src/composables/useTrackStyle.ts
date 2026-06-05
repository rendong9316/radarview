import * as Cesium from 'cesium'
import type { DataSource } from '../types/track'

interface TrackStyle {
  color: Cesium.Color
  icon: string
}

const cssVarMap: Record<DataSource, string> = {
  adsb: '--source-adsb',
  radar: '--source-radar',
  radar_raw: '--source-radar_raw',
  simulation: '--source-simulation',
}

function getSourceHexColor(source: DataSource): string {
  const varName = cssVarMap[source]
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw || fallbackColors[source]
}

const fallbackColors: Record<DataSource, string> = {
  adsb: '#00d4ff',
  radar: '#00ff88',
  radar_raw: '#ff8800',
  simulation: '#aa88ff',
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

// Cache icons by hex color
const iconCache = new Map<string, string>()
function getCachedIcon(hex: string): string {
  let icon = iconCache.get(hex)
  if (!icon) {
    icon = createCircleIcon(hex)
    iconCache.set(hex, icon)
  }
  return icon
}

export function useTrackStyle() {
  function getColor(source: DataSource): Cesium.Color {
    const hex = getSourceHexColor(source)
    return Cesium.Color.fromCssColorString(hex)
  }

  function getIcon(source: DataSource): string {
    const hex = getSourceHexColor(source)
    return getCachedIcon(hex)
  }

  function getStyle(source: DataSource): TrackStyle {
    return {
      color: getColor(source),
      icon: getIcon(source),
    }
  }

  /** Force refresh of cached colors/icons (call after theme change) */
  function refreshColors(): void {
    iconCache.clear()
  }

  return { getStyle, getColor, getIcon, getSourceHexColor, refreshColors }
}
