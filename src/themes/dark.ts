import type { Theme } from '../types/theme'

export const darkTheme: Theme = {
  id: 'dark',
  label: 'Dark+',
  labelZh: '深色主题',
  icon: '🌙',
  colors: {
    '--titlebar-bg': '#2d2d2d',
    '--titlebar-fg': '#cccccc',
    '--titlebar-border': '#3c3c3c',

    '--menu-bg': '#252526',
    '--menu-fg': '#cccccc',
    '--menu-hover': '#094771',
    '--menu-separator': '#454545',
    '--menu-shortcut': '#888888',

    '--activitybar-bg': '#333333',
    '--activitybar-fg': '#858585',
    '--activitybar-active': '#ffffff',
    '--activitybar-active-border': '#007acc',

    '--sidebar-bg': '#252526',
    '--sidebar-fg': '#cccccc',
    '--sidebar-border': '#3c3c3c',
    '--sidebar-header': '#cccccc',

    '--statusbar-bg': '#007acc',
    '--statusbar-fg': '#ffffff',
    '--statusbar-border': '#005a9e',

    '--editor-bg': '#1e1e1e',

    '--bg-primary': '#1e1e1e',
    '--bg-secondary': '#252526',
    '--bg-tertiary': '#2d2d2d',

    '--text-primary': '#cccccc',
    '--text-secondary': '#a0a0a0',
    '--text-tertiary': '#6a6a6a',

    '--border-primary': '#3e3e3e',
    '--border-secondary': '#2d2d2d',

    '--accent-primary': '#007acc',
    '--accent-hover': '#1a8ad4',

    '--button-bg': '#3c3c3c',
    '--button-hover': '#4c4c4c',
    '--button-fg': '#cccccc',
    '--input-bg': '#3c3c3c',
    '--input-border': '#555555',
    '--input-fg': '#cccccc',
    '--dropdown-bg': '#252526',
    '--dropdown-hover': '#094771',
    '--dropdown-fg': '#cccccc',

    '--scrollbar-bg': '#1e1e1e',
    '--scrollbar-thumb': '#424242',

    '--error': '#f44747',
    '--error-bg': 'rgba(244,71,71,0.15)',
    '--warning': '#cca700',
    '--info': '#3794ff',

    '--source-adsb': '#00d4ff',
    '--source-radar': '#00ff88',
    '--source-radar_raw': '#ff8800',
    '--source-simulation': '#aa88ff',
  },
}
