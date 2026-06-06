import { reactive, watch } from 'vue'
import type { DataSource } from '../types/track'

/**
 * Custom line colors per data source.
 * null = use theme default (CSS variable fallback).
 */
const lineColors = reactive<Record<DataSource, string | null>>({
  adsb: null,
  radar: null,
  radar_raw: null,
  simulation: null,
})

/** Theme CSS variable name for each source */
const cssVarMap: Record<DataSource, string> = {
  adsb: '--source-adsb',
  radar: '--source-radar',
  radar_raw: '--source-radar_raw',
  simulation: '--source-simulation',
}

/** Hard fallback colors (dark theme defaults, used when CSS vars are unavailable) */
const fallbackColors: Record<DataSource, string> = {
  adsb: '#00d4ff',
  radar: '#00ff88',
  radar_raw: '#ff8800',
  simulation: '#aa88ff',
}

/** Read the current theme's default color for a source from CSS variables. */
export function getThemeColor(source: DataSource): string {
  if (typeof document === 'undefined') return fallbackColors[source]
  const varName = cssVarMap[source]
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return raw || fallbackColors[source]
}

export function useLineColor() {
  /** Get the effective hex color: custom if set, otherwise theme default. */
  function getEffectiveHex(source: DataSource): string {
    return lineColors[source] || getThemeColor(source)
  }

  /** Set a custom line color for a source. Pass null to reset to theme default. */
  function setLineColor(source: DataSource, hex: string | null) {
    lineColors[source] = hex
  }

  /** Check if a source has a custom color override. */
  function hasCustomColor(source: DataSource): boolean {
    return lineColors[source] !== null
  }

  // Persist line color changes
  watch(lineColors, () => {
    import('./useSettingsPersistence').then(({ scheduleSave }) => {
      for (const [src, v] of Object.entries(lineColors)) {
        scheduleSave(`display.line_color.${src}`, JSON.stringify(v))
      }
    })
  }, { deep: true, immediate: false })

  return { lineColors, getEffectiveHex, setLineColor, hasCustomColor }
}
