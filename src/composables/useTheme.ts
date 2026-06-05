import { ref } from 'vue'
import type { ThemeId } from '../types/theme'
import { darkTheme } from '../themes/dark'
import { lightTheme } from '../themes/light'
import { hcTheme } from '../themes/highContrast'

const themes = { dark: darkTheme, light: lightTheme, hc: hcTheme } as const

const activeThemeId = ref<ThemeId>('dark')
let _initialized = false

/**
 * Apply theme CSS variables to :root.
 */
function applyTheme(id: ThemeId): void {
  const theme = themes[id]
  if (!theme) return

  const root = document.documentElement
  const colors = theme.colors

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value)
  }

  activeThemeId.value = id
}

/**
 * Initialize theme: apply persisted theme or default (dark).
 * Must be called after settings are loaded.
 */
export function initTheme(savedId?: string): void {
  if (_initialized) return
  _initialized = true

  const id = (savedId && savedId in themes) ? (savedId as ThemeId) : 'dark'
  applyTheme(id)
}

/**
 * Switch to a different theme and persist the choice.
 */
export function setTheme(id: ThemeId): void {
  applyTheme(id)

  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave('theme.id', JSON.stringify(id))
  })
}

/**
 * Cycle through themes: dark → light → hc → dark
 */
export function cycleTheme(): void {
  const order: ThemeId[] = ['dark', 'light', 'hc']
  const idx = order.indexOf(activeThemeId.value)
  const next = order[(idx + 1) % order.length]
  setTheme(next)
}

/**
 * Get the current theme's CSS variable value.
 * Returns empty string if running in SSR or variable not set.
 */
export function getThemeVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Reactive composable for theme state.
 */
export function useTheme() {
  return {
    activeTheme: activeThemeId,
    themes,
    setTheme,
    cycleTheme,
    getThemeVar,
  }
}
