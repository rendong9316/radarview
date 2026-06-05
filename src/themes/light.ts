import type { Theme } from '../types/theme'

export const lightTheme: Theme = {
  id: 'light',
  label: 'Light+',
  labelZh: '浅色主题',
  icon: '☀️',
  colors: {
    '--titlebar-bg': '#dddddd',
    '--titlebar-fg': '#333333',
    '--titlebar-border': '#c8c8c8',

    '--menu-bg': '#f0f0f0',
    '--menu-fg': '#333333',
    '--menu-hover': '#cce5ff',
    '--menu-separator': '#d4d4d4',
    '--menu-shortcut': '#888888',

    '--activitybar-bg': '#dddddd',
    '--activitybar-fg': '#666666',
    '--activitybar-active': '#333333',
    '--activitybar-active-border': '#005fb8',

    '--sidebar-bg': '#f3f3f3',
    '--sidebar-fg': '#333333',
    '--sidebar-border': '#e5e5e5',
    '--sidebar-header': '#333333',

    '--statusbar-bg': '#005fb8',
    '--statusbar-fg': '#ffffff',
    '--statusbar-border': '#004c9a',

    '--editor-bg': '#ffffff',

    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f3f3f3',
    '--bg-tertiary': '#ececec',

    '--text-primary': '#333333',
    '--text-secondary': '#555555',
    '--text-tertiary': '#888888',

    '--border-primary': '#e5e5e5',
    '--border-secondary': '#d4d4d4',

    '--accent-primary': '#005fb8',
    '--accent-hover': '#0068cd',

    '--button-bg': '#e0e0e0',
    '--button-hover': '#d0d0d0',
    '--button-fg': '#333333',
    '--input-bg': '#ffffff',
    '--input-border': '#c8c8c8',
    '--input-fg': '#333333',
    '--dropdown-bg': '#f0f0f0',
    '--dropdown-hover': '#cce5ff',
    '--dropdown-fg': '#333333',

    '--scrollbar-bg': '#f3f3f3',
    '--scrollbar-thumb': '#c1c1c1',

    '--error': '#e51400',
    '--error-bg': 'rgba(229,20,0,0.1)',
    '--warning': '#bf8803',
    '--info': '#0066cc',

    '--source-adsb': '#0078d4',
    '--source-radar': '#00885a',
    '--source-radar_raw': '#d47300',
    '--source-simulation': '#7744aa',
  },
}
