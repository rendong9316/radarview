import type { Theme } from '../types/theme'

export const hcTheme: Theme = {
  id: 'hc',
  label: 'High Contrast',
  labelZh: '高对比度主题',
  icon: '◐',
  colors: {
    '--titlebar-bg': '#000000',
    '--titlebar-fg': '#ffffff',
    '--titlebar-border': '#6fc3df',

    '--menu-bg': '#0a0a0a',
    '--menu-fg': '#ffffff',
    '--menu-hover': '#1aebff',
    '--menu-separator': '#6fc3df',
    '--menu-shortcut': '#a0a0a0',

    '--activitybar-bg': '#000000',
    '--activitybar-fg': '#999999',
    '--activitybar-active': '#ffffff',
    '--activitybar-active-border': '#1aebff',

    '--sidebar-bg': '#0a0a0a',
    '--sidebar-fg': '#ffffff',
    '--sidebar-border': '#6fc3df',
    '--sidebar-header': '#ffffff',

    '--statusbar-bg': '#000000',
    '--statusbar-fg': '#ffffff',
    '--statusbar-border': '#6fc3df',

    '--editor-bg': '#000000',

    '--bg-primary': '#000000',
    '--bg-secondary': '#0a0a0a',
    '--bg-tertiary': '#111111',

    '--text-primary': '#ffffff',
    '--text-secondary': '#e0e0e0',
    '--text-tertiary': '#a0a0a0',

    '--border-primary': '#6fc3df',
    '--border-secondary': '#444444',

    '--accent-primary': '#1aebff',
    '--accent-hover': '#6fc3df',

    '--button-bg': '#111111',
    '--button-hover': '#1aebff',
    '--button-fg': '#ffffff',
    '--input-bg': '#0a0a0a',
    '--input-border': '#6fc3df',
    '--input-fg': '#ffffff',
    '--dropdown-bg': '#0a0a0a',
    '--dropdown-hover': '#1aebff',
    '--dropdown-fg': '#ffffff',

    '--scrollbar-bg': '#000000',
    '--scrollbar-thumb': '#6fc3df',

    '--error': '#f44747',
    '--error-bg': 'rgba(244,71,71,0.2)',
    '--warning': '#ffcc00',
    '--info': '#1aebff',

    '--source-adsb': '#1aebff',
    '--source-radar': '#00ff88',
    '--source-radar_raw': '#ffaa00',
    '--source-simulation': '#cc88ff',

    '--cesium-bg': '#000000',
    '--cesium-globe-base': '#000000',
  },
}
