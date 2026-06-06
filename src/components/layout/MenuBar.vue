<template>
  <Teleport to="body">
    <div
      v-if="openMenuR !== null"
      class="menu-dropdown"
      :style="dropdownStyle"
      @mouseenter="onDropdownEnter"
      @mouseleave="onDropdownLeave"
      @click.stop
    >
      <template v-for="(item, idx) in currentItems" :key="idx">
        <!-- Separator -->
        <div v-if="item.type === 'separator'" class="menu-separator" />

        <!-- Submenu trigger -->
        <div
          v-else-if="item.type === 'submenu'"
          class="menu-item submenu-trigger"
          :class="{ disabled: item.disabled, open: activeSubmenu === item.id }"
          @click.stop
          @mouseenter="openSubMenu = item.id! as 'appearance'"
        >
          <span class="menu-label">{{ item.label }}</span>
          <span class="menu-arrow">▸</span>
        </div>

        <!-- Inline submenu items (appearance) -->
        <template v-if="item.type === 'submenu' && activeSubmenu === item.id">
          <button
            v-for="th in themes"
            :key="th.id"
            class="menu-item submenu-item"
            @click="onThemeClick(th.id)"
          >
            <span class="menu-check">{{ activeTheme === th.id ? '✓' : '' }}</span>
            <span class="menu-label">{{ th.labelZh }} ({{ th.label }})</span>
          </button>
        </template>

        <!-- Normal item -->
        <button
          v-else
          class="menu-item"
          :class="{ disabled: item.disabled }"
          :disabled="item.disabled"
          @click="onItemClick(item)"
        >
          <span class="menu-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="menu-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>

  <!-- Top-level menu bar -->
  <nav class="menubar" @mouseleave="onBarLeave">
    <button
      v-for="m in menus"
      :key="m.id"
      class="menubar-btn"
      :class="{ active: openMenuR === m.id }"
      :ref="(el) => setBtnRef(m.id, el as HTMLElement)"
      @click.stop="onMenuClick(m.id)"
      @mouseenter="onMenuHover(m.id)"
    >
      {{ m.label }}
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { MenuName } from '../../composables/useMenu'
import { useMenu } from '../../composables/useMenu'
import { useTheme } from '../../composables/useTheme'

type MenuItemType = 'item' | 'separator' | 'submenu'

interface MenuItemDef {
  type: MenuItemType
  id?: string
  label?: string
  shortcut?: string
  disabled?: boolean
}

interface MenuDef {
  id: MenuName
  label: string
  items: MenuItemDef[]
}

const emit = defineEmits<{
  action: [id: string]
}>()

const { openMenu, openSubMenu, toggle, hoverOpen, close } = useMenu()
const { activeTheme, themes: themeDefs, setTheme } = useTheme()

const openMenuR = openMenu
const activeSubmenu = openSubMenu

// Button refs for positioning
const btnRefs = ref<Record<string, HTMLElement>>({})
function setBtnRef(id: string, el: HTMLElement) {
  if (el) btnRefs.value[id] = el
}

// ── Menu definitions ──
const menus: MenuDef[] = [
  {
    id: 'file',
    label: '文件',
    items: [
      { type: 'item', id: 'import-adsb', label: '导入 ADS-B 数据...', shortcut: 'Ctrl+O' },
      { type: 'item', id: 'import-radar', label: '导入雷达数据...', shortcut: 'Ctrl+Shift+O' },
      { type: 'item', id: 'import-radar-raw', label: '导入雷达原始测量数据...' },
      { type: 'separator' },
      { type: 'item', id: 'export-tracks', label: '导出当前航迹...', shortcut: 'Ctrl+S', disabled: true },
      { type: 'separator' },
      { type: 'item', id: 'exit', label: '退出', shortcut: 'Alt+F4' },
    ],
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { type: 'item', id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', disabled: true },
      { type: 'item', id: 'redo', label: '重做', shortcut: 'Ctrl+Y', disabled: true },
      { type: 'separator' },
      { type: 'item', id: 'select-all', label: '全选航迹', shortcut: 'Ctrl+A', disabled: true },
      { type: 'item', id: 'clear-selection', label: '清除选中', shortcut: 'Esc' },
      { type: 'separator' },
      { type: 'item', id: 'open-settings', label: '首选项设置', shortcut: 'Ctrl+,' },
    ],
  },
  {
    id: 'view',
    label: '视图',
    items: [
      { type: 'submenu', id: 'appearance', label: '外观' },
      { type: 'separator' },
      { type: 'item', id: 'toggle-track-panel', label: '轨迹面板', shortcut: 'Ctrl+Shift+T' },
      { type: 'item', id: 'toggle-manage-panel', label: '航迹管理系统', shortcut: 'Ctrl+Shift+M' },
      { type: 'item', id: 'toggle-layer-panel', label: '图层控制', shortcut: 'Ctrl+Shift+L' },
      { type: 'item', id: 'toggle-flag-panel', label: '旗标面板', shortcut: 'Ctrl+Shift+F' },
      { type: 'item', id: 'toggle-time-filter', label: '时间过滤', shortcut: 'Ctrl+Shift+E' },
      { type: 'separator' },
      { type: 'item', id: 'reset-view', label: '重置地图视角', shortcut: 'Ctrl+R' },
      { type: 'item', id: 'toggle-labels', label: '切换标签显示', shortcut: 'Ctrl+T' },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    items: [
      { type: 'item', id: 'toggle-playback', label: '航迹回放控制' },
      { type: 'separator' },
      { type: 'item', id: 'toggle-batch-panel', label: '批量数据管理' },
      { type: 'item', id: 'open-flags', label: '旗标管理' },
      { type: 'item', id: 'clear-all-flags', label: '清除所有旗标' },
      { type: 'separator' },
      { type: 'item', id: 'open-dev-tools', label: '开发工具', shortcut: 'F12' },
    ],
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { type: 'item', id: 'about', label: '关于 RadarView' },
      { type: 'separator' },
      { type: 'item', id: 'shortcuts', label: '键盘快捷键参考' },
      { type: 'item', id: 'docs', label: '使用文档' },
    ],
  },
]

