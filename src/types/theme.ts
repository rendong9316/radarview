/** VS Code-style theme color definitions */
export interface ThemeColors {
  // Title bar
  '--titlebar-bg': string
  '--titlebar-fg': string
  '--titlebar-border': string

  // Menu
  '--menu-bg': string
  '--menu-fg': string
  '--menu-hover': string
  '--menu-separator': string
  '--menu-shortcut': string

  // Activity bar
  '--activitybar-bg': string
  '--activitybar-fg': string
  '--activitybar-active': string
  '--activitybar-active-border': string

  // Side bar
  '--sidebar-bg': string
  '--sidebar-fg': string
  '--sidebar-border': string
  '--sidebar-header': string

  // Status bar
  '--statusbar-bg': string
  '--statusbar-fg': string
  '--statusbar-border': string

  // Editor area
  '--editor-bg': string

  // Base
  '--bg-primary': string
  '--bg-secondary': string
  '--bg-tertiary': string

  // Text
  '--text-primary': string
  '--text-secondary': string
  '--text-tertiary': string

  // Border
  '--border-primary': string
  '--border-secondary': string

  // Accent
  '--accent-primary': string
  '--accent-hover': string

  // Interactive
  '--button-bg': string
  '--button-hover': string
  '--button-fg': string
  '--input-bg': string
  '--input-border': string
  '--input-fg': string
  '--dropdown-bg': string
  '--dropdown-hover': string
  '--dropdown-fg': string

  // Scrollbar
  '--scrollbar-bg': string
  '--scrollbar-thumb': string

  // Semantic
  '--error': string
  '--error-bg': string
  '--warning': string
  '--info': string

  // Source colors (track lines)
  '--source-adsb': string
  '--source-radar': string
  '--source-radar_raw': string
  '--source-simulation': string

  // Cesium scene background
  '--cesium-bg': string
  '--cesium-globe-base': string
}

export type ThemeId = 'dark' | 'light' | 'hc'

export interface Theme {
  id: ThemeId
  label: string
  labelZh: string
  colors: ThemeColors
}