const currentItems = computed<MenuItemDef[]>(() => {
  if (!openMenuR.value) return []
  const menu = menus.find(m => m.id === openMenuR.value)
  return menu?.items ?? []
})

// ── Dropdown positioning ──
const dropdownStyle = computed(() => {
  if (!openMenuR.value) return { display: 'none' as const }
  const btn = btnRefs.value[openMenuR.value]
  if (!btn) return { display: 'none' as const }
  const rect = btn.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    top: `${rect.bottom}px`,
    left: `${rect.left}px`,
    zIndex: 50,
  }
})

// ── Theme list for submenu ──
const themes = computed(() => [
  themeDefs.dark,
  themeDefs.light,
  themeDefs.hc,
])

// ── Event handlers ──
function onMenuClick(name: MenuName) {
  toggle(name)
}

function onMenuHover(name: MenuName) {
  hoverOpen(name)
}

function onBarLeave() {
  // close after a short delay — canceled if mouse enters dropdown
  // (handled implicitly: dropdown @mouseleave will close it)
}

function onDropdownEnter() {
  // Keep menu open when mouse enters dropdown from menu bar
}

function onDropdownLeave() {
  close()
}

function onItemClick(item: MenuItemDef) {
  if (item.disabled || !item.id) return
  emit('action', item.id)
  close()
}

function onThemeClick(id: string) {
  setTheme(id as 'dark' | 'light' | 'hc')
  close()
}

// ── Global click to close menus ──
function onGlobalClick() {
  close()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && openMenu.value !== null) {
    e.preventDefault()
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.menubar {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 0;
}

.menubar-btn {
  height: 100%;
  padding: 0 8px;
  font-size: 0.929rem;
  color: var(--titlebar-fg);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
}
.menubar-btn:hover,
.menubar-btn.active {
  background: var(--menu-hover);
}

/* ── Dropdown ── */
.menu-dropdown {
  min-width: 220px;
  background: var(--menu-bg);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 4px 0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 20px;
  font-size: 0.929rem;
  color: var(--menu-fg);
  background: transparent;
  border: none;
  border-radius: 0;
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
  min-height: 24px;
  line-height: 20px;
}
.menu-item:hover:not(.disabled) {
  background: var(--menu-hover);
}
.menu-item.disabled {
  color: var(--menu-shortcut);
  cursor: default;
}

.menu-label {
  flex: 1;
}

.menu-shortcut {
  margin-left: 24px;
  color: var(--menu-shortcut);
  font-size: 0.857rem;
}

.menu-check {
  width: 16px;
  margin-right: 2px;
  text-align: center;
}

.menu-arrow {
  color: var(--menu-shortcut);
  font-size: 0.786rem;
}

.menu-separator {
  height: 1px;
  margin: 4px 12px;
  background: var(--menu-separator);
}

.submenu-trigger {
  position: relative;
}
.submenu-trigger.open {
  background: var(--menu-hover);
}

.submenu-item {
  padding-left: 36px !important;
}

/* Submenu dropdown */
.submenu-dropdown {
  min-width: 200px;
}
</style>
